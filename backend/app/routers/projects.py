import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth import get_current_user, user_dir

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _projects_file(user_id: str):
    return user_dir(user_id) / "projects.json"


def _load(user_id: str) -> dict:
    f = _projects_file(user_id)
    if not f.exists():
        return {}
    return json.loads(f.read_text())


def _save(user_id: str, d: dict) -> None:
    _projects_file(user_id).write_text(json.dumps(d, indent=2))


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    projectType: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    milestones: Optional[list] = None
    members: Optional[list] = None
    scenarios: Optional[list] = None
    activeScenarioId: Optional[str] = None
    siaTimeline: Optional[dict] = None
    energyPlan: Optional[dict] = None


PATCH_FIELDS = (
    "name", "projectType", "status", "notes", "milestones",
    "members", "scenarios", "activeScenarioId", "siaTimeline", "energyPlan",
)


def _normalize(project: dict) -> dict:
    # Legacy records stored the project status under "phase".
    if "status" not in project and "phase" in project:
        project["status"] = project.pop("phase")
    return project


@router.get("")
async def list_projects(user: dict = Depends(get_current_user)):
    d = _load(user["id"])
    return [_normalize(p) for p in d.values()]


@router.post("", status_code=201)
async def add_project(request: Request, user: dict = Depends(get_current_user)):
    project = await request.json()
    project_id = project.get("id")
    if not project_id or not project.get("name"):
        raise HTTPException(400, "project.id and project.name are required")
    d = _load(user["id"])
    d[project_id] = project
    _save(user["id"], d)
    return project


@router.patch("/{project_id}")
async def update_project(project_id: str, patch: ProjectPatch, user: dict = Depends(get_current_user)):
    d = _load(user["id"])
    if project_id not in d:
        raise HTTPException(404, f"Project {project_id} not found")
    project = _normalize(d[project_id])
    # model_fields_set (not "is not None") so activeScenarioId can be cleared to null.
    for field in PATCH_FIELDS:
        if field in patch.model_fields_set:
            project[field] = getattr(patch, field)
    project["updatedAt"] = datetime.now(timezone.utc).isoformat()
    _save(user["id"], d)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    d = _load(user["id"])
    d.pop(project_id, None)
    _save(user["id"], d)
