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

### Audit update (post-TICKET-6): concrete candidates, not yet scoped

A pass over `backend/ai_tools/`'s six existing tools found **no
redundancy** — each wraps a distinct `events.py` handler
(`create_event_draft`/`publish_event` are a deliberate two-step
draft-then-approve pair per TICKET-2, not overlap; `cancel_event` is
explicitly kept separate from `close_event`, which stays unexposed to the
AI, per TICKET-9). A pass over the rest of the app's already-implemented
(not just proposed) backend surface turned up real candidates for
expansion, every one mapping to a handler function that already exists and
is already used by some admin page today — nothing here requires new
backend logic:

- **`list_event_templates`** → `event_templates.list_templates`
  (`GET /event-templates`) — **scoped and picked up as TICKET-12**, since
  TICKET-6's live verification hit exactly the gap this fills.
- **Volunteer management** (flagged as a promising area — the admin side
  has real signup/approval workflows today with no AI tool touching them
  at all):
  - `list_volunteers` → `volunteers.list_volunteers`
    (`GET /volunteers`) — e.g. "find approved volunteers with a first-aid
    skill."
  - `list_event_signups` → `volunteers.list_event_signups`
    (`GET /events/{event_id}/volunteer-signups`) — "who's signed up for
    Saturday's cleanup and what's their status?"
  - `approve_event_signup` / `reject_event_signup` →
    `volunteers.approve_event_signup` /
    `volunteers.reject_event_signup` — lets an organizer approve/reject a
    signup by name in one chat turn instead of opening `EventRoster.tsx`.
    These are the closest analog to `cancel_event`'s "the AI can execute
    a real state change" precedent, so should get the same drafted-then-
    confirmed treatment TICKET-6 built if picked up, not fire-and-forget.
- **`update_event_task`** → `events.update_event_task`
  (`PATCH /events/{event_id}/tasks/{task_id}`, supports setting
  `team_member_id`) — "assign Alvin to the venue-setup task," the actual
  mechanism `AdminEventsPage.tsx` already uses for task assignment.
- **`dashboard_summary`** → `dashboard.dashboard_summary`
  (`GET /dashboard/summary`) — read-only, lets the AI answer "how are we
  doing this week" without the organizer opening the dashboard page.

None of these are scoped into a ticket yet except TICKET-12 — listed here
so a future pass doesn't have to re-derive candidates from scratch.
Volunteer-management tools in particular are flagged as high-value since
that whole workflow currently has zero AI coverage.

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

---

~~TICKET-12: AI needs visibility into existing event templates~~
— **Done.** New seventh tool `list_event_templates` (thin wrapper around
`event_templates.list_templates`, registered in `backend/ai_tools/tools.py`/
`schemas.py`/`specs.py` exactly like the existing six), plus a
`SYSTEM_PROMPT` addition (`backend/api/routes/ai_assistant.py`) telling the
model to call it and match by name instead of asking the organizer for a
raw id, and that `event_template_id: null` is valid input, not missing
information. `test_tool_specs_expose_exactly_the_named_tool_set` extended
to the new seven-tool set; three new tests in `backend/tests/test_ai_tools.py`
cover the tool returning id/name, filtering by search text, and rejecting
unknown arguments.

**Two real bugs found and fixed during live verification** (not present in
the ticket's original scope, but directly blocking the flow this ticket
exists to fix):
- **A whitespace-only assistant turn broke the next message.** When a turn
  only makes a tool call (e.g. `list_event_templates`) with no trailing
  commentary, OpenRouter can stream a content-free or whitespace-only
  reply (observed live: a lone `"\n\n"`). That message stayed in
  `conversation` and got resent as history on the next turn —
  `ChatMessage.content`'s `NonEmptyText` validation rejects it, so the next
  message 422'd. Fixed in `AiCopilot.tsx`'s `sendMessage` by filtering
  `conversation` on `message.content.trim()` before building the history
  sent to the backend, matching the same trim check now used when deciding
  whether to render a message bubble at all (an empty/whitespace-only
  bubble is confusing to a human reader, flagged during review — fixed in
  the same pass rather than filed separately).
- **A validation-error 422 rendered as literal `"[object Object]"`.**
  FastAPI's `detail` is a plain string for a raised `HTTPException`, but a
  *list* of `{loc, msg, type}` objects for a Pydantic validation failure —
  `ai-api.ts` was interpolating `detail` directly into `Error(...)`, and
  `Array.prototype.toString` on a list of objects produces exactly
  `"[object Object]"`. New `formatErrorDetail` in `src/ai-api.ts` extracts
  and joins the `msg` fields when `detail` is an array, falling back to a
  generic "Request failed with status N" only if no message can be
  extracted. Both used by `streamChat` and `invokeTool`'s error paths.

Two new regression tests in `src/AiCopilot.chat.test.tsx` lock these in:
one streams a whitespace-only token then a second turn, asserting no
`.copilot-message-assistant` bubble renders and the resent history omits
the blank turn; the other asserts a FastAPI-style `detail` array renders
its `msg` text, not `[object Object]`.

Verified live end-to-end against the running backend and a real
OpenRouter key, reproducing the exact scenario that surfaced these bugs:
asked the panel to draft an event naming "Skill Enhancement" by name — the
model called `list_event_templates` with `q: "Skill Enhancement"` (matched
by name, confirmed via `ai_audit_log`), and confirming afterward no longer
422'd or showed a raw `[object Object]`/empty bubble. Also reproduced the
original TICKET-6 confusion directly: asking for a draft naming no
template now proceeds immediately with `event_template_id: null` instead
of the model refusing to continue without a raw id.

**Found but not chased further, flagging for TICKET-7:** on the
confirmation turn the model sometimes re-calls `list_event_templates`
instead of proceeding straight to `create_event_draft` with the id it
already resolved — a conversational-efficiency nuance, not a correctness
bug (the tool still resolves correctly each time), better addressed by
TICKET-7's prompt-iteration work than by further changes here.

**Third fix, prompted by user feedback during live verification:** a turn
where `list_event_templates` is the only thing that happens (no trailing
model commentary, which the whitespace-only-content case above shows does
happen) used to leave the organizer looking at a bare
"list_event_templates succeeded." line with no way to tell what templates
exist or that it's their turn to respond. `AiCopilot.tsx`'s tool-activity
rendering now special-cases a successful `list_event_templates` result to
render the templates themselves — name, description, "No matching
templates found." when the list is empty — instead of the generic status
line, so the organizer always has something concrete to act on regardless
of whether the model adds its own prose. Two more tests in
`src/AiCopilot.chat.test.tsx` cover the populated and empty-results cases.

