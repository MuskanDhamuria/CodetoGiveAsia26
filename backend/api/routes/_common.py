"""Shared helpers for feature routers."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, Query, Request


DEFAULT_LIMIT = 50
MAX_LIMIT = 100


def get_connection(request: Request) -> Iterator[sqlite3.Connection]:
    """Yield a SQLite connection bound to the app's configured database path.

    FastAPI runs sync path operations and their sync generator dependencies in a
    threadpool, so the connection can be created in one worker thread and used in
    another. ``check_same_thread=False`` makes that safe; each request still gets
    its own short-lived connection, so there is no cross-request sharing.
    """

    database_path: Path = request.app.state.database_path
    connection = sqlite3.connect(database_path, check_same_thread=False)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    finally:
        connection.close()


Connection = Annotated[sqlite3.Connection, Depends(get_connection)]


class Pagination:
    """Validated limit/offset pair shared by list endpoints."""

    def __init__(
        self,
        limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> None:
        self.limit = limit
        self.offset = offset


def list_envelope(
    items: list[Any], total: int, pagination: Pagination
) -> dict[str, Any]:
    return {
        "items": items,
        "total": total,
        "limit": pagination.limit,
        "offset": pagination.offset,
    }


def as_bool(value: int | None) -> bool | None:
    """Map SQLite 0/1/NULL to JSON true/false/null."""

    return None if value is None else bool(value)
