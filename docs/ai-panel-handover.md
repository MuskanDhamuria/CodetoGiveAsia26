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

Everything below is done; each ticket's full technical detail (files,
function names, exact bugs and fixes, test breakdowns) lives in
`tickets.md` — this section only summarizes what a feature *does* and how
the pieces fit together, grouped by theme rather than ticket number.

**Foundation.** The Phase-0 audit (TICKET-0) confirmed the admin backend
has no auth to work around, no service layer to extract (route handlers
are directly callable in-process), and no new dependency needed for
OpenRouter. Event cancellation (TICKET-9) got its own distinct state from
"registration closed," so the AI's cancel action and the admin UI can't be
confused with an ordinarily-closed event. The AI panel itself
(TICKET-10) is a collapsible FAB + overlay, closed by default on every
page, accessible (focus management, `Escape`, ARIA roles), built on a
dead CSS design that was rebuilt rather than retrofitting the old
always-open sidebar.

**Backend AI framework (TICKET-1–4).** `POST /api/v1/ai/chat` streams a
conversation through OpenRouter and back to the frontend over
Server-Sent Events, holding the API key server-side only. The model can
call a constrained set of tools — creating/publishing/updating/cancelling
events, listing events, and looking up event templates — each a thin
wrapper around the same backend logic the human-driven admin pages use,
so nothing bypasses existing validation. Every tool call runs through a
schema → business-rule → permission pipeline and returns a structured
result instead of raising, and every call (success or failure) is written
to an audit log.

**Tool expansion — tasks and volunteers (TICKET-13/14/15/16/17/19/23).**
The tool set grew from 7 to 15: task visibility and management
(`list_event_tasks`, `assign_event_task`, `update_task_status`,
`list_upcoming_deadlines` for cross-event deadline visibility) and
volunteer visibility (`list_volunteers`, `list_event_roles`,
`list_event_signups`). Volunteer management — previously flagged in
TICKET-8's audit as having zero AI coverage — now also has a judgment-call
tool: `approve_event_signup`, reachable only after the model recommends a
candidate (reasoning over skill overlap and signup history via
`SYSTEM_PROMPT` guidance) and the organizer explicitly confirms, never
auto-approved. All eight new tools are thin wrappers with no new business
logic, same pattern as the original seven.

**Frontend chat experience (TICKET-5, 6, 11, 12).** The panel is wired to
real conversation history and streams the model's reply live, rendered as
markdown so lists and formatting show up properly instead of raw text.
When the AI proposes a new event, it shows as an editable draft card the
organizer must explicitly confirm before anything is created — no
tool ever executes silently. Status messages about what the AI did behind
the scenes only appear when they add information a human wouldn't
otherwise have (a failure, or a result the model didn't already describe
in its own reply), to keep the conversation readable rather than
duplicating everything twice.

**Getting started and staying in sync (TICKET-34/35).** The panel now
opens with four clickable starter prompts on an empty conversation (e.g.
"List my upcoming events") that fire immediately through the same send
path as anything typed by hand — a first-time organizer doesn't have to
guess what to type. Separately, the admin page behind the panel (Dashboard,
Events, Volunteers) now refetches its data automatically the moment an AI
tool call actually writes something (`publish_event`, `update_event`,
`cancel_event`, `assign_event_task`, `update_task_status`,
`approve_event_signup`) — no manual reload needed to see the change
reflected outside the chat.

**Tool expansion — inventory, broadcast, reports/certificates
(TICKET-38–41).** A 2026-08-02 merge of `origin/backend` added three
whole admin features (`/admin/inventory`, the Broadcasts page, and
post-event reports/certificates) with zero AI coverage; the tool set grew
from 15 to 28 (bumping past the earlier 7→15 growth noted above) to close
that gap. Inventory got four read-only tools (items, locations, stock
levels, movement ledger) — write tools (adjustments/transfers) were
deliberately left out pending a real organizer use case. Broadcast and
certificate generation both got the same two-step pattern as
`create_event_draft`/`publish_event`: a `preview_*` tool that writes/sends
nothing and returns a recipient count, then a `send_*`/`generate_*` tool
the model is instructed (`SYSTEM_PROMPT`) to only call after the organizer
explicitly confirms the exact preview. That confirmation is still
prompt-only, same as every other mutating tool — see TICKET-26 below,
which now also covers `send_announcement`, `send_shift_reminder`, and
`generate_event_certificates`.

