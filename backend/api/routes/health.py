"""Service and database health endpoints."""

import sqlite3
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from backend.database import connect


router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]


class DatabaseHealthResponse(HealthResponse):
    database: Literal["ok"]


@router.get("", response_model=HealthResponse, summary="Check API health")
def health() -> HealthResponse:
    """Confirm that the FastAPI process is accepting requests."""

    return HealthResponse(status="ok")


@router.get(
    "/database",
    response_model=DatabaseHealthResponse,
    summary="Check SQLite health",
)
def database_health(request: Request) -> DatabaseHealthResponse:
    """Confirm that the configured SQLite database can execute a query."""

    database_path: Path = request.app.state.database_path
    try:
        with connect(database_path) as connection:
            connection.execute("SELECT 1").fetchone()
    except (OSError, sqlite3.Error) as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        ) from error

    return DatabaseHealthResponse(status="ok", database="ok")
