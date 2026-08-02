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
.venv/bin/python -m backend.seed             # optional: adds demo events
.venv/bin/python -m uvicorn backend.main:app --reload
```

**2. Frontend** (terminal 2):

```sh
npm install
npm run dev
```

Then open <http://localhost:8443>.

## WhatsApp bot

The WhatsApp bot integrates with the Meta WhatsApp Cloud API. Follow these
steps in order to get it running for a local demo.

**1. Create `backend/.env`** with:

```
WHATSAPP_TOKEN=<permanent token from a Meta System User>
WHATSAPP_PHONE_NUMBER_ID=<from Meta app dashboard > WhatsApp > API Setup>
WHATSAPP_DISPLAY_NUMBER=<your WhatsApp number, digits only>
WHATSAPP_VERIFY_TOKEN=<any string you invent, entered in Meta's webhook config too>
WHATSAPP_APP_SECRET=<optional, from Meta app dashboard > Settings > Basic>
WHATSAPP_OTP_TEMPLATE_NAME=otp
WHATSAPP_OTP_TEMPLATE_LANG=en_US
PASSION_PUBLIC_BASE_URL=http://localhost:8000
PASSION_FRONTEND_BASE_URL=http://localhost:5173
PASSION_CORS_ORIGINS=http://localhost:5173
```

Refresh `WHATSAPP_TOKEN` if it's more than a day old — temporary tokens from
the Meta dashboard expire in 24h.

`WHATSAPP_OTP_TEMPLATE_NAME`/`WHATSAPP_OTP_TEMPLATE_LANG` must match an
approved template in Meta's Business Manager exactly (name + language code).
Every volunteer signup now happens on the website — right after registering,
the backend sends this template with the 6-digit code, the volunteer enters
it on the site to verify their number, and a welcome message follows
automatically. If your template doesn't use a "copy code" button component,
that part of the payload is harmless to leave in — Meta ignores unused
button components.

**2. Start the backend** (terminal 1): `python3 -m uvicorn backend.main:app --reload`
(runs on `localhost:8000`).

**3. Start the tunnel** (terminal 2): `ngrok http 8000`. Copy the fresh
`https://...ngrok-free.dev` URL it gives you — it's different every time
ngrok restarts.

**4. Update `PASSION_PUBLIC_BASE_URL`** in `backend/.env` to that ngrok URL,
then restart the backend so certificate links pick it up.

**5. Point Meta at the tunnel**: in the Meta dashboard (WhatsApp product →
Configuration → Webhook), set the Callback URL to
`{ngrok-url}/api/v1/integrations/whatsapp/webhook`, re-enter
`WHATSAPP_VERIFY_TOKEN`, click **Verify and Save**.

**6. Start the frontend** (terminal 3): `npm run dev`. Confirm
`PASSION_CORS_ORIGINS` in `backend/.env` matches its local URL (e.g.
`http://localhost:5173`).

**7. Send yourself a real WhatsApp message** and confirm the bot replies,
before anyone's watching.

While demoing: don't restart ngrok once it's running (the URL changes and
steps 4–5 have to be redone), and keep all three terminals visible so you
notice immediately if one of them dies.

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