**Tool expansion — participants, venues, logistics (TICKET-54).** A fresh
gap audit (this ticket's own framing, mirroring the earlier TICKET-38
pattern) found three whole feature modules — `participants.py`,
`venues.py`, `logistics.py` — with zero AI coverage despite having real
admin-facing frontend pages, and had simply fallen outside every prior
gap-audit's stated scope. The tool set grew from 28 to 37: participant/RSVP
roster tools (`list_event_participants`, `get_participant`,
`list_participants`), venue visibility (`list_venues`, `get_venue`,
`list_venue_bookings`), and logistics (`get_attendance_forecast`,
`get_event_logistics` for the full operational picture in one call,
`list_event_logistics_requirements`) — all read-only, same
no-organizer-use-case-yet rationale as inventory's TICKET-39 for deferring
writes. `organizations.py` and `beneficiaries.py` were deliberately left
out of this pass — see TICKET-54 in `tickets.md` for why.

**Write-tool expansion — tasks, inventory, venues, logistics
(TICKET-55–58).** Explicit organizer request superseded TICKET-39/54/57's
"no use case yet" deferral for these four areas: the tool set grew from 37
to 58. Event tasks got `create_event_task`/`update_event_task`. Inventory
got its previously-deferred writes: `create_inventory_item`,
`update_inventory_item`, `create_inventory_location`,
`update_inventory_location`, `adjust_stock`, `transfer_stock`. Venues went
from zero coverage to full CRUD plus booking: `create_venue`,
`update_venue`, `create_venue_space`, `update_venue_space`,
`create_venue_booking`, `update_venue_booking` (the latter two run through
`ensure_no_overlap`, same as the human route). Logistics requirements and
allocations got `create_event_logistics_requirement`,
`update_event_logistics_requirement`,
`cancel_event_logistics_requirement`, `reserve_logistics_inventory`,
`release_logistics_inventory`, and `issue_logistics_inventory`. Every new
tool is a thin wrapper around its matching route handler, same pattern as
every prior tool — no new business logic. Deliberately still deferred:
task deletion/reordering, item/location/venue/space deactivation (soft
deletes), the donation-batch lifecycle, and
`finalize_reconciliation`/`reconcile_logistics_allocation` as a bare tool —
`reconcile_logistics_allocation` was wired up directly (not
preview-then-confirm) since the route itself already gates on the event
being closed, but `finalize_reconciliation` stays out entirely as a
one-way, event-closing operation in the same category as `cancel_event`;
see TICKET-58's note on hard deletes/irreversible closes staying
human-only.

**Deactivation, reorder, donation batches, organizations/beneficiaries,
team members, signup rejection, and templates (TICKET-59–65).** The tool
set grew from 58 to 101. `deactivate_inventory_item`/
`deactivate_inventory_location`/`deactivate_venue`/`deactivate_venue_space`
fill in the reversible `is_active` toggles TICKET-56/57 left uncovered
(TICKET-59). `reorder_event_tasks` wraps the one remaining task route with
no AI path (TICKET-60). The donation-batch lifecycle (create → collect →
receive → sort → complete-sorting → distribute → close) — previously
deferred in TICKET-54 as "not yet requested" — is now fully wrapped, each
step a direct mutating tool since state transitions are visible/correctable
via `get_donation_batch` rather than one-way (TICKET-61). `organizations.py`
and `beneficiaries.py` — deliberately left out of TICKET-54 over
PII/external-partner-data sensitivity — are now covered: beneficiary CRUD
(group metadata only, no redaction needed), and the full external-organization/
contact/supplier-order surface, with contact email/phone judged
lower-sensitivity than beneficiary PII and sent as-is (TICKET-62).
`team_members.py` (previously "not started" in TICKET-8's old backlog) got
`create_team_member`/`list_team_members`/`get_team_member`/
`update_team_member`/`list_team_member_tasks` (TICKET-63).
`reject_event_signup` mirrors `approve_event_signup` so the model can
decline a signup, not just approve one (TICKET-64). `create_event_template`/
`update_event_template` round out event-template coverage, which was
read-only until now (TICKET-65). Every hard-delete/one-way-close route
(`delete_event_task`, `delete_event`, `delete_beneficiary`,
`delete_team_member`, `delete_template`, `delete_order_line`,
`finalize_reconciliation`) stays without an AI tool, same rule as every
prior ticket in this area — `deactivate_organization`/`deactivate_contact`
were deliberately left for a follow-up rather than silently bundled in.

**Correctness/robustness fixes (TICKET-48/50/53).** The chat loop now
resolves up to 5 rounds of tool-calling per user turn (was exactly 1),
bounded to avoid runaway loops — the model can now chain
`list_event_templates` → `create_event_draft` and similar sequential
lookups `SYSTEM_PROMPT` already described as possible, within one turn.
`dispatch_tool_call` catches unexpected executor exceptions generically
now, and `/ai/chat`'s stream always emits a terminal `error`/`done` event
pair instead of the SSE stream silently dying mid-turn. Real
participant/volunteer names and certificate download tokens no longer
leave the system to OpenRouter by default —
`list_completed_event_reports` returns counts only unless the organizer's
question actually needs names (`include_names=true`), and
`list_event_certificates` drops the bearer-style `download_token`/`link`
entirely since the model never needs it.

**Not started:** TICKET-7 (system-prompt iteration — live testing surfaced
a couple of concrete cases worth tuning, like the model over-verifying
information it already has), TICKET-18 (task-prioritization prompt
guidance, meant to land as part of TICKET-7), and TICKET-20/21/22 (a
workload-based team-member recommendation tool, a dashboard-summary tool,
and whatever else TICKET-21 originally scoped beyond the team-member
roster tool — see `tickets.md` for scope; note `list_team_members`/
`get_team_member` now exist as of TICKET-63 above, so re-check TICKET-21's
original text before assuming its full scope is still open). TICKET-8's future-tool backlog is otherwise mostly picked up now;
volunteer management has real AI coverage as of TICKET-16/19/23 above.
A 2026-08-02 code review (TICKET-24–33) also found real gaps in what's
shipped — most notably no allowlist on the direct tool-invoke endpoint
(TICKET-25) and no confirmation gate for mutating tools besides
`publish_event` (TICKET-26) — see `tickets.md` for the full list; none of
those are fixed yet.

## How to run and see it

**One-time setup — add your OpenRouter key to your shell's rc file** so
it's available in every new terminal without re-exporting it each time.
The backend only reads it from the process environment (no `.env` file is
wired up), so it must land in an actual shell startup file, not a config
the app reads. Append to `~/.zshrc` (default on macOS) or `~/.bashrc` if
you use bash, then reload the shell:

```sh
echo 'export OPENROUTER_API_KEY="sk-or-your-key-here"' >> ~/.zshrc
echo 'export OPENROUTER_MODEL="anthropic/claude-3.5-sonnet"' >> ~/.zshrc   # optional — this is already the default
source ~/.zshrc
```

`OPENROUTER_MODEL` is optional and only needed to override the default
model slug. Never commit a real key to any file in this repo.

Then run the app same as the repo's standard local setup (see the root
`CLAUDE.md`):

