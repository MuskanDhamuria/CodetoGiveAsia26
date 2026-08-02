import { FormEvent, useMemo, useRef, useState } from "react"
import {
  createInMemoryEventOperations,
  eventsForCollection,
  type Event,
  type EventDraft,
  type EventOperations,
  type EventPhase,
  type EventTask,
  type EventTemplate,
  type TemplateTaskInput,
} from "./event-operations"
import EventCollectionPrototype from "./EventCollectionPrototype"
import "./EventOperationsMvp.css"

const phases: EventPhase[] = ["Planning", "Execution", "Post-execution"]

type EditableTask = Omit<TemplateTaskInput, "relativeDeadlineDays"> & {
  key: number
  relativeDeadlineDays: string
  subtasks: string
}

function newEditableTask(): EditableTask {
  return {
    key: Date.now(),
    title: "",
    phase: "Planning",
    relativeDeadlineDays: "-7",
    subtaskTitles: [],
    subtasks: "",
  }
}

function relativeDeadlineLabel(days: number) {
  if (days === 0) return "Event day"
  const count = Math.abs(days)
  return `${count} day${count === 1 ? "" : "s"} ${days < 0 ? "before" : "after"} Event`
}

function taskDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("en-SG", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(parsed)
}

function offsetForDate(eventDate: string, deadline: string) {
  if (!eventDate || !deadline) return null
  const start = Date.parse(`${eventDate}T00:00:00Z`)
  const end = Date.parse(`${deadline}T00:00:00Z`)
  return Number.isNaN(start) || Number.isNaN(end)
    ? null
    : Math.round((end - start) / 86_400_000)
}

