# Tickets

Backlog for the participant portal and cross-cutting work. Update statuses
in place; remove or archive tickets once they're done rather than leaving
stale entries here — see [`participant-portal.md`](participant-portal.md)
for the "why" behind decisions already made.

---

## TICKET-1: Let a returning participant sign in without RSVPing to an event

**Priority:** High
**Area:** Frontend (`src/participant/`), Backend (`backend/api/routes/participants.py`)

### Problem

There's no way to re-establish identity on a new device/browser (or after
clearing site data) without going through an event's signup form — and that
form always registers you for that event as a side effect
(`POST /public/events/{id}/rsvp` does find-or-create *and* RSVP in one call,
by design — see `docs/participant-portal.md`). So today, checking "my
events" from a fresh session either shows nothing, or forces an unwanted
signup just to get identified.

### Acceptance criteria

- A "Sign in" entry point on the participant portal (e.g. next to the
  existing "My Events" link in `ParticipantApp.tsx`'s nav) that asks only
  for a phone number — no event context, no RSVP side effect.
- On success, the same `storeParticipant` / `localStorage` flow already used
  by `SignupForm` is reused so "My Events" and future signups pick up the
  restored identity.
- On failure (no participant with that number), an honest empty state
  ("We couldn't find that number — sign up for an event to get started"),
  not a raw API error.

### Technical notes

- No backend endpoint currently supports an exact, side-effect-free lookup
  by phone number. `GET /api/v1/participants?q=...` (`participants.py`)
  does a `LIKE`-based partial search across name/email/contact_number and
  returns a list — usable as a stopgap by filtering client-side for an exact
  `contact_number` match, but not built for this and returns more than
  necessary.
- Recommend adding a small dedicated endpoint instead, e.g.
  `GET /api/v1/participants/lookup?contact_number=...` returning a single
  match or 404 — cleaner than repurposing the search endpoint, and avoids
  leaking other participants' data if the `q` match is too loose.
- There is still no real authentication in this system (see
  `API_ENDPOINTS.md`'s open decisions) — this is "restore local identity by
  phone number," not a secure login. Keep the UI copy honest about that.

---

## TICKET-2: Add a calendar view to the participant browse-events page

**Priority:** Medium
**Area:** Frontend (`src/participant/components/EventBrowseList.tsx`)

### Problem

`EventBrowseList` only renders a flat list with an Upcoming/Past tab toggle.
Organizers already get a List/Calendar toggle on the events page.

### Acceptance criteria

- `EventBrowseList` gets a List/Calendar view toggle, mirroring the existing
  Upcoming/Past tabs in placement and style.
- Calendar view shows a month grid with events plotted on their date, month
  navigation (prev/next), and clicking an event opens its detail page
  (`/participant/events/:eventId`), same as the list view's links.

### Reuse this — don't rebuild it

`src/EventOperationsMvp.tsx` already has a complete, working month-calendar
component for exactly this purpose:

- `EventCalendar` (`src/EventOperationsMvp.tsx:185-226`) — self-contained
  month grid: computes weekday offset and days-in-month from a `Date`,
  renders a 7-column grid, plots events whose `date` matches each cell, and
  takes `onChangeMonth` / `onOpen` callbacks. Takes `events: Event[]` with a
  `date: string` (`YYYY-MM-DD`) field — same shape as this project's
  `EventSummary.event_date`, so adapting it is a rename, not a rewrite.
- `EventCollection` (`src/EventOperationsMvp.tsx:228-274`) shows the
  List/Calendar `view` toggle pattern (`CollectionView = "list" | "calendar"`
  state, toggle buttons with an `.active` class) to copy for
  `EventBrowseList`.
- CSS is already written: `.event-view-toggle`, `.event-collection-calendar`,
  `.event-calendar-weekdays`, `.event-calendar-grid` in
  `src/EventOperationsMvp.css`. Reuse the classes directly, or copy+rename
  into `participant.css` if the two pages' calendars should be able to
  diverge in styling later.
- Ignore `src/EventCollectionPrototype.tsx`'s `PrototypeCalendar` — it's
  explicitly marked `PROTOTYPE ONLY` and uses fixture data with a different
  date shape; `EventOperationsMvp.tsx`'s version is the live, real one.

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
  event-management UI adds these to the same file.
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
- `EventBrowseList`'s "Past" tab includes today's date on both sides
  (`date_from <= today` for upcoming, `date_to <= today` for past) — a
  same-day event could show in both tabs. One-line fix: `date_to < today`
  for past.
- Consider caching `GET /events` client-side (e.g. a simple in-memory cache
  in `api/client.ts`) if the browse page ends up re-fetching on every nav.
- `list_participants`'s `q` search (`backend/api/routes/participants.py`)
  does a naive `LIKE` scan; fine at hackathon scale, would want an index or
  FTS if the participant list grows large.
- The "Code Morphing Agent" idea from the original brainstorm (an agent that
  edits the system's own code) is still low-priority/good-to-have, not
  started.
