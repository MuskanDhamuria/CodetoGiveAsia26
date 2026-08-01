# Tickets

Backlog for the participant portal and cross-cutting work. Update statuses
in place; remove or archive tickets once they're done rather than leaving
stale entries here — see [`participant-portal.md`](participant-portal.md)
for the "why" behind decisions already made.

---

~~TICKET-1: Let a returning participant sign in without RSVPing to an event~~
— **Done.** Added `GET /api/v1/participants/lookup?contact_number=...`
(`participants.py`) — exact match via the same `normalize_phone_number`
(TICKET-13) used everywhere else, single match or 404, registered ahead of
`/{participant_id}` so "lookup" doesn't get caught by that route's int path
param. Frontend: `SignInForm`/`SignInPage` (`src/participant/components/`)
ask only for a phone number, reuse `onIdentified`/`storeParticipant` on a
match, land on My Events (no RSVP call made), and show the honest
"We couldn't find that number — sign up for an event to get started." copy
on a 404 rather than a raw error. A "Sign in" nav link next to My Events is
shown only when no participant is currently identified. Still no real
authentication, by design — see TICKET-6; the sign-in form's copy says so
explicitly.

---

~~TICKET-2: Add a calendar view to the participant browse-events page~~ —
**Done.** `EventBrowseList` gets a second `.event-browse-tabs` row (List /
Calendar) directly below the existing Upcoming/Past tabs, same classes so it
mirrors their placement and style exactly. Calendar view is a new
`EventCalendarView` component (`src/participant/components/`), adapted from
`EventOperationsMvp.tsx`'s `EventCalendar` for this page's `EventSummary`
shape — event cells are `<Link to="events/:id">`s straight to the detail
page instead of an `onOpen` callback + modal, matching how the list view
already links out. Month navigation (prev/next) wraps years correctly (via
`Date.UTC`, same approach as the original). CSS copied+adapted into
`participant.css` (`.event-collection-calendar`, `.event-calendar-weekdays`,
`.event-calendar-grid`, `a` selector instead of `button`) rather than
importing `EventOperationsMvp.css`, so the two pages' calendars can diverge
in styling later without cross-page coupling. Defaults to the current
month; navigating between tabs (Upcoming/Past) doesn't reset it. Tests in
`EventBrowseList.test.tsx` use a dynamically-computed "today" fixture date
rather than fake timers, so they don't need the system clock mocked.

---

## TICKET-3: Make the site an installable PWA (mobile + desktop)

**Priority:** Medium-High
**Area:** `index.html`, new `public/manifest.json` (or similar), service worker, all page-level navigation

### Problem

`index.html` currently has no PWA affordances at all — confirmed by reading
it: no `<link rel="manifest">`, no `theme-color` meta, no icons, no service
worker registration. Nothing here currently makes the site installable.

### Acceptance criteria

- **Manifest**: add a `manifest.json` (name, short_name, icons at minimum
  192×192 and 512×512, `start_url`, `display: "standalone"`, `theme_color`,
  `background_color`) and link it from `index.html` via
  `<link rel="manifest" href="/manifest.json">`. Add a `theme-color` meta tag
  to `index.html`'s `<head>` alongside the existing viewport meta.
- **Service worker**: register one (even a minimal cache-the-app-shell one to
  start) so the install criteria are met and the app has an offline
  fallback. `vite-plugin-pwa` is the standard way to do this in a Vite
  project and would generate both the manifest and service worker from
  config rather than hand-rolling — worth using instead of writing this by
  hand, given nothing PWA-related is installed yet (`package.json` has no
  PWA plugin currently).
- **In-app back navigation on every non-root page.** This is the part that's
  easy to miss: once installed as a standalone PWA, the browser's own
  back/forward chrome is gone (this is especially true on iOS Safari-based
  installs, which have no back gesture at all in standalone mode). Every
  page reachable by drilling in — `/participant/events/:eventId` today, and
  whatever `/volunteer` and `/admin` sub-pages get built — needs an explicit
  in-UI back control, not just reliance on browser chrome or nav links to
  the section root. Concretely: add a back button to `EventDetailCard`, and
  make this a requirement teammates building `/volunteer`/`/admin` know
  about before those pages ship.
