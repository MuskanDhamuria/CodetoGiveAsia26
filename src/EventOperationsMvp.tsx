import { FormEvent, useState } from "react"
import {
  createInMemoryEventOperations,
  type Event,
  type EventOperations,
} from "./event-operations"
import "./EventOperationsMvp.css"

function EventWorkspace({
  event,
  operations,
  onEventChanged,
}: {
  event: Event
  operations: EventOperations
  onEventChanged: (event: Event) => void
}) {
  const headingId = `event-workspace-title-${event.id}`

  function startTask(taskId: string) {
    operations.startTask({ eventId: event.id, taskId })
    onEventChanged(operations.getEvent(event.id)!)
  }

  return (
    <section
      aria-labelledby={headingId}
      className="event-operations-workspace"
    >
      <p>Event workspace</p>
      <h2 id={headingId}>{event.name}</h2>
      <span>
        {event.date} · {event.venue}
      </span>
      <p>From {event.sourceTemplateName}</p>
      <h3>Auto-generated plan</h3>
      <div className="event-operations-task-list">
        {event.tasks.map((task) => (
          <article key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <span>
                {task.phase} · Due {task.deadline}
              </span>
            </div>
            <span className="event-operations-status">{task.status}</span>
            {task.status === "To do" && (
              <button type="button" onClick={() => startTask(task.id)}>
                Start task
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

export default function EventOperationsMvp() {
  const [operations] = useState<EventOperations>(() =>
    createInMemoryEventOperations(),
  )
  const [events, setEvents] = useState<Event[]>(() => operations.listEvents())
  const [showCreator, setShowCreator] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)

  function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    if (!draftId) return
    operations.updateEventDraft(draftId, {
      name: String(values.get("name")),
      date: String(values.get("date")),
      venue: String(values.get("venue")),
    })
    operations.createEventFromDraft(draftId)
    setEvents(operations.listEvents())
    setShowCreator(false)
    setDraftId(null)
  }

  function openCreator() {
    const draft = operations.createEventDraft("distribution-of-pre-loved-items")
    setDraftId(draft.id)
    setShowCreator(true)
  }

  function cancelCreator() {
    if (draftId) operations.discardEventDraft(draftId)
    setDraftId(null)
    setShowCreator(false)
  }

  return (
    <section className="events-page">
      <div className="dashboard-shell event-operations-page">
        <header className="section-hero">
          <p>Event operations</p>
          <h1>Plan the work behind every Event</h1>
          <span>
            Create a scheduled Event from a reusable workflow, then start its
            Tasks.
          </span>
        </header>

        <section
          className="event-operations-library"
          aria-labelledby="template-library-title"
        >
          <div>
            <p>Built-in Event Template</p>
            <h2 id="template-library-title">Distribution of pre-loved items</h2>
            <span>12 Tasks · 8-week planning horizon</span>
          </div>
          <button type="button" onClick={openCreator}>
            New event
          </button>
        </section>

        {showCreator && (
          <form className="event-operations-creator" onSubmit={createEvent}>
            <h2>Create from Distribution of pre-loved items</h2>
            <label>
              Event name
              <input
                defaultValue="August community distribution"
                name="name"
                required
              />
            </label>
            <label>
              Event date
              <input
                defaultValue="2027-08-09"
                name="date"
                required
                type="date"
              />
            </label>
            <label>
              Venue
              <input
                defaultValue="Marina Bay Community Plaza"
                name="venue"
                required
              />
            </label>
            <div>
              <button type="button" onClick={cancelCreator}>
                Cancel
              </button>
              <button type="submit">Create event</button>
            </div>
          </form>
        )}

        {events.length === 0 ? (
          <section className="event-operations-empty">
            <h2>No Events yet</h2>
            <p>
              Create your first Event from the built-in Distribution of
              pre-loved items Event Template.
            </p>
          </section>
        ) : (
          events.map((event) => (
            <EventWorkspace
              event={event}
              key={event.id}
              operations={operations}
              onEventChanged={(updatedEvent) =>
                setEvents((current) =>
                  current.map((item) =>
                    item.id === updatedEvent.id ? updatedEvent : item,
                  ),
                )
              }
            />
          ))
        )}
      </div>
    </section>
  )
}
