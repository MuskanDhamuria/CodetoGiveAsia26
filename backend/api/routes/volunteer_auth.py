"""Volunteer account registration, session authentication, and dashboard."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.api.routes._common import Connection
from backend.schema.volunteer_auth import (
    VolunteerAccountOut,
    VolunteerDashboardEvent,
    VolunteerDashboardOut,
    VolunteerAuthResult,
    VolunteerLogin,
    VolunteerRegister,
)


router = APIRouter(prefix="/volunteer-auth", tags=["volunteer auth"])
bearer = HTTPBearer(auto_error=False)
SESSION_DAYS = 30
PASSWORD_N = 2**14
PASSWORD_R = 8
PASSWORD_P = 1


def normalise_phone(value: str) -> str:
    return "+" + "".join(character for character in value if character.isdigit())


def validate_password(password: str) -> None:
    checks = {
        "uppercase": any(character.isupper() for character in password),
        "lowercase": any(character.islower() for character in password),
        "number": any(character.isdigit() for character in password),
    }
    if len(password) < 8 or not all(checks.values()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters and include uppercase, lowercase, and a number.",
        )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=PASSWORD_N,
        r=PASSWORD_R,
        p=PASSWORD_P,
    )
    encode = lambda value: base64.urlsafe_b64encode(value).decode("ascii")
    return f"scrypt${PASSWORD_N}${PASSWORD_R}${PASSWORD_P}${encode(salt)}${encode(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, n, r, p, salt_text, digest_text = stored.split("$", 5)
        if algorithm != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def account_model(row: sqlite3.Row) -> VolunteerAccountOut:
    return VolunteerAccountOut(
        id=row["account_id"],
        volunteer_id=row["volunteer_id"],
        name=row["name"],
        contact_number=row["contact_number"],
        email=row["email"],
    )


def find_account_by_phone(db: sqlite3.Connection, phone: str) -> sqlite3.Row | None:
    return db.execute(
        """
        SELECT va.id AS account_id, v.id AS volunteer_id, v.name,
               v.contact_number, v.email, va.password_hash
        FROM volunteer_accounts va
        JOIN volunteers v ON v.id = va.volunteer_id
        WHERE v.contact_number = ?
        """,
        (phone,),
    ).fetchone()


def issue_session(db: sqlite3.Connection, account_id: int) -> str:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    expires_at = (datetime.now(UTC) + timedelta(days=SESSION_DAYS)).isoformat()
    db.execute(
        """
        INSERT INTO volunteer_sessions (volunteer_account_id, token_hash, expires_at)
        VALUES (?, ?, ?)
        """,
        (account_id, token_hash, expires_at),
    )
    return raw_token


def current_account(
    credentials: HTTPAuthorizationCredentials | None,
    db: Connection,
) -> sqlite3.Row:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Volunteer sign-in required")
    token_hash = hashlib.sha256(credentials.credentials.encode("utf-8")).hexdigest()
    row = db.execute(
        """
        SELECT va.id AS account_id, v.id AS volunteer_id, v.name,
               v.contact_number, v.email
        FROM volunteer_sessions vs
        JOIN volunteer_accounts va ON va.id = vs.volunteer_account_id
        JOIN volunteers v ON v.id = va.volunteer_id
        WHERE vs.token_hash = ? AND datetime(vs.expires_at) > datetime('now')
        """,
        (token_hash,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Volunteer session expired")
    return row


@router.post("/register", response_model=VolunteerAuthResult, status_code=201)
def register(payload: VolunteerRegister, db: Connection) -> VolunteerAuthResult:
    validate_password(payload.password)
    phone = normalise_phone(payload.contact_number)
    if len(phone) < 7:
        raise HTTPException(status_code=422, detail="Enter a valid phone number")

    existing_account = find_account_by_phone(db, phone)
    if existing_account is not None:
        raise HTTPException(status_code=409, detail="An account already exists for this phone number")

    volunteer = db.execute(
        "SELECT * FROM volunteers WHERE contact_number = ?", (phone,)
    ).fetchone()
    try:
        with db:
            if volunteer is None:
                volunteer = db.execute(
                    """
                    INSERT INTO volunteers (name, contact_number, signup_status)
                    VALUES (?, ?, 'pending') RETURNING *
                    """,
                    (payload.name, phone),
                ).fetchone()
            account = db.execute(
                """
                INSERT INTO volunteer_accounts (volunteer_id, password_hash)
                VALUES (?, ?) RETURNING id
                """,
                (volunteer["id"], hash_password(payload.password)),
            ).fetchone()
            token = issue_session(db, account["id"])
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="An account already exists for this volunteer") from error

    row = db.execute(
        """
        SELECT va.id AS account_id, v.id AS volunteer_id, v.name,
               v.contact_number, v.email
        FROM volunteer_accounts va JOIN volunteers v ON v.id = va.volunteer_id
        WHERE va.id = ?
        """,
        (account["id"],),
    ).fetchone()
    return VolunteerAuthResult(access_token=token, volunteer=account_model(row))


@router.post("/login", response_model=VolunteerAuthResult)
def login(payload: VolunteerLogin, db: Connection) -> VolunteerAuthResult:
    phone = normalise_phone(payload.contact_number)
    account = find_account_by_phone(db, phone)
    if account is None or not verify_password(payload.password, account["password_hash"]):
        raise HTTPException(status_code=401, detail="Phone number or password is incorrect")
    with db:
        db.execute(
            "UPDATE volunteer_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
            (account["account_id"],),
        )
        token = issue_session(db, account["account_id"])
    return VolunteerAuthResult(access_token=token, volunteer=account_model(account))


@router.get("/me", response_model=VolunteerAccountOut)
def me(
    db: Connection,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
) -> VolunteerAccountOut:
    return account_model(current_account(credentials, db))


@router.get("/dashboard", response_model=VolunteerDashboardOut)
def dashboard(
    db: Connection,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
) -> VolunteerDashboardOut:
    account = current_account(credentials, db)
    rows = db.execute(
        """
        SELECT vs.id AS signup_id, e.id AS event_id, e.name AS event_name,
               e.venue, e.event_date, e.status AS event_status,
               vs.status AS signup_status, r.name AS assigned_role_name,
               vs.attendance
        FROM volunteer_signups vs
        JOIN events e ON e.id = vs.event_id
        LEFT JOIN roles r ON r.id = vs.assigned_role_id
        WHERE vs.volunteer_id = ?
        ORDER BY e.event_date DESC
        """,
        (account["volunteer_id"],),
    ).fetchall()
    today = datetime.now(UTC).date().isoformat()
    items = [VolunteerDashboardEvent(**dict(row)) for row in rows]
    active = [item for item in items if item.event_date >= today and item.event_status != "closed"]
    past = [item for item in items if item not in active]
    return VolunteerDashboardOut(
        volunteer=account_model(account),
        active_events=active,
        past_events=past,
        has_approved_event=any(item.signup_status == "approved" for item in items),
    )
