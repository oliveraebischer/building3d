import asyncio
import math
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
from typing import Optional

import fiona
from fastapi import APIRouter, Depends, HTTPException, Query
from pyproj import Transformer

from app.auth import get_current_user
from app.routers.tiles import _load_manifest

router = APIRouter(prefix="/api/buildings", tags=["buildings"], dependencies=[Depends(get_current_user)])
DATA_DIR = Path(__file__).parents[2] / "data" / "tiles"
_executor = ThreadPoolExecutor(max_workers=2)

# See "Risks — cache memory bound" in the plan: start conservative, raise
# only after confirming actual RSS headroom against the 1GB VM budget.
_TILE_CACHE_SIZE = 8


def _candidate_tile_ids(lv95_bbox: Optional[tuple]) -> list:
    """Tile ids worth opening for this query. Cheap (JSON + directory read,
    no GDAL) — deliberately not cached, so a freshly downloaded tile is
    immediately visible.

    - lv95_bbox is None -> every known tile (manifest union on-disk-only
      dirs); this is the exhaustive fallback for /measurements calls made
      without the optional bbox param.
    - Otherwise -> tiles whose bbox_lv95 intersects lv95_bbox, plus any tile
      with no bbox_lv95 (pre-migration tile, or a failed one-time extraction)
      which is always included as a safe fallback, plus any tile directory
      present on disk but missing from manifest.json (defensive — matches the
      old DATA_DIR.iterdir()-based behavior for that edge case).
    """
    manifest = _load_manifest()
    disk_only = []
    if DATA_DIR.is_dir():
        disk_only = [p.name for p in DATA_DIR.iterdir() if p.is_dir() and p.name not in manifest]

    if lv95_bbox is None:
        return list(manifest.keys()) + disk_only

    minx, miny, maxx, maxy = lv95_bbox
    result = []
    for tile_id, info in manifest.items():
        b = info.get("bbox_lv95")
        if b is None:
            result.append(tile_id)  # unknown bbox -> always a candidate
            continue
        tminx, tminy, tmaxx, tmaxy = b
        if tmaxx < minx or tminx > maxx or tmaxy < miny or tminy > maxy:
            continue  # definite gap on some axis -> no overlap
        result.append(tile_id)
    result.extend(disk_only)
    return result


def _find_tile_zip(tile_id: str) -> Optional[Path]:
    tile_dir = DATA_DIR / tile_id
    if not tile_dir.is_dir():
        return None
    for zip_file in tile_dir.glob("*.gdb.zip"):
        return zip_file
    return None


@lru_cache(maxsize=_TILE_CACHE_SIZE)
def _get_tile_features(tile_id: str) -> dict:
    """Parse one tile's Building_solid layer ONCE (per process lifetime,
    subject to LRU eviction at _TILE_CACHE_SIZE) and cache its complete,
    unfiltered contents keyed by tile_id.

    IMPORTANT: keep this a full, query-independent scan. The cache key is
    tile_id alone, so the cached value must stay valid for ANY future
    bbox/EGID combination touching this tile — never add a where=/bbox=
    filter here parameterized by the current request, or a later request
    with different filters hitting the same tile would silently see
    incomplete data.

    Returns:
        {
          "by_egid":    {123456: {"geometry": <raw LV95 geom dict>, "properties": {...}}, ...},
          "unassigned": [{"geometry": ..., "properties": ...}, ...],  # EGID is null
        }
    Geometry/properties are plain dicts, fully detached from fiona/GDAL.
    """
    zip_file = _find_tile_zip(tile_id)
    if zip_file is None:
        return {"by_egid": {}, "unassigned": []}

    vsipath = f"/vsizip/{zip_file.resolve()}"
    by_egid: dict = {}
    unassigned: list = []
    try:
        with fiona.open(vsipath, layer="Building_solid") as src:
            for f in src:
                props = dict(f["properties"])
                geom = f["geometry"]
                entry = {
                    "geometry": {"type": geom["type"], "coordinates": geom["coordinates"]},
                    "properties": props,
                }
                egid = props.get("EGID")
                if egid is None:
                    unassigned.append(entry)
                else:
                    by_egid[int(egid)] = entry
    except Exception:
        return {"by_egid": {}, "unassigned": []}
    return {"by_egid": by_egid, "unassigned": unassigned}


