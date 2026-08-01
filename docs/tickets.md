# Tickets

Backlog for the AI Side Panel initiative. Update statuses in place; remove or
archive tickets once they're done rather than leaving stale entries here. See
[`ai-panel-handover.md`](ai-panel-handover.md) for the current "what's built,
what's next, why" summary, and
[`ai-panel-compatibility-report.md`](ai-panel-compatibility-report.md) for
the Phase-0 investigation (TICKET-0) this backlog is built on.

The participant-portal backlog that lived in this file previously has been
cleared per instruction to repopulate around the new proposal — if that work
isn't actually done, recover it from git history (`git log -- docs/tickets.md`)
before it's lost for good.

---

~~TICKET-0: Phase 0 compatibility audit (blocking — do not start implementation before this)~~
— **Done.** Full findings in
[`docs/ai-panel-compatibility-report.md`](ai-panel-compatibility-report.md).
Headline results that change downstream tickets:

- **`AiCopilot.tsx` is already mounted as the side panel.** `src/App.tsx:1019`
  renders it inside `.product-frame` on every non-home admin page today —
  it's a static UI mock with no backend wiring (`sendGoal`/`loadGoal` only
  set local state), not collapsible yet, but the insertion-point question
  TICKET-5 was worried about is already answered by existing code.
- **`cancel_event` must never map to `delete_event`.** `delete_event` is a
  real hard delete with cascading `ON DELETE CASCADE` to tasks/subtasks/
  participations — the one irreversible operation in this area, and not
  something the proposal's tool list asked for. *(Superseded, see TICKET-9:*
  *mapping `cancel_event` to plain `close_event` turned out to be*
  *insufficient — closed-for-registration and actually-cancelled need to be*
  *distinguishable on the dashboard, so TICKET-9 adds a dedicated*
  *`cancelled_at` column and `POST /events/{id}/cancel` endpoint; that's*
  *the tool's real target.)*
- **In-process tool dispatch is confirmed workable** — route handlers'
  `Connection` parameter is just a plain `sqlite3.Connection` at the Python
  level; FastAPI's `Depends()` wiring is irrelevant to a direct in-process
  call. Acquire the connection via `backend.database.connect()` (the
  documented convention), not by copying `_common.py`'s inline
  `sqlite3.connect()` setup a third time.
- **No new dependency needed for OpenRouter.** `httpx` is already a backend
  dependency and supports streaming.
- Confirmed no soft-delete convention and no audit-log table exist anywhere
  in the schema (relevant to TICKET-4).

See the report for the full six-area breakdown, the tool/handler mapping
table, and recommended implementation order (TICKET-2 and TICKET-3 before
TICKET-1; TICKET-5/6 together once TICKET-1 lands; TICKET-4/7 in parallel).

<details>
<summary>Original ticket text</summary>

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
- **Authentication — decided, no new auth for this milestone.** The
  volunteer flow (`backend/api/routes/volunteer_auth.py`) has real
  password + bearer-token auth, but the **admin/organizer dashboard that this
  proposal targets has no authentication at all** — `events.py`,
  `event_templates.py`, `team_members.py`, `dashboard.py` have no session
  checks, no roles, no permission middleware. **Decision: ship the AI panel
  without introducing new auth**, under an explicit single-organizer/
  no-multi-tenant trust model for the hackathon. TICKET-3's "permission
  validation" stage is therefore a no-op/pass-through for now, not a gap to
  fill — don't build a parallel auth path just for the AI tools when none
  exists for the human-driven admin pages either. Revisit if real admin auth
  ever gets built (would have been the old backlog's TICKET-6).

</details>

---

~~TICKET-1: Backend AI endpoint — OpenRouter integration and streaming~~
— **Done.** New `backend/api/routes/ai_assistant.py` (registered in
`backend/api/router.py`), `POST /api/v1/ai/chat`. Accepts
`{"messages": [{"role": "user"|"assistant", "content": "..."}]}`
(`backend/schema/ai_assistant.py`), holds `OPENROUTER_API_KEY` server-side
only (`backend/README.md`/root `CLAUDE.md` document the env var; 500 if
unset), and streams Server-Sent Events (`token`/`tool_call`/`tool_result`/
`done`/`error`) back over `StreamingResponse`. Registers TICKET-2's tool set
with the OpenRouter call via `tools=TOOL_SPECS` (real function-calling
schema, not a system-prompt-only approach — see TICKET-7 for the prompt
itself). Contains no business logic: `run_chat_turn` only accumulates the
model's streamed tool-call fragments and hands them to
`ai_tools.dispatch_tool_call` (TICKET-2/3), nothing else. Handles exactly one
round of tool-calling per user turn (call whatever the model asked for, feed
results back, stream the follow-up reply) rather than an open-ended agent
loop — matches the draft-then-approve flow, since `publish_event` only fires
on a later, separate user turn once the organizer approves the draft.
Covered by `backend/tests/test_ai_assistant.py` using `httpx.MockTransport`
to fake OpenRouter's streaming response (no real network, no real key
needed): plain-text streaming, a full tool-call round trip (including
confirming `create_event_draft` never writes to the DB), a hypothetical
out-of-set tool call still getting rejected, the missing-`OPENROUTER_API_KEY`
500, and the empty-`messages` 422.

