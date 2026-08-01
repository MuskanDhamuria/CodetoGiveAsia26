# FastAPI endpoint contract

This document is the proposed HTTP API between the React frontend and the
FastAPI backend. It is based on the current SQLite schema and the product plan.

## Current implementation status

The organizer/admin backend currently implements:

- Event-template CRUD and cloning, including ordered template tasks/subtasks.
- Event CRUD, filtering, closing/reopening, rescheduling, and atomic workflow
  generation from a template.
- Event-task and subtask CRUD, ordering, status transitions, deadlines, and
  internal team-member assignment.
- Team-member CRUD and assigned-task queries.
- Participant CRUD, event registration, RSVP, attendance, and event history.
- Dashboard summary, upcoming deadlines, calendar events, and per-event
  progress summaries.

Volunteer routes remain owned by the volunteer feature module. The organizer
implementation does not change the event volunteer-signup endpoints. Routes in
the “Proposed future endpoints” section still require schema/product decisions
and are not implemented.

## Conventions

- Base URL: `/api/v1`
- Request and response bodies use JSON and `snake_case` field names.
- Database IDs are integers.
- Dates use ISO `YYYY-MM-DD`, for example `2026-08-09`.
- Datetimes use ISO 8601 with a timezone, for example
  `2026-08-09T09:00:00+08:00`.
- Boolean database values (`0`/`1`) are exposed as JSON booleans.
- `PATCH` performs a partial update; omitted fields are unchanged.
- A successful `DELETE` returns `204 No Content`.
- List endpoints support `limit` and `offset`. Defaults: `limit=50`,
  `offset=0`; maximum `limit=100`.
- Text query parameters should be trimmed before use.
- Unless stated otherwise, list results are ordered by ID ascending.

Suggested list response:

```json
{
  "items": [],
  "total": 0,
  "limit": 50,
  "offset": 0
}
```

Suggested error response:

```json
{
  "detail": "Event 42 was not found",
  "code": "event_not_found"
}
```

Common status codes:

- `200` successful read or update
- `201` successful creation
- `204` successful deletion
- `400` malformed business request
- `404` resource not found
- `409` uniqueness conflict or invalid state transition
- `422` request validation failure (FastAPI default)

## MVP route summary

The recommended first implementation is:

1. Health, event templates, template tasks, and template subtasks.
2. Events, event tasks, event subtasks, and team members.
3. Participants and event participation.
4. Volunteers, roles, skills, and volunteer signup processing.
5. Dashboard summary endpoints.

Authentication and authorization are not yet represented in the schema. Until
that is designed, the API must not be considered production-secure.

## FastAPI module structure

Keep `backend/main.py` limited to application-wide setup such as lifespan,
middleware, and including the central router. Each feature owns a separate
router module:

```text
backend/
├── main.py
├── database.py
├── api/
│   ├── router.py
│   └── routes/
│       ├── health.py
│       ├── event_templates.py
│       ├── events.py
│       ├── team_members.py
│       ├── participants.py
│       ├── volunteers.py
│       ├── roles.py
│       └── dashboard.py
└── schema/
    ├── common.py
    ├── health.py
    ├── event_templates.py
    ├── events.py
    ├── team_members.py
    └── participants.py
```

Every route module declares its own `APIRouter`, path prefix, tags, and endpoint
functions. Its Pydantic request/response models belong in the matching
`backend/schema/` module; shared constrained types and enums belong in
`backend/schema/common.py`. `backend/api/router.py` imports and includes the
feature routers. `backend/main.py` includes only that central router, so
teammates do not all need to edit the application entry point.

`volunteers.py` is a temporary exception: its existing Pydantic models remain
in the route module until the volunteer feature owner moves them separately.
Do not move or modify those schemas as part of organizer/admin work.

Example feature module:

```python
from fastapi import APIRouter

from backend.schema.events import EventSummary

router = APIRouter(prefix="/events", tags=["events"])

@router.get("", response_model=list[EventSummary])
def list_events() -> list[EventSummary]:
    ...
```

