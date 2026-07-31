import { FormEvent, useRef, useState } from "react"
import {
  createInMemoryEventOperations,
  type Event,
  type EventDraft,
  type EventOperations,
  type EventPhase,
  type EventTemplate,
  type TemplateTaskInput,
} from "./event-operations"
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
}: {
  event: Event
  operations: EventOperations
  onEventChanged: (event: Event) => void
}) {
  return (
    <section
      aria-labelledby={`event-workspace-title-${event.id}`}
      className="event-operations-workspace"
    >
      <p>Event workspace</p>
      <h2 id={`event-workspace-title-${event.id}`}>{event.name}</h2>
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
              <button
                type="button"
                onClick={() => {
                  operations.startTask({ eventId: event.id, taskId: task.id })
                  onEventChanged(operations.getEvent(event.id)!)
                }}
              >
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
  const [templates, setTemplates] = useState(() =>
    operations.listEventTemplates(),
  )
  const [events, setEvents] = useState<Event[]>(() => operations.listEvents())
  const [draft, setDraft] = useState<EventDraft | null>(null)
  const [creationStep, setCreationStep] = useState(1)
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
  const [templateErrors, setTemplateErrors] = useState<{
    name?: string
    tasks?: string
  }>({})
  const templateNameInput = useRef<HTMLInputElement>(null)
  const firstTaskInput = useRef<HTMLInputElement>(null)

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
      setTemplateErrors({ name: "Enter an Event Template name." })
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
          "Every Task needs a title, phase, and date-relative deadline.",
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
    if (
      !window.confirm(
        `Delete ${template.name}? This will not change existing Events.`,
      )
    )
      return
    operations.deleteCustomEventTemplate(template.id)
    refreshTemplates()
    setMessage("Custom Event Template deleted. Existing Events are unchanged.")
  }
  function resetTemplate(template: EventTemplate) {
    if (!window.confirm(`Reset ${template.name} to its bundled plan?`)) return
    operations.resetBuiltInEventTemplate(template.id)
    refreshTemplates()
    setMessage("Built-in Event Template reset to its bundled plan.")
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
      setCreationErrors({})
      setConfirmDiscard(false)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Choose an Event Template.",
      )
    }
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
        return
      }
      setCreationStep(3)
      return
    }
    try {
      operations.createEventFromDraft(draft.id)
      setEvents(operations.listEvents())
      setDraft(null)
      setMessage("Event created from its Event Template.")
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to create Event.",
      )
    }
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
        <p aria-live="polite" className="event-operations-feedback">
          {message}
        </p>
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
        <section className="event-operations-library" aria-label="Create Event">
          <div>
            <p>New Event</p>
            <h2>Create from an Event Template</h2>
            <select
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={openCreator}>
            New event
          </button>
        </section>
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
              <ol className="event-creation-steps"><li className={creationStep >= 1 ? "active" : ""}>1 <span>Choose template</span></li><li className={creationStep >= 2 ? "active" : ""}>2 <span>Event details</span></li><li className={creationStep >= 3 ? "active" : ""}>3 <span>Review plan</span></li></ol>
              {creationStep === 1 && <div className="event-creation-body"><h3>Choose an Event Template</h3><p>Start with a reusable workflow. You can edit the copied plan before creating the Event.</p><div className="event-creation-templates">{templates.map((template) => <button className={draft.templateId === template.id ? "selected" : ""} key={template.id} type="button" onClick={() => setDraft(operations.changeEventDraftTemplate(draft.id, template.id))}><strong>{template.name}</strong><span>{template.description}</span><small>{template.tasks.length} Tasks · {planningHorizon(template)}</small></button>)}</div><button className="event-creation-link" type="button" onClick={() => { setCreatingTemplateForDraft(true); openTemplateEditor() }}>Create a custom Event Template</button></div>}
              {creationStep === 2 && <div className="event-creation-body"><div className="event-creation-summary"><strong>{templates.find((template) => template.id === draft.templateId)?.name}</strong><span>{draft.tasks.length} Tasks · {planningHorizon(templates.find((template) => template.id === draft.templateId)!)}</span><button type="button" onClick={() => setCreationStep(1)}>Change template</button></div><h3>Event details</h3><label>Event name<input aria-invalid={Boolean(creationErrors.name)} value={draft.name} onChange={(event) => { updateDraft({ name: event.target.value, date: draft.date, venue: draft.venue }); setCreationErrors((errors) => ({ ...errors, name: "" })) }} /></label>{creationErrors.name && <p className="event-creation-error">{creationErrors.name}</p>}<label>Event date<input aria-invalid={Boolean(creationErrors.date)} type="date" value={draft.date} onChange={(event) => { updateDraft({ name: draft.name, date: event.target.value, venue: draft.venue }); setCreationErrors((errors) => ({ ...errors, date: "" })) }} /></label>{creationErrors.date && <p className="event-creation-error">{creationErrors.date}</p>}<label>Venue<input aria-invalid={Boolean(creationErrors.venue)} value={draft.venue} onChange={(event) => { updateDraft({ name: draft.name, date: draft.date, venue: event.target.value }); setCreationErrors((errors) => ({ ...errors, venue: "" })) }} /></label>{creationErrors.venue && <p className="event-creation-error">{creationErrors.venue}</p>}</div>}
              {creationStep === 3 && <div className="event-creation-body"><div className="event-creation-summary"><strong>{draft.name || "Untitled Event"}</strong><span>{draft.date || "Choose a date"} · {draft.venue || "Choose a venue"}</span><span>From {templates.find((template) => template.id === draft.templateId)?.name} · {draft.tasks.length} Tasks · {planningHorizon(templates.find((template) => template.id === draft.templateId)!)}</span><button type="button" onClick={() => setCreationStep(2)}>Change details</button></div><h3>Auto-generated plan</h3><p>These Tasks are copied from the Event Template and only become an Event when you create it.</p>{draft.tasks.map((task) => <article className="event-creation-task" key={task.id}><label>Task<input value={task.title} onChange={(event) => setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, title: event.target.value }))} /></label><label>Phase<select value={task.phase} onChange={(event) => setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, phase: event.target.value as EventPhase }))}>{phases.map((phase) => <option key={phase}>{phase}</option>)}</select></label><label>Deadline<input type="date" value={task.deadline} onChange={(event) => { const offset = offsetForDate(draft.date, event.target.value); if (offset !== null) setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, relativeDeadlineDays: offset })) }} /></label><label>Team Member<select value={task.assigneeId ?? ""} onChange={(event) => setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, assigneeId: event.target.value || null }))}><option value="">Unassigned</option>{operations.listTeamMembers().map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>Subtasks<input value={task.subtasks.map((subtask) => subtask.title).join(", ")} onChange={(event) => setDraft(operations.updateEventDraftTask(draft.id, { ...task, taskId: task.id, subtasks: event.target.value.split(",").map((title) => ({ title: title.trim(), completed: false })).filter((subtask) => subtask.title) }))} /></label><small>{task.deadline || "Set an Event date first"} · {relativeDeadlineLabel(task.relativeDeadlineDays)}</small><button type="button" onClick={() => setDraft(operations.removeEventDraftTask(draft.id, task.id))}>Remove Task</button></article>)}<button className="event-creation-add-task" type="button" onClick={() => setDraft(operations.addEventDraftTask(draft.id))}>Add Task</button>{draft.tasks.length === 0 && <p className="event-creation-error">Keep at least one Task in this Event plan.</p>}</div>}
              {confirmDiscard ? <div className="event-creation-confirm"><strong>Discard this Event draft?</strong><p>Your Event details and plan edits will be lost.</p><button type="button" onClick={() => setConfirmDiscard(false)}>Keep editing</button><button type="button" onClick={() => { operations.discardEventDraft(draft.id); setDraft(null); setConfirmDiscard(false); setMessage("Event draft discarded.") }}>Discard draft</button></div> : <footer><button type="button" disabled={creationStep === 1} onClick={() => setCreationStep((step) => step - 1)}>Back</button><button type="button" onClick={() => creationStep === 3 ? continueCreation() : continueCreation()} disabled={creationStep === 3 && draft.tasks.length === 0}>{creationStep === 3 ? "Create event" : "Continue"}</button></footer>}
            </section>
          </div>
        )}
        {events.length === 0 ? (
          <section className="event-operations-empty">
            <h2>No Events yet</h2>
            <p>Create an Event from an Event Template.</p>
          </section>
        ) : (
          events.map((event) => (
            <EventWorkspace
              event={event}
              key={event.id}
              operations={operations}
              onEventChanged={(updated) =>
                setEvents((current) =>
                  current.map((item) =>
                    item.id === updated.id ? updated : item,
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
