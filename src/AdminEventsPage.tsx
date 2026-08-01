import { useEffect, useMemo, useState } from "react"
import {
  adminApi,
  type AdminApi,
  type EventDetail,
  type EventTask,
  type EventTemplate,
  type TaskCategory,
  type TeamMember,
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

type EventDialog = "edit" | "reschedule" | "close" | "delete" | null
type TaskDraft = {
  name: string
  body: string
  due_at: string
  category: TaskCategory
  team_member_id: string
}

const emptyTaskDraft: TaskDraft = {
  name: "",
  body: "",
  due_at: "",
  category: "planning",
  team_member_id: "",
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

export default function AdminEventsPage({ api = adminApi, initialEventId = null }: { api?: AdminApi; initialEventId?: number | null }) {
  const [templates, setTemplates] = useState<EventTemplate[]>([])
  const [events, setEvents] = useState<EventDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [showCreator, setShowCreator] = useState(false)
  const [creationStep, setCreationStep] = useState(1)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [creating, setCreating] = useState(false)
  const [openEventId, setOpenEventId] = useState<number | null>(initialEventId)
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [eventDialog, setEventDialog] = useState<EventDialog>(null)
  const [eventForm, setEventForm] = useState({ name: "", venue: "", event_date: "", shift_task_deadlines: true, delete_name: "" })
  const [editingTaskId, setEditingTaskId] = useState<number | "new" | null>(null)
  const [taskForm, setTaskForm] = useState<TaskDraft>(emptyTaskDraft)
  const [subtaskTitles, setSubtaskTitles] = useState<Record<number, string>>({})
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("")
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false)
  const [confirmDeleteSubtaskId, setConfirmDeleteSubtaskId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    const membersRequest = api.listTeamMembers ? api.listTeamMembers() : Promise.resolve([])
    Promise.all([api.listEventTemplates(), api.listEvents(), membersRequest])
      .then(([loadedTemplates, loadedEvents, loadedMembers]) => {
        if (!active) return
        setTemplates(loadedTemplates)
        setEvents(loadedEvents)
        setTeamMembers(loadedMembers)
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
  const editingTask = openEvent && typeof editingTaskId === "number"
    ? openEvent.tasks.find((task) => task.id === editingTaskId)
    : undefined
  const completedTaskCount = openEvent?.tasks.filter((task) => task.status === "done").length ?? 0
  const eventCompletionPercent = openEvent?.tasks.length
    ? Math.round((completedTaskCount / openEvent.tasks.length) * 100)
    : 0

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

  function replaceEvent(updated: EventDetail) {
    setEvents((current) => current
      .map((event) => event.id === updated.id ? updated : event)
      .sort((a, b) => a.event_date.localeCompare(b.event_date)))
  }

  function replaceTask(eventId: number, updated: EventTask) {
    setEvents((current) => current.map((event) => event.id === eventId
      ? { ...event, tasks: event.tasks.map((task) => task.id === updated.id ? updated : task) }
      : event))
  }

  function openEventDialog(mode: Exclude<EventDialog, null>, event: EventDetail) {
    setError("")
    setEventForm({
      name: event.name,
      venue: event.venue,
      event_date: event.event_date,
      shift_task_deadlines: true,
      delete_name: "",
    })
    setEventDialog(mode)
  }

  async function saveEventDetails(event: EventDetail) {
    if (!eventForm.name.trim() || !eventForm.venue.trim()) {
      setError("Enter an Event name and venue.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const updated = await api.updateEvent(event.id, { name: eventForm.name.trim(), venue: eventForm.venue.trim() })
      replaceEvent(updated)
      setEventDialog(null)
      setMessage("Event details updated.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update Event.")
    } finally {
      setSaving(false)
    }
  }

  async function reschedule(event: EventDetail) {
    if (!eventForm.event_date) {
      setError("Choose a new Event date.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const updated = await api.rescheduleEvent(event.id, {
        event_date: eventForm.event_date,
        shift_task_deadlines: eventForm.shift_task_deadlines,
      })
      replaceEvent(updated)
      setEventDialog(null)
      setMessage("Event rescheduled.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reschedule Event.")
    } finally {
      setSaving(false)
    }
  }

  async function changeEventStatus(event: EventDetail, next: "open" | "closed") {
    setSaving(true)
    setError("")
    try {
      const updated = next === "closed" ? await api.closeEvent(event.id) : await api.reopenEvent(event.id)
      replaceEvent(updated)
      setEventDialog(null)
      setMessage(next === "closed" ? "Event closed." : "Event reopened.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update Event status.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteEvent(event: EventDetail) {
    setSaving(true)
    setError("")
    try {
      await api.deleteEvent(event.id)
      setEvents((current) => current.filter((candidate) => candidate.id !== event.id))
      setOpenEventId(null)
      setEventDialog(null)
      setMessage(`Deleted ${event.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete Event.")
    } finally {
      setSaving(false)
    }
  }

  function openTaskEditor(task?: EventTask) {
    setError("")
    setConfirmDeleteTask(false)
    setConfirmDeleteSubtaskId(null)
    setNewSubtaskTitle("")
    if (!task) {
      setEditingTaskId("new")
      setTaskForm(emptyTaskDraft)
      setSubtaskTitles({})
      return
    }
    setEditingTaskId(task.id)
    setTaskForm({
      name: task.name,
      body: task.body,
      due_at: task.due_at.slice(0, 10),
      category: task.category,
      team_member_id: task.team_member_id === null ? "" : String(task.team_member_id),
    })
    setSubtaskTitles(Object.fromEntries(task.subtasks.map((subtask) => [subtask.id, subtask.title])))
  }

  async function saveTask(event: EventDetail) {
    if (!taskForm.name.trim() || !taskForm.due_at) {
      setError("Enter a Task name and due date.")
      return
    }
    const input = {
      name: taskForm.name.trim(),
      body: taskForm.body,
      due_at: taskForm.due_at,
      category: taskForm.category,
      team_member_id: taskForm.team_member_id ? Number(taskForm.team_member_id) : null,
    }
    setSaving(true)
    setError("")
    try {
      if (editingTaskId === "new") {
        const created = await api.createEventTask(event.id, input)
        setEvents((current) => current.map((candidate) => candidate.id === event.id
          ? { ...candidate, tasks: [...candidate.tasks, created] }
          : candidate))
        setEditingTaskId(created.id)
        setSubtaskTitles({})
        setMessage("Task created. You can now add checklist items.")
      } else if (typeof editingTaskId === "number") {
        const updated = await api.updateEventTask(event.id, editingTaskId, input)
        replaceTask(event.id, updated)
        setMessage("Task updated.")
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save Task.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteTask(event: EventDetail, taskId: number) {
    setSaving(true)
    setError("")
    try {
      await api.deleteEventTask(event.id, taskId)
      setEvents((current) => current.map((candidate) => candidate.id === event.id
        ? { ...candidate, tasks: candidate.tasks.filter((task) => task.id !== taskId) }
        : candidate))
      setEditingTaskId(null)
      setMessage("Task deleted.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete Task.")
    } finally {
      setSaving(false)
    }
  }

  async function addSubtask(event: EventDetail, task: EventTask) {
    if (!newSubtaskTitle.trim()) return
    setSaving(true)
    setError("")
    try {
      const created = await api.createEventSubtask(event.id, task.id, { title: newSubtaskTitle.trim() })
      const updated = { ...task, subtasks: [...task.subtasks, created] }
      replaceTask(event.id, updated)
      setSubtaskTitles((current) => ({ ...current, [created.id]: created.title }))
      setNewSubtaskTitle("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add checklist item.")
    } finally {
      setSaving(false)
    }
  }

  async function updateSubtask(event: EventDetail, task: EventTask, subtaskId: number, changes: { title?: string; completed?: boolean }) {
    setSaving(true)
    setError("")
    try {
      const updatedSubtask = await api.updateEventSubtask(event.id, task.id, subtaskId, changes)
      replaceTask(event.id, { ...task, subtasks: task.subtasks.map((subtask) => subtask.id === subtaskId ? updatedSubtask : subtask) })
      setSubtaskTitles((current) => ({ ...current, [subtaskId]: updatedSubtask.title }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update checklist item.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteSubtask(event: EventDetail, task: EventTask, subtaskId: number) {
    setSaving(true)
    setError("")
    try {
      await api.deleteEventSubtask(event.id, task.id, subtaskId)
      replaceTask(event.id, { ...task, subtasks: task.subtasks.filter((subtask) => subtask.id !== subtaskId) })
      setConfirmDeleteSubtaskId(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete checklist item.")
    } finally {
      setSaving(false)
    }
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
              <div className="api-event-header-actions">
                <span className={`api-event-status ${openEvent.status}`}>{openEvent.status === "closed" ? "Closed" : "Open"}</span>
                {openEvent.status === "open" ? (<>
                  <button type="button" onClick={() => openEventDialog("edit", openEvent)}>Edit details</button>
                  <button type="button" onClick={() => openEventDialog("reschedule", openEvent)}>Reschedule</button>
                  <button type="button" onClick={() => openEventDialog("close", openEvent)}>Close Event</button>
                </>) : <button type="button" onClick={() => void changeEventStatus(openEvent, "open")}>Reopen Event</button>}
                <button className="api-danger-button" type="button" onClick={() => openEventDialog("delete", openEvent)}>Delete Event</button>
              </div>
            </header>
            {(message || error) && <p aria-live="polite" className={`api-workspace-feedback${error ? " error" : ""}`}>{error || message}</p>}
            <dl aria-label="Event details" className="api-event-metadata">
              <div><dt>Date</dt><dd>{formatDate(openEvent.event_date)}</dd></div>
              <div><dt>Venue</dt><dd>{openEvent.venue}</dd></div>
              <div><dt>Tasks</dt><dd>{openEvent.tasks.length}</dd></div>
            </dl>
            {openEvent.status === "closed" && <p className="event-operations-closed-notice">Closed Events are read-only. The Task history is kept for reference.</p>}
            <div className="api-event-workspace-body">
              <div className="api-event-workspace-main">
                <div className="api-task-workspace-heading">
                  <h3>Task workspace</h3>
                  {openEvent.status === "open" && <button type="button" onClick={() => openTaskEditor()}>Add Task</button>}
                </div>
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
                    {tasks.map((task) => {
                      const completedSubtaskCount = task.subtasks.filter((subtask) => subtask.completed).length
                      const subtaskCompletionPercent = task.subtasks.length
                        ? Math.round((completedSubtaskCount / task.subtasks.length) * 100)
                        : 0
                      return (
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
                        <span className="api-task-assignee">{task.team_member_id === null ? "Unassigned" : teamMembers.find((member) => member.id === task.team_member_id)?.name ?? `Team member ${task.team_member_id}`}</span>
                        {task.subtasks.length > 0 && <div className="event-operations-progress api-subtask-progress">
                          <span>{completedSubtaskCount} of {task.subtasks.length} Subtasks complete</span>
                          <i aria-label={`${task.name} Subtask completion`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={subtaskCompletionPercent} role="progressbar"><b style={{ width: `${subtaskCompletionPercent}%` }} /></i>
                        </div>}
                        {openEvent.status === "open" && (
                          <div className="event-operations-task-actions">
                            <button type="button" onClick={() => changeTaskStatus(openEvent, task.id)}>{task.status === "incomplete" ? "Start task" : task.status === "ongoing" ? "Mark done" : "Reopen task"}</button>
                            <button aria-label={`Edit ${task.name}`} type="button" onClick={() => openTaskEditor(task)}>Edit</button>
                          </div>
                        )}
                        </article>
                      )
                    })}
                      </section>
                    )
                  })}
                </div>
                {!openEvent.tasks.length && <p>No Tasks yet. This Event was started from scratch.</p>}
              </div>
              <aside aria-label="Event progress" className="api-event-progress-panel">
                <p>Plan completion</p>
                <strong>{eventCompletionPercent}%</strong>
                <span>{completedTaskCount} of {openEvent.tasks.length} Tasks complete</span>
                <i aria-label="Event completion" aria-valuemax={100} aria-valuemin={0} aria-valuenow={eventCompletionPercent} role="progressbar"><b style={{ width: `${eventCompletionPercent}%` }} /></i>
                <dl>
                  <div><dt>To do</dt><dd>{openEvent.tasks.filter((task) => task.status === "incomplete").length}</dd></div>
                  <div><dt>In progress</dt><dd>{openEvent.tasks.filter((task) => task.status === "ongoing").length}</dd></div>
                  <div><dt>Done</dt><dd>{completedTaskCount}</dd></div>
                </dl>
                {openEvent.status === "open" && <p className="api-event-progress-help">Use <strong>Edit</strong> on a Task to update its details and Subtasks.</p>}
              </aside>
            </div>
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

        {openEvent && eventDialog && (
          <div className="event-creation-overlay" role="presentation">
            <section aria-labelledby="event-action-title" aria-modal="true" className="event-creation-dialog api-action-dialog" role="dialog">
              <header>
                <div><p>Event action</p><h2 id="event-action-title">{eventDialog === "edit" ? "Edit Event details" : eventDialog === "reschedule" ? "Reschedule Event" : eventDialog === "close" ? "Close Event" : "Delete Event"}</h2></div>
                <button aria-label="Cancel Event action" className="event-creation-close" type="button" onClick={() => setEventDialog(null)}>×</button>
              </header>
              <div className="event-creation-body api-action-body">
                {eventDialog === "edit" && <div className="event-creation-fields">
                  <label>Event name<input value={eventForm.name} onChange={(input) => setEventForm({ ...eventForm, name: input.target.value })} /></label>
                  <label>Venue<input value={eventForm.venue} onChange={(input) => setEventForm({ ...eventForm, venue: input.target.value })} /></label>
                </div>}
                {eventDialog === "reschedule" && <div className="event-creation-fields">
                  <label>New Event date<input type="date" value={eventForm.event_date} onChange={(input) => setEventForm({ ...eventForm, event_date: input.target.value })} /></label>
                  <label className="api-checkbox-field"><input checked={eventForm.shift_task_deadlines} type="checkbox" onChange={(input) => setEventForm({ ...eventForm, shift_task_deadlines: input.target.checked })} /> Shift Task deadlines by the same number of days</label>
                </div>}
                {eventDialog === "close" && <p>Closing this Event makes its details and Tasks read-only until it is reopened.</p>}
                {eventDialog === "delete" && <div className="event-creation-fields">
                  <p className="api-danger-notice">This permanently deletes the Event, Tasks, checklists, registrations, and volunteer signups.</p>
                  <label>Type {openEvent.name} to confirm<input aria-label="Confirm Event name" value={eventForm.delete_name} onChange={(input) => setEventForm({ ...eventForm, delete_name: input.target.value })} /></label>
                </div>}
                {error && <p className="event-creation-error" role="alert">{error}</p>}
              </div>
              <footer>
                <button type="button" onClick={() => setEventDialog(null)}>Cancel</button>
                {eventDialog === "edit" && <button disabled={saving} type="button" onClick={() => void saveEventDetails(openEvent)}>Save changes</button>}
                {eventDialog === "reschedule" && <button disabled={saving} type="button" onClick={() => void reschedule(openEvent)}>Reschedule Event</button>}
                {eventDialog === "close" && <button disabled={saving} type="button" onClick={() => void changeEventStatus(openEvent, "closed")}>Confirm close</button>}
                {eventDialog === "delete" && <button className="api-delete-confirm" disabled={saving || eventForm.delete_name !== openEvent.name} type="button" onClick={() => void deleteEvent(openEvent)}>Delete permanently</button>}
              </footer>
            </section>
          </div>
        )}

        {openEvent && editingTaskId !== null && (
          <div className="event-creation-overlay" role="presentation">
            <section aria-labelledby="task-editor-title" aria-modal="true" className="event-creation-dialog api-task-dialog" role="dialog">
              <header>
                <div><p>Task editor</p><h2 id="task-editor-title">{editingTaskId === "new" ? "Add Task" : `Edit ${editingTask?.name ?? "Task"}`}</h2></div>
                <button aria-label="Close Task editor" className="event-creation-close" type="button" onClick={() => setEditingTaskId(null)}>×</button>
              </header>
              <div className="event-creation-body api-task-editor-body">
                <div className="api-task-fields">
                  <label>Task name<input value={taskForm.name} onChange={(input) => setTaskForm({ ...taskForm, name: input.target.value })} /></label>
                  <label>Due date<input type="date" value={taskForm.due_at} onChange={(input) => setTaskForm({ ...taskForm, due_at: input.target.value })} /></label>
                  <label>Category<select value={taskForm.category} onChange={(input) => setTaskForm({ ...taskForm, category: input.target.value as TaskCategory })}><option value="planning">Planning</option><option value="execution">Execution</option><option value="post_execution">Post execution</option></select></label>
                  <label>Assignee<select value={taskForm.team_member_id} onChange={(input) => setTaskForm({ ...taskForm, team_member_id: input.target.value })}><option value="">Unassigned</option>{teamMembers.map((member) => <option disabled={!member.is_active && String(member.id) !== taskForm.team_member_id} key={member.id} value={member.id}>{member.name}{member.is_active ? "" : " (inactive)"}</option>)}</select></label>
                  <label className="api-task-body-field">Description<textarea rows={4} value={taskForm.body} onChange={(input) => setTaskForm({ ...taskForm, body: input.target.value })} /></label>
                </div>
                {editingTask && <section aria-labelledby="task-checklist-title" className="api-task-checklist">
                  <h3 id="task-checklist-title">Checklist</h3>
                  {editingTask.subtasks.map((subtask) => <div className="api-subtask-row" key={subtask.id}>
                    <input aria-label={`Complete ${subtask.title}`} checked={subtask.completed} type="checkbox" onChange={() => void updateSubtask(openEvent, editingTask, subtask.id, { completed: !subtask.completed })} />
                    <input aria-label={`Checklist item ${subtask.id}`} value={subtaskTitles[subtask.id] ?? subtask.title} onChange={(input) => setSubtaskTitles({ ...subtaskTitles, [subtask.id]: input.target.value })} />
                    <button disabled={saving || !(subtaskTitles[subtask.id] ?? "").trim()} type="button" onClick={() => void updateSubtask(openEvent, editingTask, subtask.id, { title: subtaskTitles[subtask.id].trim() })}>Save</button>
                    {confirmDeleteSubtaskId === subtask.id ? <><button className="api-danger-button" type="button" onClick={() => void deleteSubtask(openEvent, editingTask, subtask.id)}>Confirm delete</button><button type="button" onClick={() => setConfirmDeleteSubtaskId(null)}>Cancel</button></> : <button type="button" onClick={() => setConfirmDeleteSubtaskId(subtask.id)}>Delete</button>}
                  </div>)}
                  {!editingTask.subtasks.length && <p>No checklist items yet.</p>}
                  <div className="api-add-subtask"><input aria-label="New checklist item" placeholder="Add a checklist item" value={newSubtaskTitle} onChange={(input) => setNewSubtaskTitle(input.target.value)} /><button disabled={saving || !newSubtaskTitle.trim()} type="button" onClick={() => void addSubtask(openEvent, editingTask)}>Add item</button></div>
                </section>}
                {editingTaskId === "new" && <p className="api-editor-note">Save the Task first, then add checklist items here.</p>}
                {error && <p className="event-creation-error" role="alert">{error}</p>}
                {editingTask && (confirmDeleteTask ? <div className="api-delete-task-confirm"><span>Delete this Task and its checklist?</span><button className="api-danger-button" type="button" onClick={() => void deleteTask(openEvent, editingTask.id)}>Confirm delete Task</button><button type="button" onClick={() => setConfirmDeleteTask(false)}>Cancel</button></div> : <button className="api-task-delete-button" type="button" onClick={() => setConfirmDeleteTask(true)}>Delete Task</button>)}
              </div>
              <footer><button type="button" onClick={() => setEditingTaskId(null)}>Close</button><button disabled={saving} type="button" onClick={() => void saveTask(openEvent)}>{editingTaskId === "new" ? "Create Task" : "Save Task"}</button></footer>
            </section>
          </div>
        )}
      </div>
    </section>
  )
}
