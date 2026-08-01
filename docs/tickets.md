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

---

## TICKET-10: Cancel-signup doesn't recover from a concurrently-invalidated identity

**Priority:** Low
**Area:** Frontend (`src/participant/components/EventDetailCard.tsx`)

### Problem

`c30feaf` added stale-identity recovery (`isStaleIdentityError` → `onIdentityInvalid()`)
to the `getMyEvents` status check and to `handleSignup`, but not to
`handleCancel` (`EventDetailCard.tsx`'s `handleCancel`, around line 90) — it
just does a generic `setActionError(error.message)`.

This is reachable if a participant is deleted from the DB *after* the detail
page has already loaded and shown "Cancel my signup" (identity was valid at
mount, invalidated mid-session). `PATCH /events/{id}/participants/{id}`
(`backend/api/routes/events.py`, `update_participation`) never checks that
the participant still exists — it only looks up the `participations` row,
and that row cascade-deletes with the participant
(`participations.participant_id ... ON DELETE CASCADE` in
`001_initial_schema.sql`). So the request 404s with "Registration not
found," not "Participant not found," and the existing string-matched
`isStaleIdentityError` wouldn't catch it even if it were checked here.

### Acceptance criteria

- `handleCancel`'s catch treats a 404 on this endpoint as "the registration
  is already gone" — reset to the not-signed-up state (`setIsSignedUp(false)`,
  and if the underlying cause is the participant no longer existing, also
  `onIdentityInvalid()`) instead of leaving the UI showing a stale "Cancel"
  button next to a confusing raw error string.
- Decide whether `update_participation` should itself distinguish
  "participant gone" vs. "registration gone" (see TICKET-7 re: a `code`
  field) rather than collapsing both into one 404 message.

---

## TICKET-11: Non-404 errors in the event-detail signup check are silently treated as "not signed up"

**Priority:** Medium
**Area:** Frontend (`src/participant/components/EventDetailCard.tsx`)

### Problem

In `EventDetailCard`, the effect that checks whether the current participant
is already signed up for this event does:

```ts
getMyEvents(participant.participantId)
  .then(...)
  .catch((error) => {
    if (isStaleIdentityError(error)) onIdentityInvalid();
    setIsSignedUp(false);   // runs on every error, not just the stale-identity 404
  });
```

A transient 500 or a dropped network request produces the exact same UI as
"you're genuinely not registered" — an already-signed-up participant sees
the "Sign up" button again, with no error banner and no retry. Contrast with
`MyEventsList.tsx`, which correctly separates the stale-identity 404
(`onIdentityInvalid()`) from a generic failure (`setStatus("error")`) —
`EventDetailCard` only has the happy-path/stale-identity branches, not a
generic-failure one, even though this same file does distinguish them
correctly inside `handleSignup`.

Worst case is low-severity (re-submitting sign-up on a backend blip is a
harmless upsert), but the missing error state means a real backend problem
is invisible to the user and indistinguishable from "you're not signed up."

### Acceptance criteria

- Give this effect the same three-way outcome `MyEventsList` already has:
  success, stale-identity (reset to signed-out), and generic error (surface
  something to the user — even reusing the existing `event-detail-status`
  treatment — rather than silently coercing to "not signed up").

---

## TICKET-12: Public RSVP can silently reassign identity to an existing participant under a different name

**Priority:** Medium
**Area:** Backend (`backend/api/routes/public.py`), Frontend (`src/participant/components/SignupForm.tsx`)

### Problem

`_find_or_create_participant` (`public.py`) matches an existing participant
by `contact_number` (then `email`) alone — it never checks that the
submitted `name` matches the record it found. Meanwhile `SignupForm`'s
`onSignedUp` callback stores the *locally-typed* name into `localStorage`,
since `PublicRsvpOut` doesn't return the matched participant's actual name:

```ts
onSignedUp({
  participantId: result.participant_id,
  name: name.trim(),   // never verified against the DB record it just matched
  ...
});
```

Concrete failure case: two people share a phone (family device, or someone
signs up on behalf of another migrant worker using that person's number), or
a typo in the phone number happens to collide with an existing registrant's.
The RSVP attaches to the existing DB participant, but the "Signed in as …"
badge shows the freshly-typed name — the localStorage identity and the DB
identity diverge, and every subsequent action (My Events, cancel) operates
on the *original* person's record under a *different* displayed name, with
nothing surfacing the mismatch.

### Acceptance criteria

- Decide the intended behavior when a submitted name doesn't match an
  existing participant matched by contact number/email: at minimum, have
  `PublicRsvpOut` return the participant's canonical `name` so the frontend
  stores/display the DB's name rather than trusting the form input
  unconditionally.
- Consider surfacing an explicit "this number is already registered as X —
  is that you?" confirmation step in `SignupForm` rather than silently
  merging identities.

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
