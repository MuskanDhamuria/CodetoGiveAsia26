# AI Side Panel — Phase 0 Compatibility Report

Produced for TICKET-0. Read this before starting TICKET-1 onward — it
resolves several open questions those tickets left pending and corrects a
couple of assumptions in the original proposal that don't hold for this
codebase.

Decisions already made by the team (recorded here for reference, not
re-litigated): **no new admin authentication** for this milestone, and
**in-process tool dispatch** (no internal HTTP loopback) since all of this
runs server-side regardless of client device.

> **Addenda (post-audit corrections — read these before trusting §1–3
> below on the `cancel_event` mapping):**
> - §1/§2/§3 below originally recommended mapping a `cancel_event` AI tool
>   to the existing `close_event` handler. That turned out to be
>   insufficient — a registration-closed event and an actually-cancelled
>   event need to be distinguishable on the dashboard, and `close_event`
>   alone can't do that. **TICKET-9** (see `tickets.md`) now owns this: a
>   new `cancelled_at` column and `POST /events/{id}/cancel` endpoint,
>   *not* `close_event`, not yet implemented. Still true and unaffected:
>   never map `cancel_event` to `delete_event`.
> - §4's "not collapsible" / "add a collapse toggle" framing is superseded
>   by **TICKET-10** (done) — the panel has since been rebuilt as a
>   collapsible FAB + overlay drawer. See
>   [`ai-panel-handover.md`](ai-panel-handover.md) for current status
>   across all tickets; treat this report as a historical snapshot of the
>   Phase-0 investigation rather than a live status doc.

## 1. Database

- No ORM. Plain `sqlite3`, `Row` factory, manual SQL, `RETURNING` clauses
  throughout. Migrations are additive numbered `.sql` files in
  `backend/migrations/`, applied in order by `initialize_database`
  (`backend/database.py`). Current head is `007_skill_enhancement_template.sql`.
