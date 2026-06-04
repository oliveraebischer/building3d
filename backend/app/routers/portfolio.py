import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

DATA_DIR = Path(__file__).parents[2] / "data"
PORTFOLIO_FILE = DATA_DIR / "portfolio.json"
SNAPSHOTS_DIR = DATA_DIR / "snapshots"


def _load() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not PORTFOLIO_FILE.exists():
        return {}
    return json.loads(PORTFOLIO_FILE.read_text())


def _save(d: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PORTFOLIO_FILE.write_text(json.dumps(d, indent=2))


class EntryPatch(BaseModel):
    label: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
async def list_portfolio():
    d = _load()
    return list(d.values())


@router.post("", status_code=201)
async def add_portfolio_entry(request: Request):
    entry = await request.json()
    egrid = (entry.get("parcel") or {}).get("egrid")
    if not egrid:
        raise HTTPException(400, "entry.parcel.egrid is required")
    d = _load()
    # Strip snapshot geometry from metadata — stored separately
    stored = {k: v for k, v in entry.items() if k != "snapshot"}
    snap_path = SNAPSHOTS_DIR / f"{egrid}.json"
    stored["hasSnapshot"] = snap_path.exists()
    d[egrid] = stored
    _save(d)
    return stored


@router.patch("/{egrid}")
async def update_portfolio_entry(egrid: str, patch: EntryPatch):
    d = _load()
    if egrid not in d:
        raise HTTPException(404, f"Portfolio entry {egrid} not found")
    entry = d[egrid]
    if patch.label is not None:
        entry["label"] = patch.label
    if patch.status is not None:
        entry["status"] = patch.status
    if patch.notes is not None:
        entry["notes"] = patch.notes
    _save(d)
    return entry


@router.delete("/{egrid}", status_code=204)
async def delete_portfolio_entry(egrid: str):
    d = _load()
    d.pop(egrid, None)
    _save(d)
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    snap = SNAPSHOTS_DIR / f"{egrid}.json"
    if snap.exists():
        snap.unlink()


@router.put("/{egrid}/snapshot", status_code=204)
async def save_portfolio_snapshot(egrid: str, request: Request):
    body = await request.json()
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    (SNAPSHOTS_DIR / f"{egrid}.json").write_text(json.dumps(body))
    d = _load()
    if egrid in d:
        d[egrid]["hasSnapshot"] = True
        _save(d)


@router.get("/{egrid}/snapshot")
async def get_portfolio_snapshot(egrid: str):
    snap_path = SNAPSHOTS_DIR / f"{egrid}.json"
    if not snap_path.exists():
        raise HTTPException(404, f"No snapshot for {egrid}")
    return json.loads(snap_path.read_text())
