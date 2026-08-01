"""Service and database health endpoints."""

import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status

from backend.database import connect
from backend.schema.health import DatabaseHealthResponse, HealthResponse


router = APIRouter(prefix="/health", tags=["health"])

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
    connection = None
    try:
        # `with connect(...)` only commits/rolls back the transaction — it
        # doesn't close the connection, so that's handled explicitly below.
        connection = connect(database_path)
        with connection:
            connection.execute("SELECT 1").fetchone()
    except (OSError, sqlite3.Error) as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        ) from error
    finally:
        if connection is not None:
            connection.close()

    return DatabaseHealthResponse(status="ok", database="ok")
