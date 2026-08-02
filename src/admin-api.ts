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
  expected_attendance?: number | null
  created_at: string
  updated_at: string
  tasks: EventTask[]
}

export type CreateEventInput = Pick<
  EventDetail,
  "event_template_id" | "name" | "venue" | "event_date" | "expected_attendance"
>
export type CreateTemplateInput = Pick<EventTemplate, "name" | "description"> & {
  beneficiary_id?: number | null
}
export type CreateTemplateTaskInput = Pick<TemplateTask, "name" | "body" | "relative_due_days" | "category"> & {
  position?: number
}

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

export type Audience = "all" | "participants" | "volunteers"

export type Announcement = {
  id: number
  event_id: number | null
  title: string
  body: string
  audience: Audience
  kind: "announcement" | "reminder"
  created_by_team_member_id: number | null
  created_at: string
  sent_at: string | null
  delivered_count: number
  failed_count: number
}

export type CreateAnnouncementInput = {
  title: string
  body: string
  audience: Audience
}

export type Certificate = {
  id: number
  event_id: number
  participant_id: number | null
  volunteer_id: number | null
  download_token: string
  issued_at: string
  delivered_at: string | null
  link: string
}

export type TeamMemberWhatsAppLink = {
  whatsapp_contact_id: number
  team_member_id: number
  phone_number: string
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
  createEventTemplate(input: CreateTemplateInput): Promise<EventTemplate>
  createTemplateTask(templateId: number, input: CreateTemplateTaskInput): Promise<TemplateTask>
  createTemplateSubtask(templateId: number, taskId: number, input: { title: string; position?: number }): Promise<TemplateSubtask>
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
  listAnnouncements(eventId: number): Promise<Announcement[]>
  createAnnouncement(eventId: number, input: CreateAnnouncementInput): Promise<Announcement>
  createReminder(eventId: number, body?: string): Promise<Announcement>
  generateCertificates(eventId: number): Promise<Certificate[]>
  listCertificates(eventId: number): Promise<Certificate[]>
  getTeamMemberWhatsAppLink(memberId: number): Promise<TeamMemberWhatsAppLink | null>
  linkTeamMemberWhatsApp(memberId: number, phoneNumber: string): Promise<TeamMemberWhatsAppLink>
  unlinkTeamMemberWhatsApp(memberId: number): Promise<void>
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

  createEventTemplate(input) {
    return request<EventTemplate>("/event-templates", { method: "POST", body: JSON.stringify(input) }).then(async (template) => {
      const detail = await request<EventTemplate>(`/event-templates/${template.id}`)
      return detail
    })
  },

  createTemplateTask(templateId, input) {
    return request<TemplateTask>(`/event-templates/${templateId}/tasks`, { method: "POST", body: JSON.stringify(input) })
  },

  createTemplateSubtask(templateId, taskId, input) {
    return request<TemplateSubtask>(`/event-templates/${templateId}/tasks/${taskId}/subtasks`, { method: "POST", body: JSON.stringify(input) })
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

  listAnnouncements(eventId) {
    return request<Announcement[]>(`/events/${eventId}/announcements`)
  },

  createAnnouncement(eventId, input) {
    return request<Announcement>(`/events/${eventId}/announcements`, {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  createReminder(eventId, body) {
    return request<Announcement>(`/events/${eventId}/reminders`, {
      method: "POST",
      body: JSON.stringify(body ? { body } : {}),
    })
  },

  generateCertificates(eventId) {
    return request<Certificate[]>(`/events/${eventId}/certificates/generate`, { method: "POST" })
  },

  listCertificates(eventId) {
    return request<Certificate[]>(`/events/${eventId}/certificates`)
  },

  async getTeamMemberWhatsAppLink(memberId) {
    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1"
    const response = await fetch(`${baseUrl}/team-members/${memberId}/whatsapp-link`)
    if (response.status === 404) return null
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.detail ?? `Request failed with status ${response.status}`)
    }
    return response.json()
  },

  linkTeamMemberWhatsApp(memberId, phoneNumber) {
    return request<TeamMemberWhatsAppLink>(`/team-members/${memberId}/whatsapp-link`, {
      method: "POST",
      body: JSON.stringify({ phone_number: phoneNumber }),
    })
  },

  unlinkTeamMemberWhatsApp(memberId) {
    return request<void>(`/team-members/${memberId}/whatsapp-link`, { method: "DELETE" })
  },
}