Then register it centrally:

```python
from backend.api.routes import events

api_router.include_router(events.router)
```

Do not create an additional FastAPI application inside a feature module. Shared
database dependencies and authentication dependencies can later live under
`backend/api/dependencies.py`.

## Health

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/health` | None | Liveness check. Returns `{"status":"ok"}`. |
| `GET` | `/health/database` | None | Executes a small database query and reports whether SQLite is reachable. |

## Event templates

Template category values are `planning`, `execution`, and `post_execution`.
`relative_due_days` is relative to the event date: negative is before the
event, `0` is event day, and positive is after the event.

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/event-templates` | Query: `is_built_in?: bool`, `q?: str`, `limit`, `offset` | List built-in and custom templates. `q` searches name and description. |
| `POST` | `/event-templates` | Body: `name`, `description?` | Create a custom template. The server always sets `is_built_in=false`. |
| `GET` | `/event-templates/{template_id}` | Path: `template_id` | Return one template, including its ordered tasks, subtasks, and roles. |
| `PATCH` | `/event-templates/{template_id}` | Body: `name?`, `description?` | Update template metadata. Decide separately whether built-ins may be edited or copied first. |
| `DELETE` | `/event-templates/{template_id}` | Path: `template_id` | Delete a custom template. Return `409` if it is built-in or is referenced by an event. |
| `POST` | `/event-templates/{template_id}/clone` | Body: `name?` | Copy a template, its tasks, subtasks, and roles into a new custom template. |

Template task body:

```json
{
  "name": "Recruit volunteers",
  "body": "Recruit enough volunteers for all event-day roles.",
  "relative_due_days": -14,
  "category": "planning",
  "position": 5
}
```

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/event-templates/{template_id}/tasks` | Query: `category?` | List template tasks ordered by `position`. |
| `POST` | `/event-templates/{template_id}/tasks` | Body: template task fields above; `position` may be omitted to append | Add a task to a template. |
| `GET` | `/event-templates/{template_id}/tasks/{task_id}` | Path IDs | Get one template task and its ordered subtasks. |
| `PATCH` | `/event-templates/{template_id}/tasks/{task_id}` | Body: any template task fields | Partially update a template task. |
| `DELETE` | `/event-templates/{template_id}/tasks/{task_id}` | Path IDs | Delete a template task and its subtasks. |
| `PUT` | `/event-templates/{template_id}/tasks/order` | Body: `{"task_ids":[3,1,2]}` | Replace task ordering in one transaction. IDs must belong to the template. |

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `POST` | `/event-templates/{template_id}/tasks/{task_id}/subtasks` | Body: `title`, `position?` | Add a template checklist item; omit `position` to append. |
| `PATCH` | `/event-templates/{template_id}/tasks/{task_id}/subtasks/{subtask_id}` | Body: `title?`, `position?` | Update a template checklist item. |
| `DELETE` | `/event-templates/{template_id}/tasks/{task_id}/subtasks/{subtask_id}` | Path IDs | Delete a template checklist item. |
| `PUT` | `/event-templates/{template_id}/tasks/{task_id}/subtasks/order` | Body: `{"subtask_ids":[3,1,2]}` | Replace subtask ordering in one transaction. |

### Template roles

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/event-templates/{template_id}/roles` | None | List volunteer roles attached to the template. |
| `POST` | `/event-templates/{template_id}/roles` | Body: `role_id` | Add an existing volunteer role to the template. |
| `DELETE` | `/event-templates/{template_id}/roles/{role_id}` | Path IDs | Remove a role from the template. |

## Events

Event status values are `open` and `closed`.

Create event body:

```json
{
  "event_template_id": 1,
  "name": "August Wellness Session",
  "venue": "Tampines Hub",
  "event_date": "2026-08-09"
}
```

