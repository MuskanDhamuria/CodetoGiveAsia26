# FastAPI backend

This backend uses FastAPI and Python's built-in `sqlite3` module. No database
server or third-party SQLite driver is required.

Install the Python dependencies from the repository root:

```sh
python3 -m pip install -r backend/requirements-dev.txt
```

Start the development API:

```sh
python3 -m uvicorn backend.main:app --reload
```

Useful URLs:

- API health: <http://127.0.0.1:8000/api/v1/health>
- Database health: <http://127.0.0.1:8000/api/v1/health/database>
- Swagger UI: <http://127.0.0.1:8000/docs>
- OpenAPI JSON: <http://127.0.0.1:8000/openapi.json>

Use `PASSION_DATABASE_PATH` to select another SQLite file and
`PASSION_CORS_ORIGINS` for a comma-separated list of allowed frontend origins.
The default CORS origins are the usual Vite development URLs on port 5173.

## Database

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

## API modules

`backend/main.py` configures the application and should stay small.
Feature endpoints belong in separate modules under `backend/api/routes/` and are
composed by `backend/api/router.py`.
