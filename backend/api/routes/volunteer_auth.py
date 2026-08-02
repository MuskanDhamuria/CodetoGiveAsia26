"""Volunteer account registration, session authentication, and dashboard."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.api.routes._common import Connection
from backend.attendance_qr import VOLUNTEER_KIND, generate_token
from backend.bot.commands import get_or_create_contact
from backend.integrations.whatsapp_client import get_client
from backend.schema.volunteer_auth import (
    VolunteerAccountOut,
    VolunteerDashboardEvent,
    VolunteerDashboardOut,
    VolunteerAuthResult,
    VolunteerLogin,
    VolunteerOtpResult,
    VolunteerRegister,
    VolunteerVerifyOtp,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/volunteer-auth", tags=["volunteer auth"])
bearer = HTTPBearer(auto_error=False)
SESSION_DAYS = 30
PASSWORD_N = 2**14
PASSWORD_R = 8
PASSWORD_P = 1

# --------------------------------------------------------------------------- #
# WhatsApp OTP verification
#
# All volunteer signup happens on the website (backend.bot.commands no longer
# creates volunteers on the fly). Right after registering, we send a code
# through the "otp" Meta template — chosen over a free-form text message
# because the volunteer hasn't necessarily messaged the bot yet, so they may
# be outside WhatsApp's 24-hour customer-service window for plain text.
# --------------------------------------------------------------------------- #
OTP_LENGTH = 6
OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5


def generate_otp_code() -> str:
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"


def hash_otp_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def otp_expiry_timestamp() -> str:
    return (datetime.now(UTC) + timedelta(minutes=OTP_TTL_MINUTES)).isoformat()


def issue_and_send_otp(db: sqlite3.Connection, account_id: int, phone: str) -> None:
    code = generate_otp_code()
    with db:
        db.execute(
            """
            UPDATE volunteer_accounts
            SET otp_code_hash = ?, otp_expires_at = ?, otp_attempts = 0
            WHERE id = ?
            """,
            (hash_otp_code(code), otp_expiry_timestamp(), account_id),
        )
    try:
        get_client().send_template(
            phone,
            template_name=os.environ.get("WHATSAPP_OTP_TEMPLATE_NAME", "otp"),
            language_code=os.environ.get("WHATSAPP_OTP_TEMPLATE_LANG", "en_US"),
            body_params=[code],
            button_param=code,
        )
    except Exception:
        # Registration/resend already succeeded and committed above; a failed
        # WhatsApp delivery shouldn't make the request look like it failed.
        logger.exception("Failed to send OTP WhatsApp template to %s", phone)


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
        phone_verified=row["phone_verified_at"] is not None,
    )


def find_account_by_phone(db: sqlite3.Connection, phone: str) -> sqlite3.Row | None:
    return db.execute(
        """
        SELECT va.id AS account_id, v.id AS volunteer_id, v.name,
               v.contact_number, v.email, va.password_hash, va.phone_verified_at
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
               v.contact_number, v.email, va.phone_verified_at
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

    # Auto-link this phone number to the WhatsApp bot so it already
    # recognizes them as a volunteer if they message it later — no separate
    # WhatsApp signup step required. Safe to run every time: never overwrites
    # an existing link to a different volunteer.
    contact = get_or_create_contact(db, volunteer["contact_number"])
    if contact["volunteer_id"] is None:
        db.execute(
            "UPDATE whatsapp_contacts SET volunteer_id = ? WHERE id = ?",
            (volunteer["id"], contact["id"]),
        )
        db.commit()

    issue_and_send_otp(db, account["id"], volunteer["contact_number"])

    row = db.execute(
        """
        SELECT va.id AS account_id, v.id AS volunteer_id, v.name,
               v.contact_number, v.email, va.phone_verified_at
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


@router.post("/verify-otp", response_model=VolunteerOtpResult)
def verify_otp(
    payload: VolunteerVerifyOtp,
    db: Connection,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
) -> VolunteerOtpResult:
    account = current_account(credentials, db)
    if account["phone_verified_at"] is not None:
        return VolunteerOtpResult(phone_verified=True)

    state = db.execute(
        "SELECT otp_code_hash, otp_expires_at, otp_attempts FROM volunteer_accounts WHERE id = ?",
        (account["account_id"],),
    ).fetchone()
    if state is None or state["otp_code_hash"] is None:
        raise HTTPException(status_code=400, detail="No verification code is pending. Request a new one.")
    if state["otp_attempts"] >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")
    if datetime.now(UTC) > datetime.fromisoformat(state["otp_expires_at"]):
        raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")
    if not hmac.compare_digest(hash_otp_code(payload.code.strip()), state["otp_code_hash"]):
        db.execute(
            "UPDATE volunteer_accounts SET otp_attempts = otp_attempts + 1 WHERE id = ?",
            (account["account_id"],),
        )
        db.commit()
        raise HTTPException(status_code=400, detail="That code is incorrect.")

    with db:
        db.execute(
            """
            UPDATE volunteer_accounts
            SET phone_verified_at = CURRENT_TIMESTAMP, otp_code_hash = NULL,
                otp_expires_at = NULL, otp_attempts = 0
            WHERE id = ?
            """,
            (account["account_id"],),
        )
    try:
        get_client().send_text(
            account["contact_number"],
            f"You're verified, {account['name'].split(' ')[0]}! Welcome to Passion to Serve — "
            "reply HELP anytime to see what I can do.",
        )
    except Exception:
        logger.exception(
            "Verified account %s but failed to send welcome WhatsApp message to %s",
            account["account_id"],
            account["contact_number"],
        )
    return VolunteerOtpResult(phone_verified=True)


@router.post("/resend-otp", response_model=VolunteerOtpResult)
def resend_otp(
    db: Connection,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
) -> VolunteerOtpResult:
    account = current_account(credentials, db)
    if account["phone_verified_at"] is not None:
        return VolunteerOtpResult(phone_verified=True)
    issue_and_send_otp(db, account["account_id"], account["contact_number"])
    return VolunteerOtpResult(phone_verified=False)


@router.get("/qr-token")
def get_volunteer_attendance_qr_token(
    db: Connection,
    event_id: Annotated[int, Query()],
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
) -> dict:
    account = current_account(credentials, db)
    registered = db.execute(
        "SELECT 1 FROM volunteer_signups WHERE event_id = ? AND volunteer_id = ?",
        (event_id, account["volunteer_id"]),
    ).fetchone()
    if registered is None:
        raise HTTPException(status_code=404, detail="Not signed up for that event")
    return {"token": generate_token(VOLUNTEER_KIND, account["volunteer_id"], event_id)}


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