`event_template_id` may be `null` when the organizer chooses **Start from
scratch**. That creates an Event with an empty Task plan. Otherwise, creating an
event copies the selected template's tasks and subtasks into
`event_tasks` and `event_subtasks`. It should calculate every `due_at` from the
event date and `relative_due_days`. Later edits to the template must not change
already-created events.

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/events` | Query: `status?`, `date_from?`, `date_to?`, `template_id?`, `q?`, `limit`, `offset`, `sort=event_date`, `order=asc|desc` | List events for the event list or calendar. `q` searches name and venue. |
| `POST` | `/events` | Body: create event fields above; `event_template_id` may be `null` | Create an Event from a template or start from an empty Task plan. |
| `GET` | `/events/{event_id}` | Query: `include=tasks,subtasks,counts` (optional) | Get event details. Optional includes prevent multiple frontend requests. |
| `PATCH` | `/events/{event_id}` | Body: `name?`, `venue?`, `event_date?`, `status?` | Update event details. Changing the date does not silently move task deadlines; use the reschedule endpoint for that. |
| `DELETE` | `/events/{event_id}` | Path: `event_id` | Permanently delete an event and dependent tasks/signups. The UI should require confirmation. |
| `POST` | `/events/{event_id}/close` | None | Convenience transition from `open` to `closed`. |
| `POST` | `/events/{event_id}/reopen` | None | Convenience transition from `closed` to `open`. |
| `POST` | `/events/{event_id}/reschedule` | Body: `event_date`, `shift_task_deadlines: bool = true` | Change the event date and optionally shift existing deadlines by the same number of days. |

### Event tasks and subtasks

Task status values are `incomplete`, `ongoing`, and `done`. Task category values
are `planning`, `execution`, and `post_execution`.

Event task body:

```json
{
  "name": "Recruit volunteers",
  "body": "Recruit enough volunteers for all roles.",
  "due_at": "2026-07-26T23:59:00+08:00",
  "category": "planning",
  "status": "incomplete",
  "team_member_id": 4,
  "position": 5
}
```

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/events/{event_id}/tasks` | Query: `category?`, `status?`, `team_member_id?`, `due_before?`, `due_after?` | List event tasks, ordered by category and position. |
| `POST` | `/events/{event_id}/tasks` | Body: event task fields; `status`, `team_member_id`, and `position` optional | Add a custom task to an event. |
| `GET` | `/events/{event_id}/tasks/{task_id}` | Path IDs | Get one event task including subtasks and assignee summary. |
| `PATCH` | `/events/{event_id}/tasks/{task_id}` | Body: any event task fields | Update task details, status, deadline, phase, or team-member assignment. |
| `DELETE` | `/events/{event_id}/tasks/{task_id}` | Path IDs | Delete a task and its subtasks. |
| `PUT` | `/events/{event_id}/tasks/order` | Body: `{"task_ids":[3,1,2]}` | Replace event task ordering atomically. |
| `POST` | `/events/{event_id}/tasks/{task_id}/start` | None | Convenience transition to `ongoing`. |
| `POST` | `/events/{event_id}/tasks/{task_id}/complete` | None | Convenience transition to `done`. |
| `POST` | `/events/{event_id}/tasks/{task_id}/reopen` | None | Convenience transition to `incomplete`. |

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `POST` | `/events/{event_id}/tasks/{task_id}/subtasks` | Body: `title`, `position?` | Add an event checklist item. |
| `PATCH` | `/events/{event_id}/tasks/{task_id}/subtasks/{subtask_id}` | Body: `title?`, `completed?`, `position?` | Edit or check/uncheck a subtask. |
| `DELETE` | `/events/{event_id}/tasks/{task_id}/subtasks/{subtask_id}` | Path IDs | Delete an event checklist item. |
| `PUT` | `/events/{event_id}/tasks/{task_id}/subtasks/order` | Body: `{"subtask_ids":[3,1,2]}` | Replace subtask ordering atomically. |

Task assignment note: `event_tasks.team_member_id` refers to an internal team
member. Volunteers are not task assignees in the current domain model; they are
approved for an event and assigned a volunteer role through `volunteer_signups`.

