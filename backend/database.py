"""Small SQLite bootstrap utility.

The project deliberately uses Python's standard-library sqlite3 module, so the
schema can be created without installing a database driver or running a server.
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


MIGRATIONS_DIR = Path(__file__).with_name("migrations")
SCHEMA_PATH = MIGRATIONS_DIR / "001_initial_schema.sql"
DEFAULT_DATABASE_PATH = Path(__file__).with_name("data") / "passion_to_serve.sqlite3"


def connect(database_path: str | Path) -> sqlite3.Connection:
    """Open a connection with SQLite foreign-key enforcement enabled."""

    connection = sqlite3.connect(database_path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.row_factory = sqlite3.Row
    return connection


def _applied_migration_versions(connection: sqlite3.Connection) -> set[int]:
    try:
        rows = connection.execute("SELECT version FROM schema_migrations").fetchall()
    except sqlite3.OperationalError:
        return set()
    return {row[0] for row in rows}


def initialize_database(database_path: str | Path = DEFAULT_DATABASE_PATH) -> Path:
    """Create the database and apply every migration idempotently, in order."""

    path = Path(database_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with connect(path) as connection:
        for migration_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            version = int(migration_path.name.split("_", 1)[0])
            applied = _applied_migration_versions(connection)
            if version in applied:
                continue
            connection.executescript(migration_path.read_text(encoding="utf-8"))

    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialize the SQLite database")
    parser.add_argument(
        "database_path",
        nargs="?",
        type=Path,
        default=DEFAULT_DATABASE_PATH,
        help=f"database file to create (default: {DEFAULT_DATABASE_PATH})",
    )
    args = parser.parse_args()
    print(initialize_database(args.database_path))


if __name__ == "__main__":
    main()
