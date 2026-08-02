// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import EventVolunteerTab, { type EventVolunteerApi } from "./EventVolunteerTab"
import type { EventDetail, TaskAssigneeGroups } from "./admin-api"
import type { Signup, VolunteerDetail } from "./volunteer-api"

afterEach(cleanup)

const roles = [
  { id: 1, name: "Registration", category: "volunteer", is_required: false },
  { id: 2, name: "Logistics", category: "volunteer", is_required: false },
]

const requested: Signup = {
  id: 10,
  event_id: 4,
  volunteer_id: 100,
  volunteer_name: "Farah Hassan",
  status: "requested",
  assigned_role_id: null,
  assigned_role_name: null,
  preferred_role_names: ["Registration"],
  is_leader: false,
  attendance: null,
}

const approved: Signup = {
  id: 11,
  event_id: 4,
  volunteer_id: 101,
  volunteer_name: "Aisha Rahman",
  status: "approved",
  assigned_role_id: 1,
  assigned_role_name: "Registration",
  preferred_role_names: [],
  is_leader: true,
  attendance: null,
}

function profile(id: number, name: string): VolunteerDetail {
  return {
    id,
    name,
    contact_number: "+6591234567",
    email: `${name.toLocaleLowerCase().replace(" ", ".")}@example.com`,
    signup_status: "approved",
    skills: [{ id, name: "Registration Desk" }],
    interests: [],
    counts: { events_signed_up: 1, events_approved: 1, events_attended: 0 },
  }
}

function buildApi(signups: Signup[]) {
  const updateSignup = vi.fn().mockImplementation(
    (_eventId: number, signupId: number, changes: Partial<Signup>) => {
      const current = signups.find((signup) => signup.id === signupId)!
      const assignedRole = roles.find((role) => role.id === changes.assigned_role_id)
      return Promise.resolve({
        ...current,
        ...changes,
        assigned_role_name: changes.assigned_role_id === null
          ? null
          : assignedRole?.name ?? current.assigned_role_name,
      })
    },
  )
  const api: EventVolunteerApi = {
    addEventRole: vi.fn().mockImplementation((_eventId, name) => Promise.resolve({
      id: 3,
      name,
      category: "volunteer",
      is_required: false,
    })),
    listEventRoles: vi.fn().mockResolvedValue(roles),
    listEventSignups: vi.fn().mockResolvedValue({ items: signups, total: signups.length, limit: 50, offset: 0 }),
    getVolunteer: vi.fn().mockImplementation((id: number) => {
      const signup = signups.find((item) => item.volunteer_id === id)!
      return Promise.resolve(profile(id, signup.volunteer_name))
    }),
    approveSignup: vi.fn().mockImplementation((_eventId, signupId, body) => Promise.resolve({
      ...signups.find((signup) => signup.id === signupId)!,
      status: "approved" as const,
      assigned_role_id: body.assigned_role_id,
      assigned_role_name: roles.find((role) => role.id === body.assigned_role_id)?.name ?? null,
    })),
    rejectSignup: vi.fn(),
    updateSignup,
    deleteEventRole: vi.fn().mockResolvedValue(undefined),
  }
  return { api, updateSignup }
}