- Test actual installability (Chrome's "Install app" prompt / Lighthouse PWA
  audit) on both a desktop and a mobile viewport, not just that the manifest
  file is syntactically valid.

---

## TICKET-4: Backlog — improvements unlocked once the site is a PWA

**Priority:** Low (future work, blocked on TICKET-3)
**Area:** cross-cutting

Not scoped for implementation yet — this is the list of things that become
possible or worth doing *after* TICKET-3 lands, so they don't get lost:

- **Offline browsing of already-loaded events.** Cache `GET /events` and
  `GET /events/:id` responses via the service worker so a participant who's
  browsed events once can still see them without signal — relevant given the
  target beneficiary population (migrant workers, who may have inconsistent
  data access).
- **Background sync for signups made offline.** Queue
  `POST /public/events/{id}/rsvp` / `POST /events/{id}/participants` calls
  made while offline and replay them when connectivity returns, instead of
  just failing.
- **Push notifications for event reminders**, as a native complement to (or
  eventual replacement for) the planned WhatsApp bot reminders — doesn't
  require the participant to have WhatsApp.
- **Home-screen install prompts** at the right moment (e.g. after a
  successful signup) so returning participants don't have to re-navigate
  from a bookmark or search each time.
- **Manifest shortcuts** for one-tap deep links into `/participant`,
  `/volunteer`, `/admin` from the home-screen icon's long-press menu, once
  all three portals exist.
- **Reduced data usage** from cached static assets (fonts, JS/CSS bundles)
  on repeat visits — meaningful for users on limited mobile data plans.
- **Splash screen / branded loading state** instead of a blank white flash
  on cold start, using the manifest's `background_color` and icons.

---

## TICKET-5: Capacity / waitlist support for event RSVPs

**Priority:** Medium
**Area:** Backend (`backend/migrations/`, `backend/api/routes/{events,public}.py`), Frontend

### Problem

