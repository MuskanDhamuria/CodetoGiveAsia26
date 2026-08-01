# Participant portal — status and handoff

Owner: Alvin (Person 1 — Participant). Branch: `feature/participant`, rebased
onto `origin/backend`.

This document exists so another agent (or teammate) can pick this work up
without re-deriving context from the conversation history. Update it as the
work evolves; delete sections once they're no longer true instead of leaving
stale info behind. Open tasks and backlog items live in
[`tickets.md`](tickets.md), not here — see that file for what's next.

## What's built

**Frontend** (`src/participant/`), mounted at `/participant/*` via
`react-router-dom`, additive alongside the existing query-param-routed
dashboard/events/volunteers pages in `src/App.tsx` (untouched):

- `/participant` — browse events, in List or Calendar view
  (`EventBrowseList`/`EventCalendarView`). List view groups upcoming events
  by month (sorted chronologically) with past events collapsed into a
  `<details>` summary at the top ("Past events (N)"), most-recent-month
  first when expanded. Calendar view has no Upcoming/Past toggle — every
  event shows on its date, colored grey if it's in the past, pastel
  green/red by open/closed status otherwise.
- `/participant/events/:eventId` — event detail, description/instructions,
  sign-up or cancel
- `/participant/my-events` — the signed-in participant's RSVP'd events
- `/participant/sign-in` — restore identity on a new device/browser by phone
  number, no event context or RSVP side effect. Only shown in the nav when
  no participant is currently identified.

Identity is phone-based with no login: first-time signup calls the backend's
public RSVP endpoint (name + phone, optional email), the returned
`participant_id` is cached in `localStorage` (`src/participant/identity.ts`),
and later visits/signups reuse it silently. `/participant/sign-in` restores
that same cached identity on a fresh session via a phone-only lookup —
`SignInForm`/`SignInPage` in `src/participant/components/`.

**Backend** (`backend/`), implementing the participant/events/public slice of
[`backend/API_ENDPOINTS.md`](../backend/API_ENDPOINTS.md) inside the shared
FastAPI + `sqlite3` structure:

- `backend/api/routes/events.py` — `GET /events`, `GET /events/{id}`,
  `POST /events/{id}/participants` (register an already-known participant),
  `PATCH /events/{id}/participants/{participant_id}` (cancel / update
  attendance)
- `backend/api/routes/participants.py` — `GET/POST /participants`,
  `GET /participants/{id}`, `GET /participants/{id}/events` ("My Events"),
  `GET /participants/lookup?contact_number=...` (exact, side-effect-free
  lookup backing "sign in" — registered ahead of `/{id}` so it isn't
  swallowed by that route's int path param)
- `backend/api/routes/public.py` — `POST /public/events/{id}/rsvp`, the
  find-or-create-and-register endpoint the signup form and (eventually) the
  WhatsApp bot both use
- `backend/migrations/002_add_event_description.sql` — adds `events.
  description` (nullable — the original schema had nowhere to put "bring a
  water bottle"-style instructions) and `events.event_time` (required,
  "HH:MM"/"HH:MM:SS", `CHECK (time(event_time) IS NOT NULL)`, kept separate
  from `event_date` so date-only filtering/sorting/calendar-matching is
  unaffected). `backend/database.py` now applies every unapplied migration
  in order, not just `001`, so this and future migrations are picked up
  automatically.
- `backend/seed_demo_data.py` — inserts a placeholder event template plus a
  handful of demo events, since organizer-side event/template creation isn't
  built yet and `events.event_template_id` is `NOT NULL`.
- `backend/phone.py` — `normalize_phone_number`, built on the `phonenumbers`
  package. Every route that reads or writes `contact_number`
  (`create_participant` in `participants.py`, `public_rsvp` in `public.py`)
  normalizes to E.164 before comparing or storing, so "9123 4567",
  "+65 9123 4567", and "+6591234567" all resolve to the same participant.
  Defaults to region `SG` for numbers with no leading "+"; a "+"-prefixed
  number is parsed using its own country code. An unparseable number 400s
  instead of being stored as-is.

Tests: `python3 -m unittest discover -s backend/tests -v` (55 passing,
`unittest.TestCase` style to match the rest of the backend — no `pytest`
dependency needed) and `npx vitest run` (45 passing).

## How to run it locally

```sh
python3 -m pip install -r backend/requirements-dev.txt
python3 -m backend.seed_demo_data     # only needed once, or after deleting the db
python3 -m uvicorn backend.main:app --reload
```

In another terminal: `npm run dev`. Vite proxies `/api` to
`http://localhost:8000` (`vite.config.ts`), so the frontend "just works"
against the local backend with no CORS setup needed.

## Open tasks and improvements

All backlog items — known gaps, scoped feature tickets, and nice-to-have
polish — live in [`tickets.md`](tickets.md), not here. That keeps a single
source of truth instead of two lists drifting apart as work lands. Check
there before starting new work on this slice.

## Key decisions worth knowing the "why" of

- **Identity = phone number, no login.** Chosen over email-OTP or
  re-entering details every time because it's zero-friction for the migrant
  worker beneficiary audience and matches how the bot will identify people.
- **`EVENT.Status` means registration open/closed, not "has this happened."**
  Upcoming vs. past is computed from `event_date` separately (`event_date <
  today` = past), so a full/closed event can still show as upcoming — and in
  Calendar view, a past event is always greyed out regardless of status,
  while an upcoming one is colored by status (pastel green/red).
- **`EventBrowseList` fetches all events once** (`getAllEvents`, no
  `date_from`/`date_to`) rather than re-fetching per Upcoming/Past tab —
  List and Calendar both bucket/group the same dataset client-side, so
  there's one loading state and one source of truth for "is this past."
- **Public RSVP is one combined endpoint**, not identify-then-signup as two
  calls — simpler for the frontend and matches `API_ENDPOINTS.md`'s own
  suggested shape for the public flow.
- **Phone numbers normalize to E.164, defaulting to the `SG` region.** Given
  phone number *is* the identity (previous bullet), two differently-typed
  numbers that reach the DB unnormalized silently create two disconnected
  participants — see the now-closed TICKET-13 in `tickets.md`. Used
  `phonenumbers`/`libphonenumber-js` (Google's libphonenumber, on each side)
  rather than a hand-rolled regex, since correctly validating/formatting
  numbers across many countries' varying rules is exactly the problem that
  library exists to solve.