describe("event volunteer workspace", () => {
  it("approves a pending request into the selected role", async () => {
    const { api } = buildApi([requested, approved])
    const user = userEvent.setup()
    render(<EventVolunteerTab eventId={4} readOnly={false} api={api} />)

    const roleSelect = await screen.findByRole("combobox", { name: "Assign role to Farah Hassan" })
    await user.selectOptions(roleSelect, "2")
    await user.click(screen.getByRole("button", { name: "Approve" }))

    expect(api.approveSignup).toHaveBeenCalledWith(4, 10, { assigned_role_id: 2 })
    expect(await screen.findByText("Farah Hassan was approved and added to the event team.")).toBeTruthy()
  })

  it("removes the old role board while preserving preference management", async () => {
    const secondApproved: Signup = {
      ...approved,
      id: 12,
      volunteer_id: 102,
      volunteer_name: "Ben Ong",
      is_leader: false,
    }
    const { api } = buildApi([secondApproved, approved])
    render(<EventVolunteerTab eventId={4} readOnly={false} api={api} />)

    expect(await screen.findByRole("button", { name: "Manage preference options" })).toBeTruthy()
    expect(screen.queryByText("Role allocation")).toBeNull()
  })

  it("manages roles for the selected event and protects roles with assignments", async () => {
    const { api } = buildApi([approved])
    const user = userEvent.setup()
    render(<EventVolunteerTab eventId={4} readOnly={false} api={api} />)

    await user.click(await screen.findByRole("button", { name: "Manage preference options" }))
    const dialog = screen.getByRole("dialog", { name: "Manage preference options" })
    expect(within(dialog).getByText(/Changes apply only to this event/)).toBeTruthy()

    const registrationRow = within(dialog).getByText("Registration").closest("article")!
    expect((within(registrationRow).getByRole("button", { name: "Reassign first" }) as HTMLButtonElement).disabled).toBe(true)

    await user.type(within(dialog).getByPlaceholderText("e.g. Translation support"), "Translation support")
    await user.click(within(dialog).getByRole("button", { name: "Add preference" }))
    expect(api.addEventRole).toHaveBeenCalledWith(4, "Translation support")

    const translationRow = (await within(dialog).findByText("Translation support")).closest("article")!
    await user.click(within(translationRow).getByRole("button", { name: "Remove" }))
    expect(api.deleteEventRole).toHaveBeenCalledWith(4, 3)
  })

  it("shows preference details and makes an assignee the task lead", async () => {
    const preferredVolunteer = { ...approved, preferred_role_names: ["Registration Desk"], is_leader: false }
    const { api } = buildApi([preferredVolunteer])
    const event: EventDetail = {
      id: 4, event_template_id: null, name: "Wellness session", venue: "Hall",
      event_date: "2027-09-01", status: "open", is_cancelled: false,
      created_at: "", updated_at: "", tasks: [{
        id: 20, team_member_id: null, volunteer_id: 101, template_task_id: null,
        name: "Run registration", body: "", due_at: "2027-09-01",
        category: "planning", status: "incomplete", position: 0, subtasks: [],
        assignees: [{ person_type: "volunteer", person_id: 101, name: "Aisha Rahman", email: "aisha@example.com", is_lead: false }],
      }],
    }
    const taskPeople: TaskAssigneeGroups = {
      organizers: [],
      volunteers: [
        { person_type: "volunteer", person_id: 101, name: "Aisha Rahman", email: "aisha@example.com" },
        { person_type: "volunteer", person_id: 102, name: "John Tan", email: "john@example.com" },
      ],
    }
    const onUpdateTaskAssignees = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<EventVolunteerTab eventId={4} event={event} taskPeople={taskPeople} readOnly={false} api={api} onUpdateTaskAssignees={onUpdateTaskAssignees} onOpenTask={vi.fn()} />)

    expect(await screen.findByText("Registration Desk")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Make Aisha Rahman a task lead" }))
    expect(onUpdateTaskAssignees).toHaveBeenCalledWith(event.tasks[0], [
      { person_type: "volunteer", person_id: 101, is_lead: true },
    ])

    onUpdateTaskAssignees.mockClear()
    const taskCard = screen.getByText("Run registration").closest("article")!
    fireEvent.drop(taskCard, { dataTransfer: { getData: () => "volunteer:102" } })
    expect(onUpdateTaskAssignees).toHaveBeenCalledWith(event.tasks[0], [
      { person_type: "volunteer", person_id: 101, is_lead: false },
      { person_type: "volunteer", person_id: 102, is_lead: false },
    ])

    onUpdateTaskAssignees.mockClear()
    const assignedAisha = screen.getByRole("button", { name: "Make Aisha Rahman a task lead" }).closest(".task-allocation-task-person")!
    const peopleTray = screen.getByLabelText("People available for task assignment")
    const dataTransfer = { dropEffect: "", effectAllowed: "", getData: vi.fn(), setData: vi.fn() }
    fireEvent.dragStart(assignedAisha, { dataTransfer })
    fireEvent.dragOver(peopleTray, { dataTransfer })
    fireEvent.drop(peopleTray, { dataTransfer })
    expect(onUpdateTaskAssignees).toHaveBeenCalledWith(event.tasks[0], [])
  })
})
