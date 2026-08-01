# SQLite database

This backend uses Python's built-in `sqlite3` module. No database server or
third-party SQLite package is required.

Create a local database with:

```sh
python3 -m backend.database
```

Or provide a different output path:

```sh
python3 -m backend.database /tmp/passion-to-serve.sqlite3
```

Run the schema tests with:

```sh
python3 -m unittest discover -s backend/tests -v
```

The initial schema is in `migrations/001_initial_schema.sql`. Every Python
connection must enable `PRAGMA foreign_keys = ON`; use `backend.database.connect`
to do that consistently.
