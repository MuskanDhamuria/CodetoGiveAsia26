# Passion to Serve — Event Operations Platform

A hackathon prototype for **Passion to Serve**, a volunteer-run Singapore
nonprofit supporting migrant workers. The goal is a single tool that lets
organizers plan and run events, coordinate volunteers, and let participants
browse and sign up — replacing the fragmented, manual coordination the
nonprofit currently relies on.

See [`CONTEXT.md`](CONTEXT.md) for the domain glossary (Event, Event
Template, Task, Team Member, Volunteer, etc.) before touching the code — it
defines the vocabulary the whole codebase uses.

## Prerequisites

- Node.js + npm
- Python **3.12** (the backend's committed bytecode and this repo's `.venv`
  are pinned to 3.12 — use `python3.12` explicitly rather than a bare
  `python`/`python3` if your system has multiple versions installed)

## Running it locally

**1. Backend** (terminal 1):

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/python -m backend.seed_demo_data   # optional: adds demo events
.venv/bin/python -m uvicorn backend.main:app --reload
```

**2. Frontend** (terminal 2):

```sh
npm install
npm run dev
```

Then open <http://localhost:8443>.

## Testing

```sh
# Frontend (Vitest)
npm test

# Backend (unittest, not pytest — see backend/README.md)
.venv/bin/python -m unittest discover -s backend/tests -v
```

## Further reading

- [`backend/README.md`](backend/README.md) — backend-specific setup detail,
  including environment variables for the database path and CORS origins
- [`backend/API_ENDPOINTS.md`](backend/API_ENDPOINTS.md) — the full proposed
  HTTP API contract (implemented incrementally, feature by feature)
- [`docs/participant-portal.md`](docs/participant-portal.md) — status and key
  decisions for the participant-facing slice
- [`docs/tickets.md`](docs/tickets.md) — open backlog items across the project
