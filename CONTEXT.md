# Passion to Serve Event Operations

This context describes how the NGO turns reusable event workflows into scheduled, trackable work.

## Language

**Event Template**:
A reusable workflow containing ordered task definitions whose deadlines are relative to an event date. It may be built in or created by a user.
_Avoid_: Event type, flow

**Event**:
A scheduled instance created from an Event Template, with its own name, date, venue, generated tasks, and assignments.
_Avoid_: Project

**Task**:
A Kanban work item belonging to an Event, with a phase, deadline, status, and optional assignee. A Task can contain Subtasks.
_Avoid_: Activity, card, to-do

**Subtask**:
A checklist item within a Task that shares its parent Task's deadline, status, and assignee.
_Avoid_: Independent task

**Team Member**:
An internal organizer who can be assigned responsibility for an Event Task.
_Avoid_: Volunteer

**Volunteer**:
A participant recruited to help execute an Event; being a Volunteer does not make someone eligible for internal Task assignment.
_Avoid_: Team Member, assignee