function EventWorkspace({
  event,
  operations,
  onEventChanged,
  onDeleted,
  onMessage,
}: {
  event: Event
  operations: EventOperations
  onEventChanged: (event: Event) => void
  onDeleted: () => void
  onMessage: (message: string) => void
}) {
  const [showNewTask, setShowNewTask] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    cancelLabel: string
    confirmLabel: string
    onConfirm: () => void
  } | null>(null)
  const [newTask, setNewTask] = useState({
    title: "",
    phase: "Planning" as EventPhase,
    deadline: event.date,
  })
  const teamMembers = operations.listTeamMembers()
  const updateTask = (task: EventTask, changes: Partial<EventTask>) => {
    try {
      operations.updateEventTask({
        eventId: event.id,
        taskId: task.id,
        title: changes.title ?? task.title,
        phase: changes.phase ?? task.phase,
        deadline: changes.deadline ?? task.deadline,
        assigneeId:
          changes.assigneeId === undefined ? task.assigneeId : changes.assigneeId,
        subtasks: changes.subtasks ?? task.subtasks,
      })
      onEventChanged(operations.getEvent(event.id)!)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update Task.")
    }
  }
  const changeStatus = (task: EventTask) => {
    try {
      const action = task.status === "To do" ? "started" : task.status === "In progress" ? "marked done" : "reopened"
      if (task.status === "To do") operations.startTask({ eventId: event.id, taskId: task.id })
      else if (task.status === "In progress") operations.markTaskDone({ eventId: event.id, taskId: task.id })
      else operations.reopenTask({ eventId: event.id, taskId: task.id })
      onEventChanged(operations.getEvent(event.id)!)
      onMessage(`Task ${action}: ${task.title}`)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to change Task status.")
    }
  }
  const taskCompletion = (task: EventTask) => {
    const total = task.subtasks.length
    const completed = task.subtasks.filter((subtask) => subtask.completed).length
    return { completed, total }
  }
  const taskCard = (task: EventTask) => (
    <article className="event-operations-task-card" key={task.id}>
      <div className="event-operations-card-heading">
        <span className={`event-operations-phase event-operations-phase-${task.phase.toLowerCase().replace("-", "-")}`}>{task.phase}</span>
        <span className="event-operations-task-date">{taskDateLabel(task.deadline)}</span>
      </div>
      <label className="event-operations-task-title">Task title<input defaultValue={task.title} disabled={event.status === "Closed"} onBlur={(input) => input.target.value !== task.title && updateTask(task, { title: input.target.value })} /></label>
      {task.subtasks.length > 0 && <div className="event-operations-progress"><span>{taskCompletion(task).completed} of {taskCompletion(task).total} complete</span><i><b style={{ width: `${(taskCompletion(task).completed / taskCompletion(task).total) * 100}%` }} /></i></div>}
      <label className="event-operations-task-field">Phase<select defaultValue={task.phase} disabled={event.status === "Closed"} onChange={(input) => updateTask(task, { phase: input.target.value as EventPhase })}>{phases.map((phase) => <option key={phase}>{phase}</option>)}</select></label>
      <label className="event-operations-task-field">Deadline<input type="date" defaultValue={task.deadline} disabled={event.status === "Closed"} onChange={(input) => updateTask(task, { deadline: input.target.value })} /></label>
      <small>{relativeDeadlineLabel(task.relativeDeadlineDays)}</small>
      <label className="event-operations-assignee">Team Member<select value={task.assigneeId ?? ""} disabled={event.status === "Closed"} onChange={(input) => { const assigneeId = input.target.value || null; updateTask(task, { assigneeId }); onMessage(assigneeId ? `Assigned to ${teamMembers.find((member) => member.id === assigneeId)?.name}` : "Task is now unassigned.") }}><option value="">Unassigned</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      {event.status === "Open" && <label className="event-operations-task-field">Subtasks<input defaultValue={task.subtasks.map((subtask) => subtask.title).join(", ")} onBlur={(input) => updateTask(task, { subtasks: input.target.value.split(",").map((title) => ({ title: title.trim(), completed: false })).filter((subtask) => subtask.title) })} /></label>}
      {task.subtasks.length > 0 && <fieldset><legend>Subtasks</legend>{task.subtasks.map((subtask, subtaskIndex) => <label key={`${task.id}-${subtaskIndex}`}><input checked={subtask.completed} disabled={event.status === "Closed"} type="checkbox" onChange={() => { try { operations.toggleSubtask({ eventId: event.id, taskId: task.id, subtaskIndex }); onEventChanged(operations.getEvent(event.id)!); onMessage(`Subtask ${subtask.completed ? "reopened" : "completed"}: ${subtask.title}`) } catch (error) { onMessage(error instanceof Error ? error.message : "Unable to update Subtask.") } }} />{subtask.title}</label>)}</fieldset>}
      {event.status === "Open" && task.status !== "Done" && <div className="event-operations-task-actions"><button type="button" onClick={() => changeStatus(task)}>{task.status === "To do" ? "Start task" : "Mark done"}</button></div>}
    </article>
  )
  return (
    <section
      aria-labelledby={`event-workspace-title-${event.id}`}
      className="event-operations-workspace"
    >
      <p>Event workspace</p>
      <h2 id={`event-workspace-title-${event.id}`}>{event.name}</h2>
      {event.status === "Closed" && <p className="event-operations-closed-notice">This Event is closed. Reopen it to make changes.</p>}
      <div className="event-operations-event-details">
        <label>Event name<input defaultValue={event.name} disabled={event.status === "Closed"} onBlur={(input) => input.target.value !== event.name && onEventChanged(operations.updateEvent(event.id, { name: input.target.value }))} /></label>
        <label>Event date<input defaultValue={event.date} disabled={event.status === "Closed"} type="date" onChange={(input) => onEventChanged(operations.updateEvent(event.id, { date: input.target.value }))} /></label>
        <label>Venue<input defaultValue={event.venue} disabled={event.status === "Closed"} onBlur={(input) => input.target.value !== event.venue && onEventChanged(operations.updateEvent(event.id, { venue: input.target.value }))} /></label>
      </div>
      <p>From {event.sourceTemplateName}</p>
      <div className="event-operations-workspace-actions">
        {event.status === "Open" ? <button className="event-operations-action-button event-operations-action-button-close" type="button" onClick={() => setConfirmation({ title: `Close “${event.name}”?`, description: "This Event will become read-only. You can reopen it later.", cancelLabel: "Keep active", confirmLabel: "Close event", onConfirm: () => { onEventChanged(operations.closeEvent(event.id)); onMessage("Event closed. It is now read-only.") } })}>Close event</button> : <button className="event-operations-action-button event-operations-action-button-close" type="button" onClick={() => setConfirmation({ title: `Reopen “${event.name}”?`, description: "Its existing plan and Task history will be preserved.", cancelLabel: "Keep closed", confirmLabel: "Reopen event", onConfirm: () => { onEventChanged(operations.reopenEvent(event.id)); onMessage("Event reopened. You can make changes again.") } })}>Reopen event</button>}
        <button className="event-operations-action-button event-operations-action-button-delete" type="button" onClick={() => setConfirmation({ title: `Delete “${event.name}” permanently?`, description: "This cannot be undone.", cancelLabel: "Keep event", confirmLabel: "Delete event", onConfirm: () => { operations.deleteEvent(event.id); onDeleted(); onMessage(`Event deleted: ${event.name}.`) } })}>Delete event</button>
      </div>
      <h3>Task workspace</h3>
      <div className="event-operations-kanban">{(["To do", "In progress", "Done"] as const).map((status) => {
        const tasks = event.tasks.filter((task) => task.status === status)
        const firstTask = tasks[0]
        const remainingTasks = tasks.slice(1)
        return <section className="event-operations-kanban-column" key={status}><h4 data-count={tasks.length}>{status}</h4>{firstTask && taskCard(firstTask)}{remainingTasks.length > 0 && <details className="event-operations-task-expander"><summary>Show {remainingTasks.length} more {remainingTasks.length === 1 ? "Task" : "Tasks"}</summary><div className="event-operations-task-expander-content">{remainingTasks.map(taskCard)}</div></details>}</section>
      })}</div>
      {event.status === "Open" && <div className="event-operations-add-task">{showNewTask ? <><label>Task title<input value={newTask.title} onChange={(input) => setNewTask({ ...newTask, title: input.target.value })} /></label><label>Phase<select value={newTask.phase} onChange={(input) => setNewTask({ ...newTask, phase: input.target.value as EventPhase })}>{phases.map((phase) => <option key={phase}>{phase}</option>)}</select></label><label>Deadline<input type="date" value={newTask.deadline} onChange={(input) => setNewTask({ ...newTask, deadline: input.target.value })} /></label><button type="button" onClick={() => { try { operations.addEventTask({ eventId: event.id, ...newTask }); onEventChanged(operations.getEvent(event.id)!); setShowNewTask(false); setNewTask({ title: "", phase: "Planning", deadline: event.date }) } catch (error) { onMessage(error instanceof Error ? error.message : "Unable to add Task.") } }}>Add Task</button><button type="button" onClick={() => setShowNewTask(false)}>Cancel</button></> : <button type="button" onClick={() => setShowNewTask(true)}>Add Task</button>}</div>}
      {confirmation && <section aria-label="Confirm action" className="event-operations-confirmation"><strong>{confirmation.title}</strong><p>{confirmation.description}</p><button type="button" onClick={() => setConfirmation(null)}>{confirmation.cancelLabel}</button><button type="button" onClick={() => { confirmation.onConfirm(); setConfirmation(null) }}>{confirmation.confirmLabel}</button></section>}
    </section>
  )
}