<details>
<summary>Original ticket text</summary>

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

TICKET-2 (needs the tool functions to dispatch to). No auth/permission
context to attach per TICKET-0's decision (ship without new auth).

</details>

---

~~TICKET-2: AI tool functions wrapping existing event operations~~
— **Done.** New `backend/ai_tools/` package: `tools.py` has the six thin
wrappers (`create_event_draft`, `publish_event`, `update_event`, `get_event`,
`list_events`, `cancel_event`), each calling straight into the matching
`backend/api/routes/events.py` handler in-process — no duplicated SQL or
business logic. `cancel_event` calls `events.cancel_event`
(`POST /events/{id}/cancel` from TICKET-9), never `close_event` or
`delete_event`; a test (`test_cancel_event_never_hard_deletes_the_row`)
locks that in. No `execute_sql`/`run_code`/generic tool exists, and
`TOOL_SPECS` (`specs.py`) is asserted to expose exactly the six named tools
and nothing else. `create_event_draft` reuses a new
`resolve_event_template_context` helper extracted from `create_event`
itself (`backend/api/routes/events.py`) — the same template-existence check
runs for both the draft and the real write, instead of a second copy that
could drift. Dispatch is in-process as decided (no HTTP loopback): tool
executors take a plain `sqlite3.Connection` from
`backend.ai_tools.dispatch_tool_call`'s caller, which for the endpoint is
the same request-scoped `Connection` `ai_assistant.py` already gets via
FastAPI's `Depends()` — no separate `backend.database.connect()` call turned
out to be needed since the endpoint already has a connection in hand.
Covered by `backend/tests/test_ai_tools.py` (17 tests): draft/publish/
update/get/list/cancel happy paths, missing-required-field and
missing-template rejections before any DB write, unknown-argument rejection,
missing-event 404s surfaced as structured errors, and an unknown tool name
(`delete_event`, `execute_sql`) rejected without touching the database.

<details>
<summary>Original ticket text</summary>

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
- `update_event`, `get_event`, `list_events` — map directly onto `events.py`'s
  existing handlers of the same name.
- `cancel_event` — **maps to `POST /events/{id}/cancel`** (shipped by
  TICKET-9), not `close_event` and never `delete_event`. `delete_event`
  hard-deletes the row with cascading deletes to tasks/subtasks/
  participations — never wire this tool to it under any circumstance.
- Explicitly out of scope per the proposal: no `execute_sql`, `run_code`, or
  any generic/filesystem tool.

### Dispatch approach — decided, with a fallback condition

Tools call the route *handler functions* directly, in-process (skipping
HTTP), rather than looping back through the app's own HTTP API. Acquire the
connection via `backend.database.connect(app.state.database_path)` (the
convention `CLAUDE.md` documents) rather than copying `_common.py`'s inline
`sqlite3.connect()` setup, and close it explicitly afterward since there's no
request-scoped generator managing that outside FastAPI's DI.

Only fall back to hitting the app's own HTTP API internally if in-process
calls turn out to need request-scoped state that can't reasonably be
constructed by hand.

</details>

---

~~TICKET-3: Validation pipeline (schema → business rules → permissions)~~
— **Done.** `backend/ai_tools/dispatch.py`'s `dispatch_tool_call` runs three
named stages: **schema** (`backend/ai_tools/schemas.py`'s `TOOL_ARG_MODELS`
subclass the same `EventCreate`/`EventUpdate` models `backend/schema/events.py`
already defines for the human HTTP routes, with `extra="forbid"` so an
LLM-invented extra field is rejected rather than silently ignored); **business**
(deliberately *not* re-implemented — the executors call straight into
`events.py`'s handlers, which already run their own checks such as
template-exists before any write, so there is no second copy to drift);
**permissions** (`_check_permissions` — an explicit, named no-op per
TICKET-0's decision that the admin backend has no auth/role concept yet, so
a real check has an obvious place to plug in later instead of being silently
skipped). Any failure at any stage becomes
`{"success": false, "reason": "..."}` instead of a raised exception —
verified for a missing required field, a missing referenced template, and a
missing event id, all before any database write. Test coverage lives
alongside TICKET-2's in `backend/tests/test_ai_tools.py` since the pipeline
and the tools it wraps were built and tested together.

<details>
<summary>Original ticket text</summary>

**Priority:** High
**Area:** backend, shared across all tools from TICKET-2