## Team members

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/team-members` | Query: `is_active?`, `q?`, `limit`, `offset` | List internal organizers eligible for task assignment. |
| `POST` | `/team-members` | Body: `name`, `email`, `is_active?` | Create a team member. Email must be unique case-insensitively. |
| `GET` | `/team-members/{team_member_id}` | Path ID | Get a team member. |
| `PATCH` | `/team-members/{team_member_id}` | Body: `name?`, `email?`, `is_active?` | Update or deactivate a team member. |
| `DELETE` | `/team-members/{team_member_id}` | Path ID | Delete a team member and unassign their tasks. Prefer deactivation when history matters. |
| `GET` | `/team-members/{team_member_id}/tasks` | Query: `status?`, `event_id?`, `due_before?`, `limit`, `offset` | List work assigned to a team member. |

## Participants and RSVPs

`attendance` is nullable: `null` means not recorded, rather than absent.

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/participants` | Query: `q?`, `limit`, `offset` | Search participants by name, email, or contact number. |
| `POST` | `/participants` | Body: `name`, `contact_number?`, `email?` | Create a participant. |
| `GET` | `/participants/{participant_id}` | Path ID | Get participant details. |
| `PATCH` | `/participants/{participant_id}` | Body: `name?`, `contact_number?`, `email?` | Update participant details. |
| `DELETE` | `/participants/{participant_id}` | Path ID | Delete a participant and their participation records. Restrict to administrators. |
| `GET` | `/participants/{participant_id}/events` | Query: `attendance?`, `limit`, `offset` | Return the participant's RSVP and attendance history. |

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/events/{event_id}/participants` | Query: `rsvp_status?`, `attendance?`, `q?`, `limit`, `offset` | List participants and RSVP/attendance data for an event. |
| `POST` | `/events/{event_id}/participants` | Body: `participant_id`, `rsvp_status?` | Register an existing participant for an event. |
| `PATCH` | `/events/{event_id}/participants/{participant_id}` | Body: `rsvp_status?`, `attendance?` | Update RSVP or attendance. |
| `DELETE` | `/events/{event_id}/participants/{participant_id}` | Path IDs | Remove the participant's event registration. |

A public signup flow will probably need a single transactional endpoint that
finds or creates the participant and registers them:

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `POST` | `/public/events/{event_id}/rsvp` | Body: `name`, `contact_number?`, `email?`, `rsvp_status=true` | Public participant RSVP. Rate limiting and duplicate matching are required before production use. |

## Volunteers

Volunteer profile signup status values are `pending`, `approved`, and
`rejected`. This represents the person's overall volunteer onboarding status;
event-specific approval is stored separately on a volunteer signup.

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/volunteers` | Query: `signup_status?`, `skill_id?`, `role_id?`, `q?`, `limit`, `offset` | Search and filter volunteer profiles. |
| `POST` | `/volunteers` | Body: `name`, `contact_number?`, `email?`, `signup_status?` | Create a volunteer profile. |
| `GET` | `/volunteers/{volunteer_id}` | Path ID | Get profile, skills, role interests, and summary counts. |
| `PATCH` | `/volunteers/{volunteer_id}` | Body: `name?`, `contact_number?`, `email?`, `signup_status?` | Update the volunteer or process overall onboarding. |
| `DELETE` | `/volunteers/{volunteer_id}` | Path ID | Delete the volunteer and signup history. Restrict to administrators. |
| `GET` | `/volunteers/{volunteer_id}/events` | Query: `status?`, `attendance?`, `limit`, `offset` | Get signup, role, and attendance history. |

