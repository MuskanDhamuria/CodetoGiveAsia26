import { useEffect, useMemo, useState } from "react"
import {
  adminApi,
  type AdminApi,
  type EventDetail,
  type EventSubtask,
  type UpdateEventSubtaskInput,
  type EventTask,
  type EventTaskAssigneeInput,
  type EventTemplate,
  type TaskAssigneeGroups,
  type TaskCategory,
  type TeamMember,
} from "./admin-api"
import EventCollectionPrototype, { type EventCollectionItem } from "./EventCollectionPrototype"
import { EventCalendar } from "./EventCalendar"
import EventVolunteerTab from "./EventVolunteerTab"
import EventAttendanceTab from "./EventAttendanceTab"
import EventLogistics from "./EventLogistics"
import "./EventOperationsMvp.css"


type Draft = {
  event_template_id: number | null | undefined
  name: string
  event_date: string
  venue: string
  description: string
  start_time: string
  end_time: string
  expected_attendance: string
}

type CreationTaskEdit = {
  name: string
  due_at: string
  category: TaskCategory
}

type CreationScratchTask = {
  id: number
  name: string
  due_at: string
  category: TaskCategory
}

type CustomTemplateTaskDraft = {
  id: number
  name: string
  relative_due_days: string
  category: TaskCategory
  subtasks: string
}

const emptyDraft: Draft = {
  event_template_id: undefined,
  name: "",
  event_date: "",
  venue: "",
  description: "",
  start_time: "",
  end_time: "",
  expected_attendance: "",
}

type EventDialog = "edit" | "reschedule" | "close" | "cancel" | "delete" | null
type TaskEditorMode = "preview" | "edit"
type TaskDraft = {
  name: string
  body: string
  due_at: string
  category: TaskCategory
  assignees: string[]
}

type SubtaskDraft = {
  title: string
  kind: "effort" | "scheduled"
  scheduled_date: string
  start_time: string
  end_time: string
  estimated_hours: string
  assignees: string[]
}

const emptySubtaskDraft: SubtaskDraft = {
  title: "",
  kind: "effort",
  scheduled_date: "",
  start_time: "",
  end_time: "",
  estimated_hours: "",
  assignees: [],
}

const emptyTaskDraft: TaskDraft = {
  name: "",
  body: "",
  due_at: "",
  category: "planning",
  assignees: [],
}

const emptyTaskAssignees: TaskAssigneeGroups = { organizers: [], volunteers: [] }

