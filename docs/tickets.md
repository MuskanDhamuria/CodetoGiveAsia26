# Tickets

Backlog for the AI Side Panel initiative. Update statuses in place; remove or
archive tickets once they're done rather than leaving stale entries here.

The participant-portal backlog that lived in this file previously has been
cleared per instruction to repopulate around the new proposal — if that work
isn't actually done, recover it from git history (`git log -- docs/tickets.md`)
before it's lost for good.

---

## TICKET-0: Phase 0 compatibility audit (blocking — do not start implementation before this)

**Priority:** Highest — the proposal itself says implementation must not
begin until this is complete and reviewed.
**Area:** whole system (read-only investigation, produces a report)

### What to produce

A written report (`docs/ai-panel-compatibility-report.md` or similar)
covering the six audit areas from the proposal, using what's actually in this
repo rather than the proposal's generic assumptions:

- **Database**: no ORM — plain `sqlite3` via `backend/database.py`'s
  `connect()`, manual SQL, `RETURNING` clauses. Migrations are additive `.sql`
  files in `backend/migrations/`, applied in order by `initialize_database`
  (see `002_add_event_description.sql` for the pattern). No soft-delete
  convention observed yet — confirm by checking `events`/`participants`
  schema for a `deleted_at`-style column before assuming hard deletes only.
  No audit-logging table exists yet (see TICKET-4).
- **Backend services**: there's no separate "service layer" to reuse — route
  handlers in `backend/api/routes/events.py` (`create_event`, `list_events`,
  `get_event`, plus task/subtask CRUD) directly contain the business logic
  and SQL. Confirm whether AI tools should import and call these route
  functions directly, or whether a thin extraction into callable
  service functions is needed first so both the HTTP route and the AI tool
  call the same code without one wrapping the other's HTTP layer.
- **API inventory**: cross-check `backend/API_ENDPOINTS.md`'s "Current
  implementation status" section against `backend/api/router.py` — event CRUD,
  templates, team members, participants/RSVP, and dashboard summaries are
  implemented; several proposed endpoints (event close/reopen/reschedule
  automation, capacity/waitlist) are not. Tool scope (TICKET-2) must only
  name tools backed by endpoints that actually exist.
- **Frontend insertion point**: `src/App.tsx` is the legacy router for all
  admin pages (dashboard, `AdminEventsPage.tsx`, volunteers, `AiCopilot.tsx`).
  Note `src/AiCopilot.tsx` already exists — read it before building anything
  new; it may be a prior prototype for this exact feature (or dead code) and
  determines whether TICKET-5 extends it or replaces it. There's no existing
  drawer/sidebar shell in `App.tsx` to hook into (confirm with a targeted
  read) — the side panel likely needs its own layout wrapper.
- **Authentication — this is the audit's most important finding.** The
  volunteer flow (`backend/api/routes/volunteer_auth.py`) has real
  password + bearer-token auth, but the **admin/organizer dashboard that this
  proposal targets has no authentication at all** — `events.py`,
  `event_templates.py`, `team_members.py`, `dashboard.py` have no session
  checks, no roles, no permission middleware. There is currently no
  "authenticated user" for an AI tool call to inherit permissions from. This
  directly contradicts the proposal's Phase-0 goal ("ensure AI tool execution
  inherits the authenticated user's permissions rather than introducing a
  separate authorization path") because there is no such path to inherit yet.
  This blocks TICKET-3 and needs a team decision — see the open question
  below and TICKET-6 in the (removed) old backlog for prior context on this
  exact gap.

### Open question (needs your input before TICKET-3 can be scoped)

Given there's no admin auth today, do we:
(a) build minimal admin auth first as its own ticket, gating both the
    existing admin pages and the new AI panel, or
(b) ship the AI panel without new auth, explicitly scoped to a
    single-organizer/no-multi-tenant trust model for the hackathon, and
    defer real permission checks?
This changes the shape of TICKET-3 significantly and should be decided before
any tool-execution code is written.

---

## TICKET-1: Backend AI endpoint — OpenRouter integration and streaming

**Priority:** High
**Area:** new `backend/api/routes/ai_assistant.py` (or similar), `backend/schema/`

### Scope

- New route module, composed into `backend/api/router.py` alongside the
  existing feature modules, following the one-module-per-feature convention.
- Holds the OpenRouter API key server-side only (new env var, e.g.
  `OPENROUTER_API_KEY`, read the same way other config is — check
  `backend/main.py`/`backend/database.py` for the existing env-var pattern
  like `PASSION_DATABASE_PATH`).
- Accepts a chat message + conversation history from the frontend, forwards
  to OpenRouter, streams the response back (SSE or chunked) to the frontend.
- Registers the constrained tool set from TICKET-2 with the LLM call
  (tool/function-calling schema, not a system-prompt-only approach).
- Does **not** contain business logic itself — when the LLM emits a tool
  call, this endpoint dispatches to the functions from TICKET-2 and nothing
  else.

### Depends on

TICKET-0's auth finding (needs to know what "authenticated user" means for
this endpoint before it can attach any permission context to tool calls) and
TICKET-2 (needs the tool functions to dispatch to).

---

## TICKET-2: AI tool functions wrapping existing event operations

**Priority:** High
**Area:** new `backend/ai_tools/` (or colocated with `ai_assistant.py`),
reuses `backend/api/routes/events.py`

### Scope

Implement the constrained tool set the proposal names, each as a thin
wrapper that calls the *existing* logic rather than duplicating it:

- `create_event_draft` — validates and returns a structured draft (see
  TICKET-3's business/schema validation), does not write to the DB yet.
- `publish_event` — takes an approved draft and calls whatever
  `create_event` in `events.py` does today.
- `update_event`, `get_event`, `list_events`, `cancel_event` — map onto
  `events.py`'s existing handlers (`get_event`, `list_events`) or their
  nearest existing equivalent (`cancel_event` doesn't exist yet as an
  endpoint — check whether "cancel" means `close` in the current status
  model, or is genuinely new; don't invent a new cancel semantics that
  diverges from what `EVENT.status` already means per `CLAUDE.md`'s
  open/closed note).
- Explicitly out of scope per the proposal: no `execute_sql`, `run_code`, or
  any generic/filesystem tool.

### Open question

Should tools call the route *handler functions* directly (in-process,
skipping HTTP) or hit the app's own HTTP API internally? Direct in-process
calls avoid network overhead and duplicate auth handling, but the route
handlers currently take a `Connection` via FastAPI dependency injection —
confirm they're callable outside a request context without rework, or note
the small refactor needed (TICKET-0's service-layer question).

---

## TICKET-3: Validation pipeline (schema → business rules → permissions)

**Priority:** High
**Area:** backend, shared across all tools from TICKET-2

### Scope

- **Schema validation**: Pydantic models in `backend/schema/` already do
  this for existing routes — reuse the same request models (e.g. whatever
  `EventCreate` looks like) for AI-generated tool arguments instead of
  writing parallel schemas, so the two paths can't drift.
- **Business validation**: dates valid, referenced entities (venue, event
  template) exist, `event_time` present (it's `NOT NULL` per
  `002_add_event_description.sql`) — again, reuse whatever validation
  `events.py`'s handlers already do rather than re-implementing it for the
  AI path.
- **Permission validation**: blocked on TICKET-0's auth finding — there's no
  current-user/role concept to check against yet.

### Acceptance criteria

- A tool call with a missing required field is rejected before reaching the
  database, with a structured `{"success": false, "reason": "..."}"` error
  (per the proposal's error-handling example), not a raw exception.
- No new validation logic exists that isn't just reused from what
  `backend/schema/` and `events.py` already enforce for the human-driven path.

---

## TICKET-4: Audit logging for AI-generated mutations

**Priority:** Medium
**Area:** `backend/migrations/` (new additive migration), all AI tool
execution paths

### Scope

The proposal requires "every AI-generated mutation must be auditable." No
audit-log table exists in the schema today (confirm during TICKET-0). Needs:

- A new additive migration (following the `002_add_event_description.sql`
  pattern) adding an audit table — at minimum: timestamp, tool name,
  arguments, resulting entity id, and (once TICKET-0/6 resolves) the acting
  user.
- Every tool dispatch in TICKET-1/2 writes a row here, on both success and
  failure.

### Open question

Should this log *only* AI-originated mutations, or become the start of a
general mutation audit log covering human-driven admin actions too? The
proposal only asks for the former, but a log that only covers AI actions
will look inconsistent next to human-driven changes with no trail at all.
Flagging for a decision, not assuming scope beyond what's asked.

---

## TICKET-5: Frontend — AI side panel UI shell

**Priority:** High
**Area:** `src/App.tsx` (admin layout), `src/AiCopilot.tsx` (existing file —
audit first, see TICKET-0), new panel component

### Scope

- Collapsible side panel mounted into the existing admin layout in
  `src/App.tsx`, not a new standalone route — per the proposal, no existing
  page should become AI-dependent or be replaced.
- Chat interface: message input, streaming response rendering (consumes
  TICKET-1's stream), conversation history for the session.
- Must not call OpenRouter directly and must not hold any API key — only
  talks to the new backend endpoint from TICKET-1.

### Depends on

TICKET-0's frontend audit (to confirm whether `AiCopilot.tsx` is reusable
scaffolding or a conflicting prior attempt).

---

## TICKET-6: Frontend — draft preview + approval flow

**Priority:** High
**Area:** same panel component as TICKET-5

### Scope

- When a tool call produces a draft (e.g. `create_event_draft`), render a
  preview card (name/date/location/etc., per the proposal's mockup) with
  Edit and Create/Confirm actions instead of executing immediately.
- "Edit" re-opens the fields for correction before resubmitting to the AI or
  directly patching the draft.
- Only on explicit user confirmation does the frontend trigger the
  publish/execute tool call.
- Tool-execution progress/result (including structured errors from TICKET-3)
  renders inline in the chat, with backend errors translated to plain
  language rather than shown as raw JSON/stack traces (proposal's explicit
  requirement — this translation happens in the LLM turn per the proposal,
  so confirm TICKET-1's system prompt handles it before assuming the
  frontend needs to do its own error-message mapping).

---

## TICKET-7: System prompt and tool-use policy

**Priority:** Medium
**Area:** `backend/ai_assistant.py` (or wherever TICKET-1 lands), no frontend

### Scope

Write and iterate on the system prompt per the proposal's prompting strategy:
never fabricate missing info, ask clarifying questions, use tools only when
required, never bypass validation, prefer drafts over immediate execution,
keep responses concise. This is a prompt-engineering/eval task, not a code
scaffold — needs a small set of test conversations (including adversarial
ones: "delete all events", "give me database access") to check the model
doesn't reach for tools outside TICKET-2's constrained set or attempt to
bypass the draft-then-approve flow.

---

## TICKET-8: Backlog — future tool expansion (not started)

**Priority:** Low (tracking only)
**Area:** N/A

Once TICKET-1–3's framework lands, additional tools (event-template
operations, team-member assignment, participant lookups) should be addable
as pure tool definitions without touching the assistant framework itself,
per the proposal's "Future Expansion" section. Not scoped until the core
framework ships and proves that pattern actually holds.