### Scope

- **Schema validation**: Pydantic models in `backend/schema/` already do
  this for existing routes — reuse the same request models (e.g. whatever
  `EventCreate` looks like) for AI-generated tool arguments instead of
  writing parallel schemas, so the two paths can't drift.
- **Business validation**: dates valid, referenced entities (venue, event
  template) exist, `event_time` present — again, reuse whatever validation
  `events.py`'s handlers already do rather than re-implementing it for the
  AI path.
- **Permission validation**: no-op for this milestone per TICKET-0's
  decision (ship without new auth). Leave an explicit, named pass-through
  step in the pipeline rather than silently skipping it, so it's obvious
  where a real check would plug in later.

### Acceptance criteria

- A tool call with a missing required field is rejected before reaching the
  database, with a structured `{"success": false, "reason": "..."}"` error,
  not a raw exception.
- No new validation logic exists that isn't just reused from what
  `backend/schema/` and `events.py` already enforce for the human-driven path.

</details>

---

~~TICKET-4: Audit logging for AI-generated mutations~~
— **Done.** New additive migration `009_ai_audit_log.sql` adds an
`ai_audit_log` table (`id`, `created_at`, `tool_name`, `arguments` as a JSON
string, `success`, `entity_id`, `reason`) — no acting-user column, per
TICKET-0's decision that the admin side has no auth/user concept yet.
`backend/ai_tools/dispatch.py`'s `dispatch_tool_call` now routes every
return path (unknown tool name, schema-validation rejection, business
validation/execution failure, success) through a single `_finish` helper
that calls `_record_audit_log` before returning, so every dispatch is
logged regardless of which stage produced the result — including
`create_event_draft`, which never writes an `events` row itself but is
still audited. `entity_id` is derived from the tool result's `id` field
when present (e.g. `publish_event`/`update_event`/`cancel_event`) and left
`NULL` otherwise (e.g. `list_events`, or any failure). Covered by four new
tests in `backend/tests/test_ai_tools.py`: a successful dispatch records
`tool_name`/`arguments`/`entity_id` with `reason` left `NULL`, a business
validation failure records `success=0` with the reason populated and no
entity id, an unknown tool name is still audited, and a `create_event_draft`
call is audited even though it performs no database write. Full backend
suite (97 tests) still passes.

**Open question carried over, not resolved by this pass:** should this log
stay AI-only, or become the start of a general mutation audit log covering
human-driven admin actions too? Not decided — out of this ticket's scope,
which only covers what the proposal asked for (AI-originated mutations).

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** `backend/migrations/` (new additive migration), all AI tool
execution paths

### Scope

The proposal requires "every AI-generated mutation must be auditable." No
audit-log table exists in the schema today (confirm during TICKET-0). Needs:

- A new additive migration (following the `002_add_event_description.sql`
  pattern) adding an audit table — at minimum: timestamp, tool name,
  arguments, and resulting entity id. No acting-user column for now since
  there's no auth/user concept on the admin side (TICKET-0's decision); add
  one later if admin auth ever gets built.
- Every tool dispatch in TICKET-1/2 writes a row here, on both success and
  failure.

### Open question

Should this log *only* AI-originated mutations, or become the start of a
general mutation audit log covering human-driven admin actions too? The
proposal only asks for the former, but a log that only covers AI actions
will look inconsistent next to human-driven changes with no trail at all.
Flagging for a decision, not assuming scope beyond what's asked.

</details>

---

