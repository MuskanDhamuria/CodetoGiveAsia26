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

Load the demo Events, Event Templates, Team Members, participants, and volunteer
records into SQLite:

```sh
python3 -m backend.seed
```

Run the React frontend in another terminal:

```sh
npm run dev
```

Vite proxies `/api/*` to FastAPI at `http://127.0.0.1:8000`. Set
`VITE_API_BASE_URL` if the API is hosted elsewhere. The normal Events page is
API-backed; the original in-memory prototype remains available at
`?page=events&prototype=operations`.

Useful URLs:

- API health: <http://127.0.0.1:8000/api/v1/health>
- Database health: <http://127.0.0.1:8000/api/v1/health/database>
- Swagger UI: <http://127.0.0.1:8000/docs>
- OpenAPI JSON: <http://127.0.0.1:8000/openapi.json>

Use `PASSION_DATABASE_PATH` to select another SQLite file and
`PASSION_CORS_ORIGINS` for a comma-separated list of allowed frontend origins.
The default CORS origins are the usual Vite development URLs on port 5173.

The AI assistant endpoint (`POST /api/v1/ai/chat`) needs `OPENROUTER_API_KEY`
set to a valid [OpenRouter](https://openrouter.ai) key — it returns a 500
without one. `OPENROUTER_MODEL` optionally overrides the model slug (default:
`anthropic/claude-3.5-sonnet`). The key is only ever read server-side; the
frontend never sees it and never calls OpenRouter directly.

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

Pydantic request and response models belong in the matching module under
`backend/schema/`; reusable constrained fields and enums live in
`backend/schema/common.py`. The volunteer route is temporarily exempt so its
feature owner can migrate it independently.
