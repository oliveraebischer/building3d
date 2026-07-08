import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/projects", tags=["projects"])

DATA_DIR = Path(__file__).parents[2] / "data"
PROJECTS_FILE = DATA_DIR / "projects.json"


def _load() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not PROJECTS_FILE.exists():
        return {}
    return json.loads(PROJECTS_FILE.read_text())


def _save(d: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROJECTS_FILE.write_text(json.dumps(d, indent=2))


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    projectType: Optional[str] = None
    phase: Optional[str] = None
    notes: Optional[str] = None
    milestones: Optional[list] = None
    members: Optional[list] = None
    scenarios: Optional[list] = None


@router.get("")
async def list_projects():
    d = _load()
    return list(d.values())


@router.post("", status_code=201)
async def add_project(request: Request):
    project = await request.json()
    project_id = project.get("id")
    if not project_id or not project.get("name"):
        raise HTTPException(400, "project.id and project.name are required")
    d = _load()
    d[project_id] = project
    _save(d)
    return project


@router.patch("/{project_id}")
async def update_project(project_id: str, patch: ProjectPatch):
    d = _load()
    if project_id not in d:
        raise HTTPException(404, f"Project {project_id} not found")
    project = d[project_id]
    for field in ("name", "projectType", "phase", "notes", "milestones", "members", "scenarios"):
        value = getattr(patch, field)
        if value is not None:
            project[field] = value
    project["updatedAt"] = datetime.now(timezone.utc).isoformat()
    _save(d)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str):
    d = _load()
    d.pop(project_id, None)
    _save(d)
