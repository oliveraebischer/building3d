import asyncio
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
                        if egid_set is not None and egid not in egid_set:
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