type CollectionView = "list" | "calendar"

function eventCompletion(event: Event) {
  const done = event.tasks.filter((task) => task.status === "Done").length
  return { done, total: event.tasks.length }
}

function monthLabel(month: Date) {
  return new Intl.DateTimeFormat("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(month)
}

function EventCalendar({
  events,
  month,
  onChangeMonth,
  onOpen,
}: {
  events: Event[]
  month: Date
  onChangeMonth: (direction: -1 | 1) => void
  onOpen: (event: Event) => void
}) {
  const year = month.getUTCFullYear()
  const monthIndex = month.getUTCMonth()
  const firstWeekday = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 })

  return (
    <section aria-label={`${monthLabel(month)} Event calendar`} className="event-collection-calendar">
      <header>
        <button aria-label="Previous month" type="button" onClick={() => onChangeMonth(-1)}>←</button>
        <h3>{monthLabel(month)}</h3>
        <button aria-label="Next month" type="button" onClick={() => onChangeMonth(1)}>→</button>
      </header>
      <div className="event-calendar-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="event-calendar-grid">
        {cells.map((_, index) => {
          const day = index - firstWeekday + 1
          const dayEvents = day > 0 && day <= daysInMonth
            ? events.filter((event) => event.date === `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
            : []
          return <div key={index} className={dayEvents.length ? "has-events" : ""}>
            {day > 0 && day <= daysInMonth && <span>{day}</span>}
            {dayEvents.map((event) => <button key={event.id} type="button" onClick={() => onOpen(event)}>{event.name}</button>)}
          </div>
        })}
      </div>
    </section>
  )
}

function EventCollection({
  events,
  onNewEvent,
  onOpen,
}: {
  events: Event[]
  onNewEvent: () => void
  onOpen: (event: Event) => void
}) {
  const [view, setView] = useState<CollectionView>("list")
  const [showClosed, setShowClosed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [month, setMonth] = useState(() => new Date(Date.UTC(2027, 7, 1)))
  const visibleEvents = useMemo(
    () => eventsForCollection(events, showClosed),
    [events, showClosed],
  )
  const selected = visibleEvents.find((event) => event.id === selectedId) ?? visibleEvents[0]

  return (
    <section aria-labelledby="event-collection-title" className="event-collection">
      <header className="event-collection-header">
        <div><p>Events</p><h2 id="event-collection-title">Event collection</h2><span>Find scheduled work in date order.</span></div>
        <div className="event-collection-controls">
          <div aria-label="Collection view" className="event-view-toggle">
            <button className={view === "list" ? "active" : ""} type="button" onClick={() => setView("list")}>List</button>
            <button className={view === "calendar" ? "active" : ""} type="button" onClick={() => setView("calendar")}>Calendar</button>
          </div>
          <label><input checked={showClosed} type="checkbox" onChange={() => setShowClosed((current) => !current)} /> Show closed</label>
          <button className="event-new-button" type="button" onClick={onNewEvent}>+ New event</button>
        </div>
      </header>
      {events.length === 0 ? (
        <div className="event-operations-empty"><h3>No Events yet</h3><p>Create an Event from an Event Template to schedule its plan.</p><button type="button" onClick={onNewEvent}>New event</button></div>
      ) : view === "calendar" ? (
        <EventCalendar events={visibleEvents} month={month} onChangeMonth={(direction) => setMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + direction, 1)))} onOpen={onOpen} />
      ) : (
        <div className="event-collection-listing">
          <div className="event-collection-list" aria-label="Events earliest first">
            {visibleEvents.map((event) => <button className={selected?.id === event.id ? "selected" : ""} key={event.id} type="button" onClick={() => setSelectedId(event.id)}><time>{new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${event.date}T00:00:00Z`))}</time><strong>{event.name}</strong><span>{event.venue}</span><em className={event.status === "Closed" ? "closed" : ""}>{event.status}</em></button>)}
          </div>
          {selected && <aside className="event-collection-preview"><p>Selected Event</p><h3>{selected.name}</h3><span>{selected.date} · {selected.venue}</span><dl><div><dt>Status</dt><dd>{selected.status}</dd></div><div><dt>Event Template</dt><dd>{selected.sourceTemplateName}</dd></div><div><dt>Tasks complete</dt><dd>{eventCompletion(selected).done} of {eventCompletion(selected).total}</dd></div></dl><button type="button" onClick={() => onOpen(selected)}>Open event workspace</button></aside>}
        </div>
      )}
    </section>
  )
}

