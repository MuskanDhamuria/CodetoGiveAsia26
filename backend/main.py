"""FastAPI application entry point."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.router import api_router
from backend.database import DEFAULT_DATABASE_PATH, initialize_database


DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8443",
    "http://127.0.0.1:8443",
)


def load_dotenv() -> None:
    """Load simple KEY=VALUE pairs from the repository .env file if present."""

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped_line = line.strip()
        if not stripped_line or stripped_line.startswith("#") or "=" not in stripped_line:
            continue
        key, value = stripped_line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def configured_database_path() -> Path:
    """Read the database location without fixing it at import time."""

    return Path(os.environ.get("PASSION_DATABASE_PATH", DEFAULT_DATABASE_PATH))


def configured_cors_origins() -> list[str]:
    """Read comma-separated frontend origins, with Vite development defaults."""

    raw_origins = os.environ.get("PASSION_CORS_ORIGINS")
    if raw_origins is None:
        return list(DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


def create_app(database_path: str | Path | None = None) -> FastAPI:
    """Build the application; accepting a path keeps tests isolated."""

    load_dotenv()
    resolved_database_path = Path(database_path or configured_database_path())

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        initialize_database(resolved_database_path)
        application.state.database_path = resolved_database_path
        yield

    application = FastAPI(
        title="Passion to Serve API",
        description="Event operations API for participants, volunteers, and organizers.",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=configured_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(api_router)
    return application


app = create_app()
