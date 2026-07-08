import os
import re
import uuid
from datetime import datetime, timezone

from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel, field_validator

from app.auth import (
    COOKIE_NAME,
    SESSION_TTL,
    create_session,
    delete_session,
    find_user_by_email,
    get_current_user,
    hash_password,
    load_users,
    migrate_legacy_data,
    save_users,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterBody(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Invalid email address")
        return v

    @field_validator("password")
    @classmethod
    def valid_password(cls, v: str) -> str:
        if not (8 <= len(v) <= 72):
            raise ValueError("Password must be 8-72 characters")
        return v


class LoginBody(BaseModel):
    email: str
    password: str


def _set_session_cookie(response: Response, sid: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=sid,
        httponly=True,
        samesite="lax",
        secure=bool(os.environ.get("FLY_APP_NAME")),
        max_age=int(SESSION_TTL.total_seconds()),
        path="/",
    )


@router.post("/register", status_code=201)
async def register(body: RegisterBody, response: Response):
    if find_user_by_email(body.email):
        raise HTTPException(409, "Email already registered")

    users = load_users()
    is_first_user = len(users) == 0

    user_id = uuid.uuid4().hex
    users[user_id] = {
        "id": user_id,
        "email": body.email,
        "password_hash": hash_password(body.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    save_users(users)

    if is_first_user:
        migrate_legacy_data(user_id)

    sid = create_session(user_id)
    _set_session_cookie(response, sid)
    return {"id": user_id, "email": body.email}


@router.post("/login")
async def login(body: LoginBody, response: Response):
    user = find_user_by_email(body.email)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")

    sid = create_session(user["id"])
    _set_session_cookie(response, sid)
    return {"id": user["id"], "email": user["email"]}


@router.post("/logout", status_code=204)
async def logout(response: Response, b3d_session: Optional[str] = Cookie(default=None)):
    if b3d_session:
        delete_session(b3d_session)
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"]}