export default function EventOperationsMvp() {
  const [operations] = useState<EventOperations>(() => {
    const instance = createInMemoryEventOperations()
    instance.createEvent({
      templateId: "distribution-of-pre-loved-items",
      name: "Distribution of clothes",
      date: "2027-08-09",
      venue: "Tampines Hub",
    })
    return instance
  })
  const [templates, setTemplates] = useState(() =>
    operations.listEventTemplates(),
  )
  const [events, setEvents] = useState<Event[]>(() =>
    operations.listEvents({ includeClosed: true }),
  )
  const [openEventId, setOpenEventId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EventDraft | null>(null)
  const [creationStep, setCreationStep] = useState(1)
  const [editingDraftTaskId, setEditingDraftTaskId] = useState<string | null>(null)
  const [creationErrors, setCreationErrors] = useState<Record<string, string>>({})
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [creatingTemplateForDraft, setCreatingTemplateForDraft] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    "distribution-of-pre-loved-items",
  )
  const [editingTemplate, setEditingTemplate] = useState<EventTemplate | null>(
    null,
  )
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [templateDescription, setTemplateDescription] = useState("")
  const [templateTasks, setTemplateTasks] = useState<EditableTask[]>([
    newEditableTask(),
  ])
  const [message, setMessage] = useState("")
  const [templateConfirmation, setTemplateConfirmation] = useState<{
    title: string
    description: string
    confirmLabel: string
    onConfirm: () => void
  } | null>(null)
  const [templateErrors, setTemplateErrors] = useState<{
    name?: string
    tasks?: string
  }>({})
  const templateNameInput = useRef<HTMLInputElement>(null)
  const firstTaskInput = useRef<HTMLInputElement>(null)
  const eventNameInput = useRef<HTMLInputElement>(null)
  const eventDateInput = useRef<HTMLInputElement>(null)
  const venueInput = useRef<HTMLInputElement>(null)

  function refreshTemplates() {
    setTemplates(operations.listEventTemplates())
  }
  function openTemplateEditor(template?: EventTemplate) {
    setShowTemplateEditor(true)
    setEditingTemplate(template ?? null)
    setTemplateName(template?.name ?? "")
    setTemplateDescription(template?.description ?? "")
    setTemplateTasks(
      template
        ? template.tasks.map((task) => ({
            ...task,
            key: Date.now() + Math.random(),
            relativeDeadlineDays: String(task.relativeDeadlineDays),
            subtasks: task.subtaskTitles.join(", "),
          }))
        : [newEditableTask()],
    )
    setMessage("")
    setTemplateErrors({})
  }
  function updateTask(key: number, changes: Partial<EditableTask>) {
    setTemplateErrors((errors) => ({ ...errors, tasks: undefined }))
    setTemplateTasks((tasks) =>
      tasks.map((task) => (task.key === key ? { ...task, ...changes } : task)),
    )
  }
  function moveTask(index: number, direction: -1 | 1) {
    setTemplateTasks((tasks) => {
      const target = index + direction
      if (target < 0 || target >= tasks.length) return tasks
      const reordered = [...tasks]
      ;[reordered[index], reordered[target]] = [
        reordered[target],
        reordered[index],
      ]
      return reordered
    })
  }
  function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!templateName.trim()) {
      setTemplateErrors({ name: "Enter a template name." })
      templateNameInput.current?.focus()
      return
    }
    if (
      templateTasks.length === 0 ||
      templateTasks.some(
        (task) =>
          !task.title.trim() || task.relativeDeadlineDays.trim() === "",
      )
    ) {
      setTemplateErrors({
        tasks:
          "Add at least one complete Task before saving.",
      })
      firstTaskInput.current?.focus()
      return
    }
    const input = {
      name: templateName,
      description: templateDescription,
      tasks: templateTasks.map(
        ({ title, phase, relativeDeadlineDays, subtasks }) => ({
          title,
          phase,
      relativeDeadlineDays: Number(relativeDeadlineDays),
          subtaskTitles: subtasks
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      ),
    }
    try {
      const savedTemplate = editingTemplate
        ? operations.updateEventTemplate({
          templateId: editingTemplate.id,
          ...input,
        })
        : operations.createCustomEventTemplate(input)
      refreshTemplates()
      if (creatingTemplateForDraft && draft) {
        setDraft(operations.changeEventDraftTemplate(draft.id, savedTemplate.id))
        setCreationStep(1)
        setCreatingTemplateForDraft(false)
      }
      setEditingTemplate(null)
      setShowTemplateEditor(false)
      setMessage("Event Template saved.")
      setTemplateErrors({})
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save Event Template.",
      )
    }
  }
  function deleteTemplate(template: EventTemplate) {
    setTemplateConfirmation({ title: `Delete “${template.name}” permanently?`, description: "This cannot be undone. Existing Events created from this template will not change.", confirmLabel: "Delete template", onConfirm: () => { operations.deleteCustomEventTemplate(template.id); refreshTemplates(); setMessage("Custom Event Template deleted. Existing Events are unchanged.") } })
  }
  function resetTemplate(template: EventTemplate) {
    setTemplateConfirmation({ title: `Reset “${template.name}” to its bundled plan?`, description: "Future Events will use the reset plan.", confirmLabel: "Reset template", onConfirm: () => { operations.resetBuiltInEventTemplate(template.id); refreshTemplates(); setMessage("Built-in Event Template reset to its bundled plan.") } })
  }
  function planningHorizon(template: EventTemplate) {
    const earliestDeadline = Math.min(
      ...template.tasks.map((task) => task.relativeDeadlineDays),
    )
    return `${Math.ceil(Math.abs(earliestDeadline) / 7)}-week planning horizon`
  }
  function openCreator() {
    try {
      const draft = operations.createEventDraft(selectedTemplateId)
      setDraft(draft)
      setCreationStep(1)
      setEditingDraftTaskId(null)
      setCreationErrors({})
      setConfirmDiscard(false)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Choose an Event Template.",
      )
    }
  }
  function openEventWorkspace(event: Event) {
    setOpenEventId(event.id)
    setMessage(`Opened ${event.name} workspace.`)
  }
  function updateDraft(changes: Pick<EventDraft, "name" | "date" | "venue">) {
    if (!draft) return
    setDraft(operations.updateEventDraft(draft.id, changes))
  }
  function continueCreation() {
    if (!draft) return
    if (creationStep === 1) {
      setCreationStep(2)
      return
    }
    if (creationStep === 2) {
      const errors: Record<string, string> = {}
      if (!draft.name.trim()) errors.name = "Enter an Event name."
      if (!draft.date) errors.date = "Choose an Event date."
      if (!draft.venue.trim()) errors.venue = "Enter a venue."
      if (Object.keys(errors).length) {
        setCreationErrors(errors)
        if (errors.name) eventNameInput.current?.focus()
        else if (errors.date) eventDateInput.current?.focus()
        else venueInput.current?.focus()
        return
      }
      setCreationStep(3)
      return
    }
    try {
      operations.createEventFromDraft(draft.id)
      setEvents(operations.listEvents({ includeClosed: true }))
      setDraft(null)
      setMessage("Event created from its Event Template.")
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to create Event.",
      )
    }
  }
  const openEvent = openEventId ? operations.getEvent(openEventId) : undefined

  return (
    <section className="events-page">
      <div className={`dashboard-shell event-operations-page ${openEvent ? "workspace-open" : ""}`}>
        <header className="section-hero">
          <p>Event operations</p>
          <h1>Plan the work behind every Event</h1>
          <span>
            Create a scheduled Event from a reusable workflow, then start its
            Tasks.
          </span>
        </header>
        <p aria-live="polite" className="event-operations-feedback">
          {message}
        </p>
        <EventCollectionPrototype
          events={events.map((event) => {
            const tasksDone = event.tasks.filter((task) => task.status === "Done").length
            return {
              id: event.id,
              name: event.name,
              date: new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${event.date}T00:00:00Z`)),
              day: Number(event.date.slice(8, 10)),
              venue: event.venue,
              status: event.status === "Closed" ? "Closed" : tasksDone === event.tasks.length ? "On track" : "Planning",
              progress: event.tasks.length ? Math.round((tasksDone / event.tasks.length) * 100) : 0,
              tasksDone,
              tasksTotal: event.tasks.length,
            }
          })}
          onNewEvent={openCreator}
          onOpen={(event) => openEventWorkspace(operations.getEvent(event.id)!)}
        />
        <section
          className="event-operations-library"
          aria-labelledby="template-library-title"
        >
          <div>
            <p>Event Templates</p>
            <h2 id="template-library-title">Reusable workflows</h2>
            <span>Changes apply to future Events only.</span>
          </div>
          <button type="button" onClick={() => openTemplateEditor()}>
            New Event Template
          </button>
        </section>
        <div className="event-operations-template-list">
          {templates.map((template) => (
            <article key={template.id}>
              <div>
                <strong>{template.name}</strong>
                <span>
                  {template.isBuiltIn
                    ? "Built-in Event Template"
                    : "Custom Event Template"}{" "}
                  · {template.tasks.length} Tasks
                  {template.isBuiltIn ? ` · ${planningHorizon(template)}` : ""}
                </span>
                <p>{template.description}</p>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => openTemplateEditor(template)}
                >
                  Edit
                </button>
                {template.isBuiltIn ? (
                  <button type="button" onClick={() => resetTemplate(template)}>
                    Reset
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => deleteTemplate(template)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {templateConfirmation && <section aria-label="Confirm template action" className="event-operations-confirmation"><strong>{templateConfirmation.title}</strong><p>{templateConfirmation.description}</p><button type="button" onClick={() => setTemplateConfirmation(null)}>Keep template</button><button type="button" onClick={() => { templateConfirmation.onConfirm(); setTemplateConfirmation(null) }}>{templateConfirmation.confirmLabel}</button></section>}
        <label className="event-template-picker">New Events start with an Event Template<select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        {showTemplateEditor ? (
          <form className="event-operations-creator" onSubmit={saveTemplate}>
            <h2>
              {editingTemplate
                ? `Edit ${editingTemplate.name}`
                : "New Event Template"}
            </h2>
            <label>
              Event Template name
              <input
                ref={templateNameInput}
                aria-describedby={templateErrors.name ? "template-name-error" : undefined}
                aria-invalid={Boolean(templateErrors.name)}
                value={templateName}
                onChange={(event) => {
                  setTemplateName(event.target.value)
                  setTemplateErrors((errors) => ({ ...errors, name: undefined }))
                }}
              />
            </label>
            {templateErrors.name && <p id="template-name-error">{templateErrors.name}</p>}
            <label>
              Description
              <input
                value={templateDescription}
                onChange={(event) => setTemplateDescription(event.target.value)}
              />
            </label>
            <h3>Task definitions</h3>
            {templateTasks.map((task, index) => (
              <fieldset key={task.key}>
                <label>
                  Task title
                  <input
                    ref={index === 0 ? firstTaskInput : undefined}
                    aria-describedby={templateErrors.tasks ? "template-tasks-error" : undefined}
                    aria-invalid={Boolean(templateErrors.tasks)}
                    value={task.title}
                    onChange={(event) =>
                      updateTask(task.key, { title: event.target.value })
                    }
                  />
                </label>
                <label>
                  Phase
                  <select
                    value={task.phase}
                    onChange={(event) =>
                      updateTask(task.key, {
                        phase: event.target.value as EventPhase,
                      })
                    }
                  >
                    {phases.map((phase) => (
                      <option key={phase}>{phase}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Days relative to Event date
                  <input
                    type="number"
                    value={task.relativeDeadlineDays}
                    onChange={(event) =>
                      updateTask(task.key, {
                        relativeDeadlineDays: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Subtasks (comma separated)
                  <input
                    value={task.subtasks}
                    onChange={(event) =>
                      updateTask(task.key, { subtasks: event.target.value })
                    }
                  />
                </label>
                <button type="button" onClick={() => moveTask(index, -1)}>
                  Move up
                </button>
                <button type="button" onClick={() => moveTask(index, 1)}>
                  Move down
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setTemplateTasks((tasks) =>
                      tasks.filter((item) => item.key !== task.key),
                    )
                  }
                >
                  Remove
                </button>
              </fieldset>
            ))}
            {templateErrors.tasks && <p id="template-tasks-error">{templateErrors.tasks}</p>}
            <button
              type="button"
              onClick={() =>
                setTemplateTasks((tasks) => [...tasks, newEditableTask()])
              }
            >
              Add Task definition
            </button>
            <div>
              <button
                type="button"
                onClick={() => {
                  setEditingTemplate(null)
                  setTemplateName("")
                  setShowTemplateEditor(false)
                }}
              >
                Cancel
              </button>
              <button type="submit">Save Event Template</button>
            </div>
          </form>
        ) : null}
        {draft && (
          <div className="event-creation-overlay" role="presentation">
            <section aria-labelledby="new-event-title" aria-modal="true" className="event-creation-dialog" role="dialog">
              <header><div><p>New Event</p><h2 id="new-event-title">Create an Event</h2></div><button aria-label="Cancel Event creation" className="event-creation-close" type="button" onClick={() => setConfirmDiscard(true)}>×</button></header>
              <ol className="event-creation-steps"><li className={creationStep === 1 ? "active" : creationStep > 1 ? "done" : ""}><span>{creationStep > 1 ? "✓" : "1"}</span>Choose template</li><li className={creationStep === 2 ? "active" : creationStep > 2 ? "done" : ""}><span>{creationStep > 2 ? "✓" : "2"}</span>Event details</li><li className={creationStep === 3 ? "active" : ""}><span>3</span>Review plan</li></ol>
              {creationStep === 1 && <div className="event-creation-body"><header><p>Step 1 of 3</p><h2>Start with a reusable Event Template</h2><span>You can tailor the plan after it is generated.</span></header><div className="event-creation-templates">{templates.map((template) => <button className={draft.templateId === template.id ? "selected" : ""} key={template.id} type="button" onClick={() => setDraft(operations.changeEventDraftTemplate(draft.id, template.id))}><span>{template.isBuiltIn ? "Built-in" : "Custom"}</span><strong>{template.name}</strong><small>{template.description}</small><em>{template.tasks.length} Tasks · {planningHorizon(template).replace(" planning horizon", " horizon")}</em></button>)}</div><button className="event-creation-link" type="button" onClick={() => { setCreatingTemplateForDraft(true); openTemplateEditor() }}>＋ Create custom template</button></div>}
              {creationStep === 2 && <div className="event-creation-body"><header><p>Step 2 of 3</p><h2>Give this Event its details</h2><span>{templates.find((template) => template.id === draft.templateId)?.name} will supply the Task structure.</span></header><div className="event-creation-fields"><label>Event name<input ref={eventNameInput} aria-describedby={creationErrors.name ? "event-name-error" : undefined} aria-invalid={Boolean(creationErrors.name)} value={draft.name} onChange={(event) => { updateDraft({ name: event.target.value, date: draft.date, venue: draft.venue }); setCreationErrors((errors) => ({ ...errors, name: "" })) }} /></label>{creationErrors.name && <p className="event-creation-error" id="event-name-error">{creationErrors.name}</p>}<label>Event date<input ref={eventDateInput} aria-describedby={creationErrors.date ? "event-date-error" : undefined} aria-invalid={Boolean(creationErrors.date)} type="date" value={draft.date} onChange={(event) => { updateDraft({ name: draft.name, date: event.target.value, venue: draft.venue }); setCreationErrors((errors) => ({ ...errors, date: "" })) }} /></label>{creationErrors.date && <p className="event-creation-error" id="event-date-error">{creationErrors.date}</p>}<label>Venue<input ref={venueInput} aria-describedby={creationErrors.venue ? "event-venue-error" : undefined} aria-invalid={Boolean(creationErrors.venue)} value={draft.venue} onChange={(event) => { updateDraft({ name: draft.name, date: draft.date, venue: event.target.value }); setCreationErrors((errors) => ({ ...errors, venue: "" })) }} /></label>{creationErrors.venue && <p className="event-creation-error" id="event-venue-error">{creationErrors.venue}</p>}</div></div>}
              {creationStep === 3 && <div className="event-creation-body"><header><p>Step 3 of 3</p><h2>Review the copied plan</h2><span>Edits affect this Event only.</span></header><div className="event-creation-plan"><div className="event-creation-plan-summary"><span>Auto-generated plan</span><strong>{Math.min(5, draft.tasks.length)} shown of {draft.tasks.length} Tasks</strong><small>Deadlines stay relative to {draft.date ? new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${draft.date}T00:00:00Z`)) : "the Event date"}</small></div>{draft.tasks.slice(0, 5).map((task) => { const isEditing = editingDraftTaskId === task.id; const assignee = operations.listTeamMembers().find((member) => member.id === task.assigneeId)?.name ?? "Unassigned"; return <article className={`event-creation-plan-task ${isEditing ? "editing" : ""}`} key={task.id}><span className={`event-creation-phase ${task.phase === "Execution" ? "execution" : ""}`}>{task.phase}</span>{isEditing ? <div className="event-creation-plan-fields"><label>Task<input value={task.title} onChange={(event) => setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, title: event.target.value }))} /></label><label>Phase<select value={task.phase} onChange={(event) => setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, phase: event.target.value as EventPhase }))}>{phases.map((phase) => <option key={phase}>{phase}</option>)}</select></label><label>Deadline<input type="date" value={task.deadline} onChange={(event) => { const offset = offsetForDate(draft.date, event.target.value); if (offset !== null) setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, relativeDeadlineDays: offset })) }} /></label><label>Subtasks<input value={task.subtasks.map((subtask) => subtask.title).join(", ")} onChange={(event) => setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, subtasks: event.target.value.split(",").map((title) => ({ title: title.trim(), completed: false })).filter((subtask) => subtask.title) }))} /></label></div> : <div><strong>{task.title}</strong><small>{task.deadline || "Set an Event date first"} · {relativeDeadlineLabel(task.relativeDeadlineDays)}</small></div>}<select aria-label={`Assignee for ${task.title}`} value={task.assigneeId ?? ""} onChange={(event) => setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, assigneeId: event.target.value || null }))}><option value="">Unassigned</option>{operations.listTeamMembers().map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button type="button" aria-label={`${isEditing ? "Done editing" : "Edit"} ${task.title}`} onClick={() => setEditingDraftTaskId(isEditing ? null : task.id)}>{isEditing ? "Done editing" : "Edit"}</button></article>})}</div>{draft.tasks.length > 5 && <p className="event-creation-plan-note">Showing the first 5 Tasks from the generated plan.</p>}</div>}
              {confirmDiscard ? <div className="event-creation-confirm"><strong>Discard this Event draft?</strong><p>Your Event details and plan edits will be lost.</p><button type="button" onClick={() => setConfirmDiscard(false)}>Keep editing</button><button type="button" onClick={() => { operations.discardEventDraft(draft.id); setDraft(null); setConfirmDiscard(false); setMessage("Event draft discarded.") }}>Discard draft</button></div> : <footer><button type="button" onClick={() => creationStep === 1 ? setConfirmDiscard(true) : setCreationStep((step) => step - 1)}>Back</button><button type="button" onClick={() => creationStep === 3 ? continueCreation() : continueCreation()} disabled={creationStep === 3 && draft.tasks.length === 0}>{creationStep === 3 ? "Create event" : "Continue"}</button></footer>}
            </section>
          </div>
        )}
        {openEvent && (
          <>
            <button className="event-workspace-back" type="button" onClick={() => setOpenEventId(null)}>
              <span aria-hidden="true">←</span> Back to Events
            </button>
            <EventWorkspace
              event={openEvent}
              operations={operations}
              onEventChanged={(updated) =>
                setEvents((current) =>
                  current.map((item) =>
                    item.id === updated.id ? updated : item,
                  ),
                )
              }
              onDeleted={() => {
                setEvents((current) =>
                  current.filter((item) => item.id !== openEvent.id),
                )
                setOpenEventId(null)
              }}
              onMessage={setMessage}
            />
          </>
        )}
      </div>
    </section>
  )
}