### Skills

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/skills` | Query: `q?`, `limit`, `offset` | List the shared skill catalogue. |
| `POST` | `/skills` | Body: `name` | Create a unique skill. |
| `PATCH` | `/skills/{skill_id}` | Body: `name` | Rename a skill. |
| `DELETE` | `/skills/{skill_id}` | Path ID | Delete a skill and volunteer-skill links. |
| `PUT` | `/volunteers/{volunteer_id}/skills` | Body: `{"skill_ids":[1,4,7]}` | Replace a volunteer's full skill set atomically. |
| `POST` | `/volunteers/{volunteer_id}/skills/{skill_id}` | Path IDs | Add one skill to a volunteer. |
| `DELETE` | `/volunteers/{volunteer_id}/skills/{skill_id}` | Path IDs | Remove one skill from a volunteer. |

## Volunteer roles and interests

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/roles` | Query: `category?`, `is_required?`, `q?`, `limit`, `offset` | List volunteer roles. |
| `POST` | `/roles` | Body: `name`, `category?`, `is_required?` | Create a volunteer role. |
| `GET` | `/roles/{role_id}` | Path ID | Get a volunteer role. |
| `PATCH` | `/roles/{role_id}` | Body: `name?`, `category?`, `is_required?` | Update a volunteer role. |
| `DELETE` | `/roles/{role_id}` | Path ID | Delete an unused role; return `409` when referenced by a signup/template. |
| `GET` | `/volunteers/{volunteer_id}/interests` | None | List roles that interest the volunteer. |
| `PUT` | `/volunteers/{volunteer_id}/interests` | Body: `{"interests":[{"role_id":2,"is_lead":true}]}` | Replace the volunteer's full role-interest list. |
| `POST` | `/volunteers/{volunteer_id}/interests` | Body: `role_id`, `is_lead?` | Add one role interest. |
| `DELETE` | `/volunteers/{volunteer_id}/interests/{role_id}` | Path IDs | Remove one role interest. |

## Event volunteer signups

