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
  updateEventTask(
    eventId: number,
    taskId: number,
    changes: Partial<
      Pick<
        EventTask,
        | "name"
        | "body"
        | "due_at"
        | "category"
        | "status"
        | "team_member_id"
        | "position"
      >
    >,
  ): Promise<EventTask>
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

  updateEventTask(eventId, taskId, changes) {
    return request<EventTask>(`/events/${eventId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    })
  },
}