**Fourth and fifth fixes, from the same live-verification pass (user
watched and flagged both):**
- The `list_event_templates` fallback list initially duplicated the
  model's own text whenever the model *did* narrate the results — the
  organizer would see the same template names twice. Generalized the
  fallback policy to every tool activity, not just templates: a **failure
  always shows** (a silently swallowed failure is a trust problem,
  independent of whether the model's text mentions it), but a **success
  only shows when the model's own reply ends up empty** — `modelRepliedWithText`
  is computed once from the turn's final assistant message and gates every
  tool-activity success line, including the `list_event_templates` list.
- That fallback decision was also being made too early — right when
  `tool_result` arrived, before any trailing tokens had streamed in —
  causing a visible flash-then-hide once real text caught up a moment
  later. Fixed by not rendering a "done" entry's outcome at all while
  `isStreaming` is still true; only "Running `<tool>`…" renders during the
  stream, and the final success/failure/fallback content resolves once
  the turn is fully settled.
- One more subtlety caught by a test failure while fixing this: TICKET-6's
  `confirmDraft` fires `publish_event` directly via `invokeTool`, outside
  any chat turn — there is no model text to ever defer to for that action.
  `ToolActivity` gained an `origin: "chat" | "direct"` tag so the
  success-suppression rule only applies to `"chat"`-origin entries;
  `"direct"` ones (currently just the confirm button's `publish_event`)
  always show their outcome.

Four new/updated tests in `src/AiCopilot.chat.test.tsx` cover: a
tool-with-text turn correctly suppressing the redundant status line, a
tool-with-no-text turn still falling back to it, a failure always showing
even alongside model text, and (in `AiCopilot.draft.test.tsx`, already
covered) `confirmDraft`'s `publish_event` outcome still showing regardless
of prior conversation text.

`npx tsc --noEmit`, `npm test -- --run` (105 frontend tests), and the full
backend suite (104 tests) all pass. Verified live end-to-end with a full
multi-turn conversation against the real OpenRouter-backed chat: template
lookup, a template-based draft, confirming via the suggestion-card,
listing events to verify, and cancelling — the fixed status-line policy
held up cleanly throughout (no duplication, no flicker, the direct-publish
outcome still visible after prior turns had text).

**Found but not chased further, flagging for TICKET-7 (second instance):**
during the same live conversation, asked to cancel an event by name, the
model called `list_events` twice with an identical query before finally
calling `cancel_event` on an explicit follow-up — re-verifying instead of
proceeding with information it already had. Same class of issue as the
template-recall case above; a prompting/confidence concern, not a tool or
UI defect, since every call still resolved correctly.

<details>
<summary>Original ticket text</summary>

## TICKET-12: AI needs visibility into existing event templates

**Priority:** Medium — blocks the draft flow in practice, found live during
TICKET-6's verification
**Area:** `backend/ai_tools/` (new tool), `backend/api/routes/ai_assistant.py`
(system prompt)

### Problem

`create_event_draft`/`publish_event`'s `event_template_id` field is
optional (`int | None` on `EventCreate`) — omitting it is valid and means
"no template." But the model has no way to know what templates exist, so
when asked to draft an event it either guesses an id (risking a wrong
match) or — what actually happened live — refuses to proceed without one,
even after being told there's no template to use, because it can't
distinguish "the field is optional" from "I'm missing required
information." The organizer ends up manually looking up a template's raw
numeric id outside the chat, defeating the point of a natural-language
draft flow.

### Scope

- New tool `list_event_templates`, wrapping
  `backend.api.routes.event_templates.list_templates` the same thin way
  every other tool in `backend/ai_tools/tools.py` wraps its `events.py`
  handler — no new business logic. Minimally returns `id` and `name` per
  template (per this ticket's own title); include `description` too if
  free, since it's already on the response model and costs nothing extra
  to pass through.
  - Registered in `backend/ai_tools/dispatch.py`'s `TOOL_EXECUTORS` /
    `backend/ai_tools/specs.py`'s `TOOL_SPECS` / `backend/ai_tools/schemas.py`'s
    `TOOL_ARG_MODELS` alongside the existing six, following the exact same
    pattern (see `list_events` for the closest analog — a read-only,
    no-argument-required list tool).
- Update `SYSTEM_PROMPT` (`backend/api/routes/ai_assistant.py`) to tell the
  model: call `list_event_templates` when drafting an event if the
  organizer didn't name a template, match by name rather than asking the
  organizer for a raw id, and that `event_template_id` is genuinely
  optional — proceeding with `null` when nothing matches is correct
  behavior, not a missing-information error requiring a clarifying
  question.
- Add this seventh tool to the existing "exactly this set" assertions in
  `backend/tests/test_ai_tools.py` (`test_tool_specs_expose_exactly_the_named_tool_set`)
  so the constrained-tool-set guarantee still holds with one more name in
  it.

### Out of scope

Not building `get_event_template` (single-template detail) in this pass —
`list_event_templates` alone resolves the observed problem (name → id
lookup); a detail-fetch tool is a TICKET-8-style future candidate if a
concrete need for template task-lists in chat shows up later.

</details>

---

~~TICKET-13: AI tool — view tasks for an event~~
— **Done.** New tool `list_event_tasks` (`backend/ai_tools/tools.py`) wraps
`events.list_event_tasks` (`GET /events/{event_id}/tasks`) exactly as
scoped — `category`/`status`/`team_member_id`/`due_before`/`due_after`
filters plus pagination, via `ListEventTasksArgs`
(`backend/ai_tools/schemas.py`), which reuses `TaskCategory`/`TaskStatus`
from `backend/schema/common.py` so an invalid category/status is rejected
at the schema stage rather than silently matching nothing. `due_before`/
`due_after` are typed `date` for that same reason and converted to the
handler's plain ISO-string params at the call site — no new business logic.
Covered by five new tests in `backend/tests/test_ai_tools.py`: returns an
event's tasks, filters by category, filters by status, a missing event is
a structured error, unknown arguments are rejected.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** new `backend/ai_tools/` tool, reuses `backend/api/routes/events.py`

### Scope

New tool `list_event_tasks`, wrapping the existing
`events.list_event_tasks` handler (`GET /events/{event_id}/tasks`) —
supports the same filters the handler already does: `category`, `status`,
`team_member_id`, `due_before`, `due_after`, pagination. Thin wrapper, no
new logic, same pattern as every existing tool.

Note `get_event` already embeds a full task list on `EventDetail` — this
tool's value is filtering (e.g. "what's still incomplete on the beach
cleanup?") without the model having to fetch and filter the whole event
itself.

### Depends on / affects

None. Independent of TICKET-14/15 below, though useful alongside them (an
organizer asking "what needs doing" naturally leads into "assign this" or
"mark that done").

</details>

---

~~TICKET-14: AI tool — allocate a task to a team member~~
— **Done.** New tool `assign_event_task` (`backend/ai_tools/tools.py`)
wraps `update_event_task`, constrained to `team_member_id` exactly as
scoped: it builds a fresh `EventTaskUpdate(team_member_id=args.team_member_id)`
rather than reusing `model_dump(exclude_unset=True)` on the AI args, so
`team_member_id` is always the one field marked "set" regardless of
whether the model passes an id or an explicit `null` — every other field
on the task (name, due date, category, position) is left untouched either
way. `team_member_id` has no default on `AssignEventTaskArgs`
(`backend/ai_tools/schemas.py`), so the model must always state its intent
rather than the field silently defaulting to "no change." Reuses the
handler's existing active-member check (404 missing member / 409 inactive)
rather than reimplementing it. Covered by five new tests: assigns, unassigns
via `team_member_id: null`, rejects an inactive team member, a missing
team member is a structured error, unknown arguments are rejected.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** new `backend/ai_tools/` tool, reuses `backend/api/routes/events.py`

### Scope correction: team members, not volunteers

The proposal that prompted this backlog said "allocate tasks to
volunteers." `CONTEXT.md`'s glossary is explicit that this is a category
error in this codebase: **Team Member** is "an internal organizer who can
be assigned responsibility for an Event Task"; **Volunteer** "does not
make someone eligible for internal Task assignment" (`_Avoid_: Team
Member, assignee` is listed directly under Volunteer). Task assignment
only ever targets `team_member_id`, never a volunteer — there is no
handler anywhere that assigns a task to a volunteer, so a tool that tried
would have nothing real to wrap. Scoping this ticket to team members only.

### Scope

New tool `assign_event_task`, wrapping the existing `update_event_task`
handler (`PATCH /events/{event_id}/tasks/{task_id}`) constrained to just
the `team_member_id` field — reuses the handler's existing active-member
validation rather than reimplementing it. A more general `update_event_task`
tool exposing every field on `EventTaskUpdate` is a plausible follow-up but
not this ticket's scope; keeping this one narrow (assignment only) matches
how `cancel_event` was kept separate from a general `update_event`.

### Depends on / affects

Pairs naturally with TICKET-13 (see what's unassigned, then assign it) and
TICKET-16 (an organizer may want to check a team member's current load
before assigning more — out of scope here, see TICKET-16's note).

</details>

---

~~TICKET-15: AI tool — mark a task's status (start / complete / reopen)~~
— **Done.** One tool, `update_task_status(event_id, task_id, status)`
(`backend/ai_tools/tools.py`), dispatching to whichever of `start_task`/
`complete_task`/`reopen_task` matches the requested `TaskStatus`
(`ongoing`/`done`/`incomplete`) — picked over three separate tools per the
ticket's own "keep the tool-name list clearest" guidance, since all three
handlers take identical arguments and differ only in the fixed status they
set. `status` is typed `TaskStatus` (`backend/schema/common.py`) on
`UpdateTaskStatusArgs`, so an invalid value (e.g. `"cancelled"`, not one of
the three real states) is rejected at the schema stage. No new validation
logic — every handler's own `require_event_task` 404 still applies.
Covered by five new tests: starts, completes, and reopens a task, a missing
task is a structured error, an invalid status value is rejected.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** new `backend/ai_tools/` tool(s), reuses `backend/api/routes/events.py`

### Scope

`TaskStatus` is `"incomplete" | "ongoing" | "done"`
(`backend/schema/common.py`). Three dedicated handlers already exist and
are the more natural mapping than a raw status field: `start_task`
(`POST .../tasks/{task_id}/start`), `complete_task`
(`POST .../tasks/{task_id}/complete`), `reopen_task`
(`POST .../tasks/{task_id}/reopen`), all built on a shared
`set_task_status` helper. Wrap these as one tool
(`update_task_status(event_id, task_id, status)` dispatching to whichever
handler matches) or three separate tools (`start_task`/`complete_task`/
`reopen_task`) — pick whichever keeps `backend/ai_tools/specs.py`'s
tool-name list clearest to the model; either way, no new validation logic,
every check already lives in the handlers.

### Depends on / affects

Same pairing as TICKET-13/14 — an organizer flow like "what's overdue on
the Health Fair? mark the venue booking done" chains TICKET-13 then this
ticket naturally.

</details>

---

~~TICKET-16: AI tool — view volunteers~~
— **Done.** New tool `list_volunteers` (`backend/ai_tools/tools.py`) wraps
`volunteers.list_volunteers` exactly as scoped — `signup_status`/`skill_id`/
`role_id`/`q` filters plus pagination, returning name/contact/skills/signup
counts per the existing `VolunteerListItem` shape. No `get_volunteer`
detail tool, per the ticket's own explicit out-of-scope note. Covered by
four new tests: a volunteer's skills and counts round-trip correctly,
filtering by `signup_status`, filtering by search text, unknown arguments
rejected.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** new `backend/ai_tools/` tool, reuses `backend/api/routes/volunteers.py`

### Scope

New tool `list_volunteers`, wrapping the existing `volunteers.list_volunteers`
handler (`GET /volunteers`) — filters already supported: `signup_status`,
`skill_id`, `role_id`, `q`, pagination. Returns name/contact/skills/signup
counts per the existing `VolunteerListItem` response shape.

Not building a `get_volunteer` (single-volunteer detail) tool in this
pass, matching TICKET-12's precedent of shipping the list tool alone
first — add the detail tool later if a concrete need for it (e.g. reading
one volunteer's full skill/history) shows up in practice.

### Note: this is read-only, not the volunteer-signup workflow

TICKET-8's audit-update section separately flagged `list_event_signups`/
`approve_event_signup`/`reject_event_signup` (state-changing) as
high-value future candidates. This ticket is deliberately scoped to
read-only volunteer visibility only — the signup-approval workflow is
still unscoped and should stay its own ticket if picked up, given
approve/reject are real state changes that (per TICKET-6's precedent)
likely deserve a draft-and-confirm treatment rather than firing
immediately from a chat turn.

</details>

---

~~TICKET-17: AI tool — upcoming deadlines across all events~~
— **Done.** New tool `list_upcoming_deadlines` (`backend/ai_tools/tools.py`)
wraps `dashboard.upcoming_deadlines` exactly as scoped — `days` (default
14), `team_member_id`, `limit` params, returning the same per-task rows
(event name, task name, due date, category, status, assignee) already
ordered by `due_at`. The handler's own `{"items": [...], "total": len(items)}`
shape (plain dicts, no Pydantic model, unlike every other list tool here)
is passed straight through — nothing to `model_dump`. Covered by five new
tests: a task due within the window is returned, a done task is excluded,
a task outside the window is excluded, filtering by `team_member_id`,
unknown arguments rejected.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** new `backend/ai_tools/` tool, reuses `backend/api/routes/dashboard.py`

### Scope

New tool `list_upcoming_deadlines`, wrapping the existing
`dashboard.upcoming_deadlines` handler
(`GET /dashboard/upcoming-deadlines`) — params already supported: `days`
(default 14), `team_member_id`, `limit`. Returns per-task rows (event
name, task name, due date, category, status, assignee) for non-done tasks
due within the window, already ordered by `due_at`. This is the
"across all tasks, all events" visibility the initiative proposal asked
for — every existing task/event-scoped tool (TICKET-13, `get_event`) is
scoped to one event at a time.

### Depends on / affects

This is the data source TICKET-18 (task prioritization) reasons over —
land this one first.

</details>

---

## TICKET-18: Task prioritization — prompt guidance, not a new tool

**Priority:** Low
**Area:** `backend/api/routes/ai_assistant.py` (system prompt), no new
backend endpoint

### Why this isn't a tool ticket

Audited whether a "prioritize my tasks" capability needs new backend
logic: it doesn't, and building one would violate this codebase's
thin-wrapper-only rule for AI tools. No endpoint computes an overdue flag
or priority score per task — `dashboard.event_summary`'s `overdue` count
is an aggregate, not something a single task carries. The raw ingredients
(`due_at`, `status`, `category`) are already fully exposed by TICKET-17's
`list_upcoming_deadlines` and TICKET-13's `list_event_tasks`. Ranking them
is reasoning over already-returned data, which is exactly what the model
is for — inventing a server-side `/tasks/prioritized` endpoint just to
pre-sort what the model could sort itself would be scope creep the
proposal never asked for.

### Scope

Once TICKET-17 ships, extend `SYSTEM_PROMPT`
(`backend/api/routes/ai_assistant.py`) with explicit guidance: when asked
what to prioritize, call `list_upcoming_deadlines` (and/or
`list_event_tasks` for a single-event question), then reason over
due date proximity, status, and category to suggest an order — stating
its reasoning rather than just dumping a re-sorted list, and never
silently dropping tasks the organizer didn't ask to exclude. This belongs
alongside TICKET-7's broader prompt-iteration work (adversarial testing,
eval conversations) rather than as a standalone prompt change — fold it
into that ticket's scope when TICKET-7 is picked up instead of doing a
one-off edit here first.

### Depends on / affects

Depends on TICKET-17 (needs the cross-event data source to reason over).
Should land as part of TICKET-7, not before it.

---

~~TICKET-19: AI judgment call — recommend a volunteer for a role by skill match~~
— **Done, and folds in TICKET-23.** Three new tools
(`backend/ai_tools/tools.py`): `list_event_roles` (wraps
`volunteers.list_event_roles`), `list_event_signups` (wraps
`volunteers.list_event_signups`, filterable to `status`/`role_id`/
`attendance`/`q`), and `approve_event_signup` (wraps
`volunteers.approve_event_signup`, taking `assigned_role_id`/`is_leader`).
The first two are exactly TICKET-23's scope — implemented once here rather
than as a separate pass, since TICKET-19's own "Scope" section already
listed them as tools it depends on and TICKET-23 depends on nothing this
ticket doesn't already need; see the TICKET-23 entry below, now marked done
too rather than left describing tools that already exist.

`SYSTEM_PROMPT` (`backend/api/routes/ai_assistant.py`) gained the
recommend-then-confirm guidance the ticket asked for: on a request like
"who should fill the first-aid role for Saturday's cleanup," call
`list_event_roles` + `list_event_signups` (pending) + `list_volunteers`
(TICKET-16) and reason over skill overlap and signup history, stating the
reasoning rather than silently naming a winner — and only call
`approve_event_signup` after the organizer explicitly confirms that
specific recommendation, never on the model's own initiative. This is
prompt-level enforcement, same mechanism as `publish_event`'s existing
draft-then-confirm guidance; there's no separate frontend suggestion-card
UI for this ticket (its own "Area" never named frontend files, unlike
TICKET-6/9) — confirmation happens through the normal chat turn.

Covered by eight new tests in `backend/tests/test_ai_tools.py`: roles
returned for an event, a missing event is a structured error, signups
returned for an event, filtering signups by status, approving a signup
sets status and role, approving with a role not available for the event is
rejected (the same 409 `_require_role_for_event` already enforces for the
human-driven route), a missing signup is a structured error, unknown
arguments rejected.

**Out of scope, unchanged from the original ticket:** no "experience"
scoring beyond signup history — nothing in the schema models it, so no
field was invented for it.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** new `backend/ai_tools/` tools, reuses `backend/api/routes/volunteers.py`;
`backend/api/routes/ai_assistant.py` (system prompt)

### Correcting the request against what actually exists

"Assign tasks based on volunteer skill" doesn't map onto this codebase as
stated: task assignment (TICKET-14) only ever targets `team_member_id`,
and `TeamMemberOut` (`backend/schema/team_members.py`) has no skill,
experience, or role field at all — just name, email, `is_active`. Skill
data (`SkillOut`, list of skill names) only exists on **volunteers**
(`backend/schema/volunteers.py`), and volunteers are explicitly not
task-assignable per TICKET-14's glossary finding. What volunteers *do* get
matched against is a per-event **role** — `list_event_roles`
(`backend/api/routes/volunteers.py:285`, `GET /events/{event_id}/roles`)
returns `RoleOut` rows, and volunteers sign up against a role
(`list_event_signups`/`approve_event_signup`, same file). This ticket
scopes the judgment call to what the data actually supports: recommending
which pending volunteer signup to approve for a role, using skill overlap
— not task assignment.

### Scope

- New read tools this depends on: `list_event_roles` (wraps
  `volunteers.list_event_roles`) and `list_event_signups` (wraps
  `volunteers.list_event_signups`, filterable to pending) — both thin
  wrappers, no new logic.
- `SYSTEM_PROMPT` guidance: when an organizer asks something like "who
  should fill the first-aid role for Saturday's cleanup," call
  `list_event_roles` + `list_event_signups` (pending signups for that
  event) + `list_volunteers` (TICKET-16, for skills) and reason over skill
  overlap, past `signup_status` history, and any explicit organizer
  preference stated in conversation. State the reasoning, don't just name
  a winner silently.
- Execution stays TICKET-6-shaped: the model recommends, the organizer
  explicitly confirms, and only then does a call reach
  `approve_event_signup` (already flagged as a future tool in TICKET-8's
  audit-update section, now made concrete by this ticket) — never
  auto-approve from a recommendation alone. A rejected/skipped
  recommendation must not silently reject the signup either; "recommend"
  means propose, not decide.

### Out of scope / open question

"Experience" beyond signup history (e.g. a tenure or reliability score)
isn't modeled anywhere in the schema — don't invent a field for it. If
that's wanted later, it's a schema-change ticket in its own right, not
something this tool can wrap.

</details>

---

## TICKET-20: AI judgment call — recommend a team member for a task by current workload

**Priority:** Medium
**Area:** new `backend/ai_tools/` tool, reuses `backend/api/routes/team_members.py`

### Scope, and why this is workload-based, not skill-based

Team members carry no skill/experience field (see TICKET-19) — so a
"who's best suited" judgment for *task* assignment can only reason over
**current load**, not skill fit, until/unless a future migration adds
something like a skills field to `team_members` (out of scope here; note
it as a TICKET-8-style backlog candidate if this turns out to matter in
practice, don't build it speculatively).

- New tool `list_team_member_tasks`, wrapping the existing
  `team_members.list_team_member_tasks` handler
  (`GET /team-members/{member_id}/tasks`, filters: `status`, `event_id`,
  `due_before`) — read-only, no new logic.
- `SYSTEM_PROMPT` guidance: when asked who should take an unassigned task,
  call `list_team_members` (TICKET-21) for the active roster and
  `list_team_member_tasks` per candidate (or accept the organizer naming a
  short list) to compare current open/overdue task counts, then recommend
  the least-loaded active member — stating the comparison, not just a
  name. Assignment itself still goes through TICKET-14's
  `assign_event_task` only on organizer confirmation, same draft-then-act
  pattern as TICKET-19.

### Depends on / affects

Depends on TICKET-14 (assignment tool this recommends into) and TICKET-21
(team member roster). Pair with TICKET-13 for "what's unassigned" first.

---

## TICKET-21: AI tool — view team members

**Priority:** Medium
**Area:** new `backend/ai_tools/` tool, reuses `backend/api/routes/team_members.py`

### Scope

New tool `list_team_members`, wrapping the existing
`team_members.list_team_members` handler (`GET /team-members`) —
name/email/`is_active` per member, whatever filters the handler already
supports. The organizer-side counterpart to TICKET-16's `list_volunteers`;
needed as the roster TICKET-14 and TICKET-20 both assign/recommend
against — the AI currently has no way to know who a team member even *is*
before this ticket.

---

## TICKET-22: AI tool — dashboard summary snapshot

**Priority:** Low
**Area:** new `backend/ai_tools/` tool, reuses `backend/api/routes/dashboard.py`

### Scope

New tool `get_dashboard_summary`, wrapping the existing
`dashboard.dashboard_summary` handler (`GET /dashboard/summary`) — the
same aggregate counts (upcoming events, pending confirmations, overdue
tasks, etc.) already shown on the live dashboard page. Lets "how are we
doing this week?" get answered in chat without the organizer switching
tabs. Complements TICKET-17's deadline-level detail with the org-wide
headline view; genuinely no new logic, this is the smallest possible tool
in the whole backlog.

---

~~TICKET-23: AI tool — view an event's roles and signups~~
— **Done, implemented as part of TICKET-19.** `list_event_roles` and
`list_event_signups` (`backend/ai_tools/tools.py`) exist exactly as scoped
below — both thin wrappers, no new logic. They were built alongside
TICKET-19 rather than as a separate pass, since TICKET-19's own scope
already named them as tools it depends on; this ticket's independence from
TICKET-19 (noted below) meant there was no ordering reason to build them
twice. See TICKET-19's entry above for the implementation and test detail.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** new `backend/ai_tools/` tools, reuses `backend/api/routes/volunteers.py`

### Scope

Two read tools, both thin wrappers, no new logic:
- `list_event_roles` — wraps `volunteers.list_event_roles`
  (`GET /events/{event_id}/roles`).
- `list_event_signups` — wraps `volunteers.list_event_signups`
  (`GET /events/{event_id}/volunteer-signups`), filterable to pending vs.
  approved/rejected.

Split out as its own ticket (rather than folded silently into TICKET-19)
because this pair is useful general-purpose visibility on its own — "who's
signed up for Saturday and what roles are still open?" — independent of
whether the skill-matching judgment call in TICKET-19 ever gets built.
TICKET-19 depends on this ticket; this ticket does not depend on TICKET-19.

</details>

---

## Findings from strict code review (2026-08-02)

A full pass over everything TICKET-1 through TICKET-23 shipped — backend
dispatch pipeline, all 15 tools, the chat endpoint, and the frontend panel
— against both correctness/coverage and the newer
"Adaptive Workflow Engine" proposal now circulating. TICKET-24 covers the
latter; TICKET-25–33 are concrete bugs and gaps found in the former. None
of these have been fixed yet — filing only, per review scope.

---

## TICKET-24: Phase-2 compatibility audit — what shipped is a chatbot over existing entities, not the Adaptive Workflow Engine the new proposal asks for

**Priority:** Highest — blocking further AI-panel implementation, per the
new proposal's own "Repository-First Development" mandate (inspect →
understand → compatibility report → identify conflicts → recommend the
least invasive strategy, *before* writing code). Mirrors TICKET-0's role
for the original proposal.
**Area:** whole system (read-only investigation, produces a report)

### The new proposal's central claim, and why what's built doesn't meet it

The new RFC opens with: "The objective is not to integrate a chatbot. The
objective is to introduce an Adaptive Workflow Engine... The AI side panel
is the primary interaction interface for this engine—not the feature
itself." Every line of TICKET-1 through TICKET-23, however, **is** a
chatbot: a constrained tool-calling LLM that directly reads and mutates
existing entities (events, tasks, volunteers) through 15 thin wrapper
tools. That was exactly right under the *original* proposal this backlog
was built from — nothing here is a criticism of that work on its own
terms, and TICKET-1–23 remain a solid, well-tested "AI ops copilot" for
today's domain model. But held up against the new RFC, this whole body of
work is at most the "AI Side Panel" box in the new architecture diagram —
one leaf interface — sitting on top of an "engine" that does not exist.

Concretely, none of the new proposal's core components have any
counterpart in the repo today:

- **Workflow Generator** — nothing produces a structured *workflow
  configuration* object. `create_event_draft` produces an `EventCreate`
  payload — the same shape a human fills in a form — not a new,
  self-describing config schema.
- **Workflow Evolution** — there is no mechanism to add a new step, field,
  or phase to how events run. The new proposal's own north-star example —
  "every food distribution event should include a volunteer briefing and
  collect dietary restrictions during registration" — cannot be expressed
  by *any* of the 15 existing tools. It needs a new task-template
  concept (a "briefing" phase type) and a new registration-form field
  (dietary restrictions on `EventCreate`/participant signup), both of
  which are exactly the category of change the new proposal says should
  not require touching application source code. Today it would.
- **Validation Pipeline**, new-proposal sense — the RFC's version has
  Schema → Business → Preview → Test stages. What TICKET-3 built is
  Schema → Business (reused from `events.py`) → Permission (an explicit
  no-op). There is no preview/simulate stage and no
  AI-generated-validation-scenario stage anywhere.
- **Version Manager** — nothing is versioned. `ai_audit_log`
  (TICKET-4) is an append-only *log* of tool calls, not an immutable,
  parent-linked, rollback-able configuration version.
- **Contextual Learning** — no analysis of historical execution data
  (skipped tasks, volunteer shortages, recurring scheduling issues)
  exists anywhere in the codebase.
- **AI-Generated Validation Scenarios** — none exist.
- **Tool Registry** — `TOOL_SPECS`/`TOOL_EXECUTORS`/`TOOL_ARG_MODELS`
  (`backend/ai_tools/`) are a reasonable de facto registry and a
  plausible foundation, but nothing about them is documented or built as
  an extensible "registry" concept in the new proposal's sense.
- **Provider abstraction** — see TICKET-32; OpenRouter specifics are
  hardcoded directly into the route module.

### Recommended scope for this ticket

Produce `docs/adaptive-workflow-engine-compatibility-report.md`,
mirroring `ai-panel-compatibility-report.md`'s structure, covering at
least:

- Whether **Event Templates** (`event_templates`/`template_tasks`/
  `template_roles` — already "a reusable workflow containing ordered task
  definitions" per `CONTEXT.md`'s own glossary) are the natural substrate
  to extend into "workflow configuration," rather than inventing a
  parallel concept from nothing. The new proposal's own principle —
  "prefer adapting this proposal to the repository rather than
  restructuring the repository around the proposal" — points here first;
  Event Template is the closest thing to "workflow" that already exists.
- What a minimal versioned-config layer would look like bolted onto the
  existing template tables (e.g. a `template_versions` table with
  parent/rollback pointers) versus a wholesale new engine.
- Whether the existing draft-then-confirm UX (`create_event_draft` →
  `.suggestion-card` → `publish_event`) generalizes to "propose config
  change → preview → approve → version → activate," or needs a
  different shape entirely.
- An explicit recommendation on sequencing: TICKET-25/26 below (the
  confirmation-gate gaps in what's *already shipped*) matter under the
  new proposal regardless of which direction workflow-config work takes,
  since "Human approval over autonomous execution" is a first-class
  principle either way — fixing those doesn't need to wait on this audit.

### Depends on / affects

Should be read before scoping any further tool or panel work. Does not
block TICKET-25–33, which are independent fixes to what already exists.

---

## TICKET-25: `POST /ai/tools/{tool_name}` has no allowlist — every mutating tool, not just `publish_event`, is directly reachable over HTTP with no LLM involvement or confirmation

**Priority:** High
**Area:** `backend/api/routes/ai_assistant.py:196-208` (`invoke_tool`),
`backend/ai_tools/dispatch.py`

### Problem

TICKET-6 scoped this endpoint narrowly: "lets the frontend execute
`publish_event` itself once the organizer explicitly confirms a
`create_event_draft` preview." The implementation, though, takes
`tool_name` as a raw path parameter and dispatches unconditionally to
`dispatch_tool_call` — every one of the 15 registered tools, including
`cancel_event`, `approve_event_signup`, `assign_event_task`, and
`update_task_status`, is reachable by any client that can reach the
backend, with no reference to a prior chat turn, no LLM reasoning
involved at all, and (per TICKET-0's decision) no auth in front of it.
`_check_permissions` is a named no-op (`dispatch.py:48-51`), so nothing
anywhere in the pipeline distinguishes "the frontend confirming a
reviewed draft" from "a script POSTing straight to
`/ai/tools/cancel_event`." This is untested beyond `publish_event` —
`test_ai_assistant.py`'s `ToolInvocationEndpointTest` only exercises
`publish_event`, an unknown tool name, and a missing required field.

### Scope

Either (a) allowlist this endpoint to only the tool(s) that actually have
a frontend draft-and-confirm flow today (currently just `publish_event`),
rejecting anything else with a structured error, or (b) if direct
confirmation is genuinely meant to be available for more tools, build the
same suggestion-card-and-explicit-confirm UX TICKET-6 built for
`publish_event` for each one before routing it through this endpoint.
Cross-reference TICKET-26 — these are two sides of the same gap.

---

## TICKET-26: No confirmation/preview step exists for AI-triggered mutations other than `publish_event`

**Priority:** High
**Area:** `backend/api/routes/ai_assistant.py` (`SYSTEM_PROMPT`,
`run_chat_turn`), `backend/ai_tools/`

### Problem

`run_chat_turn` (`ai_assistant.py:124-193`) dispatches whatever tool
calls the model emits in a single turn immediately, with no structural
gate. `publish_event` is the *only* tool with a real two-step
draft-then-confirm mechanism: `create_event_draft` writes nothing and
returns a preview; `publish_event` only fires from a separate, explicit
frontend button click via TICKET-6's invoke endpoint. Every other
mutating tool can execute directly within the same turn the organizer's
message arrives in:

- `approve_event_signup` — the *only* thing stopping "recommend, don't
  auto-approve" is one sentence in `SYSTEM_PROMPT`
  (`ai_assistant.py:44-51`). That's a prompt-level social contract with
  the model, not anything enforced in code. TICKET-9's own text flagged
  this exact pattern as needed ("should get the same drafted-then-
  confirmed treatment TICKET-6 built... not fire-and-forget"), but
  TICKET-19 shipped only the prompt-level version.
- `update_event`, `cancel_event`, `assign_event_task`,
  `update_task_status` — `SYSTEM_PROMPT` doesn't mention a confirmation
  expectation for these at all, prompt-level or otherwise.

`cancel_event` is the sharpest case: it's close to irreversible in
practice today (`reopen_event` doesn't clear `cancelled_at`, per
TICKET-9's own open question, and there is no "uncancel" AI tool), yet an
organizer's single ambiguous chat message is enough for the model to fire
it with zero intermediate review.

### Scope

Decide, and record the decision, which of the 15 tools are safe to fire
on the model's own judgment within a turn (arguably every read-only
`list_*`/`get_*` tool) versus which must go through an explicit,
separately-confirmed step (arguably every tool that writes:
`update_event`, `cancel_event`, `assign_event_task`,
`update_task_status`, `approve_event_signup`, alongside `publish_event`).
For the latter group, either extend TICKET-6's
draft/render-card/explicit-confirm pattern, or introduce a lighter
"pending confirmation" tool-result shape the frontend renders as an
inline Confirm/Cancel pair before the mutation reaches the database,
rather than executing on receipt.

### Depends on / affects

Directly relevant to TICKET-24's "Human approval over autonomous
execution" principle — worth fixing independent of that audit's outcome.

---

## TICKET-27: `dispatch_tool_call` only catches `ToolValidationError`/`HTTPException` — any other exception skips the audit log and silently breaks the chat stream

**Priority:** High
**Area:** `backend/ai_tools/dispatch.py:87-115`

### Problem

```python
try:
    result = TOOL_EXECUTORS[tool_name](db, parsed_args)
except ToolValidationError as error: ...
except HTTPException as error: ...
```

There is no catch-all. Not every write path a tool executor reaches
guards itself: `publish_event` → `events.create_event` uses `with db:`
(auto-rollback on any exception, so data stays consistent, but the
exception itself is never translated into an `HTTPException`), and
several other handlers this dispatch layer calls into —
`cancel_event`, `set_task_status`, `set_event_status` — call
`db.commit()` directly with no surrounding `try`/`except` at all. If any
of these raise something other than `ToolValidationError`/`HTTPException`
(a `sqlite3.OperationalError` from a locked database being the obvious
real-world case):

1. `_finish`/`_record_audit_log` never runs, so the failed dispatch
   writes **no row** to `ai_audit_log` — breaking TICKET-4's "every
   dispatch, success or failure, is audited" guarantee.
2. In the chat-streaming path, the exception propagates out of
   `run_chat_turn`'s generator. `chat()`'s `event_stream()` only catches
   `httpx.HTTPError` (`ai_assistant.py:217-223`) — anything else isn't
   caught, so no `error` SSE event is ever sent and the response stream
   just terminates. The frontend's `for await` loop exits with neither an
   `error` nor a `done` event, leaving the organizer looking at a panel
   that silently stopped mid-turn with no explanation and no error
   message rendered.

### Scope

Add a catch-all in `dispatch_tool_call` that turns any unexpected
exception into a structured `{"success": False, "reason": ...}` result
(log the real exception server-side; don't leak internals to the
client), routed through `_finish` so the audit-log guarantee holds
unconditionally. Add a matching catch-all in `chat()`'s `event_stream()`
so any exception from `run_chat_turn` still yields an `error` SSE event
instead of a bare stream termination.

---

## TICKET-28: `list_volunteers` sends volunteers' raw `contact_number`/`email` to the third-party OpenRouter LLM with no redaction

**Priority:** High — privacy, and this organization specifically serves a
vulnerable population (migrant workers, per root `CLAUDE.md`)
**Area:** `backend/ai_tools/tools.py:116-129` (`list_volunteers`),
`backend/schema/volunteers.py:32-42` (`VolunteerSummary`/
`VolunteerListItem`)

### Problem

`list_volunteers` passes `volunteers_routes.list_volunteers`'s result
straight through unmodified. `VolunteerListItem` (extends
`VolunteerSummary`) includes `contact_number` and `email` per volunteer.
Every time the AI calls this tool — e.g. answering "find approved
volunteers with a first-aid skill" — the full result, phone numbers and
email addresses included, is serialized into a `tool`-role message
(`ai_assistant.py:177-183`, `json.dumps(result)`) and sent to OpenRouter,
and whichever underlying model OpenRouter routes the request to, as part
of the follow-up completion call. Real personal contact data leaves the
organization's infrastructure and lands with a third-party AI provider on
every such query, with no minimization and no opt-out considered anywhere
in the tickets that shipped this. (`list_event_signups`/`get_event`
similarly expose volunteer/team-member *names* — materially lower
sensitivity than direct contact details, not flagged here.)

### Scope

Decide whether the AI genuinely needs raw contact details to do its job —
matching by name/skill doesn't require a phone number or email in the
model's context. If not, strip `contact_number`/`email` from what
`list_volunteers`'s tool result returns to the model specifically (the
human-facing admin page can keep showing full detail; this is only about
what transits to the LLM). If a future feature needs the AI to *act* on
contact info (e.g. drafting a reminder message), that should be its own
explicitly-scoped tool rather than incidental exposure through a
list/search tool.

---

## TICKET-29: No visual distinction between read-only and mutating tool activity in the chat UI

**Priority:** Medium
**Area:** `src/AiCopilot.tsx:261-321`, `src/index.css`
(`.copilot-message-tool`)

### Problem

Every tool-activity line — `list_events succeeded.`, `cancel_event
succeeded.`, `approve_event_signup succeeded.` — renders through the
same generic `.copilot-message-tool` styling (`index.css:2704-2720`).
Worse, per the `activity.origin === "chat" && modelRepliedWithText`
suppression rule (`AiCopilot.tsx:295`), a successful *mutation's* status
line can be omitted from the DOM entirely whenever the model's own reply
happens to be non-empty — the organizer's only signal that a real,
potentially hard-to-reverse change occurred is trusting the model's
free-form prose to have described it accurately. Unlike `publish_event`,
none of `cancel_event`/`assign_event_task`/`update_task_status`/
`approve_event_signup` get a `.suggestion-card`-style structured
confirmation at all (TICKET-19's own text: "there's no separate frontend
suggestion-card UI for this ticket... confirmation happens through the
normal chat turn").

### Scope

At minimum, give mutating tool results a visually distinct treatment
from read-only ones (different accent/icon), and exempt them from the
text-suppression rule so a mutation's outcome always renders explicitly
regardless of the model's prose — mirroring the "failures always show"
rule already applied a few lines above it. If TICKET-26 adds a real
confirm-before-execute step for these tools, the *result* of that step
still needs a clearly distinct "this happened" rendering, so this ticket
is complementary to that one, not superseded by it.

---

## TICKET-30: Test coverage gaps in the newer AI tools

**Priority:** Medium
**Area:** `backend/tests/test_ai_tools.py`,
`src/AiCopilot.chat.test.tsx`/`src/AiCopilot.draft.test.tsx`

### Problem

- `list_event_signups`'s `role_id`, `attendance`, and `q` filters
  (`schemas.py:143-154`) have no test — only the base list and `status`
  filter are covered.
- `list_event_templates`'s `is_built_in` filter (`schemas.py:57-63`) has
  no test.
- On the frontend, only `cancel_event`'s *failure* path is exercised
  (`AiCopilot.chat.test.tsx:107-125` — `cancel_event failed: ...`).
  There is no test for a *successful* `cancel_event`,
  `approve_event_signup`, `assign_event_task`, or `update_task_status`
  tool result reaching the UI at all — so the generic-status-line
  rendering and the text-suppression interaction described in TICKET-29
  are entirely unverified for every mutating tool except `publish_event`.

### Scope

Fill in the filter-argument tests for the two backend tools above,
mirroring the pattern already used for every other tool's filters. Add
at least one frontend test per untested mutating tool confirming its
`tool_result` renders (or correctly suppresses, per the
`modelRepliedWithText` rule) as expected.

---

## TICKET-31: No bound on conversation size or message length — unbounded OpenRouter cost per session

**Priority:** Medium
**Area:** `backend/schema/ai_assistant.py` (`ChatRequest`/`ChatMessage`),
`backend/schema/common.py` (`NonEmptyText`), `backend/api/routes/ai_assistant.py`

### Problem

`ChatRequest.messages` (`schema/ai_assistant.py:15-16`) has
`min_length=1` but no `max_length`; `ChatMessage.content` uses
`NonEmptyText` (`schema/common.py:8`), which enforces non-empty but has
no upper bound either. Per TICKET-1's stateless design, the frontend
resends the *entire* conversation on every turn
(`AiCopilot.tsx:105-108`) — there's no truncation, summarization, or
turn-count cap anywhere in the loop. A single long-running organizer
session — or a buggy/malicious client hitting this unauthenticated
endpoint directly — can grow the resent payload, and the resulting
OpenRouter token cost, without any server-side ceiling. This bears
directly on the newer RFC's own "Cost and Model Independence" success
criterion, which treats cost control as a first-class concern rather than
an afterthought.

### Scope

Add a reasonable `max_length` to `ChatRequest.messages` and/or a
character cap to `ChatMessage.content`, and/or a simple
conversation-window/summarization strategy once a session exceeds N
turns. Doesn't need to be sophisticated — just bounded.

---

## TICKET-32: OpenRouter specifics are hardcoded directly into the route module — no provider-abstraction boundary

**Priority:** Medium — architecture, directly relevant to the RFC pivot
(see TICKET-24)
**Area:** `backend/api/routes/ai_assistant.py`

### Problem

`OPENROUTER_URL`, `DEFAULT_MODEL`, the SSE line-parsing/`[DONE]`
handling, and the OpenAI-style `tool_calls` delta-accumulation logic
(`_accumulate_tool_calls`, `ai_assistant.py:99-121`) all live directly in
the FastAPI route module, coupled to OpenRouter's specific wire format.
The new RFC states explicitly: "Abstract the LLM behind a provider
interface so that different models or providers can be substituted
without changing business logic." Today, substituting a different
provider — or even one with a materially different streaming/tool-call
format — means editing `ai_assistant.py` directly rather than adding an
implementation behind an interface.

### Scope

Not urgent enough to block anything today (OpenRouter itself already
routes across many upstream models). Worth extracting
`_stream_openrouter_completion`/`_accumulate_tool_calls` behind a small
interface (e.g. a `ChatProvider` protocol with a
`stream_completion(messages, tools) -> AsyncIterator[...]` method) before
a second provider is ever actually added, rather than retrofitting it
under time pressure later. Natural to pair with TICKET-24's audit, since
the new proposal frames provider-independence as core to the pivot, not
just a nice-to-have for the existing chatbot.

---

## TICKET-33: `approve_event_signup` has no `reject_event_signup` counterpart — the AI can't undo its own recommendation

**Priority:** Low
**Area:** `backend/ai_tools/tools.py`, `backend/ai_tools/schemas.py`,
`backend/ai_tools/specs.py`

### Problem

`volunteers.py` already implements `reject_event_signup`
(`volunteers.py:434-445`) as the natural undo for `approve_event_signup`,
but only `approve_event_signup` was wired into `TOOL_EXECUTORS`
(`tools.py:207-223`). If an organizer approves a recommendation through
the AI panel and later decides it was wrong, there's no way to correct it
through the same conversational interface — they have to leave the panel
and use the admin UI directly, breaking the loop for a feature whose
whole premise is handling this kind of workflow entirely in chat.

### Scope

Add `reject_event_signup` as a new tool, thin-wrapped exactly like
`approve_event_signup`, with the same "only after explicit organizer
confirmation" treatment this ticket family already established. Small
and mechanical — same pattern as every other tool in `backend/ai_tools/`.

---

~~TICKET-34: Frontend — recommended-action prompt chips on an empty conversation~~
— **Done.** New `RECOMMENDED_ACTIONS` constant (`src/AiCopilot.tsx`) — four
fixed, read/list-leaning starter prompts ("Create an event for me using one
of my templates", "List upcoming tasks across all events", "List my
upcoming events", "Which volunteer signups need approval?") rendered as
`.copilot-suggestion-chip` buttons inside the existing empty-state block
(`conversation.length === 0 && !isStreaming`), styled via new
`.copilot-suggestions`/`.copilot-suggestion-chip` rules in `src/index.css`.
`sendMessage` gained an optional `overrideText` parameter
(`sendMessage(overrideText?: string)`, trimming `overrideText ?? input`) so
a chip's `onClick={() => sendMessage(action)}` reuses the exact same
streaming/tool-call/error path a typed-and-submitted message goes through —
no second code path. Once the conversation has any content the chips
disappear along with the rest of the empty-state block, same as scoped.

New test in `src/AiCopilot.chat.test.tsx` (`AiCopilot recommended actions`)
confirms a chip is visible on open, clicking it sends the exact prompt text
to `/api/v1/ai/chat`, and the chip itself (not the now-sent user message of
the same text) is gone afterward. Verified live: opened the panel, saw all
four chips, clicked "List my upcoming events," and it sent immediately and
streamed back a real reply from the running backend.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** `src/AiCopilot.tsx`

### Problem

The panel's only empty-state content today is a static sentence
(`AiCopilot.tsx:240-244`, "Ask me to help manage an event — I'll show you
a draft before creating anything.") — an organizer who opens the panel for
the first time has no hint of the range of things it can actually do
(15 tools spanning events, tasks, and volunteer signups per
`docs/ai-panel-handover.md`) beyond that one event-creation example, and
has to type a full request from scratch every time before seeing anything
happen. TICKET-10's original design note for this panel never scoped
starter prompts, and none exist anywhere in the component today — this is
new surface, not a regression.

### Scope

- A small fixed set of recommended-action chips/buttons (e.g. "Create an
  event from a template", "List upcoming tasks", "Who's signed up for my
  next event?"), rendered only in place of — or alongside — the existing
  empty-state sentence, i.e. only when `conversation.length === 0` and not
  `isStreaming` (mirrors the existing condition at `AiCopilot.tsx:240`).
  Once the conversation has any content, the chips must not linger — they
  represent "get started," not a persistent menu.
- Clicking a chip should be immediately activated per the request: it
  populates `input` with the chip's associated prompt text and triggers
  the same `sendMessage()` path a typed-and-submitted message goes
  through — not a separate code path, so the chip's request gets the same
  streaming/tool-call/error handling as anything the organizer types by
  hand.
- Keep the chip set small and read-only-leaning (list/lookup style
  requests, not e.g. "cancel an event") so a first-time click can't
  itself trigger a destructive action — the tool call it produces still
  goes through the model and the existing draft/confirm gates
  (`create_event_draft`'s suggestion-card, etc.) exactly as if the
  organizer had typed the same words.
- No backend change — this is purely a canned-input convenience over the
  existing `sendMessage`/`streamChat` path from TICKET-1/5.

### Out of scope

Personalizing chips to `activePage` or real data (e.g. naming an actual
upcoming event) is a plausible follow-up but adds a data-fetch dependency
the panel doesn't have today; ship a fixed, generic set first.

</details>

---

~~TICKET-35: Frontend — refresh the underlying admin page after a successful AI mutation~~
— **Done, with a simpler implementation than originally sketched.** Rather
than mixing two idioms (a `key` remount for events/dashboard, a threaded
`reloadKey` prop for `VolunteerDirectory`), all three admin pages use the
same uniform `key`-remount mechanism, since it needed no changes to
`DashboardPage`, `AdminEventsPage`, or `VolunteerDirectory` themselves — a
smaller diff than plumbing a new prop through `VolunteerDirectory`'s
existing internal `reloadKey` state for one caller. `AdminPanel`
(`src/App.tsx:896`) holds a new `refreshKey` counter, incremented via a new
`onDataChanged` callback passed into `AiCopilot`; `DashboardPage`,
`EventsPage`, and `VolunteersPage` all fold `refreshKey` into their existing
(or, for `DashboardPage`, newly added) `key` prop, forcing a clean remount
and refetch. `AiCopilot.tsx` gained a `MUTATING_TOOLS` set (`publish_event`,
`update_event`, `cancel_event`, `assign_event_task`, `update_task_status`,
`approve_event_signup` — the same list TICKET-29 identifies) and calls
`onDataChanged?.()` only when a result for one of those tools comes back
successful, from both the chat-turn `tool_result` path (`sendMessage`) and
the direct-invoke path (`confirmDraft`'s `publish_event`) — never for a
read/list/preview-only result or a failure. `onDataChanged` is optional
(`AiCopilot({ activePage, onDataChanged })`, `?.()` call) so every existing
call site/test that doesn't pass it keeps working unchanged.
`window.location.reload()` was not used, exactly as scoped, since it would
have discarded the panel's own open conversation state.

Six new tests: `src/AiCopilot.chat.test.tsx` covers `onDataChanged` firing
once for a successful mutating chat tool result, not firing for a
successful read-only result, and not firing for a failed mutating result;
`src/AiCopilot.draft.test.tsx` covers the direct-invoke path firing on a
successful `publish_event` confirm and not firing on a failed one.

Verified live end-to-end against the running backend: opened the Dashboard
(showing "Upcoming Events: 2"), used the panel to draft and confirm a new
event via `publish_event`, and — with no manual reload — watched the
network log show `GET /events`, `GET /dashboard/summary`, and
`GET /dashboard/upcoming-deadlines` refire immediately after
`POST /ai/tools/publish_event` succeeded; closing the panel showed the
Dashboard's "Upcoming Events" count updated to 3. The test event was
deleted afterward via `DELETE /api/v1/events/4` to leave the seed data
as found, mirroring TICKET-6's cleanup precedent. `npx tsc --noEmit` and
`npm test -- --run` (111 frontend tests) both pass.

<details>
<summary>Original ticket text</summary>

**Priority:** Medium
**Area:** `src/App.tsx`, `src/AiCopilot.tsx`

### Problem

None of the admin pages share a cache or subscribe to any kind of change
notification — confirmed no `react-query`/`swr` or similar anywhere in the
app. Each fetches its own data once, in a `useEffect` keyed only on
stable props, with no dependency that changes after a mutation:
`DashboardPage`'s `useEffect(..., [api])` (`App.tsx:532-561`),
`AdminEventsPage`'s `useEffect(..., [api])` (`src/AdminEventsPage.tsx:117-136`),
and `VolunteersPage` → `VolunteerDirectory`'s `useEffect(..., [reloadKey])`
(`src/VolunteerDirectory.tsx:48-59`) — the last of these already has an
internal `reloadKey`/`setReloadKey` (`VolunteerDirectory.tsx:46`), but it's
wired only to a manual "Retry" button on fetch error
(`VolunteerDirectory.tsx:107`), not exposed to any parent. `AiCopilot.tsx`
is mounted as a fixed sibling of whichever page is active (`App.tsx:1017`,
inside `AdminPanel`, `App.tsx:896`) and is fully decoupled from it — it
only receives `activePage` as a read-only prop, with no callback wired
back the other way, and no Context/event-bus connects them. So today, if
an organizer uses the AI panel to (for example) cancel an event, assign a
task, or approve a volunteer signup while looking at the Dashboard or
Events page behind it, the mutation succeeds (visible only as a
`tool_result` status line or the `publish_event` suggestion-card) but the
page underneath keeps showing stale data until the organizer manually
reloads or navigates away and back. `AdminEventsPage`'s render in
`AdminPanel` already has prior art for a parent-forced refetch — it's
remounted via `key={`events-${openEventIndex ?? "list"}`}` (`App.tsx:1011`)
— but nothing today changes that key (or an equivalent) in response to an
AI-triggered change.

### Scope

- Lift a simple refresh signal (e.g. a `refreshKey` counter state) into
  `AdminPanel` (`App.tsx:896`), incremented by a callback passed down to
  `AiCopilot`.
- `AiCopilot.tsx` calls that callback once a mutating tool's result comes
  back successful — both from the chat-turn `tool_result` path
  (`sendMessage`, `AiCopilot.tsx:130-150`) and the direct-invoke path
  (`confirmDraft`'s `publish_event`, `AiCopilot.tsx:165-195`). Scope this
  to the tools that actually write (`publish_event`, `update_event`,
  `cancel_event`, `assign_event_task`, `update_task_status`,
  `approve_event_signup`) — no need to trigger a refresh for any `list_*`/
  `get_event`/`create_event_draft` read/preview-only result — the same
  list TICKET-29 identifies as "mutating."
- Wire that `refreshKey` into whichever mechanism gets the currently
  active page to refetch. Two idioms already exist side by side in this
  codebase to build on rather than inventing a third: fold `refreshKey`
  into `AdminEventsPage`'s existing `key` prop
  (`App.tsx:1009-1013`, extending the `EventsPage`/`openEventIndex`
  precedent), and pass it down as a new prop into `VolunteerDirectory`
  to fold into its existing internal `reloadKey` effect dependency
  (`VolunteerDirectory.tsx:46-59`) rather than duplicating that state.
  `DashboardPage` has no existing reload idiom of its own, so give it the
  same `key`-remount treatment as `AdminEventsPage`. A page-wide
  `window.location.reload()` (confirmed nowhere in `src/` today, so this
  would be new, not prior art) is explicitly out of scope since it would
  also blow away the AI panel's open conversation state
  (`AiCopilot.tsx`'s `conversation`/`toolActivity` are local component
  state with no persistence — TICKET-10 deliberately chose in-memory state
  over `localStorage` for panel open/closed, same reasoning applies to not
  wanting a full reload here).
- A refresh should only affect the page currently mounted behind the
  panel — no need to eagerly refetch pages the organizer isn't looking at.

### Out of scope

Building a real shared cache/query layer (react-query, SWR, or similar)
across the whole admin app — out of proportion to what this ticket needs
and a bigger architectural change than "make the AI panel's mutations
visible without a manual reload."

### Depends on / affects

Complements TICKET-29 (visually distinguishing mutating tool activity) —
that ticket's list of which tools count as "mutating" is the same list
this one should trigger a refresh from.

</details>

---

~~TICKET-36: Frontend — button to clear the AI chat history~~
— **Done.** A "Clear chat" button in `.copilot-header-actions` (new wrapper
div alongside the existing close button, `src/AiCopilot.tsx`) renders only
when `conversation.length > 0`. `clearConversation()` resets `conversation`,
`toolActivity`, `errorMessage`, and any open `draftPreview`/`isEditingDraft`
back to the panel's fresh-mount state. `sendMessage` now creates an
`AbortController` per turn (`streamAbortRef`), passed as `streamChat`'s
existing (previously unused) `signal` parameter — `clearConversation` calls
`streamAbortRef.current?.abort()` first so an in-flight stream can't keep
writing tokens into state after the clear; the resulting `AbortError` is
caught and swallowed rather than surfaced as `errorMessage`. New CSS
`.copilot-header-actions` (`src/index.css`) groups the two header buttons
with `display: flex; gap: 8px`, since `.copilot-header`'s existing
`justify-content: space-between` only accounted for one button on the
right before. New test in `src/AiCopilot.chat.test.tsx` sends a message,
waits for the streamed reply, clicks Clear chat, and asserts the
conversation and button both disappear and the panel returns to the
empty-conversation starter-prompt state. Verified live in-browser: sending
a message shows the Clear chat button, clicking it returns the panel to
the starter-prompt/suggestion-chips view with the button gone again.
`npx tsc --noEmit` (no new errors — the pre-existing `src/imports/pasted_text/`
errors are unrelated) and `npm test -- --run` (112 tests across 14 files)
both pass.

<details>
<summary>Original ticket text</summary>

## TICKET-36: Frontend — button to clear the AI chat history

**Priority:** Low
**Area:** `src/AiCopilot.tsx`

### Problem

`AiCopilot.tsx`'s `conversation`/`toolActivity` state is in-memory only for
the lifetime of the mounted panel (TICKET-10's deliberate choice, no
`localStorage`) — but there is currently no way for the organizer to reset
it short of a full page reload, which per TICKET-35 also blows away
whatever page state a mutation just refreshed. A long conversation with
several draft/cancel/lookup turns has no way to be cleared and restarted
cleanly.

### Scope

- A "Clear chat" control in `.copilot-header` (alongside the existing close
  button), visible only when there's something to clear (non-empty
  `conversation`).
- Clicking it resets `conversation`, `toolActivity`, and any open
  `draftPreview` suggestion card back to the panel's initial empty state —
  same shape as a freshly mounted panel, not a page reload.
- Any in-flight stream (`isStreaming`) should be aborted (existing
  `AbortController`/`signal` plumbing in `sendMessage`, if present) rather
  than left to write into state after the clear.
- No confirmation dialog needed — clearing chat history isn't a destructive
  action against any persisted data (nothing here is written to the
  database or `localStorage`).

### Out of scope

Any backend change — `ai_audit_log` (TICKET-4) is unaffected; this only
clears the frontend's transient conversation view, not the audit trail of
tool calls already made.

</details>
