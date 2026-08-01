import { useEffect, useMemo, useState } from "react"
import {
  adminApi,
  type AdminApi,
  type EventDetail,
  type EventTemplate,
} from "./admin-api"
import "./EventOperationsMvp.css"


type Draft = {
  event_template_id: number | null | undefined
  name: string
  event_date: string
  venue: string
}

const emptyDraft: Draft = {
  event_template_id: undefined,
  name: "",
  event_date: "",
  venue: "",
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

export default function AdminEventsPage({ api = adminApi }: { api?: AdminApi }) {
  const [templates, setTemplates] = useState<EventTemplate[]>([])
  const [events, setEvents] = useState<EventDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [showCreator, setShowCreator] = useState(false)
  const [creationStep, setCreationStep] = useState(1)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [creating, setCreating] = useState(false)
  const [openEventId, setOpenEventId] = useState<number | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([api.listEventTemplates(), api.listEvents()])
      .then(([loadedTemplates, loadedEvents]) => {
        if (!active) return
        setTemplates(loadedTemplates)
        setEvents(loadedEvents)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load events.")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api])

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === draft.event_template_id),
    [draft.event_template_id, templates],
  )
  const openEvent = events.find((event) => event.id === openEventId)

  function openCreator() {
    setDraft(emptyDraft)
    setCreationStep(1)
    setError("")
    setShowCreator(true)
  }

  function continueCreation() {
    if (creationStep === 1 && draft.event_template_id !== undefined) {
      setCreationStep(2)
      return
    }
    if (creationStep === 2) {
      if (!draft.name.trim() || !draft.event_date || !draft.venue.trim()) {
        setError("Enter an Event name, date, and venue.")
        return
      }
      setError("")
      setCreationStep(3)
    }
  }

  async function createEvent() {
    setCreating(true)
    setError("")
    try {
      const event = await api.createEvent({
        event_template_id: draft.event_template_id ?? null,
        name: draft.name.trim(),
        venue: draft.venue.trim(),
        event_date: draft.event_date,
      })
      setEvents((current) => [...current, event].sort((a, b) => a.event_date.localeCompare(b.event_date)))
      setShowCreator(false)
      setMessage(
        event.event_template_id === null
          ? "Event created from scratch. Add Tasks when you are ready."
          : "Event created from its Event Template.",
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create Event.")
    } finally {
      setCreating(false)
    }
  }

  async function updateTaskStatus(event: EventDetail, taskId: number, status: "incomplete" | "ongoing" | "done") {
    const task = event.tasks.find((item) => item.id === taskId)
    if (!task || task.status === status) return
    try {
      const updated = await api.updateEventTask(event.id, task.id, { status })
      setEvents((current) => current.map((item) => item.id === event.id
        ? { ...item, tasks: item.tasks.map((candidate) => candidate.id === updated.id ? updated : candidate) }
        : item))
      setMessage(`Task ${status === "ongoing" ? "started" : status === "done" ? "completed" : "reopened"}: ${task.name}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update Task.")
    }
  }

  function changeTaskStatus(event: EventDetail, taskId: number) {
    const task = event.tasks.find((item) => item.id === taskId)
    if (!task) return
    const status = task.status === "incomplete"
      ? "ongoing"
      : task.status === "ongoing"
        ? "done"
        : "incomplete"
    void updateTaskStatus(event, taskId, status)
  }

  if (loading) return <p role="status">Loading organizer events…</p>

  return (
    <section className="events-page">
      <div className={`dashboard-shell event-operations-page api-event-operations-page${openEvent ? " workspace-open" : ""}`}>
        <header className="section-hero">
          <p>Event operations</p>
          <h1>Event portfolio</h1>
          <span>Plan reusable workflows or begin with an empty Event.</span>
        </header>
        <p aria-live="polite" className="event-operations-feedback">
          {message || error}
        </p>
        {openEvent ? (<>
          <button aria-label="Back to Events" className="event-workspace-back api-event-workspace-back" type="button" onClick={() => setOpenEventId(null)}>← Back to Events</button>
          <section aria-label={openEvent.name} className="event-operations-workspace api-event-workspace">
            <header className="api-event-workspace-header">
              <div>
                <p>Event workspace</p>
                <h2>{openEvent.name}</h2>
              </div>
              <span className={`api-event-status ${openEvent.status}`}>{openEvent.status === "closed" ? "Closed" : "Open"}</span>
            </header>
            <dl aria-label="Event details" className="api-event-metadata">
              <div><dt>Date</dt><dd>{formatDate(openEvent.event_date)}</dd></div>
              <div><dt>Venue</dt><dd>{openEvent.venue}</dd></div>
              <div><dt>Tasks</dt><dd>{openEvent.tasks.length}</dd></div>
            </dl>
            {openEvent.status === "closed" && <p className="event-operations-closed-notice">Closed Events are read-only. The Task history is kept for reference.</p>}
            <h3>Task workspace</h3>
            <div className="event-operations-kanban">
              {(["incomplete", "ongoing", "done"] as const).map((status) => {
                const tasks = openEvent.tasks.filter((task) => task.status === status)
                const label = status === "incomplete" ? "To do" : status === "ongoing" ? "In progress" : "Done"
                return (
                  <section
                    aria-label={`${label} Tasks`}
                    className={`event-operations-kanban-column${dragOverStatus === status ? " drag-over" : ""}`}
                    key={status}
                    onDragOver={(dragEvent) => {
                      if (openEvent.status !== "open") return
                      dragEvent.preventDefault()
                      if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = "move"
                      setDragOverStatus(status)
                    }}
                    onDragLeave={() => setDragOverStatus((current) => current === status ? null : current)}
                    onDrop={(dropEvent) => {
                      if (openEvent.status !== "open") return
                      dropEvent.preventDefault()
                      const transferredId = Number(dropEvent.dataTransfer?.getData("text/plain"))
                      const taskId = transferredId || draggedTaskId
                      setDraggedTaskId(null)
                      setDragOverStatus(null)
                      if (taskId !== null) void updateTaskStatus(openEvent, taskId, status)
                    }}
                  >
                    <h4><span>{label}</span><span className="api-kanban-count">{tasks.length}</span></h4>
                    {!tasks.length && <p className="api-kanban-empty">No Tasks</p>}
                    {tasks.map((task) => (
                      <article
                        className={`event-operations-task-card${openEvent.status === "open" ? " draggable" : ""}${draggedTaskId === task.id ? " dragging" : ""}`}
                        draggable={openEvent.status === "open"}
                        key={task.id}
                        onDragEnd={() => {
                          setDraggedTaskId(null)
                          setDragOverStatus(null)
                        }}
                        onDragStart={(dragEvent) => {
                          if (openEvent.status !== "open") return
                          setDraggedTaskId(task.id)
                          if (dragEvent.dataTransfer) {
                            dragEvent.dataTransfer.effectAllowed = "move"
                            dragEvent.dataTransfer.setData("text/plain", String(task.id))
                          }
                        }}
                        title={openEvent.status === "open" ? "Drag this Task to another status" : undefined}
                      >
                        <div className="event-operations-card-heading">
                          <span className={`event-operations-phase event-operations-phase-${task.category.replace("_", "-")}`}>{task.category.replace("_", " ")}</span>
                          <span className="event-operations-task-date">{formatDate(task.due_at.slice(0, 10))}</span>
                        </div>
                        <strong className="event-operations-task-title">{task.name}</strong>
                        {openEvent.status === "open" && (
                          <div className="event-operations-task-actions">
                            <button type="button" onClick={() => changeTaskStatus(openEvent, task.id)}>{task.status === "incomplete" ? "Start task" : task.status === "ongoing" ? "Mark done" : "Reopen task"}</button>
                          </div>
                        )}
                      </article>
                    ))}
                  </section>
                )
              })}
            </div>
            {!openEvent.tasks.length && <p>No Tasks yet. This Event was started from scratch.</p>}
          </section>
        </>
        ) : <>
        <div className="event-operations-collection-heading">
          <div>
            <h2>Events</h2>
            <span>{events.length} scheduled Events</span>
          </div>
          <button type="button" onClick={openCreator}>New Event</button>
        </div>
        <div className="event-operations-template-list">
          {events.map((event) => (
            <article key={event.id}>
              <div>
                <strong>{event.name}</strong>
                <span>{formatDate(event.event_date)} · {event.venue}</span>
                <p>{event.tasks.length} Tasks · {event.status === "closed" ? "Closed" : "Open"}</p>
              </div>
              <button aria-label={`Open ${event.name}`} type="button" onClick={() => setOpenEventId(event.id)}>Open workspace</button>
            </article>
          ))}
          {!events.length && <p>No Events yet. Create the first one.</p>}
        </div>

        <section className="event-operations-library" aria-labelledby="api-template-title">
          <div>
            <p>Event Templates</p>
            <h2 id="api-template-title">Reusable workflows</h2>
            <span>Loaded from the organizer API.</span>
          </div>
        </section>
        <div className="event-operations-template-list">
          {templates.map((template) => (
            <article key={template.id}>
              <div>
                <strong>{template.name}</strong>
                <span>{template.is_built_in ? "Built-in" : "Custom"} · {template.tasks.length} Tasks</span>
                <p>{template.description}</p>
              </div>
            </article>
          ))}
        </div>
        </>}

        {showCreator && (
          <div className="event-creation-overlay" role="presentation">
            <section aria-labelledby="api-new-event-title" aria-modal="true" className="event-creation-dialog" role="dialog">
              <header>
                <div><p>New Event</p><h2 id="api-new-event-title">Create an Event</h2></div>
                <button aria-label="Cancel Event creation" className="event-creation-close" type="button" onClick={() => setShowCreator(false)}>×</button>
              </header>
              <ol className="event-creation-steps">
                <li className={creationStep === 1 ? "active" : creationStep > 1 ? "done" : ""}><span>1</span>Starting point</li>
                <li className={creationStep === 2 ? "active" : creationStep > 2 ? "done" : ""}><span>2</span>Event details</li>
                <li className={creationStep === 3 ? "active" : ""}><span>3</span>Review plan</li>
              </ol>
              {creationStep === 1 && (
                <div className="event-creation-body">
                  <header><p>Step 1 of 3</p><h2>Choose how to begin</h2><span>Use a proven workflow or build the Task plan yourself.</span></header>
                  <div className="event-creation-templates">
                    <button aria-label="Start from scratch" className={draft.event_template_id === null ? "selected" : ""} type="button" onClick={() => setDraft({ ...draft, event_template_id: null })}>
                      <span>Empty plan</span><strong>Start from scratch</strong><small>Create the Event now and add Tasks in its workspace.</small><em>0 Tasks</em>
                    </button>
                    {templates.map((template) => (
                      <button className={draft.event_template_id === template.id ? "selected" : ""} key={template.id} type="button" onClick={() => setDraft({ ...draft, event_template_id: template.id })}>
                        <span>{template.is_built_in ? "Built-in" : "Custom"}</span><strong>{template.name}</strong><small>{template.description}</small><em>{template.tasks.length} Tasks</em>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {creationStep === 2 && (
                <div className="event-creation-body">
                  <header><p>Step 2 of 3</p><h2>Give this Event its details</h2><span>{selectedTemplate?.name ?? "An empty plan"} will be used as the starting point.</span></header>
                  <div className="event-creation-fields">
                    <label>Event name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                    <label>Event date<input type="date" value={draft.event_date} onChange={(event) => setDraft({ ...draft, event_date: event.target.value })} /></label>
                    <label>Venue<input value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} /></label>
                  </div>
                </div>
              )}
              {creationStep === 3 && (
                <div className="event-creation-body">
                  <header><p>Step 3 of 3</p><h2>Review the plan</h2><span>{selectedTemplate?.name ?? "Started from scratch"}</span></header>
                  {selectedTemplate?.tasks.length ? (
                    <div className="event-creation-plan">{selectedTemplate.tasks.slice(0, 5).map((task) => <article className="event-creation-plan-task" key={task.id}><strong>{task.name}</strong><small>{task.relative_due_days} days relative to Event</small></article>)}</div>
                  ) : <p>No Tasks yet</p>}
                </div>
              )}
              <footer>
                <button type="button" disabled={creationStep === 1} onClick={() => setCreationStep((step) => step - 1)}>Back</button>
                {creationStep < 3 ? <button type="button" disabled={creationStep === 1 && draft.event_template_id === undefined} onClick={continueCreation}>Continue</button> : <button type="button" disabled={creating} onClick={createEvent}>{creating ? "Creating…" : "Create event"}</button>}
              </footer>
            </section>
          </div>
        )}
      </div>
    </section>
  )
}
