import asyncio
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import fiona
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user

router = APIRouter(prefix="/api/tiles", tags=["tiles"], dependencies=[Depends(get_current_user)])
_delete_lock = asyncio.Lock()

DATA_DIR = Path(__file__).parents[2] / "data" / "tiles"
MANIFEST = DATA_DIR / "manifest.json"


def _load_manifest() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not MANIFEST.exists():
        return {}
    return json.loads(MANIFEST.read_text())


def _save_manifest(m: dict) -> None:
    MANIFEST.write_text(json.dumps(m, indent=2))


class TileInfo(BaseModel):
    id: str
    size_bytes: int
    downloaded_at: str
    # [minx, miny, maxx, maxy] in EPSG:2056 (LV95). None for tiles downloaded
    # before this field existed, or if the one-time extraction below failed —
    # app/routers/buildings.py treats both cases identically (always a query
    # candidate, never excluded by tile-bbox pre-filtering).
    bbox_lv95: Optional[list[float]] = None


class DownloadRequest(BaseModel):
    url: str


def _extract_bbox_lv95(zip_path: Path) -> Optional[list]:
    """Best-effort one-time extent read; None on any failure (never blocks
    a download or backfill pass)."""
    try:
        vsipath = f"/vsizip/{zip_path.resolve()}"
        with fiona.open(vsipath, layer="Building_solid") as src:
            bounds = src.bounds  # (minx, miny, maxx, maxy) in EPSG:2056
        return list(bounds) if bounds is not None else None
    except Exception:
        return None


def backfill_missing_bboxes() -> None:
    """One-time, best-effort bbox extraction for tiles downloaded before
    bbox_lv95 existed. Without this, tile-bbox filtering in buildings.py
    would keep treating every already-downloaded tile as "always a
    candidate" forever (never re-tagged), which defeats the whole point of
    the tile-bbox narrowing for any tile that existed before this change
    shipped. Called once at app startup (see app/main.py); cheap — .bounds()
    is metadata-only, not a full feature scan (~0.1s/tile observed locally).
    """
    m = _load_manifest()
    changed = False
    for tile_id, entry in m.items():
        if entry.get("bbox_lv95") is not None:
            continue
        tile_dir = DATA_DIR / tile_id
        if not tile_dir.is_dir():
            continue
        zip_file = next(tile_dir.glob("*.gdb.zip"), None)
        if zip_file is None:
            continue
        bbox = _extract_bbox_lv95(zip_file)
        if bbox is not None:
            entry["bbox_lv95"] = bbox
            changed = True
    if changed:
        _save_manifest(m)


@router.get("", response_model=list[TileInfo])
async def list_tiles():
    m = _load_manifest()
    return [TileInfo(id=k, **v) for k, v in m.items()]


@router.post("/{tile_id}/download", response_model=TileInfo)
async def download_tile(tile_id: str, body: DownloadRequest):
    m = _load_manifest()
    if tile_id in m:
        return TileInfo(id=tile_id, **m[tile_id])

    tile_dir = DATA_DIR / tile_id
    tile_dir.mkdir(parents=True, exist_ok=True)

    filename = body.url.split("/")[-1]
    dest = tile_dir / filename

    try:
        async with httpx.AsyncClient(timeout=600) as client:
            async with client.stream("GET", body.url) as resp:
                if resp.status_code != 200:
                    raise HTTPException(404, f"Tile not found upstream (HTTP {resp.status_code})")
                with open(dest, "wb") as f:
                    async for chunk in resp.aiter_bytes(65536):
                        f.write(chunk)
    except HTTPException:
        shutil.rmtree(tile_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(tile_dir, ignore_errors=True)
        raise HTTPException(500, f"Download failed: {exc}") from exc

    size = dest.stat().st_size
    ts = datetime.now(timezone.utc).isoformat()
    entry = {"size_bytes": size, "downloaded_at": ts}

    # One-time bbox extraction (only for the format buildings.py actually reads;
    # the frontend only ever requests .gdb.zip assets today, but guard anyway).
    # Best-effort: any failure just leaves bbox_lv95 unset and never blocks the
    # download — query-time code falls back to treating this tile as "always a
    # candidate," same as a tile downloaded before this change existed.
    if dest.name.endswith(".gdb.zip"):
        bbox = _extract_bbox_lv95(dest)
        if bbox is not None:
            entry["bbox_lv95"] = bbox

    m[tile_id] = entry
    _save_manifest(m)

    return TileInfo(id=tile_id, **entry)


@router.delete("/{tile_id}", status_code=204)
async def delete_tile(tile_id: str):
    async with _delete_lock:
        m = _load_manifest()
        shutil.rmtree(DATA_DIR / tile_id, ignore_errors=True)
        m.pop(tile_id, None)
        _save_manifest(m)
        from app.routers.buildings import _get_tile_features
        _get_tile_features.cache_clear()
