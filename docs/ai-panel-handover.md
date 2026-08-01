# AI side panel — status and handoff

Branch: `feat/agent`, branched off `feature/participant`.

This document exists so another agent (AI or human) can pick this work up
without re-deriving context from conversation history. It's the "what's true
right now" summary; the reasoning trail behind each ticket lives in
[`tickets.md`](tickets.md), and the Phase-0 investigation lives in
[`ai-panel-compatibility-report.md`](ai-panel-compatibility-report.md).
Update this file as work lands — delete sections once they're no longer
true rather than leaving stale info behind, the same convention
[`participant-portal.md`](participant-portal.md) uses for its slice.

## What this initiative is

Adding an AI-assisted side panel to the existing admin/organizer dashboard
(`src/App.tsx`'s legacy pages — dashboard, events, volunteers), per a
proposal to let organizers do things like "create an event" via natural
language, with the LLM only producing structured tool calls that dispatch
into the *existing* backend logic — never raw SQL, never bypassing
validation, always a reviewable draft before anything destructive or
irreversible executes. Full proposal reasoning and the resulting ticket
breakdown are in `tickets.md`.

## What's built so far

**TICKET-0 (Phase 0 compatibility audit) — done.** Full findings in
[`ai-panel-compatibility-report.md`](ai-panel-compatibility-report.md).
Headline results, since they shape everything downstream:

- The admin/organizer backend has **no authentication at all** — decided:
  ship this milestone without adding any (see "Key decisions" below).
- There's no service layer — `backend/api/routes/events.py`'s route
  handlers *are* the business logic, and are directly callable in-process
  (FastAPI's `Depends()` wiring doesn't matter outside an HTTP request).
- `httpx` (already a backend dependency) is sufficient for the OpenRouter
  call; no new dependency needed.
- `src/AiCopilot.tsx` already existed as a static UI mock, already mounted
  into the admin layout — see TICKET-10 below for what happened to it.

**TICKET-10 (collapsible AI panel, mobile + desktop) — done.** The audit
turned up a complete, entirely unused floating-action-button +
slide-in-overlay design sitting dead in `src/index.css` (`.copilot-fab`,
`.copilot-panel`, `.copilot-header`, `.copilot-chat`, `.copilot-message`,
`.suggestion-card`, `.copilot-composer`) — apparently an earlier iteration
of the AI copilot, superseded by a permanent-grid-sidebar version without
ever being deleted. `src/AiCopilot.tsx` has been rebuilt on top of that dead
CSS instead of the sidebar:

- Collapsed by default on every breakpoint; a fixed bottom-right FAB opens a
  right-anchored overlay panel (desktop: `min(440px, 100vw)` with a
  click-outside-to-close backdrop; mobile, under 810px: full-viewport, no
  backdrop needed).
- `Escape` closes it; focus moves to the panel's close button on open and
  back to the FAB on close (via a `useEffect` keyed on the `open` boolean —
  an inline focus call in the click handler doesn't work here, because the
  FAB and close button are never mounted at the same time, so the ref you'd
  focus doesn't exist yet at the moment the handler runs).
- `role="dialog"` / `aria-modal` / `aria-hidden` / `aria-expanded` /
  `aria-controls` wired for basic screen-reader correctness.
- `App.tsx`'s `.product-frame`/`.product-page-content` grid-reservation
  layout (which used to reserve permanent screen space for the old
  always-visible sidebar) is gone — the panel is a fixed overlay over
  full-width page content now.
- Cleanup beyond the original ticket scope: also deleted a *third*,
  already-dead "workflow-wizard" copilot design
  (`.copilot-workflow-*`/`.copilot-steps`/`.copilot-prompts`) found in the
  same CSS region, and a leftover reference to the now-removed
  `--copilot-sidebar-width` variable in `EventOperationsMvp.css`.
- Content inside the panel is still the same mock data it always was
  (`recommendedActions`, the one hardcoded "Broadcast draft" card, a
  free-text box that just echoes "Preparing: …" locally) — **no backend
  wiring exists yet.** That's TICKET-1/TICKET-5's job, not done here.

Verified in-browser at desktop and mobile viewports (open/close, Escape,
backdrop, focus handling) plus `npx tsc --noEmit` and `npm test -- --run`
(75 tests) both passing. See TICKET-10 in `tickets.md` for the full
before/after and a process note about an `npm run format` mishap that got
caught and reverted before landing.

**Update: `src/AiCopilot.test.tsx` added (new file — none existed before).**
The verification above was manual/in-browser only; the new suite locks in
the same behavior without a browser: collapsed-by-default state, FAB → panel
open with focus moving to the close button, Escape and the close button both
closing and returning focus to the FAB, backdrop click-to-close, and the
FAB's `aria-expanded`/`aria-controls` pointing at the panel. One quirk worth
knowing if you touch this file: the panel is `aria-hidden` while closed,
which removes it from the accessibility tree, so `getByRole("dialog", ...)`
can't find it then — the tests look it up by `id` (`#ai-copilot-panel`)
directly instead. The 810px mobile breakpoint hiding the backdrop is plain
CSS (`display: none` in a media query), which jsdom doesn't evaluate, so
that part of TICKET-10 stays manual-verification-only.

**TICKET-9 (event cancellation as a distinct state) — done.** New additive
migration `008_event_cancellation.sql` adds nullable `events.cancelled_at`,
kept separate from `status` (see "Key decisions" below for why). New
`POST /events/{id}/cancel` sets `cancelled_at` and `status='closed'`
together. `EventSummary`/`EventDetail` expose a derived `is_cancelled: bool`.
`dashboard_summary` and `calendar_events` both exclude cancelled events via
`AND cancelled_at IS NULL`. The admin Events page
(`EventCollectionPrototype.tsx`/`AdminEventsPage.tsx`) shows a distinct
"Cancelled" badge, hides cancelled events by default behind a new "Show
cancelled" toggle, and has a "Cancel Event" action with a confirmation
dialog. The participant portal excludes cancelled events from browsing
(`EventBrowseList`) but still flags them "Cancelled" for a participant
already RSVP'd (`MyEventsList`, `EventDetailCard`) instead of silently
dropping them. This is what `cancel_event` (TICKET-2) should call —
**do not** wire `cancel_event` to `close_event` or `delete_event` as a
stand-in; see TICKET-9/TICKET-2 in `tickets.md` for why.

One loose end found while implementing, noted in `tickets.md`'s TICKET-9
entry: the existing `reopen_event` endpoint doesn't clear `cancelled_at`,
so a direct API call (not reachable through the admin UI, which hides
"Reopen" for cancelled events) could leave `status='open'` with
`cancelled_at` still set. The dashboard/calendar queries filter on
`cancelled_at IS NULL` explicitly (not just `status`) to stay correct even
in that state. Whether "reopen" should actually clear `cancelled_at`
(true un-cancel) is still an open question — see TICKET-9's "Open
questions" in `tickets.md`.

Test coverage added on both sides — see the fuller breakdown in
`tickets.md`'s TICKET-9 entry, summarized here: `test_admin_api.py` (cancel
+ 404, dashboard/calendar exclusion) and `test_participants.py` (a new test
since `/participants/{id}/events` derives `is_cancelled` on its own code
path, separate from `events.py`'s); `AdminEventsPage.test.tsx` (cancel
dialog → badge → Reopen/Close hidden; the "Show cancelled" toggle);
`EventBrowseList.test.tsx` and `EventDetailCard.test.tsx` (both extended);
and a brand-new `MyEventsList.test.tsx` (this component had zero test
coverage before this pass).

**TICKET-2 (AI tool functions), TICKET-3 (validation pipeline), and
TICKET-1 (backend OpenRouter endpoint) — all done.** New `backend/ai_tools/`
package (`tools.py`, `schemas.py`, `dispatch.py`, `specs.py`) implements the
six-tool set the proposal names — `create_event_draft`, `publish_event`,
`update_event`, `get_event`, `list_events`, `cancel_event` — each a thin
in-process wrapper around the matching `backend/api/routes/events.py`
handler, dispatched through `dispatch_tool_call(db, tool_name, arguments)`.
That function runs the three-stage pipeline TICKET-3 asked for (schema
validation via the same `EventCreate`/`EventUpdate` Pydantic models the
human HTTP routes use; business validation reused from `events.py`'s own
checks rather than re-implemented; permission validation as an explicit
named no-op, since the admin backend still has no auth/role concept) and
always returns a structured `{"success": bool, ...}` result instead of
raising. `cancel_event` correctly targets `POST /events/{id}/cancel`
(TICKET-9), never `close_event`/`delete_event`. New
`backend/api/routes/ai_assistant.py` exposes `POST /api/v1/ai/chat`: holds
`OPENROUTER_API_KEY` server-side only, streams Server-Sent Events back to
the frontend, registers `ai_tools.TOOL_SPECS` with the OpenRouter call as
real function-calling tools, and dispatches any tool call the model makes
straight to `dispatch_tool_call` — the route itself has no business logic.
It resolves one round of tool-calling per user turn (not an open-ended agent
loop), which is enough for the draft-then-approve flow since `publish_event`
only fires on a separate, later user turn once the organizer confirms.
See TICKET-1/2/3 in `tickets.md` for the full design rationale and test
breakdown (22 new backend tests across `test_ai_tools.py` and
`test_ai_assistant.py`, none of which need a real OpenRouter key —
`httpx.MockTransport` fakes the streaming response).

**TICKET-4 (audit logging) — done.** New additive migration
`009_ai_audit_log.sql` adds an `ai_audit_log` table (timestamp, tool name,
arguments as JSON, success flag, resulting entity id, failure reason — no
acting-user column, per TICKET-0's decision). `dispatch_tool_call`
(`backend/ai_tools/dispatch.py`) now logs a row on every dispatch path —
unknown tool name, schema-validation rejection, business-validation/
execution failure, and success — including `create_event_draft`, which is
audited even though it never writes an `events` row. Whether this log
should later expand to cover human-driven admin mutations too is still an
open question (see TICKET-4 in `tickets.md`), not resolved by this pass.

**TICKET-5 (wire real chat into the panel) — done.** New `src/ai-api.ts`
(`streamChat`) is the only thing in the frontend that talks to
`/api/v1/ai/chat` — it holds no API key and never calls OpenRouter
directly, per the proposal's constraint. `AiCopilot.tsx`'s old mock
(`recommendedActions`, the hardcoded "Broadcast draft" card, the
`goal`/`draft` local state) is gone, replaced by a real `conversation`
array sent in full on every turn (the backend is stateless). `token`
events stream into a live assistant bubble; `tool_call`/`tool_result`
render as a lightweight inline status line (`"<tool> succeeded."` /
`"<tool> failed: <reason>"`) — the full `.suggestion-card` draft-review UI
is still TICKET-6's job, not built here. A CSS bug turned up during
in-browser verification and got fixed in the same pass: `.copilot-chat`'s
grid rows were stretching to fill the panel's height when there were only
one or two messages (`align-content: normal` behaves like `stretch` for
auto-sized grid tracks) — fixed with `align-content: start`. New
`src/AiCopilot.chat.test.tsx` covers the request payload, streamed tokens,
tool activity rendering, error surfacing, and multi-turn history; verified
live against a running backend with no `OPENROUTER_API_KEY` set (the 500's
`detail` renders as a readable inline error, not a blank panel).

**Not started:** TICKET-6 (draft/approval cards — the natural next step now
that TICKET-5's chat shell is real), TICKET-7 (system prompt —
`ai_assistant.py` ships a first-pass `SYSTEM_PROMPT`, but TICKET-7's
eval/adversarial-testing work is separate), TICKET-8 (future tool backlog,
tracking only).

## How to run and see it

Same as the repo's standard local setup (see the root `CLAUDE.md`):

```sh
.venv/bin/python -m uvicorn backend.main:app --reload   # terminal 1
npm run dev                                              # terminal 2, http://localhost:8443
```

Open `http://localhost:8443/admin/dashboard` (or `/admin/events`,
`/admin/volunteers` — any non-home admin page). The AI panel's FAB
("Ask Passion AI") sits fixed bottom-right; click it to open, `Escape` or
the panel's "Close" button to dismiss, or click the dimmed backdrop on a
desktop-width viewport. The panel itself still shows TICKET-10's static mock
content — nothing in it calls the new backend yet (that's TICKET-5).

To exercise the new backend endpoint directly (no frontend wiring exists to
call it yet), set `OPENROUTER_API_KEY` before starting uvicorn and stream
from it with curl:

```sh
export OPENROUTER_API_KEY=sk-or-...
curl -N -X POST http://127.0.0.1:8000/api/v1/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "List upcoming events"}]}'
```

**Caution:** don't run `npm run format` repo-wide without reviewing the
diff first — oxfmt's default style strips semicolons, which doesn't match
this repo's committed convention, and running it touches every `.ts`/`.tsx`
file in the project, not just the one you're working on. Format
individual files by hand or via your editor's formatter instead.

## Open tasks and improvements

All backlog items — remaining tickets, their scope, dependencies, and open
questions — live in [`tickets.md`](tickets.md). That's the single source of
truth; don't duplicate it here. TICKET-9, TICKET-2, TICKET-3, TICKET-1, and
TICKET-4 are all done, so the recommended order now is: TICKET-5/TICKET-6
together (the backend they need to wire into now exists), with TICKET-7
parallel to the rest.

## Key decisions worth knowing the "why" of

- **No new admin authentication for this milestone.** The admin/organizer
  backend has none today (only the unrelated volunteer flow does); adding a
  parallel auth path just for AI tool calls when the human-driven admin
  pages have none would be inconsistent and out of scope. Revisit if real
  admin auth ever gets built.
- **Tool dispatch is in-process, not an internal HTTP loopback.** All of
  this is server-side regardless of the calling device, and the audit
  confirmed route handlers are directly callable as plain Python functions
  outside FastAPI's request cycle — no refactor needed. In practice
  `ai_assistant.py` passes `dispatch_tool_call` the same request-scoped
  `Connection` it already gets from FastAPI's `Depends()` for the chat
  request itself, rather than opening a second connection via
  `backend.database.connect()` as TICKET-2 originally sketched — one
  connection per request was simpler and there was no reason to open two.
- **The AI endpoint resolves at most one round of tool-calling per user
  turn**, not an open-ended agent loop: it calls whatever tools the model
  asked for, feeds the results back, and streams the follow-up reply. This
  is enough for the draft-then-approve flow — `publish_event` only fires
  when the organizer explicitly confirms a draft on a separate, later turn,
  so the model never needs to chain more than one tool call to get useful
  work done in a single turn.
- **Event cancellation gets its own column (`cancelled_at`), not a new
  `status` value.** `EVENT.status` is documented and consumed elsewhere
  purely as a registration open/closed toggle (dashboard queries, the
  participant portal); overloading it with a lifecycle/cancellation meaning
  risks a `status == 'closed'` check silently mishandling an actually
  cancelled event. See TICKET-9.
- **The collapsible panel resurrects dead CSS instead of retrofitting the
  live one.** The live `.copilot-sidebar` design reserved permanent grid
  space and didn't collapse on mobile at all (stacked below content at a
  fixed height); the dead FAB/overlay design already had the right shape
  for both breakpoints in one mechanism, it just needed a component. See
  TICKET-10.
- **Don't run whole-repo formatters without checking the diff first.** This
  repo's committed style uses semicolons; `npm run format` (oxfmt) defaults
  to a semicolon-free style and will touch every source file if run without
  scoping. Caught during TICKET-10; noted here so it isn't repeated.
