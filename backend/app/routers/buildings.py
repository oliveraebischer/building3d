import asyncio
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import fiona
from fastapi import APIRouter, HTTPException, Query
from pyproj import Transformer

router = APIRouter(prefix="/api/buildings", tags=["buildings"])
DATA_DIR = Path(__file__).parents[2] / "data" / "tiles"
_executor = ThreadPoolExecutor(max_workers=2)


def _sync_fetch_buildings(egid_set: Optional[frozenset], lv95_bbox: tuple) -> list:
    to_wgs84 = Transformer.from_crs("EPSG:2056", "EPSG:4326", always_xy=True)
    features = []
    for tile_dir in DATA_DIR.iterdir():
        if not tile_dir.is_dir():
            continue
        for zip_file in tile_dir.glob("*.gdb.zip"):
            vsipath = f"/vsizip/{zip_file.resolve()}"
            try:
                with fiona.open(vsipath, layer="Building_solid") as src:
                    for f in src.filter(bbox=lv95_bbox):
                        egid = f["properties"].get("EGID")
                        if egid_set is not None and egid is not None and egid not in egid_set:
                            continue
                        # GDB spatial index may be unavailable via vsizip — post-filter by bounds
                        geom = f.geometry
                        if geom is None:
                            continue
                        all_coords = [c for poly in geom["coordinates"] for ring in poly for c in ring]
                        if all_coords:
                            xs = [c[0] for c in all_coords]
                            ys = [c[1] for c in all_coords]
                            if (max(xs) < lv95_bbox[0] or min(xs) > lv95_bbox[2] or
                                    max(ys) < lv95_bbox[1] or min(ys) > lv95_bbox[3]):
                                continue
                        new_polys = []
                        for ring_list in f["geometry"]["coordinates"]:
                            new_rings = []
                            for ring in ring_list:
                                new_rings.append([
                                    [*to_wgs84.transform(c[0], c[1]), c[2]]
                                    for c in ring
                                ])
                            new_polys.append(new_rings)
                        features.append({
                            "type": "Feature",
                            "properties": {
                                "egid": egid,
                                "objektart": f["properties"].get("OBJEKTART"),
                                "dach_max": f["properties"].get("DACH_MAX"),
                                "gesamthoehe": f["properties"].get("GESAMTHOEHE"),
                            },
                            "geometry": {
                                "type": "MultiPolygon",
                                "coordinates": new_polys,
                            },
                        })
            except Exception:
                continue
    return features


def _vec3_cross(a: tuple, b: tuple) -> tuple:
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])

def _vec3_sub(a: tuple, b: tuple) -> tuple:
    return (a[0]-b[0], a[1]-b[1], a[2]-b[2])

def _vec3_len(a: tuple) -> float:
    return math.sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2])


def _sync_compute_measurements(egid: int) -> Optional[dict]:
    for tile_dir in DATA_DIR.iterdir():
        if not tile_dir.is_dir():
            continue
        for zip_file in tile_dir.glob("*.gdb.zip"):
            vsipath = f"/vsizip/{zip_file.resolve()}"
            try:
                with fiona.open(vsipath, layer="Building_solid") as src:
                    for f in src:
                        if f["properties"].get("EGID") != egid:
                            continue
                        coords = f["geometry"]["coordinates"]
                        props = f["properties"]
                        return _compute_measurements_from_coords(egid, coords, props)
            except Exception:
                continue
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


@router.get("/{egid}/measurements")
async def get_building_measurements(egid: int):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, _sync_compute_measurements, egid)
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
    try:
        parts = bbox.split(",")
        minlng, minlat, maxlng, maxlat = (float(x) for x in parts)
    except (ValueError, TypeError):
        raise HTTPException(400, "bbox must be 'minlng,minlat,maxlng,maxlat'")

    to_lv95 = Transformer.from_crs("EPSG:4326", "EPSG:2056", always_xy=True)
    minx, miny = to_lv95.transform(minlng, minlat)
    maxx, maxy = to_lv95.transform(maxlng, maxlat)
    lv95_bbox = (minx, miny, maxx, maxy)

    loop = asyncio.get_event_loop()
    features = await loop.run_in_executor(
        _executor, _sync_fetch_buildings, egid_set, lv95_bbox
    )
    return {"type": "FeatureCollection", "features": features}