`participations.rsvp_status` is a plain boolean. There's no way to cap
signups for an event or waitlist people once it's full — this is listed as
an open decision in `API_ENDPOINTS.md` ("Capacity limits, waiting lists,
cancellation status, and RSVP states beyond a simple boolean").

### Acceptance criteria

- A capacity field (nullable = unlimited) somewhere on `events`, added via a
  new additive migration, following the pattern in `002_add_event_description.sql`.
- `POST /events/{id}/participants` and `POST /public/events/{id}/rsvp` check
  capacity and either register the participant normally or place them on a
  waitlist, returning which one happened.
- `EventDetailCard` surfaces "You're on the waitlist" distinctly from
  "You're signed up," and shows remaining slots (or "Full — join waitlist")
  on the signup CTA.

### Open question

Whether waitlist position/promotion needs to be tracked explicitly (an
ordered queue) or a simple `waitlisted` status is enough for the hackathon
demo. Needs a team decision before implementation.

---

## TICKET-6: Decide on and implement authentication

**Priority:** Medium (cross-cutting — affects every portal, not just participant)
**Area:** whole system

### Problem

There is no real authentication anywhere in the system. The participant
portal's phone-based identity (see `participant-portal.md`) is intentionally
low-friction and not secure against a shared device — fine for a hackathon
demo, but `API_ENDPOINTS.md`'s first open decision is explicitly
"Authentication method and permissions for participant, volunteer,
organizer, administrator, bot, and public access," and it's still open.

### What this ticket actually is

A design decision, not an implementation task yet — there's not enough
agreed-upon shape to write acceptance criteria for. Needs the team to decide
the method (session cookies? magic links? something bot-compatible for
volunteers/organizers?) and a permissions matrix across the four roles
before any endpoint can be locked down. Once decided, split into
per-portal follow-up tickets.

---

## TICKET-7: Add a `code` field to API error responses

**Priority:** Low
**Area:** Backend, all route modules

### Problem

`API_ENDPOINTS.md`'s "Suggested error response" convention is
`{"detail": "...", "code": "..."}`, but every implemented route (including
`health.py`, `events.py`, `participants.py`, `public.py`) only returns
`{"detail": "..."}`, matching FastAPI's default `HTTPException` shape.

This isn't just cosmetic: `src/participant/components/EventDetailCard.tsx`
and `MyEventsList.tsx` currently detect a stale local identity by matching
the exact `detail` *string* `"Participant not found"` (see
`isStaleIdentityError` in both files) — fragile, since any wording change to
that message silently breaks the fallback. A stable `code` like
`participant_not_found` would fix that properly.

### Acceptance criteria

- Team decision on whether to adopt the `code` field at all (it's marked
  "suggested," not required, in the contract doc).
- If yes: a custom exception handler that renders `{"detail", "code"}` for
  domain errors, machine-stable `code` values assigned across existing
  routes, and the frontend's string-matching swapped for `code` checks.

---

## TICKET-8: Backlog — other portals and integrations not yet built

**Priority:** N/A (tracking only, not owned by the participant slice)
**Area:** cross-cutting

- **Organizer-side event CRUD.** `backend/api/routes/events.py` only has
  list/detail/register — no `POST/PATCH/DELETE /events`,
  `/events/{id}/close`, `/reopen`, or `/reschedule`. Whoever builds the admin
  event-management UI adds these to the same file. Note `events.event_time`
  is `NOT NULL` (see `002_add_event_description.sql`), so the create-event
  form needs a time input alongside the date picker, not just an optional
  add-on.
- **`/volunteer` and `/admin` route trees** aren't built yet. The
  `/participant/*` route in `src/App.tsx` is the precedent for mounting them
  the same way — a `<Route path="/x/*">` pointing at that portal's own
  nested `<Routes>`, additive alongside the existing pages.
- **WhatsApp bot integration.** The plan is for the bot to call
  `POST /public/events/{id}/rsvp` for participant signups too, since both
  key off phone number. Not started; owned by Jia Yu.

---

## TICKET-9: Backlog — participant portal polish

**Priority:** Low (non-blocking)
**Area:** `src/participant/`, `backend/api/routes/participants.py`

- Add a loading skeleton instead of plain "Loading events…" text on the
  browse/detail pages.
- ~~`EventBrowseList`'s "Past" tab includes today's date on both sides~~ —
  moot: the Upcoming/Past tabs were replaced by month-grouped list view +
  calendar coloring (see `participant-portal.md`), which fetches all events
  once and buckets client-side with a strict `event_date < today` for past,
  so today's events land in exactly one place.
- Consider caching `GET /events` client-side (e.g. a simple in-memory cache
  in `api/client.ts`) if the browse page ends up re-fetching on every nav.
- `list_participants`'s `q` search (`backend/api/routes/participants.py`)
  does a naive `LIKE` scan; fine at hackathon scale, would want an index or
  FTS if the participant list grows large.
- The "Code Morphing Agent" idea from the original brainstorm (an agent that
  edits the system's own code) is still low-priority/good-to-have, not
  started.

---

~~TICKET-10: Cancel-signup doesn't recover from a concurrently-invalidated identity~~
— **Partially done.** `handleCancel` (`EventDetailCard.tsx`) now catches a
404 from `cancelRegistration` and resets to the not-signed-up state
(`setIsSignedUp(false)`) instead of leaving a stale "Cancel my signup"
button next to a raw "Registration not found" error — covers both "already
cancelled elsewhere" and "participant record deleted" causes for the
*visible UI state*.

Still open (per the ticket's own second acceptance-criteria bullet, which
was a "decide" item, not yet decided): `update_participation`
(`backend/api/routes/events.py`) still doesn't distinguish "participant
gone" from "registration gone" in its 404, so `handleCancel` can't safely
call `onIdentityInvalid()` only in the participant-gone case — doing so
unconditionally would incorrectly log out a participant who simply
cancelled from another device/tab. That still needs the TICKET-7 `code`
field (or an equivalent signal) before it can be implemented correctly.

---

~~TICKET-11: Non-404 errors in the event-detail signup check are silently treated as "not signed up"~~
— **Done.** The `getMyEvents` signup-check effect in `EventDetailCard.tsx`
now has the same three-way outcome `MyEventsList` already had: success,
stale-identity (`onIdentityInvalid()`, no error shown), and a distinct
generic-error state (new `signupCheckStatus` state) that renders "Couldn't
check your registration status. Refresh the page to try again." in the
action area instead of silently coercing to "Sign up" with no explanation.

---

~~TICKET-12: Public RSVP can silently reassign identity to an existing participant under a different name~~
— **Partially done.** `PublicRsvpOut` (`public.py`) now returns the
matched/created participant's canonical `participant_name`,
`participant_contact_number`, and `participant_email` — `_find_or_create_participant`
returns the full `sqlite3.Row` instead of just an id, so the handler builds
the response from what's actually in the DB rather than echoing the request
body. `SignupForm.tsx`'s `onSignedUp` now stores `result.participant_name`/
`result.participant_contact_number`/`result.participant_email` instead of
the locally-typed form values (this also closes TICKET-15, the identical gap
for `contact_number`). Covered by
`test_rsvp_returns_the_matched_participants_canonical_name_not_the_submitted_one`
and `test_rsvp_returns_canonical_contact_number_even_when_typed_differently`
(`test_public.py`), plus a frontend integration test in
`ParticipantApp.ui.test.tsx` asserting the "Signed in as …" badge reflects
the backend's canonical name, not what was typed.

Still open: this only fixes what gets *stored/displayed* after the fact — it
doesn't detect or surface the mismatch to the participant at signup time.
The acceptance criteria's suggested "this number is already registered as
X — is that you?" confirmation step in `SignupForm` is still undone; two
people sharing a phone (or a typo colliding with an existing registrant's
number) still silently merges into the existing record without asking.

---

~~TICKET-13: No phone-number normalization in participant identity matching~~
— **Done.** `backend/phone.py`'s `normalize_phone_number` (built on
`phonenumbers`) parses and reformats every incoming `contact_number` to
E.164 before it's written or matched against — `create_participant`
(`participants.py`) and `public_rsvp`/`_find_or_create_participant`
(`public.py`) both funnel through it, and a number that fails to parse as
valid now 400s instead of being stored as-is. Frontend: `SignupForm`'s phone
field auto-formats as the participant types (`src/participant/phone.ts`,
`libphonenumber-js`'s `AsYouType`) and rejects an invalid number client-side
before submitting. Defaults to the `SG` region for numbers with no leading
"+"; a "+"-prefixed number is parsed using its own country code regardless,
so other countries work without a picker. Existing seeded data had no
participants with phone numbers, so no backfill was needed — if that
changes before this ships for real, audit stored `contact_number` values
for anything pre-dating this fix.

Still open: TICKET-1's proposed lookup-by-phone endpoint should normalize
its query parameter the same way once it's built.

---

~~TICKET-14: `todayIso()` uses the browser's local clock, breaking the app's own "always UTC" date scheme for ~8 hours a day~~
— **Done.** Added `sgNow()` (`dateFormat.ts`) — shifts the real UTC instant
forward by a fixed 8-hour Singapore offset before reading its UTC calendar
date/components, instead of trusting the device's local `Date`/
`toISOString()`. `todayIso()` now builds on `sgNow()`; `EventBrowseList.tsx`'s
`startOfCurrentMonth()` had the identical bug (deriving the "current month"
default from a local-clock `Date`) and now uses `sgNow()` too. Regression
test in `dateFormat.test.ts` fakes the system clock to an instant where UTC
and SGT disagree on the calendar date and asserts `todayIso()` returns
SGT's date; `EventBrowseList.test.tsx` gets an equivalent end-to-end case
asserting an event dated "yesterday" (SGT) is bucketed as past rather than
upcoming. `EventBrowseList.test.tsx`'s own fixture-date helper
(`TODAY_ISO`/`isoDaysFromNow`) now imports `todayIso()` from the module
under test rather than reimplementing the same local-clock logic, so the
fixtures can't silently drift out of sync with the component again.

---

~~TICKET-15: `SignupForm` stores the un-normalized phone number locally, diverging from what the backend persists~~
— **Done**, bundled into the same `PublicRsvpOut` response-shape fix as
TICKET-12 (see above). `SignupForm.tsx` now stores
`result.participant_contact_number` (E.164, as persisted) instead of the
raw `contactNumber.trim()` form value, so a participant's
`StoredParticipant.contactNumber` is normalized the same way whether they
most recently signed up or signed in via `SignInForm`.

---

~~TICKET-16: No test coverage for cancel-signup, repeat-signup, or the closed-event render branch~~
— **Done.** New `EventDetailCard.test.tsx` covers: a successful cancel
returning to the "Sign up" state; cancel recovering cleanly from a 404
("registration already gone," TICKET-10) instead of leaving a stale Cancel
button; a known, already-signed-in participant registering for a *second*
event directly (no `SignupForm`); the closed-event message rendering with
no signup affordance for a visitor with no existing RSVP; and the
generic-error state on the signup check (TICKET-11) rendering instead of
silently showing "Sign up".

---

~~TICKET-17: Admin events calendar grid misaligns with its date headers on mobile once a day has events~~
— **Done.** The bug was in `src/EventCollectionPrototype.tsx`'s calendar
view (`.collection-calendar-days` / `.collection-calendar-grid`,
`src/index.css`) — this is the component `App.tsx` actually mounts for the
admin Events page, not `EventOperationsMvp.tsx`'s similarly-named
`EventCalendar` (which is unused dead code for this route; `App.tsx` line
718's `EventOperationsMvp` render path is for a different view). Root
cause: the weekday header and day-cell grid were two separate sibling
elements each independently declaring `grid-template-columns: repeat(7,
1fr)`. `fr` tracks still respect each grid item's default `min-width:
auto`, and nothing on the day cells or their event buttons reset that, so a
long event name (e.g. "Clothes & Essentials Distribution") forced a
cell's intrinsic minimum width past `1fr`, widening `.collection-calendar-grid`'s
columns independently of `.collection-calendar-days`'s header row — with no
events, all cells sat at the same content-free minimum and the rows
coincidentally matched. Fixed by changing both grids to
`repeat(7, minmax(0, 1fr))` and adding `min-width: 0` to the day cell and
button, forcing every column to the shared track width regardless of
content. That alone made columns line up but shrank cells so far on mobile
that event-name text wrapped one letter per line; added a
`max-width: 640px` block shrinking cell/button padding to recover usable
width, and switched the event-name `<strong>` to single-line
`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` (the same
pattern `EventOperationsMvp.css`'s dead calendar already used) instead of
letting it wrap. Verified via the in-app browser at a 375px viewport:
`.collection-calendar-days` and `.collection-calendar-grid` column
`left` offsets now match exactly (`[49,89,128,168,207,247,286]`) both on
an empty month and on a day cell with a long event name, which now
ellipsizes to "C…" instead of blowing out its column.
`EventCalendarView.tsx` (participant portal, TICKET-2) and
`EventOperationsMvp.tsx`'s dead `EventCalendar` share the same
weekday/grid-split structure — not touched here since neither is live on
this bug's path, but worth a follow-up sweep if either turns out to have
the same latent issue.
