import { FormEvent, useRef, useState } from "react"
import {
  createInMemoryEventOperations,
  type Event,
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
  const [draftId, setDraftId] = useState<string | null>(null)
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
      if (editingTemplate)
        operations.updateEventTemplate({
          templateId: editingTemplate.id,
          ...input,
        })
      else operations.createCustomEventTemplate(input)
      refreshTemplates()
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
      setDraftId(draft.id)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Choose an Event Template.",
      )
    }
  }
  function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draftId) return
    const values = new FormData(event.currentTarget)
    try {
      operations.updateEventDraft(draftId, {
        name: String(values.get("name")),
        date: String(values.get("date")),
        venue: String(values.get("venue")),
      })
      operations.createEventFromDraft(draftId)
      setEvents(operations.listEvents())
      setDraftId(null)
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
        {draftId && (
          <form className="event-operations-creator" onSubmit={createEvent}>
            <h2>Create Event</h2>
            <label>
              Event name
              <input name="name" required />
            </label>
            <label>
              Event date
              <input name="date" required type="date" />
            </label>
            <label>
              Venue
              <input name="venue" required />
            </label>
            <div>
              <button
                type="button"
                onClick={() => {
                  operations.discardEventDraft(draftId)
                  setDraftId(null)
                  setMessage("Event draft discarded.")
                }}
              >
                Cancel
              </button>
              <button type="submit">Create event</button>
            </div>
          </form>
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