- **No soft-delete convention anywhere.** Every `DELETE` route
  (`delete_event`, `delete_event_task`, `delete_participant`,
  `delete_template`, `delete_team_member`, `delete_beneficiary`, …) issues a
  real `DELETE FROM ... WHERE id = ?`. There is no `deleted_at` column on any
  table. This matters for TICKET-2/6: a `cancel_event` tool must **not** map
  to `delete_event` — that's an irreversible hard delete with `ON DELETE
  CASCADE` wiping the event's tasks/subtasks/participations. It should map to
  `close_event` (see §2) instead, which only flips `status`.
- **No audit-log table exists.** `schema_migrations` only tracks which
  migration versions have been applied, not business-data changes. TICKET-4
  needs a genuinely new table.
- The `events` table's relevant columns for tool arguments:
  `event_template_id` (nullable since migration 006 — events no longer
  require a template), `name`, `venue`, `event_date` (date-only), `status`
  (`'open'|'closed'` only — no `'cancelled'` state), `description`,
  `start_time`/`end_time` (nullable `TEXT`), `beneficiary_id`.

## 2. Backend services

There is no separate service layer — `backend/api/routes/events.py`'s route
handlers **are** the business logic (validation + SQL together). Relevant
handlers already implemented there:

| Handler | HTTP route | Notes |
|---|---|---|
| `create_event` | `POST /events` | takes `EventCreate` (schema below) |
| `list_events` | `GET /events` | paginated, minimal fields |
| `get_event` | `GET /events/{id}` | full detail incl. tasks |
| `update_event` | `PATCH /events/{id}` | partial update via `EventUpdate` |
| `delete_event` | `DELETE /events/{id}` | **hard delete, cascades** — do not expose as an AI tool |
| `close_event` | `POST /events/{id}/close` | sets `status = 'closed'` — this is the real target for a `cancel_event`/"close registration" tool |
| `reschedule_event` | `POST /events/{id}/reschedule` | dedicated date-change endpoint with `shift_task_deadlines` option, separate from generic `update_event` |

`backend/schema/events.py` already has `EventCreate`/`EventUpdate` Pydantic
models — these are exactly the request shape TICKET-3 should reuse for tool
argument schemas instead of writing a parallel JSON schema.

**In-process dispatch is confirmed workable.** Every handler's `db` parameter
is typed `Connection = Annotated[sqlite3.Connection, Depends(get_connection)]`
(`backend/api/routes/_common.py`). The `Depends(...)` metadata only matters
when FastAPI wires the route over HTTP; called directly as a plain Python
function, `db` just needs a real `sqlite3.Connection` passed positionally —
Pydantic/FastAPI don't intercept a direct call. One wrinkle:
`_common.py:get_connection` builds its connection with a bare
`sqlite3.connect(...)` + manual `PRAGMA foreign_keys = ON` / `row_factory`
setup, duplicating (rather than calling) `backend/database.py`'s `connect()`
that `CLAUDE.md` documents as "the only way to get a `sqlite3.Connection`."
The AI tool layer should call `backend.database.connect(app.state.database_path)`
directly (matching the documented convention) rather than copying
`_common.py`'s inline version a third time, and should `close()` the
connection itself since there's no request-scoped generator managing that
outside FastAPI's DI.

## 3. API inventory

Cross-checked `backend/API_ENDPOINTS.md`'s "Current implementation status"
against `backend/api/router.py`. Implemented and composed today: health,
beneficiaries, event-template CRUD, event CRUD + close/reschedule + tasks/
subtasks, team members, dashboard summaries, volunteers, volunteer auth,
participants, public (participant RSVP). No routes are missing that the
proposal's named tool set needs — `create_event_draft`/`update_event`/
`get_event`/`list_events`/`publish_event`/`cancel_event` all have a real
backing handler (`publish_event` = calling `create_event` on an
already-validated draft; `cancel_event` = `close_event`, per §1/§2, not
`delete_event`).

## 4. Frontend insertion point

**This is mostly already built.** `src/AiCopilot.tsx` is a static UI
prototype, and `src/App.tsx:1019` already mounts it as a permanent side
panel — `<AiCopilot activePage={activePage} />` renders inside
`.product-frame` (a flex row with `.product-page-content`) on every non-home
admin page: dashboard, events, volunteers, and even the dedicated `"ai"`
page (which currently shows a placeholder in the main content area while the
same sidebar renders). So the "where does this panel live" question the
proposal's Phase-0 asks is already answered by existing code — TICKET-5 is
about wiring it up, not finding a mounting point.

What's *not* there yet, and what TICKET-5/6 actually need to add:

- **No backend wiring at all.** `AiCopilot`'s `sendGoal`/`loadGoal` only set
  local `useState` text (`goal`/`draft`) — there is no `fetch` call anywhere
  in the file. It's a visual mock.
- **Not collapsible.** No collapse/expand toggle exists despite the proposal
  calling for a "collapsible side panel" — would need adding.
- **Hardcoded per-page content.** `pageContext`/`pageInsight`/the three
  fixed "Recommended actions" and one fixed "Approval queue" item
  (`AiCopilot.tsx:4-18, 90-115`) are static demo copy, not derived from any
  real state — all of this needs replacing with the real chat/draft/approval
  UI from TICKET-5/6, likely keeping the existing header/composer visual
  style (`.copilot-sidebar` etc. in `index.css`) rather than the content.
- No streaming-consumption code (`EventSource`/`fetch` + `ReadableStream`)
  exists on the frontend yet — nothing to reuse, build fresh in TICKET-5.

## 5. Authentication

Confirmed and already decided (see top of doc): the admin/organizer side —
`events.py`, `event_templates.py`, `team_members.py`, `dashboard.py` — has no
session checks, roles, or permission middleware. Only the unrelated
volunteer flow (`volunteer_auth.py`) has real password + bearer-token auth.
Per the team's decision, TICKET-3's permission-validation stage is an
explicit no-op/pass-through for this milestone, not a blocker.

## 6. Dependencies

`httpx` (already a backend dependency, see `backend/requirements.txt`) is
sufficient for calling OpenRouter's OpenAI-compatible REST API with
streaming (`httpx.AsyncClient.stream`) — no new HTTP client or vendor SDK
needed for TICKET-1. Frontend has no SSE/streaming library today; plain
`fetch` with a `ReadableStream` reader (or `EventSource` if the backend
frames as SSE) covers it without a new npm dependency.

## Candidate tool functions (confirms/refines TICKET-2)

| Tool | Backing handler | Notes |
|---|---|---|
| `create_event_draft` | validates against `EventCreate`, no DB write | new, thin |
| `publish_event` | `create_event` (`events.py:98`) | |
| `update_event` | `update_event` (`events.py:248`) | |
| `get_event` | `get_event` (`events.py:243`) | |
| `list_events` | `list_events` (`events.py:186`) | |
| `cancel_event` | `close_event` (`events.py:678`) | **not** `delete_event` |

`delete_event` should stay off the AI tool set entirely for now — it's the
one genuinely irreversible, cascading operation in this area of the code,
and nothing in the proposal's named tool list asks for it.

## Risks

- Conflating `cancel_event` with `delete_event` would give the AI a
  destructive, cascading tool the proposal never asked for — call this out
  explicitly in TICKET-2's implementation, not just in this report.
- `AiCopilot.tsx`'s existing hardcoded content means someone skimming the
  running app today may believe AI functionality already exists; TICKET-5
  should replace the mock content in the same pass it adds real wiring
  rather than leaving both states reachable.
- `_common.py`'s duplicated connection-setup logic (vs. `backend/database.py`'s
  `connect()`) is a pre-existing minor inconsistency, not introduced by this
  work — noted so the AI tool layer doesn't copy it a third time, but not a
  ticket of its own.

## Recommended implementation order

1. TICKET-2 (tool functions) before TICKET-1 (endpoint) — the endpoint's
   dispatch logic is trivial once the tool functions exist and validated
   in isolation (easier to unit-test without a live OpenRouter key).
2. TICKET-3 (validation) alongside TICKET-2 — reusing `EventCreate`/
   `EventUpdate` means there's barely a separate step here.
3. TICKET-1 (backend endpoint + streaming).
4. TICKET-5 (frontend wiring into the existing `AiCopilot.tsx` shell) +
   TICKET-6 (draft/approval cards) together, since both touch the same
   component.
5. TICKET-4 (audit log) and TICKET-7 (system prompt) can proceed in
   parallel with 1–3; neither blocks nor is blocked by the others.
6. TICKET-8 (future tools) not started until 1–3 prove out.