def _feature_bbox_overlaps(geom: dict, lv95_bbox: tuple) -> bool:
    """Per-feature bounds check against the query bbox — the only bbox
    filtering left in the read path (the cache loader above applies none at
    all), operating on cached in-memory data."""
    coords = geom.get("coordinates")
    if not coords:
        return False
    all_coords = [c for poly in coords for ring in poly for c in ring]
    if not all_coords:
        return False
    xs = [c[0] for c in all_coords]
    ys = [c[1] for c in all_coords]
    minx, miny, maxx, maxy = lv95_bbox
    return not (max(xs) < minx or min(xs) > maxx or max(ys) < miny or min(ys) > maxy)


def _feature_to_geojson(egid: Optional[int], geom: dict, props: dict, to_wgs84: Transformer) -> dict:
    new_polys = []
    for ring_list in geom["coordinates"]:
        new_rings = []
        for ring in ring_list:
            new_rings.append([[*to_wgs84.transform(c[0], c[1]), c[2]] for c in ring])
        new_polys.append(new_rings)
    return {
        "type": "Feature",
        "properties": {
            "egid": egid,
            "objektart": props.get("OBJEKTART"),
            "dach_max": props.get("DACH_MAX"),
            "gesamthoehe": props.get("GESAMTHOEHE"),
        },
        "geometry": {"type": "MultiPolygon", "coordinates": new_polys},
    }


def _sync_fetch_buildings(egid_set: Optional[frozenset], lv95_bbox: tuple) -> list:
    to_wgs84 = Transformer.from_crs("EPSG:2056", "EPSG:4326", always_xy=True)
    features = []
    for tile_id in _candidate_tile_ids(lv95_bbox):
        tile = _get_tile_features(tile_id)

        if egid_set is not None:
            for e in egid_set:
                entry = tile["by_egid"].get(e)
                if entry is None:
                    continue
                geom = entry["geometry"]
                if not _feature_bbox_overlaps(geom, lv95_bbox):
                    continue
                features.append(_feature_to_geojson(e, geom, entry["properties"], to_wgs84))
        else:
            for entry in tile["by_egid"].values():
                geom = entry["geometry"]
                if not _feature_bbox_overlaps(geom, lv95_bbox):
                    continue
                egid = entry["properties"].get("EGID")
                features.append(_feature_to_geojson(egid, geom, entry["properties"], to_wgs84))

        # Features with no EGID were never excluded by the old filter either
        # (egid is not None was False, so the skip-condition short-circuited)
        # — preserved exactly via the "unassigned" bucket.
        for entry in tile["unassigned"]:
            geom = entry["geometry"]
            if not _feature_bbox_overlaps(geom, lv95_bbox):
                continue
            features.append(_feature_to_geojson(None, geom, entry["properties"], to_wgs84))
    return features


def _vec3_cross(a: tuple, b: tuple) -> tuple:
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])

def _vec3_sub(a: tuple, b: tuple) -> tuple:
    return (a[0]-b[0], a[1]-b[1], a[2]-b[2])

def _vec3_len(a: tuple) -> float:
    return math.sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2])


def _sync_compute_measurements(egid: int, lv95_bbox: Optional[tuple]) -> Optional[dict]:
    for tile_id in _candidate_tile_ids(lv95_bbox):
        tile = _get_tile_features(tile_id)
        entry = tile["by_egid"].get(egid)
        if entry is None:
            continue
        coords = entry["geometry"]["coordinates"]
        return _compute_measurements_from_coords(egid, coords, entry["properties"])
    return None