function subtaskDraft(subtask: EventSubtask): SubtaskDraft {
  const scheduledStart = subtask.scheduled_start?.replace(" ", "T") ?? ""
  const scheduledEnd = subtask.scheduled_end?.replace(" ", "T") ?? ""
  return {
    title: subtask.title,
    kind: scheduledStart ? "scheduled" : "effort",
    scheduled_date: scheduledStart.slice(0, 10),
    start_time: scheduledStart.slice(11, 16),
    end_time: scheduledEnd.slice(11, 16),
    estimated_hours: subtask.estimated_minutes == null ? "" : String(Math.round(subtask.estimated_minutes / 6) / 10),
    assignees: (subtask.assignees ?? []).map((person) => `${person.person_type}:${person.person_id}`),
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

function formatTime(value?: string | null) {
  if (!value) return ""
  const [hour, minute] = value.slice(0, 5).split(":").map(Number)
  return new Intl.DateTimeFormat("en-SG", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute))
}

function eventTimeLabel(start?: string | null, end?: string | null) {
  if (!start) return ""
  return `${formatTime(start)}${end ? `–${formatTime(end)}` : ""}`
}

function validTimeRange(start: string, end: string) {
  return (!start && !end) || (!!start && !!end && end > start)
}

function eventCompletion(event: EventDetail) {
  const done = event.tasks.filter((task) => task.status === "done").length
  return { done, total: event.tasks.length }
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
  const [creationTaskAssignees, setCreationTaskAssignees] = useState<Record<number, string>>({})
  const [creationTaskEdits, setCreationTaskEdits] = useState<Record<number, CreationTaskEdit>>({})
  const [editingCreationTaskId, setEditingCreationTaskId] = useState<number | null>(null)
  const [scratchTasks, setScratchTasks] = useState<CreationScratchTask[]>([])
  const [showTemplateBuilder, setShowTemplateBuilder] = useState(false)
  const [customTemplateName, setCustomTemplateName] = useState("")
  const [customTemplateDescription, setCustomTemplateDescription] = useState("")
  const [customTemplateTasks, setCustomTemplateTasks] = useState<CustomTemplateTaskDraft[]>([])
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [reviewPage, setReviewPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const [openEventId, setOpenEventId] = useState<number | null>(initialEventId)
  const [workspaceTab, setWorkspaceTab] = useState<"tasks" | "volunteers" | "attendance" | "logistics">("tasks")
  const [mobileTaskStatus, setMobileTaskStatus] = useState<"incomplete" | "ongoing" | "done">("incomplete")
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [eventTaskAssignees, setEventTaskAssignees] = useState<TaskAssigneeGroups>(emptyTaskAssignees)
  const [eventDialog, setEventDialog] = useState<EventDialog>(null)
  const [eventForm, setEventForm] = useState({ name: "", venue: "", description: "", start_time: "", end_time: "", event_date: "", shift_task_deadlines: true, delete_name: "" })
  const [editingTaskId, setEditingTaskId] = useState<number | "new" | null>(null)
  const [taskEditorMode, setTaskEditorMode] = useState<TaskEditorMode>("edit")
  const [taskForm, setTaskForm] = useState<TaskDraft>(emptyTaskDraft)
  const [subtaskTitles, setSubtaskTitles] = useState<Record<number, string>>({})
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("")
  const [subtaskForms, setSubtaskForms] = useState<Record<number, SubtaskDraft>>({})
  const [newSubtaskForm, setNewSubtaskForm] = useState<SubtaskDraft>(emptySubtaskDraft)
  const [timeLogForms, setTimeLogForms] = useState<Record<number, { person: string; hours: string; notes: string }>>({})
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

  async function refreshTaskAssignees(eventId: number) {
    if (!api.listEventTaskAssignees) {
      setEventTaskAssignees({
        organizers: teamMembers.filter((member) => member.is_active).map((member) => ({
          person_type: "team_member",
          person_id: member.id,
          name: member.name,
          email: member.email,
        })),
        volunteers: [],
      })
      return
    }
    try {
      setEventTaskAssignees(await api.listEventTaskAssignees(eventId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load task assignees.")
    }
  }

  useEffect(() => {
    if (openEventId === null) {
      setEventTaskAssignees(emptyTaskAssignees)
      return
    }
    if (loading) return
    if (!events.some((event) => event.id === openEventId)) {
      setEventTaskAssignees(emptyTaskAssignees)
      setError(`Event ${openEventId} was not found.`)
      return
    }
    void refreshTaskAssignees(openEventId)
  }, [events, loading, openEventId])

  function taskPeople(task: EventTask) {
    if (task.assignees?.length) return task.assignees
    const legacyPerson = [...eventTaskAssignees.organizers, ...eventTaskAssignees.volunteers].find((person) =>
      person.person_type === "team_member"
        ? person.person_id === task.team_member_id
        : person.person_id === task.volunteer_id,
    )
    return legacyPerson ? [{ ...legacyPerson, is_lead: false }] : []
  }

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === draft.event_template_id),
    [draft.event_template_id, templates],
  )
  const reviewTasks = selectedTemplate?.tasks.slice(reviewPage * 5, reviewPage * 5 + 5) ?? []
  const reviewPageCount = selectedTemplate ? Math.ceil(selectedTemplate.tasks.length / 5) : 0
  const openEvent = events.find((event) => event.id === openEventId)
  const collectionEvents = useMemo<EventCollectionItem[]>(
    () => events.map((event) => {
      const completed = eventCompletion(event)
      const date = new Date(`${event.event_date}T00:00:00Z`)
      const status = event.is_cancelled
        ? "Cancelled"
        : event.status === "closed"
          ? "Closed"
          : completed.total > 0 && completed.done === completed.total
            ? "On track"
            : "Planning"
      return {
        id: String(event.id),
        name: event.name,
        date: `${formatDate(event.event_date)}${event.start_time ? ` · ${eventTimeLabel(event.start_time, event.end_time)}` : ""}`,
        day: date.getUTCDate(),
        venue: event.venue,
        status,
        progress: completed.total ? Math.round((completed.done / completed.total) * 100) : 0,
        tasksDone: completed.done,
        tasksTotal: completed.total,
      }
    }),
    [events],
  )
  const editingTask = openEvent && typeof editingTaskId === "number"
    ? openEvent.tasks.find((task) => task.id === editingTaskId)
    : undefined
  const completedTaskCount = openEvent?.tasks.filter((task) => task.status === "done").length ?? 0
  const eventCompletionPercent = openEvent?.tasks.length
    ? Math.round((completedTaskCount / openEvent.tasks.length) * 100)
    : 0

  function openCollectionEvent(event: EventDetail) {
    setOpenEventId(event.id)
    setWorkspaceTab("tasks")
  }

  function openCreator() {
    setDraft(emptyDraft)
    setCreationStep(1)
    setCreationTaskAssignees({})
    setCreationTaskEdits({})
    setEditingCreationTaskId(null)
    setScratchTasks([])
    setShowTemplateBuilder(false)
    setReviewPage(0)
    setError("")
    setShowCreator(true)
  }

  function openTemplateBuilder() {
    setCustomTemplateName("")
    setCustomTemplateDescription("")
    setCustomTemplateTasks([{ id: Date.now(), name: "", relative_due_days: "0", category: "planning", subtasks: "" }])
    setError("")
    setShowTemplateBuilder(true)
  }

  async function saveCustomTemplate() {
    if (!customTemplateName.trim()) {
      setError("Enter a template name.")
      return
    }
    if (!customTemplateTasks.length || customTemplateTasks.some((task) => !task.name.trim() || task.relative_due_days.trim() === "")) {
      setError("Add at least one complete Task definition.")
      return
    }
    if (!api.createEventTemplate || !api.createTemplateTask || !api.createTemplateSubtask) {
      setError("Custom templates are not available from this API.")
      return
    }
    setSavingTemplate(true)
    setError("")
    try {
      const created = await api.createEventTemplate({ name: customTemplateName.trim(), description: customTemplateDescription.trim() })
      const createdTasks = await Promise.all(customTemplateTasks.map((task, position) => api.createTemplateTask!(created.id, {
        name: task.name.trim(), body: "", relative_due_days: Number(task.relative_due_days), category: task.category, position,
      }).then(async (createdTask) => {
        const subtasks = task.subtasks.split(",").map((title) => title.trim()).filter(Boolean)
        await Promise.all(subtasks.map((title, subtaskPosition) => api.createTemplateSubtask!(created.id, createdTask.id, { title, position: subtaskPosition })))
        return createdTask
      })))
      const savedTemplate = { ...created, tasks: createdTasks, roles: created.roles ?? [] }
      setTemplates((current) => [...current, savedTemplate].sort((a, b) => Number(b.is_built_in) - Number(a.is_built_in) || a.name.localeCompare(b.name)))
      setDraft((current) => ({ ...current, event_template_id: created.id }))
      setShowTemplateBuilder(false)
      setMessage("Custom Event Template saved. It is selected for this Event.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the custom Event Template.")
    } finally {
      setSavingTemplate(false)
    }
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
      if (!validTimeRange(draft.start_time, draft.end_time)) {
        setError("Enter both times and make sure the end time is after the start time.")
        return
      }
      setError("")
      setReviewPage(0)
      setCreationStep(3)
    }
  }

  async function createEvent() {
    setCreating(true)
    setError("")
    try {
      let event = await api.createEvent({
        event_template_id: draft.event_template_id ?? null,
        name: draft.name.trim(),
        venue: draft.venue.trim(),
        event_date: draft.event_date,
        description: draft.description.trim(),
        start_time: draft.start_time || null,
        end_time: draft.end_time || null,
        ...(draft.expected_attendance ? { expected_attendance: Number(draft.expected_attendance) } : {}),
      })
      if (draft.event_template_id === null && scratchTasks.length) {
        const createdTasks = await Promise.all(scratchTasks.map((task, position) => api.createEventTask(event.id, {
          name: task.name.trim(),
          body: "",
          due_at: task.due_at || draft.event_date,
          category: task.category,
          position,
        })))
        event = { ...event, tasks: createdTasks }
      }
      const changedTasks = event.tasks.flatMap((task) => {
        const assignee = creationTaskAssignees[task.id]
        const edit = creationTaskEdits[task.id]
        const changes = {
          ...(assignee !== undefined ? { team_member_id: assignee ? Number(assignee) : null } : {}),
          ...(edit && edit.name !== task.name ? { name: edit.name.trim() } : {}),
          ...(edit && edit.due_at !== task.due_at ? { due_at: edit.due_at } : {}),
          ...(edit && edit.category !== task.category ? { category: edit.category } : {}),
        }
        return Object.keys(changes).length ? [{ task, changes }] : []
      })
      if (changedTasks.length) {
        const updatedTasks = await Promise.all(changedTasks.map(({ task, changes }) => api.updateEventTask(event.id, task.id, changes)))
        event = { ...event, tasks: event.tasks.map((task) => updatedTasks.find((updated) => updated.id === task.id) ?? task) }
      }
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
      setMessage("")
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
      description: event.description ?? "",
      start_time: event.start_time?.slice(0, 5) ?? "",
      end_time: event.end_time?.slice(0, 5) ?? "",
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
    if (!validTimeRange(eventForm.start_time, eventForm.end_time)) {
      setError("Enter both times and make sure the end time is after the start time.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const updated = await api.updateEvent(event.id, {
        name: eventForm.name.trim(),
        venue: eventForm.venue.trim(),
        description: eventForm.description.trim(),
        start_time: eventForm.start_time || null,
        end_time: eventForm.end_time || null,
      })
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

  async function cancelEventAction(event: EventDetail) {
    setSaving(true)
    setError("")
    try {
      const updated = await api.cancelEvent(event.id)
      replaceEvent(updated)
      setEventDialog(null)
      setMessage("Event cancelled.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to cancel Event.")
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

  function openTaskEditor(task?: EventTask, mode: TaskEditorMode = "edit") {
    setError("")
    setTaskEditorMode(mode)
    setConfirmDeleteTask(false)
    setConfirmDeleteSubtaskId(null)
    setNewSubtaskTitle("")
    setNewSubtaskForm(emptySubtaskDraft)
    setTimeLogForms({})
    if (!task) {
      setEditingTaskId("new")
      setTaskForm(emptyTaskDraft)
      setSubtaskTitles({})
      setSubtaskForms({})
      return
    }
    setEditingTaskId(task.id)
    setTaskForm({
      name: task.name,
      body: task.body,
      due_at: task.due_at.slice(0, 10),
      category: task.category,
      assignees: taskPeople(task).map((person) => `${person.person_type}:${person.person_id}`),
    })
    setSubtaskTitles(Object.fromEntries(task.subtasks.map((subtask) => [subtask.id, subtask.title])))
    setSubtaskForms(Object.fromEntries(task.subtasks.map((subtask) => [subtask.id, subtaskDraft(subtask)])))
  }

  async function saveTask(event: EventDetail) {
    if (!taskForm.name.trim() || !taskForm.due_at) {
      setError("Enter a Task name and due date.")
      return
    }
    const existingLeads = new Set((editingTask?.assignees ?? [])
      .filter((person) => person.is_lead)
      .map((person) => `${person.person_type}:${person.person_id}`))
    const input = {
      name: taskForm.name.trim(),
      body: taskForm.body,
      due_at: taskForm.due_at,
      category: taskForm.category,
      assignees: taskForm.assignees.map((value) => {
        const [person_type, personId] = value.split(":")
        return {
          person_type: person_type as "team_member" | "volunteer",
          person_id: Number(personId),
          is_lead: existingLeads.has(value),
        }
      }),
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
      await refreshTaskAssignees(event.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save Task.")
    } finally {
      setSaving(false)
    }
  }

  async function updateTaskPeople(event: EventDetail, task: EventTask, people: EventTaskAssigneeInput[]) {
    setError("")
    try {
      const updated = await api.updateEventTask(event.id, task.id, {
        assignees: people,
      })
      replaceTask(event.id, updated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update task assignees.")
    }
  }

  async function updateSubtaskPeople(event: EventDetail, task: EventTask, subtask: EventSubtask, people: EventTaskAssigneeInput[]) {
    setError("")
    try {
      const updated = await api.updateEventSubtask(event.id, task.id, subtask.id, { assignees: people })
      replaceTask(event.id, { ...task, subtasks: task.subtasks.map((item) => item.id === subtask.id ? updated : item) })
      await refreshTaskAssignees(event.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update subtask assignees.")
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
    const form = { ...newSubtaskForm, title: newSubtaskForm.title.trim() || newSubtaskTitle.trim() }
    if (!form.title) return
    if (form.kind === "scheduled" && (!form.scheduled_date || !form.start_time || !form.end_time)) {
      setError("Enter the scheduled date, start time and end time.")
      return
    }
    if (form.kind === "scheduled" && form.end_time <= form.start_time) {
      setError("Subtask end time must be after its start time.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const created = await api.createEventSubtask(event.id, task.id, {
        title: form.title,
        scheduled_start: form.kind === "scheduled" ? `${form.scheduled_date}T${form.start_time}:00` : null,
        scheduled_end: form.kind === "scheduled" ? `${form.scheduled_date}T${form.end_time}:00` : null,
        estimated_minutes: form.kind === "effort" && form.estimated_hours ? Math.round(Number(form.estimated_hours) * 60) : null,
        assignees: form.assignees.map(personInput),
      })
      const updated = { ...task, subtasks: [...task.subtasks, created] }
      replaceTask(event.id, updated)
      setSubtaskTitles((current) => ({ ...current, [created.id]: created.title }))
      setSubtaskForms((current) => ({ ...current, [created.id]: subtaskDraft(created) }))
      setNewSubtaskTitle("")
      setNewSubtaskForm(emptySubtaskDraft)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add subtask.")
    } finally {
      setSaving(false)
    }
  }

  function personInput(value: string): EventTaskAssigneeInput {
    const [person_type, personId] = value.split(":")
    return { person_type: person_type as "team_member" | "volunteer", person_id: Number(personId) }
  }

  async function updateSubtask(event: EventDetail, task: EventTask, subtaskId: number, changes: UpdateEventSubtaskInput) {
    setSaving(true)
    setError("")
    try {
      const updatedSubtask = await api.updateEventSubtask(event.id, task.id, subtaskId, changes)
      replaceTask(event.id, { ...task, subtasks: task.subtasks.map((subtask) => subtask.id === subtaskId ? updatedSubtask : subtask) })
      setSubtaskTitles((current) => ({ ...current, [subtaskId]: updatedSubtask.title }))
      setSubtaskForms((current) => ({ ...current, [subtaskId]: subtaskDraft(updatedSubtask) }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update checklist item.")
    } finally {
      setSaving(false)
    }
  }

  async function saveSubtask(event: EventDetail, task: EventTask, subtask: EventSubtask) {
    const form = subtaskForms[subtask.id] ?? subtaskDraft(subtask)
    if (!form.title.trim()) return
    if (form.kind === "scheduled" && (!form.scheduled_date || !form.start_time || !form.end_time)) {
      setError("Enter the scheduled date, start time and end time.")
      return
    }
    if (form.kind === "scheduled" && form.end_time <= form.start_time) {
      setError("Subtask end time must be after its start time.")
      return
    }
    await updateSubtask(event, task, subtask.id, {
      title: form.title.trim(),
      scheduled_start: form.kind === "scheduled" ? `${form.scheduled_date}T${form.start_time}:00` : null,
      scheduled_end: form.kind === "scheduled" ? `${form.scheduled_date}T${form.end_time}:00` : null,
      estimated_minutes: form.kind === "effort" && form.estimated_hours ? Math.round(Number(form.estimated_hours) * 60) : null,
      assignees: form.assignees.map(personInput),
    })
  }

  async function duplicateScheduledSubtask(event: EventDetail, task: EventTask, subtask: EventSubtask) {
    setSaving(true)
    setError("")
    try {
      const created = await api.createEventSubtask(event.id, task.id, {
        title: `${subtask.title} (another shift)`,
        scheduled_start: subtask.scheduled_start,
        scheduled_end: subtask.scheduled_end,
        assignees: (subtask.assignees ?? []).map((person) => ({ person_type: person.person_type, person_id: person.person_id })),
      })
      replaceTask(event.id, { ...task, subtasks: [...task.subtasks, created] })
      setSubtaskTitles((current) => ({ ...current, [created.id]: created.title }))
      setSubtaskForms((current) => ({ ...current, [created.id]: subtaskDraft(created) }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to duplicate shift.")
    } finally {
      setSaving(false)
    }
  }

  async function logSubtaskTime(event: EventDetail, task: EventTask, subtask: EventSubtask) {
    const form = timeLogForms[subtask.id]
    if (!form?.person || !Number(form.hours)) {
      setError("Choose an assignee and enter the hours spent.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const log = await api.createEventSubtaskTimeLog(event.id, task.id, subtask.id, {
        ...personInput(form.person),
        minutes_spent: Math.round(Number(form.hours) * 60),
        notes: form.notes.trim(),
      })
      const updated = { ...subtask, time_logs: [log, ...(subtask.time_logs ?? [])] }
      replaceTask(event.id, { ...task, subtasks: task.subtasks.map((item) => item.id === subtask.id ? updated : item) })
      setTimeLogForms((current) => ({ ...current, [subtask.id]: { person: "", hours: "", notes: "" } }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to log hours.")
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
        {openEvent && <header className="section-hero">
          <p>Event operations</p>
          <h1>Event portfolio</h1>
          <span>Plan reusable workflows or begin with an empty Event.</span>
        </header>}
        <p aria-live="polite" className="event-operations-feedback" role={error ? "alert" : undefined}>
          {message || error}
        </p>
        {openEvent ? (<>
          <button aria-label="Back to Events" className="event-workspace-back api-event-workspace-back" type="button" onClick={() => { setWorkspaceTab("tasks"); setOpenEventId(null) }}>← Back to Events</button>
          <section aria-label={openEvent.name} className="event-operations-workspace api-event-workspace">
            <header className="api-event-workspace-header">
              <div>
                <p>Event workspace</p>
                <h2>{openEvent.name}</h2>
              </div>
              <div className="api-event-header-actions">
                <span className={`api-event-status ${openEvent.is_cancelled ? "cancelled" : openEvent.status}`}>{openEvent.is_cancelled ? "Cancelled" : openEvent.status === "closed" ? "Closed" : "Open"}</span>
                {openEvent.status === "open" ? (<>
                  <button type="button" onClick={() => openEventDialog("edit", openEvent)}>Edit details</button>
                  <button type="button" onClick={() => openEventDialog("reschedule", openEvent)}>Reschedule</button>
                  <button type="button" onClick={() => openEventDialog("close", openEvent)}>Close Event</button>
                  <button className="api-danger-button" type="button" onClick={() => openEventDialog("cancel", openEvent)}>Cancel Event</button>
                </>) : !openEvent.is_cancelled && <button type="button" onClick={() => void changeEventStatus(openEvent, "open")}>Reopen Event</button>}
                <button className="api-danger-button" type="button" onClick={() => openEventDialog("delete", openEvent)}>Delete Event</button>
              </div>
            </header>
            {(message || error) && <p aria-live="polite" className={`api-workspace-feedback${error ? " error" : ""}`}>{error || message}</p>}
            <dl aria-label="Event details" className="api-event-metadata">
              <div><dt>Date &amp; time</dt><dd>{formatDate(openEvent.event_date)}{openEvent.start_time ? ` · ${eventTimeLabel(openEvent.start_time, openEvent.end_time)}` : " · Time not set"}</dd></div>
              <div><dt>Venue</dt><dd>{openEvent.venue}</dd></div>
              <div><dt>Tasks</dt><dd>{openEvent.tasks.length}</dd></div>
            </dl>
            {openEvent.status === "closed" && (
              <p className="event-operations-closed-notice">
                {openEvent.is_cancelled
                  ? "This Event has been cancelled. Its details and Task history are kept for reference."
                  : "Closed Events are read-only. The Task history is kept for reference."}
              </p>
            )}
            <div className="api-event-workspace-tabs" role="tablist" aria-label="Event workspace sections">
              <button
                aria-controls="event-task-workspace"
                aria-selected={workspaceTab === "tasks"}
                className={workspaceTab === "tasks" ? "active" : ""}
                id="event-tasks-tab"
                role="tab"
                type="button"
                onClick={() => setWorkspaceTab("tasks")}
              >Tasks</button>
              <button
                aria-controls="event-volunteer-workspace"
                aria-selected={workspaceTab === "volunteers"}
                className={workspaceTab === "volunteers" ? "active" : ""}
                id="event-volunteers-tab"
                role="tab"
                type="button"
                onClick={() => setWorkspaceTab("volunteers")}
              >Volunteers</button>
              <button
                aria-controls="event-attendance-workspace"
                aria-selected={workspaceTab === "attendance"}
                className={workspaceTab === "attendance" ? "active" : ""}
                id="event-attendance-tab"
                role="tab"
                type="button"
                onClick={() => setWorkspaceTab("attendance")}
              >Attendance</button>
              <button
                aria-controls="event-logistics-workspace"
                aria-selected={workspaceTab === "logistics"}
                className={workspaceTab === "logistics" ? "active" : ""}
                id="event-logistics-tab"
                role="tab"
                type="button"
                onClick={() => setWorkspaceTab("logistics")}
              >Logistics</button>
            </div>
            {workspaceTab === "tasks" ? <div
              aria-labelledby="event-tasks-tab"
              className="api-event-workspace-body"
              id="event-task-workspace"
              role="tabpanel"
            >
              <div className="api-event-workspace-main">
                <div className="api-task-workspace-heading">
                  <h3>Task workspace</h3>
                  {openEvent.status === "open" && <button type="button" onClick={() => openTaskEditor()}>Add Task</button>}
                </div>
                <div aria-label="Task status" className="event-operations-mobile-status-tabs" role="tablist">
                  {(["incomplete", "ongoing", "done"] as const).map((status) => {
                    const label = status === "incomplete" ? "To do" : status === "ongoing" ? "In progress" : "Done"
                    const count = openEvent.tasks.filter((task) => task.status === status).length
                    return <button
                      aria-controls={`api-event-operations-column-${status}`}
                      aria-selected={mobileTaskStatus === status}
                      className={mobileTaskStatus === status ? "active" : ""}
                      key={status}
                      onClick={() => setMobileTaskStatus(status)}
                      role="tab"
                      type="button"
                    >
                      {label}<span>{count}</span>
                    </button>
                  })}
                </div>
                <div className="event-operations-kanban">
                  {(["incomplete", "ongoing", "done"] as const).map((status) => {
                    const tasks = openEvent.tasks.filter((task) => task.status === status)
                    const label = status === "incomplete" ? "To do" : status === "ongoing" ? "In progress" : "Done"
                    return (
                      <section
                    aria-label={`${label} Tasks`}
                    className={`event-operations-kanban-column${dragOverStatus === status ? " drag-over" : ""}${mobileTaskStatus === status ? " mobile-active" : ""}`}
                    id={`api-event-operations-column-${status}`}
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
                        onClick={(clickEvent) => {
                          if ((clickEvent.target as HTMLElement).closest("button")) return
                          openTaskEditor(task, openEvent.status === "open" ? "edit" : "preview")
                        }}
                        onKeyDown={(keyEvent) => {
                          if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return
                          keyEvent.preventDefault()
                          openTaskEditor(task, openEvent.status === "open" ? "edit" : "preview")
                        }}
                        aria-label={`Edit ${task.name}`}
                        role="group"
                        tabIndex={0}
                        title={openEvent.status === "open" ? "Drag this Task to another status or click to edit" : "Click to view this Task"}
                      >
                        <div className="event-operations-card-heading">
                          <span className={`event-operations-phase event-operations-phase-${task.category.replace("_", "-")}`}>{task.category.replace("_", " ")}</span>
                          <span className="event-operations-task-date">{formatDate(task.due_at.slice(0, 10))}</span>
                        </div>
                        <strong className="event-operations-task-title">{task.name}</strong>
                        <div className="api-task-assignees" aria-label={`Assignees for ${task.name}`}>
                          {taskPeople(task).length
                            ? taskPeople(task).slice(0, 3).map((person) => <span key={`${person.person_type}:${person.person_id}`}>{person.name}</span>)
                            : <em>Unassigned</em>}
                          {taskPeople(task).length > 3 && <span>+{taskPeople(task).length - 3}</span>}
                        </div>
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
            </div> : workspaceTab === "volunteers" ? <div aria-labelledby="event-volunteers-tab" id="event-volunteer-workspace" role="tabpanel">
              <EventVolunteerTab
                eventId={openEvent.id}
                event={openEvent}
                taskPeople={eventTaskAssignees}
                readOnly={openEvent.status === "closed"}
                onPeopleChanged={() => void refreshTaskAssignees(openEvent.id)}
                onUpdateTaskAssignees={(task, people) => updateTaskPeople(openEvent, task, people)}
                onUpdateSubtaskAssignees={(task, subtask, people) => updateSubtaskPeople(openEvent, task, subtask, people)}
                onOpenTask={(task) => { setWorkspaceTab("tasks"); openTaskEditor(task, openEvent.status === "open" ? "edit" : "preview") }}
              />
            </div> : workspaceTab === "attendance" ? <div aria-labelledby="event-attendance-tab" id="event-attendance-workspace" role="tabpanel">
              <EventAttendanceTab
                eventId={openEvent.id}
                readOnly={openEvent.is_cancelled}
              />
            </div> : <div aria-labelledby="event-logistics-tab" id="event-logistics-workspace" role="tabpanel">
              <EventLogistics eventId={openEvent.id} eventStatus={openEvent.status} />
            </div>}
          </section>
        </>
        ) : <>
        <EventCollectionPrototype
          events={collectionEvents}
          initialShowClosed
          onNewEvent={openCreator}
          onOpen={(event) => {
            const apiEvent = events.find((candidate) => String(candidate.id) === event.id)
            if (apiEvent) openCollectionEvent(apiEvent)
          }}
          renderCalendar={() => (
            <EventCalendar
              events={events}
              onOpenWorkspace={(eventId) => {
                const apiEvent = events.find((candidate) => candidate.id === eventId)
                if (apiEvent) openCollectionEvent(apiEvent)
              }}
            />
          )}
        />
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
                  <header><p>Step 1 of 3</p><h2>Start with a reusable Event Template</h2><span>You can tailor the plan after it is generated.</span></header>
                  <div className="event-creation-templates">
                    {templates.map((template) => (
                      <button className={draft.event_template_id === template.id ? "selected" : ""} key={template.id} type="button" onClick={() => { setDraft({ ...draft, event_template_id: template.id }); setReviewPage(0) }}>
                        <span>{template.is_built_in ? "Built-in" : "Custom"}</span><strong>{template.name}</strong><small>{template.description}</small><em>{template.tasks.length} Tasks · {template.tasks.length ? `${Math.max(...template.tasks.map((task) => Math.abs(task.relative_due_days)))}-day horizon` : "No Tasks"}</em>
                      </button>
                    ))}
                  </div>
                  <div className="event-creation-template-actions"><button className="event-creation-link" type="button" onClick={openTemplateBuilder}>＋ Create custom template</button><button aria-label="Start from scratch" className="event-creation-link" type="button" onClick={() => { setDraft({ ...draft, event_template_id: null }); setReviewPage(0) }}>＋ Start from scratch</button></div>
                </div>
              )}
              {creationStep === 2 && (
                <div className="event-creation-body">
                  <header><p>Step 2 of 3</p><h2>Give this Event its details</h2><span>{selectedTemplate?.name ?? "An empty plan"} will supply the Task structure.</span></header>
                  <div className="event-creation-fields">
                    <label>Event name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                    <label>Event date<input type="date" value={draft.event_date} onChange={(event) => setDraft({ ...draft, event_date: event.target.value })} /></label>
                    <label>Venue<input value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} /></label>
                    <label>Start time<input type="time" value={draft.start_time} onChange={(event) => setDraft({ ...draft, start_time: event.target.value })} /></label>
                    <label>End time<input type="time" value={draft.end_time} onChange={(event) => setDraft({ ...draft, end_time: event.target.value })} /></label>
                    <label>Planned attendance<input min="0" type="number" value={draft.expected_attendance} onChange={(event) => setDraft({ ...draft, expected_attendance: event.target.value })} /></label>
                    <label className="event-creation-description">Description<textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
                  </div>
                </div>
              )}
              {creationStep === 3 && draft.event_template_id === null && scratchTasks.length === 0 && <p className="event-creation-empty-plan-note">No Tasks yet</p>}
              {creationStep === 3 && (
                <div className="event-creation-body">
                  <header><p>Step 3 of 3</p><h2>Review the copied plan</h2><span>Edits affect this Event only.</span></header>
                  {draft.event_template_id === null ? <div className="event-creation-scratch-plan"><div className="event-creation-plan-summary"><span>Empty plan</span><strong>{scratchTasks.length} Tasks added</strong><small>Add the work that needs to happen before and after the Event.</small></div>{scratchTasks.map((task, index) => <fieldset className="event-creation-task" key={task.id}><label>Task title<input value={task.name} onChange={(event) => setScratchTasks((current) => current.map((item) => item.id === task.id ? { ...item, name: event.target.value } : item))} /></label><label>Phase<select value={task.category} onChange={(event) => setScratchTasks((current) => current.map((item) => item.id === task.id ? { ...item, category: event.target.value as TaskCategory } : item))}><option value="planning">Planning</option><option value="execution">Execution</option><option value="post_execution">Post-execution</option></select></label><label>Days relative to Event date<input type="number" value={draft.event_date && task.due_at ? Math.round((Date.parse(`${task.due_at}T00:00:00Z`) - Date.parse(`${draft.event_date}T00:00:00Z`)) / 86400000) : 0} onChange={(event) => setScratchTasks((current) => current.map((item) => item.id === task.id ? { ...item, due_at: draft.event_date ? new Date(Date.parse(`${draft.event_date}T00:00:00Z`) + Number(event.target.value || 0) * 86400000).toISOString().slice(0, 10) : "" } : item))} /></label><button type="button" onClick={() => setScratchTasks((current) => current.filter((item) => item.id !== task.id))}>Remove</button><small>Task {index + 1}</small></fieldset>)}<button className="event-creation-add-task" type="button" onClick={() => setScratchTasks((current) => [...current, { id: Date.now(), name: "New Task", due_at: draft.event_date, category: "planning" }])}>＋ Add Task definition</button></div> : selectedTemplate?.tasks.length ? <div className="event-creation-plan"><div className="event-creation-plan-summary"><span>Auto-generated plan</span><strong>Tasks {reviewPage * 5 + 1}–{Math.min((reviewPage + 1) * 5, selectedTemplate.tasks.length)} of {selectedTemplate.tasks.length}</strong><small>Deadlines stay relative to {draft.event_date ? formatDate(draft.event_date) : "the Event date"}</small></div>{reviewTasks.map((task) => { const defaultDue = draft.event_date ? new Date(Date.parse(`${draft.event_date}T00:00:00Z`) + task.relative_due_days * 86400000).toISOString().slice(0, 10) : ""; const edit = creationTaskEdits[task.id] ?? { name: task.name, due_at: defaultDue, category: task.category }; const isEditing = editingCreationTaskId === task.id; return <article className={`event-creation-plan-task ${isEditing ? "editing" : ""}`} key={task.id}><span className={`event-creation-phase ${edit.category === "execution" ? "execution" : ""}`}>{edit.category === "post_execution" ? "Post-execution" : edit.category[0].toUpperCase() + edit.category.slice(1)}</span>{isEditing ? <div className="event-creation-plan-fields"><label>Task<input value={edit.name} onChange={(event) => setCreationTaskEdits((current) => ({ ...current, [task.id]: { ...edit, name: event.target.value } }))} /></label><label>Phase<select value={edit.category} onChange={(event) => setCreationTaskEdits((current) => ({ ...current, [task.id]: { ...edit, category: event.target.value as TaskCategory } }))}><option value="planning">Planning</option><option value="execution">Execution</option><option value="post_execution">Post-execution</option></select></label><label>Deadline<input type="date" value={edit.due_at} onChange={(event) => setCreationTaskEdits((current) => ({ ...current, [task.id]: { ...edit, due_at: event.target.value } }))} /></label></div> : <div><strong>{edit.name}</strong><small>{edit.due_at || "Set an Event date first"} · {task.relative_due_days === 0 ? "Event day" : `${Math.abs(task.relative_due_days)} days ${task.relative_due_days < 0 ? "before" : "after"} Event`}</small></div>}<select aria-label={`Assignee for ${edit.name}`} value={creationTaskAssignees[task.id] ?? ""} onChange={(event) => setCreationTaskAssignees((current) => ({ ...current, [task.id]: event.target.value }))}><option value="">Unassigned</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button type="button" aria-label={`${isEditing ? "Done editing" : "Edit"} ${edit.name}`} onClick={() => setEditingCreationTaskId(isEditing ? null : task.id)}>{isEditing ? "Done editing" : "Edit"}</button></article>})}</div> : <p>No Tasks yet</p>}
                  {reviewPageCount > 1 && <div className="event-creation-plan-pager"><button type="button" disabled={reviewPage === 0} onClick={() => setReviewPage((page) => page - 1)}>Previous 5</button><span>Showing {reviewPage * 5 + 1}–{Math.min((reviewPage + 1) * 5, selectedTemplate?.tasks.length ?? 0)}</span><button type="button" disabled={reviewPage === reviewPageCount - 1} onClick={() => setReviewPage((page) => page + 1)}>Next 5</button></div>}
                </div>
              )}
              {showTemplateBuilder && (
                <div className="event-template-builder" role="dialog" aria-labelledby="custom-template-title">
                  <div className="event-template-builder-card">
                    <header><div><p>Custom Event Template</p><h2 id="custom-template-title">Build a reusable workflow</h2></div><button aria-label="Close custom template builder" className="event-creation-close" type="button" onClick={() => setShowTemplateBuilder(false)}>×</button></header>
                    <div className="event-creation-body">
                      <label>Template name<input value={customTemplateName} onChange={(event) => setCustomTemplateName(event.target.value)} placeholder="e.g. Community outreach" /></label>
                      <label>Description<input value={customTemplateDescription} onChange={(event) => setCustomTemplateDescription(event.target.value)} /></label>
                      <h3>Task definitions</h3>
                      {customTemplateTasks.map((task, index) => <fieldset className="event-creation-task" key={task.id}><label>Task title<input aria-label={`Task title ${index + 1}`} value={task.name} onChange={(event) => setCustomTemplateTasks((current) => current.map((item) => item.id === task.id ? { ...item, name: event.target.value } : item))} /></label><label>Phase<select value={task.category} onChange={(event) => setCustomTemplateTasks((current) => current.map((item) => item.id === task.id ? { ...item, category: event.target.value as TaskCategory } : item))}><option value="planning">Planning</option><option value="execution">Execution</option><option value="post_execution">Post-execution</option></select></label><label>Days relative to Event date<input aria-label={`Days relative to Event date ${index + 1}`} type="number" value={task.relative_due_days} onChange={(event) => setCustomTemplateTasks((current) => current.map((item) => item.id === task.id ? { ...item, relative_due_days: event.target.value } : item))} /></label><label>Subtasks (comma separated)<input value={task.subtasks} onChange={(event) => setCustomTemplateTasks((current) => current.map((item) => item.id === task.id ? { ...item, subtasks: event.target.value } : item))} /></label><button type="button" onClick={() => setCustomTemplateTasks((current) => current.filter((item) => item.id !== task.id))}>Remove</button></fieldset>)}
                      <button className="event-creation-add-task" type="button" onClick={() => setCustomTemplateTasks((current) => [...current, { id: Date.now(), name: "", relative_due_days: "0", category: "planning", subtasks: "" }])}>＋ Add Task definition</button>
                    </div>
                    <footer><button type="button" onClick={() => setShowTemplateBuilder(false)}>Cancel</button><button type="button" disabled={savingTemplate} onClick={saveCustomTemplate}>{savingTemplate ? "Saving…" : "Save Event Template"}</button></footer>
                  </div>
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
                <div><p>Event action</p><h2 id="event-action-title">{eventDialog === "edit" ? "Edit Event details" : eventDialog === "reschedule" ? "Reschedule Event" : eventDialog === "close" ? "Close Event" : eventDialog === "cancel" ? "Cancel Event" : "Delete Event"}</h2></div>
                <button aria-label="Cancel Event action" className="event-creation-close" type="button" onClick={() => setEventDialog(null)}>×</button>
              </header>
              <div className="event-creation-body api-action-body">
                {eventDialog === "edit" && <div className="event-creation-fields">
                  <label>Event name<input value={eventForm.name} onChange={(input) => setEventForm({ ...eventForm, name: input.target.value })} /></label>
                  <label>Venue<input value={eventForm.venue} onChange={(input) => setEventForm({ ...eventForm, venue: input.target.value })} /></label>
                  <label>Start time<input type="time" value={eventForm.start_time} onChange={(input) => setEventForm({ ...eventForm, start_time: input.target.value })} /></label>
                  <label>End time<input type="time" value={eventForm.end_time} onChange={(input) => setEventForm({ ...eventForm, end_time: input.target.value })} /></label>
                  <label className="event-creation-description">Description<textarea rows={3} value={eventForm.description} onChange={(input) => setEventForm({ ...eventForm, description: input.target.value })} /></label>
                </div>}
                {eventDialog === "reschedule" && <div className="event-creation-fields">
                  <label>New Event date<input type="date" value={eventForm.event_date} onChange={(input) => setEventForm({ ...eventForm, event_date: input.target.value })} /></label>
                  <label className="api-checkbox-field"><input checked={eventForm.shift_task_deadlines} type="checkbox" onChange={(input) => setEventForm({ ...eventForm, shift_task_deadlines: input.target.checked })} /> Shift Task deadlines by the same number of days</label>
                </div>}
                {eventDialog === "close" && <p>Closing this Event makes its details and Tasks read-only until it is reopened.</p>}
                {eventDialog === "cancel" && <p className="api-danger-notice">Cancelling tells participants and volunteers this Event isn't happening. It closes registration and marks the Event as cancelled instead of merely closed — this can't be undone from here.</p>}
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
                {eventDialog === "cancel" && <button className="api-delete-confirm" disabled={saving} type="button" onClick={() => void cancelEventAction(openEvent)}>Confirm cancellation</button>}
                {eventDialog === "delete" && <button className="api-delete-confirm" disabled={saving || eventForm.delete_name !== openEvent.name} type="button" onClick={() => void deleteEvent(openEvent)}>Delete permanently</button>}
              </footer>
            </section>
          </div>
        )}

        {openEvent && editingTaskId !== null && (
          <div className="event-creation-overlay" role="presentation">
            <section aria-labelledby="task-editor-title" aria-modal="true" className="event-creation-dialog api-task-dialog" role="dialog">
              <header>
                <div><p>{taskEditorMode === "preview" ? "Task preview" : "Task editor"}</p><h2 id="task-editor-title">{editingTaskId === "new" ? "Add Task" : taskEditorMode === "preview" ? editingTask?.name ?? "Task" : `Edit ${editingTask?.name ?? "Task"}`}</h2></div>
                <button aria-label="Close Task editor" className="event-creation-close" type="button" onClick={() => setEditingTaskId(null)}>×</button>
              </header>
              <div className="event-creation-body api-task-editor-body">
                <div className="api-task-fields">
                  <label>Task name<input readOnly={taskEditorMode === "preview"} value={taskForm.name} onChange={(input) => setTaskForm({ ...taskForm, name: input.target.value })} /></label>
                  <label>Due date<input readOnly={taskEditorMode === "preview"} type="date" value={taskForm.due_at} onChange={(input) => setTaskForm({ ...taskForm, due_at: input.target.value })} /></label>
                  <label>Category<select disabled={taskEditorMode === "preview"} value={taskForm.category} onChange={(input) => setTaskForm({ ...taskForm, category: input.target.value as TaskCategory })}><option value="planning">Planning</option><option value="execution">Execution</option><option value="post_execution">Post execution</option></select></label>
                  <fieldset className="api-task-assignee-picker">
                    <legend>Assignees</legend>
                    {([ ["Event organisers", eventTaskAssignees.organizers], ["Volunteer only", eventTaskAssignees.volunteers] ] as const).map(([label, people]) => <div key={label}>
                      <strong>{label}</strong>
                      {people.length ? people.map((person) => {
                        const value = `${person.person_type}:${person.person_id}`
                        return <label key={value}><input
                          aria-label={`Assign ${person.name}`}
                          checked={taskForm.assignees.includes(value)}
                          disabled={taskEditorMode === "preview"}
                          type="checkbox"
                          onChange={(input) => setTaskForm({ ...taskForm, assignees: input.target.checked
                            ? [...taskForm.assignees, value]
                            : taskForm.assignees.filter((candidate) => candidate !== value) })}
                        />{person.name}<small>{person.person_type === "team_member" ? "PTS staff" : label === "Event organisers" ? "Volunteer organiser" : "Volunteer"}</small></label>
                      }) : <span>None</span>}
                    </div>)}
                  </fieldset>
                  <label className="api-task-body-field">Description<textarea readOnly={taskEditorMode === "preview"} rows={4} value={taskForm.body} onChange={(input) => setTaskForm({ ...taskForm, body: input.target.value })} /></label>
                </div>
                {editingTask && <section aria-labelledby="task-checklist-title" className="api-task-checklist">
                  <header><div><h3 id="task-checklist-title">Subtasks</h3><p>Split this task into scheduled shifts or effort-based work.</p></div></header>
                  <div className="api-subtask-editor-list">
                    {editingTask.subtasks.map((subtask) => {
                      const form = subtaskForms[subtask.id] ?? subtaskDraft(subtask)
                      const logForm = timeLogForms[subtask.id] ?? { person: "", hours: "", notes: "" }
                      return <article className="api-subtask-editor" key={subtask.id}>
                        <header>
                          <label><input aria-label={`Complete ${subtask.title}`} checked={subtask.completed} disabled={taskEditorMode === "preview"} type="checkbox" onChange={() => void updateSubtask(openEvent, editingTask, subtask.id, { completed: !subtask.completed })} /><span>{subtask.completed ? "Completed" : "Open"}</span></label>
                          <strong>{form.kind === "scheduled" ? "Scheduled / shift" : "Effort-based"}</strong>
                        </header>
                        <div className="api-subtask-fields">
                          <label>Subtask name<input aria-label={`Checklist item ${subtask.id}`} readOnly={taskEditorMode === "preview"} value={form.title} onChange={(input) => setSubtaskForms({ ...subtaskForms, [subtask.id]: { ...form, title: input.target.value } })} /></label>
                          <label>Work type<select disabled={taskEditorMode === "preview"} value={form.kind} onChange={(input) => setSubtaskForms({ ...subtaskForms, [subtask.id]: { ...form, kind: input.target.value as SubtaskDraft["kind"] } })}><option value="effort">Effort / log hours</option><option value="scheduled">Scheduled / shift</option></select></label>
                          {form.kind === "scheduled" ? <>
                            <label>Date<input disabled={taskEditorMode === "preview"} type="date" value={form.scheduled_date} onChange={(input) => setSubtaskForms({ ...subtaskForms, [subtask.id]: { ...form, scheduled_date: input.target.value } })} /></label>
                            <label>Start<input disabled={taskEditorMode === "preview"} type="time" value={form.start_time} onChange={(input) => setSubtaskForms({ ...subtaskForms, [subtask.id]: { ...form, start_time: input.target.value } })} /></label>
                            <label>End<input disabled={taskEditorMode === "preview"} type="time" value={form.end_time} onChange={(input) => setSubtaskForms({ ...subtaskForms, [subtask.id]: { ...form, end_time: input.target.value } })} /></label>
                          </> : <label>Estimated hours<input disabled={taskEditorMode === "preview"} min="0" step="0.25" type="number" value={form.estimated_hours} onChange={(input) => setSubtaskForms({ ...subtaskForms, [subtask.id]: { ...form, estimated_hours: input.target.value } })} /></label>}
                        </div>
                        <fieldset className="api-subtask-assignees"><legend>People assigned to this subtask</legend>
                          {([["Event organisers", eventTaskAssignees.organizers], ["Volunteer only", eventTaskAssignees.volunteers]] as const).map(([label, people]) => <div key={label}><strong>{label}</strong>{people.map((person) => {
                            const value = `${person.person_type}:${person.person_id}`
                            return <label key={value}><input checked={form.assignees.includes(value)} disabled={taskEditorMode === "preview"} type="checkbox" onChange={(input) => setSubtaskForms({ ...subtaskForms, [subtask.id]: { ...form, assignees: input.target.checked ? [...form.assignees, value] : form.assignees.filter((item) => item !== value) } })} />{person.name}</label>
                          })}</div>)}
                        </fieldset>
                        {form.kind === "effort" && <div className="api-subtask-time-logs">
                          <strong>Hours logged: {Math.round((subtask.time_logs ?? []).reduce((sum, log) => sum + log.minutes_spent, 0) / 6) / 10}</strong>
                          {(subtask.time_logs ?? []).map((log) => <small key={log.id}>{log.name} · {Math.round(log.minutes_spent / 6) / 10}h{log.notes ? ` · ${log.notes}` : ""}</small>)}
                          {taskEditorMode === "edit" && <div><select aria-label={`Person logging time for ${subtask.title}`} value={logForm.person} onChange={(input) => setTimeLogForms({ ...timeLogForms, [subtask.id]: { ...logForm, person: input.target.value } })}><option value="">Choose assignee</option>{(subtask.assignees ?? []).map((person) => <option key={`${person.person_type}:${person.person_id}`} value={`${person.person_type}:${person.person_id}`}>{person.name}</option>)}</select><input aria-label={`Hours spent on ${subtask.title}`} min="0.1" placeholder="Hours" step="0.25" type="number" value={logForm.hours} onChange={(input) => setTimeLogForms({ ...timeLogForms, [subtask.id]: { ...logForm, hours: input.target.value } })} /><input aria-label={`Time log notes for ${subtask.title}`} placeholder="Notes (optional)" value={logForm.notes} onChange={(input) => setTimeLogForms({ ...timeLogForms, [subtask.id]: { ...logForm, notes: input.target.value } })} /><button disabled={saving || !logForm.person || !Number(logForm.hours)} type="button" onClick={() => void logSubtaskTime(openEvent, editingTask, subtask)}>Log hours</button></div>}
                        </div>}
                        {taskEditorMode === "edit" && <footer><button disabled={saving || !form.title.trim()} type="button" onClick={() => void saveSubtask(openEvent, editingTask, subtask)}>Save subtask</button>{form.kind === "scheduled" && <button disabled={saving} type="button" onClick={() => void duplicateScheduledSubtask(openEvent, editingTask, subtask)}>Duplicate shift</button>}{confirmDeleteSubtaskId === subtask.id ? <><button className="api-danger-button" type="button" onClick={() => void deleteSubtask(openEvent, editingTask, subtask.id)}>Confirm delete</button><button type="button" onClick={() => setConfirmDeleteSubtaskId(null)}>Cancel</button></> : <button type="button" onClick={() => setConfirmDeleteSubtaskId(subtask.id)}>Delete</button>}</footer>}
                      </article>
                    })}
                  </div>
                  {!editingTask.subtasks.length && <p>No subtasks yet.</p>}
                  {taskEditorMode === "edit" && <div className="api-add-subtask">
                    <h4>Add subtask</h4>
                    <div className="api-subtask-fields"><label>Subtask name<input aria-label="New checklist item" placeholder="e.g. Morning collection shift" value={newSubtaskForm.title || newSubtaskTitle} onChange={(input) => { setNewSubtaskTitle(input.target.value); setNewSubtaskForm({ ...newSubtaskForm, title: input.target.value }) }} /></label><label>Work type<select value={newSubtaskForm.kind} onChange={(input) => setNewSubtaskForm({ ...newSubtaskForm, kind: input.target.value as SubtaskDraft["kind"] })}><option value="effort">Effort / log hours</option><option value="scheduled">Scheduled / shift</option></select></label>{newSubtaskForm.kind === "scheduled" ? <><label>Date<input type="date" value={newSubtaskForm.scheduled_date} onChange={(input) => setNewSubtaskForm({ ...newSubtaskForm, scheduled_date: input.target.value })} /></label><label>Start<input type="time" value={newSubtaskForm.start_time} onChange={(input) => setNewSubtaskForm({ ...newSubtaskForm, start_time: input.target.value })} /></label><label>End<input type="time" value={newSubtaskForm.end_time} onChange={(input) => setNewSubtaskForm({ ...newSubtaskForm, end_time: input.target.value })} /></label></> : <label>Estimated hours<input min="0" step="0.25" type="number" value={newSubtaskForm.estimated_hours} onChange={(input) => setNewSubtaskForm({ ...newSubtaskForm, estimated_hours: input.target.value })} /></label>}</div>
                    <fieldset className="api-subtask-assignees"><legend>Assign people now (optional)</legend>{([["Event organisers", eventTaskAssignees.organizers], ["Volunteer only", eventTaskAssignees.volunteers]] as const).map(([label, people]) => <div key={label}><strong>{label}</strong>{people.map((person) => { const value = `${person.person_type}:${person.person_id}`; return <label key={value}><input checked={newSubtaskForm.assignees.includes(value)} type="checkbox" onChange={(input) => setNewSubtaskForm({ ...newSubtaskForm, assignees: input.target.checked ? [...newSubtaskForm.assignees, value] : newSubtaskForm.assignees.filter((item) => item !== value) })} />{person.name}</label> })}</div>)}</fieldset>
                    <button disabled={saving || !(newSubtaskForm.title || newSubtaskTitle).trim()} type="button" onClick={() => void addSubtask(openEvent, editingTask)}>Add {newSubtaskForm.kind === "scheduled" ? "scheduled" : "effort"} subtask</button>
                  </div>}
                </section>}
                {editingTaskId === "new" && <p className="api-editor-note">Save the Task first, then add checklist items here.</p>}
                {error && <p className="event-creation-error" role="alert">{error}</p>}
                {taskEditorMode === "edit" && editingTask && (confirmDeleteTask ? <div className="api-delete-task-confirm"><span>Delete this Task and its checklist?</span><button className="api-danger-button" type="button" onClick={() => void deleteTask(openEvent, editingTask.id)}>Confirm delete Task</button><button type="button" onClick={() => setConfirmDeleteTask(false)}>Cancel</button></div> : <button className="api-task-delete-button" type="button" onClick={() => setConfirmDeleteTask(true)}>Delete Task</button>)}
              </div>
              <footer><button type="button" onClick={() => setEditingTaskId(null)}>Close</button>{taskEditorMode === "preview" ? openEvent.status === "open" && <button type="button" onClick={() => setTaskEditorMode("edit")}>Edit Task</button> : <button disabled={saving} type="button" onClick={() => void saveTask(openEvent)}>{editingTaskId === "new" ? "Create Task" : "Save Task"}</button>}</footer>
            </section>
          </div>
        )}
      </div>
    </section>
  )
}
