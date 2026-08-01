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

**TICKET-9 (event cancellation as a distinct state) — proposed, not yet
implemented.** Full design (new `events.cancelled_at` column, kept separate
from `status`, new `POST /events/{id}/cancel` endpoint, dashboard/calendar
query changes, participant-portal handling) is written up in `tickets.md`
but no code exists for it yet. This is what `cancel_event` (TICKET-2) should
eventually call — **do not** wire `cancel_event` to `close_event` or
`delete_event` as a stand-in; see TICKET-9/TICKET-2 in `tickets.md` for why.

**Not started:** TICKET-1 (backend OpenRouter endpoint), TICKET-2 (tool
functions), TICKET-3 (validation pipeline), TICKET-4 (audit log), TICKET-5
(wire real chat into the TICKET-10 shell), TICKET-6 (draft/approval cards),
TICKET-7 (system prompt), TICKET-8 (future tool backlog, tracking only).

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
desktop-width viewport.

**Caution:** don't run `npm run format` repo-wide without reviewing the
diff first — oxfmt's default style strips semicolons, which doesn't match
this repo's committed convention, and running it touches every `.ts`/`.tsx`
file in the project, not just the one you're working on. Format
individual files by hand or via your editor's formatter instead.

## Open tasks and improvements

All backlog items — remaining tickets, their scope, dependencies, and open
questions — live in [`tickets.md`](tickets.md). That's the single source of
truth; don't duplicate it here. As of this writing, the recommended order
(from the compatibility report) is: TICKET-2 → TICKET-3 → TICKET-1, then
TICKET-9 (needed before TICKET-2's `cancel_event` can be correct), then
TICKET-5/TICKET-6 together, with TICKET-4/TICKET-7 parallel to the rest.

## Key decisions worth knowing the "why" of

- **No new admin authentication for this milestone.** The admin/organizer
  backend has none today (only the unrelated volunteer flow does); adding a
  parallel auth path just for AI tool calls when the human-driven admin
  pages have none would be inconsistent and out of scope. Revisit if real
  admin auth ever gets built.
- **Tool dispatch is in-process, not an internal HTTP loopback.** All of
  this is server-side regardless of the calling device, and the audit
  confirmed route handlers are directly callable as plain Python functions
  outside FastAPI's request cycle — no refactor needed.
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
