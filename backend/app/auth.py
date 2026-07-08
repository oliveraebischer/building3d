import json
import secrets
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import bcrypt
from fastapi import Cookie, HTTPException

DATA_DIR = Path(__file__).parents[1] / "data"
AUTH_DIR = DATA_DIR / "auth"
USERS_FILE = AUTH_DIR / "users.json"
SESSIONS_FILE = AUTH_DIR / "sessions.json"
USERS_DIR = DATA_DIR / "users"

COOKIE_NAME = "b3d_session"
SESSION_TTL = timedelta(days=30)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_users() -> dict:
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    if not USERS_FILE.exists():
        return {}
    return json.loads(USERS_FILE.read_text())


def save_users(d: dict) -> None:
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(json.dumps(d, indent=2))


def _load_sessions() -> dict:
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    if not SESSIONS_FILE.exists():
        return {}
    return json.loads(SESSIONS_FILE.read_text())


def _save_sessions(d: dict) -> None:
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_FILE.write_text(json.dumps(d, indent=2))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def find_user_by_email(email: str) -> Optional[dict]:
    email_lower = email.strip().lower()
    for user in load_users().values():
        if user["email"] == email_lower:
            return user
    return None


def create_session(user_id: str) -> str:
    sessions = _load_sessions()
    sid = secrets.token_urlsafe(32)
    sessions[sid] = {
        "user_id": user_id,
        "created_at": _now_iso(),
        "expires_at": (datetime.now(timezone.utc) + SESSION_TTL).isoformat(),
    }
    _save_sessions(sessions)
    return sid


def delete_session(sid: str) -> None:
    sessions = _load_sessions()
    sessions.pop(sid, None)
    _save_sessions(sessions)


def user_dir(user_id: str) -> Path:
    d = USERS_DIR / user_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def migrate_legacy_data(user_id: str) -> None:
    """One-shot: move the pre-auth global portfolio/projects/snapshots into
    the first registered user's directory. Only ever called when users.json
    was empty, so it can't fire twice."""
    dest = user_dir(user_id)
    legacy = {
        DATA_DIR / "portfolio.json": dest / "portfolio.json",
        DATA_DIR / "projects.json": dest / "projects.json",
        DATA_DIR / "snapshots": dest / "snapshots",
    }
    for src, dst in legacy.items():
        if not src.exists():
            continue
        try:
            shutil.move(str(src), str(dst))
            print(f"[auth] migrated legacy {src} -> {dst}")
        except Exception as exc:
            print(f"[auth] failed to migrate {src}: {exc}")


async def get_current_user(b3d_session: Optional[str] = Cookie(default=None)) -> dict:
    if not b3d_session:
        raise HTTPException(401, "Not authenticated")
    sessions = _load_sessions()
    session = sessions.get(b3d_session)
    if not session or session["expires_at"] < _now_iso():
        raise HTTPException(401, "Session expired")
    users = load_users()
    user = users.get(session["user_id"])
    if not user:
        raise HTTPException(401, "Unknown user")
    return user
