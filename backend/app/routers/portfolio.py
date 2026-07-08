import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth import get_current_user, user_dir

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


def _portfolio_file(user_id: str):
    return user_dir(user_id) / "portfolio.json"


def _snapshots_dir(user_id: str):
    return user_dir(user_id) / "snapshots"


def _load(user_id: str) -> dict:
    f = _portfolio_file(user_id)
    if not f.exists():
        return {}
    return json.loads(f.read_text())


def _save(user_id: str, d: dict) -> None:
    _portfolio_file(user_id).write_text(json.dumps(d, indent=2))


class EntryPatch(BaseModel):
    label: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
async def list_portfolio(user: dict = Depends(get_current_user)):
    d = _load(user["id"])
    return list(d.values())


@router.post("", status_code=201)
async def add_portfolio_entry(request: Request, user: dict = Depends(get_current_user)):
    entry = await request.json()
    egrid = (entry.get("parcel") or {}).get("egrid")
    if not egrid:
        raise HTTPException(400, "entry.parcel.egrid is required")
    d = _load(user["id"])
    # Strip snapshot geometry from metadata — stored separately
    stored = {k: v for k, v in entry.items() if k != "snapshot"}
    snap_path = _snapshots_dir(user["id"]) / f"{egrid}.json"
    stored["hasSnapshot"] = snap_path.exists()
    d[egrid] = stored
    _save(user["id"], d)
    return stored


@router.patch("/{egrid}")
async def update_portfolio_entry(egrid: str, patch: EntryPatch, user: dict = Depends(get_current_user)):
    d = _load(user["id"])
    if egrid not in d:
        raise HTTPException(404, f"Portfolio entry {egrid} not found")
    entry = d[egrid]
    if patch.label is not None:
        entry["label"] = patch.label
    if patch.status is not None:
        entry["status"] = patch.status
    if patch.notes is not None:
        entry["notes"] = patch.notes
    _save(user["id"], d)
    return entry


@router.delete("/{egrid}", status_code=204)
async def delete_portfolio_entry(egrid: str, user: dict = Depends(get_current_user)):
    d = _load(user["id"])
    d.pop(egrid, None)
    _save(user["id"], d)
    snap_dir = _snapshots_dir(user["id"])
    snap_dir.mkdir(parents=True, exist_ok=True)
    snap = snap_dir / f"{egrid}.json"
    if snap.exists():
        snap.unlink()


@router.put("/{egrid}/snapshot", status_code=204)
async def save_portfolio_snapshot(egrid: str, request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    snap_dir = _snapshots_dir(user["id"])
    snap_dir.mkdir(parents=True, exist_ok=True)
    (snap_dir / f"{egrid}.json").write_text(json.dumps(body))
    d = _load(user["id"])
    if egrid in d:
        d[egrid]["hasSnapshot"] = True
        _save(user["id"], d)


@router.get("/{egrid}/snapshot")
async def get_portfolio_snapshot(egrid: str, user: dict = Depends(get_current_user)):
    snap_path = _snapshots_dir(user["id"]) / f"{egrid}.json"
    if not snap_path.exists():
        raise HTTPException(404, f"No snapshot for {egrid}")
    return json.loads(snap_path.read_text())