~~TICKET-5: Frontend — AI side panel UI shell~~
— **Done.** New `src/ai-api.ts` exposes `streamChat(messages, signal?)`, an
async generator that `POST`s to `/api/v1/ai/chat` (TICKET-1) and parses the
`fetch` response body's SSE frames (`token`/`tool_call`/`tool_result`/
`error`/`done`) into typed events — it holds no API key and never talks to
OpenRouter, only this backend endpoint. `AiCopilot.tsx`'s hardcoded
`recommendedActions`/"Broadcast draft" mock and the `goal`/`draft`
local-state stand-in are gone, replaced with a real `conversation:
ChatMessage[]` sent in full on every turn (the backend is stateless per
TICKET-1) inside the `.copilot-chat`/`.copilot-composer` shell TICKET-10
built. `token` events append to a streaming assistant bubble in place;
`tool_call`/`tool_result` render as a lightweight inline status line
(`"<tool> succeeded."` / `"<tool> failed: <reason>"`) rather than
TICKET-6's dedicated `.suggestion-card` review UI, which is out of this
ticket's scope; `error` events surface in a `.copilot-message-error`
bubble instead of a raw exception. Found and fixed one CSS bug while
verifying in-browser: `.copilot-chat`'s grid rows stretched to fill the
panel's full height when there were only one or two messages (`align-content:
normal` behaves as `stretch` for auto-sized grid tracks) — added
`align-content: start` to keep bubbles anchored to the top instead of
spread across empty space. New `src/AiCopilot.chat.test.tsx` (4 tests,
`fetch` stubbed with a hand-built `ReadableStream` SSE response) covers:
a plain streamed reply reaching the backend with the right request body,
`tool_call`/`tool_result` rendering inline, an `error` event surfacing in
plain language, and prior turns being resent as history on the next
message. `src/AiCopilot.test.tsx` (TICKET-10's collapse/focus tests) needed
one unrelated fix — `chatRef.current.scrollTo` isn't implemented in jsdom,
switched to setting `scrollTop` directly. Verified live in-browser against
a running backend with no `OPENROUTER_API_KEY` set: user message renders,
request reaches `/api/v1/ai/chat`, and the 500's `detail` surfaces as a
readable inline error rather than a blank panel or an unhandled rejection.
`npx tsc --noEmit` and `npm test -- --run` (94 tests across 14 files) both
pass.

<details>
<summary>Original ticket text</summary>

**Priority:** High
**Area:** `src/AiCopilot.tsx`, `src/App.tsx` (mounting site, no change needed)

### Resolved by TICKET-0's audit — this is a rewrite of an existing mock, not new placement

`src/AiCopilot.tsx` is **already mounted** as the side panel —
`src/App.tsx:1019` renders `<AiCopilot activePage={activePage} />` inside
`.product-frame` on every non-home admin page (dashboard, events,
volunteers, and the dedicated `"ai"` page). No new insertion point or layout
wrapper is needed; don't build a second panel alongside it.

What's there today is a **static visual mock with no backend wiring**:
`sendGoal`/`loadGoal` only set local `useState` (`goal`/`draft`), there's no
`fetch` call anywhere in the file, and `pageContext`/`pageInsight`/the fixed
"Recommended actions" and "Approval queue" items (lines 4–18, 90–115) are
hardcoded demo copy, not real state. There's also no collapse/expand toggle
despite the proposal asking for a collapsible panel — **see TICKET-10**,
which found a complete, unused collapsible-overlay CSS design already dead
in `index.css` and specifies rebuilding `AiCopilot.tsx` on top of it instead
of the current `.copilot-sidebar` grid layout. Do TICKET-10's structural
rework first; this ticket's scope is what goes *inside* that shell.

### Scope

- Replace the hardcoded mock content (goal-setting composer, fake
  recommended-actions list, fake approval-queue item) with a real chat
  interface: message input, streaming response rendering (consumes
  TICKET-1's stream), conversation history for the session, inside the
  `.copilot-panel`/`.copilot-chat` shell TICKET-10 produces.
- Must not call OpenRouter directly and must not hold any API key — only
  talks to the new backend endpoint from TICKET-1.
- Do this rewrite in one pass together with TICKET-10, not incrementally
  alongside the mock — a half-wired panel next to leftover fake
  "Recommended actions" buttons would make it unclear to anyone testing the
  app which parts are real.

</details>

---

~~TICKET-6: Frontend — draft preview + approval flow~~
— **Done.** New backend endpoint `POST /api/v1/ai/tools/{tool_name}`
(`backend/api/routes/ai_assistant.py`, `ToolInvocationRequest` in
`backend/schema/ai_assistant.py`) directly calls `dispatch_tool_call` —
same schema/business/permission pipeline as an LLM-issued call, just
bypassing the model entirely. This exists specifically so the frontend can
fire `publish_event` itself on explicit confirmation, rather than sending
another chat turn and hoping the model re-issues the same tool call with
the same (possibly edited) fields. New `invokeTool(toolName, args)` in
`src/ai-api.ts` calls it.

`AiCopilot.tsx`: a successful `create_event_draft` `tool_result` now sets a
`draftPreview` state (the draft's `EventCreate`-shaped fields) instead of
rendering the generic "create_event_draft succeeded." activity line, shown
as a `.suggestion-card` with Name/Venue/Date/Description and **Edit** /
**Create Event** buttons. Edit toggles an inline form that patches
`draftPreview` directly (client-side only, no round-trip to the AI) — the
"resubmit to the AI" alternative the ticket floated wasn't needed since
patching the already-validated draft object is simpler and doesn't risk
the model changing unrelated fields. **Create Event** is disabled while
editing (forces "Done editing" first) and calls `invokeTool("publish_event",
draftPreview)` only on that explicit click; the outcome renders through
the same tool-activity line as any other tool call ("publish_event
succeeded."/"publish_event failed: `<reason>`") — on success the card is
removed (no stale Edit/Create buttons left behind); on failure the card
stays so the organizer can fix the draft and retry, since `dispatch_tool_call`
already returns plain-language reasons (e.g. "Event 9999 was not found"),
not raw JSON/stack traces, matching this ticket's error-message requirement.

New tests: `backend/tests/test_ai_assistant.py`'s `ToolInvocationEndpointTest`
(4 tests — publishes directly, unknown tool name is a structured 200
response rather than a 404, missing required field, and the dispatch is
still written to `ai_audit_log` per TICKET-4). New
`src/AiCopilot.draft.test.tsx` (4 tests) covers the card rendering instead
of the generic status line, editing without firing any request, confirming
with the edited fields sent to `/ai/tools/publish_event` and the card
disappearing on success, and the card staying open with a plain-language
reason on failure. One pre-existing TICKET-5 test in
`src/AiCopilot.chat.test.tsx` used `create_event_draft` to test the generic
tool-activity line — switched to `list_events` since a successful draft no
longer renders that line at all.

Verified live end-to-end against the running backend and a real
OpenRouter key: asked the panel to draft a beach cleanup event, the
suggestion-card rendered separately from the model's own prose, edited the
name inline, confirmed, and the event was created in the database with the
edited name (`curl .../api/v1/events` showed it), then cleaned up via
`DELETE`. `npx tsc --noEmit`, `npm test -- --run` (99 frontend tests), and
the full backend suite (101 tests) all pass.

**Found but not fixed here, flagging for TICKET-7:** the live model was
initially unwilling to omit the optional `event_template_id` field even
after being told there was no template, and only proceeded once given a
real template id. That's a system-prompt/tool-schema framing issue for
TICKET-7's prompt-iteration work, not a TICKET-6 defect — the draft/confirm
UI behaved correctly once the model did call `create_event_draft`.

<details>
<summary>Original ticket text</summary>

**Priority:** High
**Area:** same panel component as TICKET-5/TICKET-10

### Scope

- When a tool call produces a draft (e.g. `create_event_draft`), render a
  preview card using TICKET-10's `.suggestion-card` (name/date/location/etc.,
  per the proposal's mockup) with
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

</details>

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

---

~~TICKET-9: Event cancellation as a distinct state from closed registration~~
— **Done.** Implemented exactly as scoped below: `008_event_cancellation.sql`
adds nullable `events.cancelled_at`; `POST /events/{id}/cancel` sets it
together with `status='closed'`; `EventSummary`/`EventDetail` expose a
derived `is_cancelled: bool`; `dashboard_summary` and `calendar_events` both
add `AND cancelled_at IS NULL`; the admin Events page
(`EventCollectionPrototype.tsx`/`AdminEventsPage.tsx`) shows a distinct
"Cancelled" badge, hides cancelled events by default behind a new "Show
cancelled" toggle (mirroring "Show closed"), and offers a "Cancel Event"
action (with a confirmation dialog) instead of only close/reopen; the
participant portal (`EventBrowseList`, `MyEventsList`, `EventDetailCard`)
excludes cancelled events from browsing but still shows an already-RSVP'd
participant a "Cancelled" badge rather than silently dropping the event.
Covered by new tests on both sides:
- Backend (`backend/tests/test_admin_api.py`):
  `test_organizer_cancels_an_event_distinctly_from_closing_it` (cancel sets
  both `status`/`is_cancelled`, and both `/dashboard/summary` and
  `/calendar/events` exclude it) and `test_cancelling_a_missing_event_is_a_404`.
  `backend/tests/test_participants.py` adds
  `test_participant_events_flags_a_since_cancelled_event`, since
  `/participants/{id}/events` needed its own `is_cancelled` derivation
  (separate code path from `events.py`'s).
- Frontend admin (`src/AdminEventsPage.test.tsx`):
  `cancels an Event distinctly from closing it` (Cancel Event dialog → API
  call → "Cancelled" badge → no Reopen/Close buttons) and
  `hides cancelled Events from the portfolio by default, revealing them
  under Show cancelled`.
- Frontend participant portal: `src/participant/components/EventBrowseList.test.tsx`
  (a cancelled event is excluded even though still upcoming by date, and the
  empty state shows when it's the only event), `EventDetailCard.test.tsx`
  (cancelled notice for a visitor, and "Remove from my events" instead of the
  normal cancel-signup button for an already-RSVP'd participant), and a new
  `MyEventsList.test.tsx` (this component had no test file before — it now
  covers the sign-up prompt, normal RSVP listing, and the cancelled badge).

`npx tsc --noEmit`, `npm test -- --run` (90 tests across 12 files), and the
full backend unittest suite (71 tests) all pass. Also verified live
in-browser: cancelling an event via the admin dialog, toggling "Show
cancelled", the workspace's "Cancelled" notice (replacing "Reopen Event"
with nothing — see open question below), and the participant detail page
showing "This event has been cancelled by the organizer."

**Found during implementation, resolved defensively rather than by
resolving the open question below:** the existing `reopen_event` endpoint
only flips `status` back to `'open'` and does not clear `cancelled_at` —
reachable only via a direct API call, not through the admin UI (the
"Reopen Event" button is intentionally not rendered for a cancelled event,
only for an ordinarily-closed one). That leaves a theoretical
`status='open'` + `cancelled_at` set state reachable from outside the UI;
`dashboard_summary`/`calendar_events`'s `AND cancelled_at IS NULL` clauses
were kept even though `status='open'`/`'closed'` filtering alone would
otherwise be sufficient, specifically so that state still can't leak into
the "what's coming up" views. Deciding true reversibility (clearing
`cancelled_at` on reopen) is still open — see below.

<details>
<summary>Original ticket text</summary>

**Priority:** High — blocks TICKET-2's `cancel_event` tool from doing the
right thing
**Area:** `backend/migrations/` (new additive migration),
`backend/api/routes/events.py`, `backend/schema/events.py`,
`backend/api/routes/dashboard.py`, `src/EventCollectionPrototype.tsx` (the
live admin Events page per TICKET-17's finding), `src/participant/`

### Problem

TICKET-0's audit originally proposed mapping an AI `cancel_event` tool onto
the existing `close_event` handler, since `EVENT.status` only has
`'open'|'closed'` and no cancellation concept exists. On review this isn't
good enough: `status='closed'` is documented (`CLAUDE.md`) as meaning
*registration* closed, not "this event isn't happening" — a closed-because-
full event and a closed-because-cancelled event would be visually and
query-wise indistinguishable, and `dashboard.py`'s `dashboard_summary`/
`calendar/events` queries would keep surfacing a cancelled event as just
another closed one rather than hiding or flagging it.

### Decision: add a separate `cancelled_at` column, don't overload `status`

New additive migration (e.g. `008_event_cancellation.sql`) adding
`events.cancelled_at TEXT` (nullable, unset by default). Rejected
alternative: adding `'cancelled'` as a third `EventStatus` value — `status`
is already consumed elsewhere (dashboard queries, the participant portal's
upcoming/past logic) purely as a registration toggle, so folding lifecycle
state into the same enum means auditing and changing every existing
consumer to treat `'cancelled'` specially, with real risk of a future
`status == 'closed'` check silently mishandling a cancelled event. A
separate nullable timestamp column keeps `status`'s existing, documented
meaning untouched, and doubles as a free "when was this cancelled" audit
field without a separate audit table.

### Scope

- Cancelling an event sets `cancelled_at = CURRENT_TIMESTAMP` **and**
  `status = 'closed'` together (a cancelled event shouldn't keep accepting
  RSVPs) — but not the reverse: an ordinarily closed event (full, or past)
  has `cancelled_at IS NULL`. New `POST /events/{id}/cancel` endpoint in
  `events.py`, mirroring `close_event`'s existing pattern.
- `dashboard.py`'s `dashboard_summary` (`upcoming_events` count) and
  `calendar_events` add `AND cancelled_at IS NULL` to their `WHERE` clauses
  so a cancelled event disappears from the default "what's coming up" views
  — this is the "disappear" half of the requirement.
- The admin Events list/calendar (`EventCollectionPrototype.tsx`) renders a
  cancelled event with a distinct "Cancelled" badge (not the same pill as
  "Closed") and excludes it from the default view, but keeps it visible
  under an explicit "Show cancelled" filter — mirroring the "Show closed"
  toggle (`collection-closed-toggle`) already coded there — so organizers
  don't lose the event's task/participation history. This is the
  "distinction" half of the requirement, for whoever wants it instead of
  outright disappearance.
- `EventSummary`/`EventDetail` (`backend/schema/events.py`) expose the new
  field (e.g. a derived `is_cancelled: bool` rather than the raw timestamp,
  matching the schema's existing `as_bool`-style conventions).
- Participant portal (`src/participant/`): a cancelled event must stop
  appearing in `EventBrowseList`'s upcoming list, and a participant who
  already RSVP'd to a since-cancelled event should see it marked
  "Cancelled" in `MyEventsList`/`EventDetailCard` rather than it silently
  vanishing — they still need to know their plans changed.

### Open questions

- Should cancellation be reversible (an "uncancel" clearing `cancelled_at`)?
  Not asked for in the AI-panel proposal — `cancel_event` as an AI tool is
  one-way — but worth deciding for the human-driven admin UI, where a
  mis-click is more likely than from a drafted-and-confirmed AI action.
- Exact visual treatment for a cancelled *and already past* event in the
  participant's "My Events" (grey out vs. remove) — left to whoever
  implements that piece, not blocking.

### Depends on / affects

Corrects TICKET-0's audit and TICKET-2's tool mapping — see the update in
each. `docs/ai-panel-compatibility-report.md`'s §1/§2/candidate-tools table
should get a short addendum note pointing here rather than being rewritten.

</details>

---

~~TICKET-10: Redesign the AI panel as a collapsible drawer (mobile + desktop)~~
— **Done.** `AiCopilot.tsx` rebuilt on the dead FAB/panel classes exactly as
scoped below (all 6 points), plus one bug found during verification: the FAB
and close button aren't mounted simultaneously (each only renders for its
own `open` state), so the original inline `fabRef.current?.focus()` inside
`close()` ran before React had committed the FAB back into the DOM and
silently no-op'd. Fixed by moving focus management into a `useEffect` keyed
on `open` (tracks the previous state via a `wasOpenRef` so it knows to focus
the close button on open and the FAB on close, without an inline call racing
the render). Verified in-browser at both desktop and mobile viewports: FAB
toggle, Escape-to-close, backdrop click-outside-to-close (desktop only —
correctly absent under 810px), and focus landing on the close button on
open / returning to the FAB on close all confirmed working; `npx tsc
--noEmit` and `npm test -- --run` (75 tests) both pass.

**Update: automated test coverage added.** The pass above only had
in-browser manual verification — no test file existed for `AiCopilot.tsx` at
all. `src/AiCopilot.test.tsx` (new) now covers, without a browser: collapsed
by default (FAB visible, panel `aria-hidden`/no `.open` class), opening via
the FAB moves focus to the close button and hides the FAB, Escape closes and
returns focus to the FAB, the close button does the same, clicking the
backdrop closes the panel, and the FAB's `aria-expanded`/`aria-controls`
point at the panel's `id`. (The panel is `aria-hidden` while closed, which
removes it from the accessibility tree — Testing Library's `getByRole` can't
see it then, so the tests look the panel up by `id` directly rather than by
role/name whenever it might be closed.) Desktop-only backdrop absence under
the 810px breakpoint is CSS (`display: none` in a media query) that jsdom
doesn't evaluate, so that half stays manual-verification-only; the
backdrop's presence and click-to-close behavior are what's covered here.

Additional cleanup beyond the original scope's item 6: also removed a third,
already-dead "workflow-wizard" copilot design
(`.copilot-workflow-*`/`.copilot-page-context`/`.copilot-steps`/
`.copilot-prompts`/`.copilot-eyebrow`) that predated this ticket and was
sitting unreferenced in the same CSS region — left in place it would have
been a second zombie design right next to the newly-resurrected one, working
against the "more readable after resurrection" goal. Also found and removed
a second, unrelated dependency on the deleted `--copilot-sidebar-width`
variable in `EventOperationsMvp.css` (`.product-app .event-creation-overlay`,
base + mobile-media-query copies) — dead now that `.product-app` is no
longer applied anywhere in `App.tsx`.

One process note: an earlier pass ran `npm run format` to check style
consistency, which reformatted the *entire* codebase (oxfmt's default style
strips semicolons, which doesn't match this repo's committed convention) —
caught before committing, reverted every file outside this ticket's actual
scope via `git checkout --`, and manually restored `App.tsx`/`AiCopilot.tsx`
to the semicolon style the rest of the repo uses. Worth remembering:
`npm run format` isn't safe to run repo-wide here without review.

<details>
<summary>Original ticket text</summary>

**Priority:** High — supersedes TICKET-5's original "add a collapse toggle
to the sidebar" scope
**Area:** `src/index.css`, `src/AiCopilot.tsx`, `src/App.tsx` (layout
simplification)

### Finding: the collapsible design already exists, unused, dead in CSS

`src/index.css:2504-2720` defines a complete floating-action-button +
slide-in-overlay design — `.copilot-fab` (fixed round toggle button,
bottom-right), `.copilot-panel`/`.copilot-panel.open` (fixed, right-anchored,
`width: min(440px, 100vw)`, `transform`/`opacity` transition, `z-index: 160`),
`.copilot-header` (with a close button), `.copilot-context` (an insight
card), `.copilot-chat` (message list container), `.copilot-message` (chat
bubble) and `.suggestion-card` (an actionable card with a single confirm
button — a plausible base for TICKET-6's draft-approval card), and
`.copilot-composer` (pill input + round send button). **None of these
classes are referenced by any `.tsx` file today** — grep confirms zero
matches outside `index.css`. This is dead CSS from what looks like an
earlier iteration of the AI copilot design, superseded by the current
permanent-sidebar `AiCopilot.tsx`/`.copilot-sidebar` without ever being
deleted. There's even an existing `@media (max-width: 810px)` block that
already sets `.copilot-panel { width: 100vw }` and repositions `.copilot-fab`
— full-screen-on-mobile is already designed for.

### Why this is a better base than retrofitting `.copilot-sidebar`

The live layout reserves permanent space via CSS grid
(`.product-frame { grid-template-columns: minmax(0,1fr) var(--copilot-sidebar-width) }`)
and shrinks the navbar to match
(`.product-app .navbar { right: var(--copilot-sidebar-width) }`) — making it
collapsible means resizing the grid and the navbar rule in sync, more moving
parts. On mobile it doesn't collapse at all today: it stacks below the page
content at a fixed 720px height (`@media max-width:810px`), forcing a
scroll past it on every visit — the opposite of convenient. A fixed overlay
toggled open/closed is a single mechanism that's naturally the same shape on
both breakpoints — only the width differs, which `min(440px, 100vw)`
already encodes.

### Scope

1. Rebuild `AiCopilot.tsx` on the dead `.copilot-fab`/`.copilot-panel`/
   `.copilot-header`/`.copilot-chat`/`.copilot-message`/`.suggestion-card`/
   `.copilot-composer` classes instead of `.copilot-sidebar`'s. A boolean
   `open` state, **default `false` on every breakpoint** (so no page becomes
   AI-dependent, per the proposal's own constraint), toggles the `.open`
   class on `.copilot-panel` and shows/hides the `.copilot-fab` trigger.
2. Drop `.product-frame`'s grid reservation and the
   `.product-app .navbar { right: ... }` shrink rule — the panel becomes a
   fixed overlay over single-column page content instead of pushing it, so
   `App.tsx`'s `.product-frame`/`.product-page-content` wrapping (around
   line 1004-1021) simplifies to just rendering `AiCopilot` as a fixed
   sibling.
3. Add a semi-transparent backdrop behind `.copilot-panel` at desktop
   widths (click-outside-to-close); skip it under the mobile breakpoint
   where the panel is already full-viewport.
4. Accessibility: `role="dialog"` + `aria-modal="true"` on `.copilot-panel`
   while open, focus moves into the panel (to its close button) on open and
   back to the FAB on close, `Escape` closes it, `aria-expanded`/
   `aria-controls` on the FAB trigger.
5. Persist open/closed across in-app navigation via component state lifted
   to wherever `App.tsx` already holds `activePage` — not `localStorage`,
   doesn't need to survive a full page reload for this milestone — so
   switching from Dashboard to Events doesn't unexpectedly close a panel the
   organizer had open.
6. Delete the now-fully-unused `.copilot-sidebar`/`.copilot-brief-*`/
   `.copilot-priority-card`/`.copilot-action-stack`/`.copilot-approval-queue`/
   `.copilot-active-goal` CSS once `AiCopilot.tsx` no longer references
   them, so the repo doesn't end up with two dead copilot designs instead of
   one.

### Depends on / affects

Supersedes TICKET-5's layout scope (see the update there); TICKET-6's
draft-approval cards should target `.suggestion-card` from this design
rather than inventing new markup.

</details>

---

~~TICKET-11: Render assistant chat replies as markdown~~
— **Done.** Added `react-markdown` (new dependency — parses to React
elements directly, never `dangerouslySetInnerHTML`, so a prompt-injected
reply can't get raw HTML/script markup executed) and used it for assistant
message content only in `AiCopilot.tsx`; user messages stay a plain `<p>`
since there's no need to parse the organizer's own typed input as markdown.
Added list/paragraph/bold styling under `.copilot-message` in `index.css`
(`ul`/`ol`/`li` spacing — `react-markdown` had nothing to render into
before). New test in `src/AiCopilot.chat.test.tsx` streams a numbered list
with bold text and asserts real `<li>`/`<strong>` elements exist and no
literal `**` markers survive. Verified live against the running backend
with a real OpenRouter key: "List the upcoming events" now renders bolded
event names and a real nested list instead of one run-on paragraph with
visible asterisks. `npx tsc --noEmit` and `npm test -- --run` (95 tests)
both pass.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium — visible formatting bug in the shipped TICKET-5 chat
**Area:** `src/AiCopilot.tsx`

### Problem

The model (per TICKET-7's system prompt guidance to "keep responses
concise") replies with markdown — numbered lists, `**bold**` — but
`AiCopilot.tsx` renders assistant message content as raw text inside a
single `<p>`. HTML collapses the model's newlines, so a numbered list
comes out as one run-on paragraph with literal `**asterisks**` visible
instead of bold text or list markup.

### Scope

- Render assistant message content through a markdown-to-React renderer
  instead of a raw `<p>{content}</p>`. User messages stay plain text (no
  need to parse the organizer's own input as markdown).
- Must not use `dangerouslySetInnerHTML` — the content originates from an
  LLM, and a prompt-injected reply that emitted raw `<script>`/`<img
  onerror>` markup must not execute. Whatever renderer is chosen must parse
  to React elements directly rather than an HTML string, so no HTML
  passthrough is possible without a plugin deliberately opting into one.
- Verify list/bold formatting renders correctly for a real streamed
  response, not just a canned test string.

</details>
