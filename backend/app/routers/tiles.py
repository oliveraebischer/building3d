import asyncio
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

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


class DownloadRequest(BaseModel):
    url: str


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
    m[tile_id] = {"size_bytes": size, "downloaded_at": ts}
    _save_manifest(m)

    return TileInfo(id=tile_id, size_bytes=size, downloaded_at=ts)


@router.delete("/{tile_id}", status_code=204)
async def delete_tile(tile_id: str):
    async with _delete_lock:
        m = _load_manifest()
        shutil.rmtree(DATA_DIR / tile_id, ignore_errors=True)
        m.pop(tile_id, None)
        _save_manifest(m)