```sh
.venv/bin/python -m uvicorn backend.main:app --reload   # terminal 1
npm run dev                                              # terminal 2, http://localhost:8443
```

Open `http://localhost:8443/admin/dashboard` (or `/admin/events`,
`/admin/volunteers` — any non-home admin page). The AI panel's FAB
("Ask Passion AI") sits fixed bottom-right; click it to open, `Escape` or
the panel's "Close" button to dismiss, or click the dimmed backdrop on a
desktop-width viewport. It's a real chat against the backend above — ask
it to list events, look up templates, or draft a new event.

You can also exercise the backend endpoint directly with curl, bypassing
the frontend entirely:

```sh
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
truth; don't duplicate it here. TICKET-9, TICKET-2, TICKET-3, TICKET-1,
TICKET-4, TICKET-5, TICKET-6, TICKET-11 (a formatting bug found after
TICKET-5 shipped), TICKET-12 (template visibility, found during
TICKET-6's verification), TICKET-13/14/15/16/17/19/23 (task
visibility/assignment, volunteer visibility, cross-event deadlines, and
the skill-match volunteer recommendation), and TICKET-34/35 (starter
prompts, refresh-after-mutation) are all done. What's left: TICKET-7
(system prompt iteration — now with several concrete cases to test
against), TICKET-8 (future tool backlog — mostly picked up, see above),
TICKET-18 (task-prioritization prompt guidance, folds into TICKET-7),
TICKET-20/21/22 (workload-based team-member recommendation, whatever
TICKET-21 scoped beyond the now-shipped `list_team_members`/
`get_team_member` roster tools, and a dashboard-summary tool), and
TICKET-24–33
(the 2026-08-02 review's compatibility audit and nine concrete bug/gap
findings — see `tickets.md`, none fixed yet).

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
- **The AI endpoint resolves up to `MAX_TOOL_ROUNDS` (5) rounds of
  tool-calling per user turn**, not an unbounded agent loop (TICKET-48).
  Originally capped at exactly one round; live use surfaced that
  `SYSTEM_PROMPT` itself promises sequential lookups within one turn (e.g.
  "call list_event_templates first ... to get the id" before
  `create_event_draft`) that a single round can't satisfy. The
  draft-then-approve boundary (`publish_event` only fires on an explicit
  later turn) still holds — the round bound only changes how many
  *lookup*-style calls the model can chain before replying, not which
  tools it's instructed to wait for confirmation on.
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