def _compute_measurements_from_coords(egid: int, coords: list, props: dict) -> dict:
    # Collect all rings and their average z for floor detection
    all_rings = []
    all_z_vals = []
    for poly in coords:
        for ring in poly:
            pts = ring[:-1]  # drop closing point
            all_rings.append(pts)
            all_z_vals.extend(c[2] for c in pts)

    min_z = min(all_z_vals) if all_z_vals else 0.0

    volume_m3 = 0.0
    facade_m2 = 0.0
    roof_m2 = 0.0

    for pts in all_rings:
        n_pts = len(pts)
        if n_pts < 3:
            continue
        # Fan-triangulate each polygon ring from its first vertex
        v0 = pts[0]
        for i in range(1, n_pts - 1):
            v1 = pts[i]
            v2 = pts[i + 1]
            e1 = _vec3_sub(v1, v0)
            e2 = _vec3_sub(v2, v0)
            n = _vec3_cross(e1, e2)
            n_len = _vec3_len(n)
            if n_len < 1e-10:
                continue
            nz = n[2] / n_len  # z = vertical axis in LV95
            area_3d = n_len / 2

            if abs(nz) > 0.5:
                # Horizontal-ish face (roof or floor)
                avg_z = (v0[2] + v1[2] + v2[2]) / 3
                if avg_z - min_z > 0.5:  # above floor → roof
                    roof_m2 += area_3d
                    a0 = max(0.0, v0[2] - min_z)
                    a1 = max(0.0, v1[2] - min_z)
                    a2 = max(0.0, v2[2] - min_z)
                    A_xy = abs(n[2]) / 2
                    volume_m3 += A_xy * (a0 + a1 + a2) / 3
            else:
                # Vertical-ish face → facade
                facade_m2 += area_3d

    # Find floor ring: exterior ring (index 0) of the polygon with the lowest avg z.
    # Interior rings (holes, index 1+) are skipped — they can have a lower avg z than the
    # actual ground footprint and would produce a wrongly small footprint area.
    floor_ring = None
    min_avg_z = math.inf
    for poly in coords:
        pts = poly[0][:-1] if poly else None  # exterior ring only, drop closing point
        if not pts or len(pts) < 3:
            continue
        avg_z = sum(c[2] for c in pts) / len(pts)
        if avg_z < min_avg_z:
            min_avg_z = avg_z
            floor_ring = pts

    footprint_m2 = 0.0
    circumference_m = 0.0
    if floor_ring and len(floor_ring) >= 3:
        n_pts = len(floor_ring)
        area = 0.0
        perim = 0.0
        for j in range(n_pts):
            k = (j + 1) % n_pts
            area += floor_ring[j][0] * floor_ring[k][1] - floor_ring[k][0] * floor_ring[j][1]
            dx = floor_ring[k][0] - floor_ring[j][0]
            dy = floor_ring[k][1] - floor_ring[j][1]
            perim += math.sqrt(dx*dx + dy*dy)
        footprint_m2 = abs(area) / 2
        circumference_m = perim

    def fmt(v: float) -> float:
        return round(v * 10) / 10

    return {
        "egid": egid,
        "footprintM2": fmt(footprint_m2),
        "facadeM2": fmt(facade_m2),
        "roofM2": fmt(roof_m2),
        "volumeM3": fmt(volume_m3),
        "circumferenceM": fmt(circumference_m),
        "heightM": float(props.get("GESAMTHOEHE") or 0),
        "dach_max": float(props.get("DACH_MAX") or 0),
    }


def _parse_wgs84_bbox_to_lv95(bbox: str) -> tuple:
    try:
        minlng, minlat, maxlng, maxlat = (float(x) for x in bbox.split(","))
    except (ValueError, TypeError):
        raise HTTPException(400, "bbox must be 'minlng,minlat,maxlng,maxlat'")
    to_lv95 = Transformer.from_crs("EPSG:4326", "EPSG:2056", always_xy=True)
    minx, miny = to_lv95.transform(minlng, minlat)
    maxx, maxy = to_lv95.transform(maxlng, maxlat)
    return (minx, miny, maxx, maxy)


@router.get("/{egid}/measurements")
async def get_building_measurements(
    egid: int,
    bbox: Optional[str] = Query(
        None,
        description="Optional minlng,minlat,maxlng,maxlat in WGS84 — narrows tile search for "
                    "faster lookups. Omit for the old exhaustive-search behavior.",
    ),
):
    lv95_bbox = _parse_wgs84_bbox_to_lv95(bbox) if bbox else None
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, _sync_compute_measurements, egid, lv95_bbox)
    if result is None:
        raise HTTPException(404, f"EGID {egid} not found in downloaded tiles")
    return result


@router.get("")
async def get_buildings(
    bbox: str = Query(..., description="minlng,minlat,maxlng,maxlat in WGS84"),
    egids: Optional[str] = Query(None, description="Comma-separated EGIDs; omit to return all buildings in bbox"),
):
    egid_set: Optional[frozenset] = None
    if egids:
        try:
            egid_set = frozenset(int(e.strip()) for e in egids.split(",") if e.strip())
        except ValueError:
            raise HTTPException(400, "egids must be comma-separated integers")

    lv95_bbox = _parse_wgs84_bbox_to_lv95(bbox)

    loop = asyncio.get_event_loop()
    features = await loop.run_in_executor(
        _executor, _sync_fetch_buildings, egid_set, lv95_bbox
    )
    return {"type": "FeatureCollection", "features": features}