Event signup status values are `requested`, `approved`, and `rejected`.
`attendance` is nullable until attendance has been recorded.

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/events/{event_id}/volunteer-signups` | Query: `status?`, `role_id?`, `attendance?`, `q?`, `limit`, `offset` | List volunteer requests and assignments for an event. |
| `POST` | `/events/{event_id}/volunteer-signups` | Body: `volunteer_id`, `role_preferences?` | Submit an existing volunteer for the event. A volunteer may sign up once per event. |
| `GET` | `/events/{event_id}/volunteer-signups/{signup_id}` | Path IDs | Get signup, volunteer summary, preferences, and assigned role. |
| `PATCH` | `/events/{event_id}/volunteer-signups/{signup_id}` | Body: `status?`, `assigned_role_id?`, `is_leader?`, `attendance?` | Process the request, assign a role, choose a leader, or record attendance. |
| `DELETE` | `/events/{event_id}/volunteer-signups/{signup_id}` | Path IDs | Withdraw or administratively remove a signup. |
| `POST` | `/events/{event_id}/volunteer-signups/{signup_id}/approve` | Body: `assigned_role_id`, `is_leader?` | Convenience action that approves and assigns the volunteer atomically. |
| `POST` | `/events/{event_id}/volunteer-signups/{signup_id}/reject` | Body: none | Convenience action that rejects the request and clears any assignment. |
| `PUT` | `/events/{event_id}/volunteer-signups/{signup_id}/preferences` | Body: `{"preferences":[{"role_id":3,"priority":1}]}` | Replace ordered role preferences. Priorities must be unique within the signup. |

Public volunteer signup:

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `POST` | `/public/events/{event_id}/volunteer-signups` | Body: volunteer identity fields plus `role_preferences?` | Find/create the volunteer and submit an event request transactionally. Requires duplicate matching and rate limiting before production. |

## Dashboard and calendar read models

These are read-only aggregation endpoints. They keep dashboard-specific SQL out
of the frontend and avoid downloading every event/task/signup to calculate
counts in JavaScript.

| Method | Path | Parameters/body | Description |
| --- | --- | --- | --- |
| `GET` | `/dashboard/summary` | Query: `date_from?`, `date_to?` | Return upcoming event count, total volunteers, pending confirmation count, overdue task count, and tasks due soon. |
| `GET` | `/dashboard/upcoming-deadlines` | Query: `days=14`, `team_member_id?`, `limit?` | Return incomplete/ongoing tasks due within the selected number of days. |
| `GET` | `/calendar/events` | Query: `month=YYYY-MM`, `status?` | Return a lightweight event projection for the monthly calendar. |
| `GET` | `/events/{event_id}/summary` | None | Return event progress, task counts by phase/status, participant counts, volunteer signup counts, and attendance totals. |

Suggested `/events/{event_id}/summary` shape:

```json
{
  "event_id": 12,
  "tasks": {
    "total": 10,
    "done": 6,
    "overdue": 1,
    "by_category": {
      "planning": {"total": 7, "done": 5},
      "execution": {"total": 1, "done": 0},
      "post_execution": {"total": 2, "done": 1}
    }
  },
  "participants": {"rsvp_yes": 45, "attended": 0},
  "volunteers": {"requested": 3, "approved": 12, "rejected": 1}
}
```

## Proposed future endpoints requiring more design

The product plan mentions the following capabilities, but the current database
schema does not yet contain the records needed to implement them safely. These
routes should not be assigned until their data models and permissions are
agreed.

### Inventory and logistics

Likely resources: inventory items, locations, stock movements, event
requirements, reservations, and fulfilment status.

- `GET/POST /inventory/items`
- `GET/PATCH/DELETE /inventory/items/{item_id}`
- `GET/POST /events/{event_id}/logistics-requirements`
- `PATCH/DELETE /events/{event_id}/logistics-requirements/{requirement_id}`
- `POST /events/{event_id}/logistics-requirements/{requirement_id}/allocate`

### Announcements, reminders, and bots

Likely resources: announcements, recipients, delivery attempts, external chat
identities, subscriptions, and message templates. WhatsApp/Telegram webhooks
must validate provider signatures and should not expose internal admin routes.

- `POST /events/{event_id}/announcements`
- `GET /events/{event_id}/announcements`
- `POST /events/{event_id}/reminders`
- `POST /integrations/telegram/webhook`
- `POST /integrations/whatsapp/webhook`
- `POST /public/notification-subscriptions`
- `DELETE /public/notification-subscriptions/{subscription_id}`

### Certificates

Likely resources: certificate templates, generated certificates, eligibility,
and secure download tokens.

- `POST /events/{event_id}/certificates/generate`
- `GET /events/{event_id}/certificates`
- `GET /public/certificates/{download_token}`

### Partner summary

- `GET /events/{event_id}/partner-summary` — stripped-down event projection
- `POST /events/{event_id}/partner-summary-links` — create a revocable share link
- `DELETE /events/{event_id}/partner-summary-links/{link_id}` — revoke access

### AI event copilot

The copilot should suggest actions first and execute only after explicit admin
approval. It needs an audit log and action/proposal schema before implementation.

- `GET /events/{event_id}/copilot/insights`
- `POST /events/{event_id}/copilot/messages`
- `POST /events/{event_id}/copilot/proposals/{proposal_id}/approve`
- `POST /events/{event_id}/copilot/proposals/{proposal_id}/reject`

## Open decisions before implementation

1. Authentication method and permissions for participant, volunteer, organizer,
   administrator, bot, and public access.
2. Whether participant and volunteer profiles can represent the same person or
   should eventually share a common `people`/`users` table.
3. Whether a required volunteer role is global or template-specific. The current
   schema stores `is_required` on `roles`, although requirement is often specific
   to an event template.
4. Whether event tasks can ever be assigned directly to volunteers. The current
   model permits only internal team-member assignment.
5. The plan says “four phases,” but the frontend and schema currently define
   three: planning, execution, and post-execution.
6. Capacity limits, waiting lists, cancellation status, and RSVP states beyond a
   simple boolean.
7. Soft deletion and audit history requirements. Current deletes are permanent.
8. Whether event time, timezone, and event end time should be added; the current
   event record stores only a calendar date.
