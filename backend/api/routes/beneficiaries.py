"""Beneficiary groups that event templates and events serve."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.api.routes._common import Connection, Pagination, list_envelope
from backend.schema.beneficiaries import (
    BeneficiaryCreate,
    BeneficiaryOut,
    BeneficiaryUpdate,
)


router = APIRouter(prefix="/beneficiaries", tags=["beneficiaries"])


def beneficiary_model(row: sqlite3.Row) -> BeneficiaryOut:
    return BeneficiaryOut(id=row["id"], name=row["name"])


def require_beneficiary(db: sqlite3.Connection, beneficiary_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM beneficiaries WHERE id = ?", (beneficiary_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Beneficiary {beneficiary_id} was not found")
    return row


@router.get("")
def list_beneficiaries(
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    q: Annotated[str | None, Query()] = None,
) -> dict:
    where = "1 = 1"
    params: list[object] = []
    if q is not None and q.strip():
        where = "name LIKE ?"
        params = [f"%{q.strip()}%"]
    total = db.execute(
        f"SELECT COUNT(*) FROM beneficiaries WHERE {where}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT * FROM beneficiaries WHERE {where}
        ORDER BY name LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    return list_envelope([beneficiary_model(row) for row in rows], total, pagination)


@router.post("", response_model=BeneficiaryOut, status_code=status.HTTP_201_CREATED)
def create_beneficiary(payload: BeneficiaryCreate, db: Connection) -> BeneficiaryOut:
    try:
        row = db.execute(
            "INSERT INTO beneficiaries (name) VALUES (?) RETURNING *",
            (payload.name,),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "A beneficiary with that name already exists") from error
    return beneficiary_model(row)


@router.get("/{beneficiary_id}", response_model=BeneficiaryOut)
def get_beneficiary(beneficiary_id: int, db: Connection) -> BeneficiaryOut:
    return beneficiary_model(require_beneficiary(db, beneficiary_id))


@router.patch("/{beneficiary_id}", response_model=BeneficiaryOut)
def update_beneficiary(
    beneficiary_id: int, payload: BeneficiaryUpdate, db: Connection
) -> BeneficiaryOut:
    current = require_beneficiary(db, beneficiary_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return beneficiary_model(current)
    assignments = ", ".join(f"{field} = ?" for field in values)
    try:
        row = db.execute(
            f"UPDATE beneficiaries SET {assignments} WHERE id = ? RETURNING *",
            [*values.values(), beneficiary_id],
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "A beneficiary with that name already exists") from error
    return beneficiary_model(row)


@router.delete("/{beneficiary_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_beneficiary(beneficiary_id: int, db: Connection) -> Response:
    # Templates/events reference beneficiaries with ON DELETE SET NULL, so this
    # detaches them rather than failing or cascading.
    require_beneficiary(db, beneficiary_id)
    db.execute("DELETE FROM beneficiaries WHERE id = ?", (beneficiary_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
