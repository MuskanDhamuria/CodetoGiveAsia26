export type TaskCategory = "planning" | "execution" | "post_execution"
export type TaskStatus = "incomplete" | "ongoing" | "done"
export type EventStatus = "open" | "closed"

export type TemplateSubtask = {
  id: number
  template_task_id: number
  title: string
  position: number
}

export type TemplateTask = {
  id: number
  event_template_id: number
  name: string
  body: string
  relative_due_days: number
  category: TaskCategory
  position: number
  subtasks: TemplateSubtask[]
}

export type EventTemplate = {
  id: number
  name: string
  description: string
  is_built_in: boolean
  created_at: string
  updated_at: string
  tasks: TemplateTask[]
  roles: Array<{
    id: number
    name: string
    category: string
    is_required: boolean
  }>
}

export type EventSubtask = {
  id: number
  title: string
  position: number
  completed: boolean
}

export type EventTask = {
  id: number
  team_member_id: number | null
  template_task_id: number | null
  name: string
  body: string
  due_at: string
  category: TaskCategory
  status: TaskStatus
  position: number
  subtasks: EventSubtask[]
}

export type EventDetail = {
  id: number
  event_template_id: number | null
  name: string
  venue: string
  event_date: string
  status: EventStatus
  created_at: string
  updated_at: string
  tasks: EventTask[]
}

export type CreateEventInput = Pick<
  EventDetail,
  "event_template_id" | "name" | "venue" | "event_date"
>

export type UpdateEventInput = Partial<Pick<EventDetail, "name" | "venue">>
export type RescheduleEventInput = {
  event_date: string
  shift_task_deadlines: boolean
}
export type CreateEventTaskInput = Pick<EventTask, "name" | "body" | "due_at" | "category"> & {
  status?: TaskStatus
  team_member_id?: number | null
  position?: number
}
export type UpdateEventTaskInput = Partial<
  Pick<EventTask, "name" | "body" | "due_at" | "category" | "status" | "team_member_id" | "position">
>
export type TeamMember = {
  id: number
  name: string
  email: string
  is_active: boolean
  created_at: string
  updated_at: string
}
export type DashboardSummary = {
  upcoming_events: number
  total_volunteers: number
  pending_volunteer_confirmations: number
  overdue_tasks: number
  tasks_due_soon: number
}
export type UpcomingDeadline = {
  id: number
  event_id: number
  event_name: string
  name: string
  due_at: string
  category: TaskCategory
  status: TaskStatus
  team_member_id: number | null
}

type ListResponse<T> = {
  items: T[]
  total: number
  limit: number
  offset: number
}

type EventTemplateSummary = Omit<EventTemplate, "tasks" | "roles">
type EventSummary = Pick<
  EventDetail,
  "id" | "name" | "venue" | "event_date" | "status"
>

export interface AdminApi {
  listEventTemplates(): Promise<EventTemplate[]>
  listEvents(): Promise<EventDetail[]>
  createEvent(input: CreateEventInput): Promise<EventDetail>
  updateEvent(eventId: number, changes: UpdateEventInput): Promise<EventDetail>
  rescheduleEvent(eventId: number, input: RescheduleEventInput): Promise<EventDetail>
  closeEvent(eventId: number): Promise<EventDetail>
  reopenEvent(eventId: number): Promise<EventDetail>
  deleteEvent(eventId: number): Promise<void>
  createEventTask(eventId: number, input: CreateEventTaskInput): Promise<EventTask>
  updateEventTask(eventId: number, taskId: number, changes: UpdateEventTaskInput): Promise<EventTask>
  deleteEventTask(eventId: number, taskId: number): Promise<void>
  createEventSubtask(eventId: number, taskId: number, input: { title: string }): Promise<EventSubtask>
  updateEventSubtask(eventId: number, taskId: number, subtaskId: number, changes: Partial<Pick<EventSubtask, "title" | "completed" | "position">>): Promise<EventSubtask>
  deleteEventSubtask(eventId: number, taskId: number, subtaskId: number): Promise<void>
  listTeamMembers(): Promise<TeamMember[]>
  getDashboardSummary(): Promise<DashboardSummary>
  listUpcomingDeadlines(): Promise<UpcomingDeadline[]>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1"
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? `Request failed with status ${response.status}`)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export const adminApi: AdminApi = {
  async listEventTemplates() {
    const result = await request<ListResponse<EventTemplateSummary>>(
      "/event-templates?limit=100",
    )
    return Promise.all(
      result.items.map((template) =>
        request<EventTemplate>(`/event-templates/${template.id}`),
      ),
    )
  },

  async listEvents() {
    const result = await request<ListResponse<EventSummary>>(
      "/events?limit=100&order=asc",
    )
    return Promise.all(
      result.items.map((event) => request<EventDetail>(`/events/${event.id}`)),
    )
  },

  createEvent(input) {
    return request<EventDetail>("/events", {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  updateEvent(eventId, changes) {
    return request<EventDetail>(`/events/${eventId}`, { method: "PATCH", body: JSON.stringify(changes) })
  },

  rescheduleEvent(eventId, input) {
    return request<EventDetail>(`/events/${eventId}/reschedule`, { method: "POST", body: JSON.stringify(input) })
  },

  closeEvent(eventId) {
    return request<EventDetail>(`/events/${eventId}/close`, { method: "POST" })
  },

  reopenEvent(eventId) {
    return request<EventDetail>(`/events/${eventId}/reopen`, { method: "POST" })
  },

  deleteEvent(eventId) {
    return request<void>(`/events/${eventId}`, { method: "DELETE" })
  },

  createEventTask(eventId, input) {
    return request<EventTask>(`/events/${eventId}/tasks`, { method: "POST", body: JSON.stringify(input) })
  },

  updateEventTask(eventId, taskId, changes) {
    return request<EventTask>(`/events/${eventId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    })
  },

  deleteEventTask(eventId, taskId) {
    return request<void>(`/events/${eventId}/tasks/${taskId}`, { method: "DELETE" })
  },

  createEventSubtask(eventId, taskId, input) {
    return request<EventSubtask>(`/events/${eventId}/tasks/${taskId}/subtasks`, { method: "POST", body: JSON.stringify(input) })
  },

  updateEventSubtask(eventId, taskId, subtaskId, changes) {
    return request<EventSubtask>(`/events/${eventId}/tasks/${taskId}/subtasks/${subtaskId}`, { method: "PATCH", body: JSON.stringify(changes) })
  },

  deleteEventSubtask(eventId, taskId, subtaskId) {
    return request<void>(`/events/${eventId}/tasks/${taskId}/subtasks/${subtaskId}`, { method: "DELETE" })
  },

  async listTeamMembers() {
    const result = await request<ListResponse<TeamMember>>("/team-members?limit=100")
    return result.items
  },

  getDashboardSummary() {
    return request<DashboardSummary>("/dashboard/summary")
  },

  async listUpcomingDeadlines() {
    const result = await request<{ items: UpcomingDeadline[] }>("/dashboard/upcoming-deadlines?days=14&limit=8")
    return result.items
  },
}
