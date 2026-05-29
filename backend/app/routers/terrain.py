import asyncio
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from pyproj import Transformer

router = APIRouter(prefix="/api/terrain", tags=["terrain"])
HEIGHT_URL = "https://api3.geo.admin.ch/rest/services/height"


async def _fetch_height(client: httpx.AsyncClient, sem: asyncio.Semaphore,
                        easting: float, northing: float) -> Optional[float]:
    async with sem:
        try:
            r = await client.get(HEIGHT_URL, params={
                "easting": f"{easting:.2f}",
                "northing": f"{northing:.2f}",
                "sr": "2056",
            })
            r.raise_for_status()
            h = r.json().get("height")
            return float(h) if h is not None else None
        except Exception:
            return None


@router.get("")
async def get_terrain(
    bbox: str = Query(..., description="minlng,minlat,maxlng,maxlat in WGS84"),
    grid: int = Query(32, ge=4, le=64),
):
    try:
        minlng, minlat, maxlng, maxlat = (float(x) for x in bbox.split(","))
    except (ValueError, TypeError):
        raise HTTPException(400, "bbox must be 'minlng,minlat,maxlng,maxlat'")

    to_lv95 = Transformer.from_crs("EPSG:4326", "EPSG:2056", always_xy=True)
    exp_minE, exp_minN = to_lv95.transform(minlng, minlat)
    exp_maxE, exp_maxN = to_lv95.transform(maxlng, maxlat)

    E_vals = [exp_minE + col * (exp_maxE - exp_minE) / (grid - 1) for col in range(grid)]
    N_vals = [exp_minN + row * (exp_maxN - exp_minN) / (grid - 1) for row in range(grid)]

    sem = asyncio.Semaphore(100)
    async with httpx.AsyncClient(timeout=30) as client:
        tasks = [
            _fetch_height(client, sem, E, N)
            for N in N_vals for E in E_vals
        ]
        flat: list = await asyncio.gather(*tasks)

    elevations = [
        [flat[row * grid + col] for col in range(grid)]
        for row in range(grid)
    ]

    valid = [z for z in flat if z is not None]
    if not valid:
        raise HTTPException(502, "Failed to fetch terrain elevations from geo.admin.ch")

    return {
        "grid_size": grid,
        "elevations": elevations,
        "bbox_lv95": [exp_minE, exp_minN, exp_maxE, exp_maxN],
        "min_elevation": min(valid),
    }
