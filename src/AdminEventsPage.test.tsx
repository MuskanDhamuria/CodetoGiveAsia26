// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import AdminEventsPage from "./AdminEventsPage"
import type { AdminApi, EventDetail } from "./admin-api"


afterEach(cleanup)


describe("API-backed organizer events", () => {
  it("updates the selected event panel without opening the workspace", async () => {
    const events: EventDetail[] = [
      { id: 4, event_template_id: null, name: "First event", venue: "Hall A", event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "", tasks: [] },
      { id: 5, event_template_id: null, name: "Second event", venue: "Hall B", event_date: "2027-09-02", status: "open", is_cancelled: false, created_at: "", updated_at: "", tasks: [] },
    ]
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue(events),
      listTeamMembers: vi.fn().mockResolvedValue([]),
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "Open Second event" }))

    expect(screen.getByRole("heading", { name: "Second event" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Back to Events" })).toBeNull()
  })

  it("uses the event portfolio presentation from the prototype collection", async () => {
    const event: EventDetail = {
      id: 4, event_template_id: null, name: "Wellness session", venue: "Hall",
      event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "", tasks: [],
    }
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([event]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
    } as unknown as AdminApi

    render(<AdminEventsPage api={api} />)
    await screen.findByRole("heading", { name: "Event portfolio" })

    expect(document.querySelector(".collection-variant-c .portfolio-header")).toBeTruthy()
    expect(document.querySelector(".collection-variant-c .portfolio-split")).toBeTruthy()
    expect(document.querySelector(".event-collection-header")).toBeNull()
  })

  it("shows Event and Subtask completion in the workspace", async () => {
    const event: EventDetail = {
      id: 4, event_template_id: null, name: "Wellness session", venue: "Hall",
      event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "",
      tasks: [
        { id: 20, team_member_id: null, template_task_id: null, name: "Prepare room", body: "", due_at: "2027-08-30", category: "planning", status: "ongoing", position: 0, subtasks: [
          { id: 31, title: "Count chairs", position: 0, completed: true },
          { id: 32, title: "Arrange tables", position: 1, completed: false },
        ] },
        { id: 21, team_member_id: null, template_task_id: null, name: "Confirm venue", body: "", due_at: "2027-08-28", category: "planning", status: "done", position: 1, subtasks: [] },
      ],
    }
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([event]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))

    expect(screen.getByText("1 of 2 Tasks complete")).toBeTruthy()
    expect(screen.getByRole("progressbar", { name: "Event completion" }).getAttribute("aria-valuenow")).toBe("50")
    expect(screen.getByText("1 of 2 Subtasks complete")).toBeTruthy()
    expect(screen.getByRole("progressbar", { name: "Prepare room Subtask completion" }).getAttribute("aria-valuenow")).toBe("50")

    await user.click(screen.getByRole("button", { name: "Edit Prepare room" }))
    expect(screen.getByRole("heading", { name: "Edit Prepare room" })).toBeTruthy()
    expect(screen.getByLabelText("Checklist item 31")).toBeTruthy()
  })

  it("opens a read-only Task preview when its card is clicked", async () => {
    const event: EventDetail = {
      id: 4, event_template_id: null, name: "Wellness session", venue: "Hall",
      event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "",
      tasks: [{
        id: 20, team_member_id: null, template_task_id: null, name: "Prepare room",
        body: "Set out chairs", due_at: "2027-08-30", category: "planning",
        status: "ongoing", position: 0,
        subtasks: [{ id: 31, title: "Count chairs", position: 0, completed: true }],
      }],
    }
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([event]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))
    await user.click(screen.getByText("Prepare room"))

    expect(screen.getByText("Task preview")).toBeTruthy()
    expect((screen.getByLabelText("Task name") as HTMLInputElement).readOnly).toBe(true)
    expect((screen.getByLabelText("Complete Count chairs") as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole("button", { name: "Save Task" })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Edit Task" }))
    expect((screen.getByLabelText("Task name") as HTMLInputElement).readOnly).toBe(false)
    expect((screen.getByLabelText("Complete Count chairs") as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByRole("button", { name: "Save Task" })).toBeTruthy()
  })

  it("edits Event details through the API", async () => {
    const event: EventDetail = {
      id: 4, event_template_id: null, name: "Wellness session", venue: "Old Hall",
      event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "", tasks: [],
    }
    const updated = { ...event, name: "Community Wellness", venue: "Tampines Hub" }
    const updateEvent = vi.fn().mockResolvedValue(updated)
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]), listEvents: vi.fn().mockResolvedValue([event]),
      listTeamMembers: vi.fn().mockResolvedValue([]), updateEvent,
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))
    await user.click(screen.getByRole("button", { name: "Edit details" }))
    const name = screen.getByLabelText("Event name")
    await user.clear(name)
    await user.type(name, "Community Wellness")
    const venue = screen.getByLabelText("Venue")
    await user.clear(venue)
    await user.type(venue, "Tampines Hub")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    expect(updateEvent).toHaveBeenCalledWith(4, { name: "Community Wellness", venue: "Tampines Hub" })
    expect(await screen.findByRole("heading", { name: "Community Wellness" })).toBeTruthy()
  })

  it("reschedules, closes, and reopens an Event", async () => {
    const event: EventDetail = { id: 4, event_template_id: null, name: "Wellness session", venue: "Hall", event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "", tasks: [] }
    const rescheduled = { ...event, event_date: "2027-09-08" }
    const closed = { ...rescheduled, status: "closed" as const }
    const reopened = { ...rescheduled, status: "open" as const }
    const rescheduleEvent = vi.fn().mockResolvedValue(rescheduled)
    const closeEvent = vi.fn().mockResolvedValue(closed)
    const reopenEvent = vi.fn().mockResolvedValue(reopened)
    const api = { listEventTemplates: vi.fn().mockResolvedValue([]), listEvents: vi.fn().mockResolvedValue([event]), listTeamMembers: vi.fn().mockResolvedValue([]), rescheduleEvent, closeEvent, reopenEvent } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))
    await user.click(screen.getByRole("button", { name: "Reschedule" }))
    fireEvent.change(screen.getByLabelText("New Event date"), { target: { value: "2027-09-08" } })
    expect((screen.getByLabelText(/shift task deadlines/i) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole("button", { name: "Reschedule Event" }))
    expect(rescheduleEvent).toHaveBeenCalledWith(4, { event_date: "2027-09-08", shift_task_deadlines: true })

    await user.click(screen.getByRole("button", { name: "Close Event" }))
    await user.click(screen.getByRole("button", { name: "Confirm close" }))
    expect(closeEvent).toHaveBeenCalledWith(4)
    await user.click(await screen.findByRole("button", { name: "Reopen Event" }))
    expect(reopenEvent).toHaveBeenCalledWith(4)
    expect(await screen.findByRole("button", { name: "Add Task" })).toBeTruthy()
  })

  it("cancels an Event distinctly from closing it (TICKET-9)", async () => {
    const event: EventDetail = { id: 4, event_template_id: null, name: "Wellness session", venue: "Hall", event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "", tasks: [] }
    const cancelled = { ...event, status: "closed" as const, is_cancelled: true }
    const cancelEvent = vi.fn().mockResolvedValue(cancelled)
    const api = { listEventTemplates: vi.fn().mockResolvedValue([]), listEvents: vi.fn().mockResolvedValue([event]), listTeamMembers: vi.fn().mockResolvedValue([]), cancelEvent } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))

    await user.click(screen.getByRole("button", { name: "Cancel Event" }))
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }))
    expect(cancelEvent).toHaveBeenCalledWith(4)

    expect(await screen.findByText("Cancelled")).toBeTruthy()
    expect(await screen.findByText(/This Event has been cancelled/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Reopen Event" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Close Event" })).toBeNull()
  })

  it("hides cancelled Events from the portfolio by default, revealing them under Show cancelled", async () => {
    const open: EventDetail = { id: 1, event_template_id: null, name: "Open event", venue: "Hall A", event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "", tasks: [] }
    const cancelled: EventDetail = { id: 2, event_template_id: null, name: "Cancelled event", venue: "Hall B", event_date: "2027-09-05", status: "closed", is_cancelled: true, created_at: "", updated_at: "", tasks: [] }
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([open, cancelled]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await screen.findByRole("button", { name: "Open Open event" })

    expect(screen.queryByText("Cancelled event")).toBeNull()

    await user.click(screen.getByLabelText("Show cancelled"))
    expect(await screen.findByText("Cancelled event")).toBeTruthy()
  })

  it("requires the exact Event name before permanent deletion", async () => {
    const event: EventDetail = { id: 4, event_template_id: null, name: "Wellness session", venue: "Hall", event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "", tasks: [] }
    const deleteEvent = vi.fn().mockResolvedValue(undefined)
    const api = { listEventTemplates: vi.fn().mockResolvedValue([]), listEvents: vi.fn().mockResolvedValue([event]), listTeamMembers: vi.fn().mockResolvedValue([]), deleteEvent } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))
    await user.click(screen.getByRole("button", { name: "Delete Event" }))
    const confirm = screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await user.type(screen.getByLabelText("Confirm Event name"), "Wellness session")
    await user.click(confirm)
    expect(deleteEvent).toHaveBeenCalledWith(4)
    expect(await screen.findByText(/deleted wellness session/i)).toBeTruthy()
  })

  it("creates, assigns, edits, checks, and deletes a Task", async () => {
    const event: EventDetail = { id: 4, event_template_id: null, name: "Wellness session", venue: "Hall", event_date: "2027-09-01", status: "open", is_cancelled: false, created_at: "", updated_at: "", tasks: [] }
    const createdTask: EventDetail["tasks"][number] = { id: 20, team_member_id: 3, template_task_id: null, name: "Prepare room", body: "Set out chairs", due_at: "2027-08-30", category: "planning", status: "incomplete", position: 0, subtasks: [] }
    const checklist = { id: 31, title: "Count chairs", position: 0, completed: false }
    const createEventTask = vi.fn().mockResolvedValue(createdTask)
    const updateEventTask = vi.fn().mockImplementation((_eventId, _taskId, changes) => Promise.resolve({ ...createdTask, ...changes }))
    const createEventSubtask = vi.fn().mockResolvedValue(checklist)
    const updateEventSubtask = vi.fn().mockImplementation((_eventId, _taskId, _subtaskId, changes) => Promise.resolve({ ...checklist, ...changes }))
    const deleteEventSubtask = vi.fn().mockResolvedValue(undefined)
    const deleteEventTask = vi.fn().mockResolvedValue(undefined)
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]), listEvents: vi.fn().mockResolvedValue([event]),
      listTeamMembers: vi.fn().mockResolvedValue([{ id: 3, name: "Aisha", email: "a@x.test", is_active: true, created_at: "", updated_at: "" }]),
      createEventTask, updateEventTask, createEventSubtask, updateEventSubtask, deleteEventSubtask, deleteEventTask,
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))
    await user.click(screen.getByRole("button", { name: "Add Task" }))
    await user.type(screen.getByLabelText("Task name"), "Prepare room")
    await user.type(screen.getByLabelText("Description"), "Set out chairs")
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2027-08-30" } })
    await user.selectOptions(screen.getByLabelText("Assignee"), "3")
    await user.click(screen.getByRole("button", { name: "Create Task" }))
    expect(createEventTask).toHaveBeenCalledWith(4, { name: "Prepare room", body: "Set out chairs", due_at: "2027-08-30", category: "planning", team_member_id: 3 })

    await user.type(await screen.findByLabelText("New checklist item"), "Count chairs")
    await user.click(screen.getByRole("button", { name: "Add item" }))
    expect(createEventSubtask).toHaveBeenCalledWith(4, 20, { title: "Count chairs" })
    await user.click(await screen.findByLabelText("Complete Count chairs"))
    expect(updateEventSubtask).toHaveBeenCalledWith(4, 20, 31, { completed: true })
    const item = screen.getByLabelText("Checklist item 31")
    await user.clear(item)
    await user.type(item, "Count tables")
    const itemRow = item.closest("div")!
    await user.click(within(itemRow).getByRole("button", { name: "Save" }))
    expect(updateEventSubtask).toHaveBeenCalledWith(4, 20, 31, { title: "Count tables" })
    await user.click(within(itemRow).getByRole("button", { name: "Delete" }))
    await user.click(within(itemRow).getByRole("button", { name: "Confirm delete" }))
    expect(deleteEventSubtask).toHaveBeenCalledWith(4, 20, 31)

    await user.click(screen.getByRole("button", { name: "Delete Task" }))
    await user.click(screen.getByRole("button", { name: "Confirm delete Task" }))
    expect(deleteEventTask).toHaveBeenCalledWith(4, 20)
    expect((await screen.findAllByText(/task deleted/i)).length).toBeGreaterThan(0)
  })

  it("creates an event from scratch without a template", async () => {
    const created: EventDetail = {
      id: 9,
      event_template_id: null,
      name: "Scratch event",
      venue: "Community Hall",
      event_date: "2027-09-01",
      status: "open",
      is_cancelled: false,
      created_at: "2026-08-01 00:00:00",
      updated_at: "2026-08-01 00:00:00",
      tasks: [],
    }
    const createEvent = vi.fn().mockResolvedValue(created)
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([]),
      createEvent,
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await screen.findByRole("heading", { name: "Event portfolio" })
    await user.click(screen.getByRole("button", { name: /new event/i }))
    await user.click(screen.getByRole("button", { name: "Start from scratch" }))
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await user.type(screen.getByLabelText("Event name"), "Scratch event")
    fireEvent.change(screen.getByLabelText("Event date"), {
      target: { value: "2027-09-01" },
    })
    await user.type(screen.getByLabelText("Venue"), "Community Hall")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByText("No Tasks yet")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Create event" }))

    expect(createEvent).toHaveBeenCalledWith({
      event_template_id: null,
      name: "Scratch event",
      venue: "Community Hall",
      event_date: "2027-09-01",
    })
    expect(await screen.findByRole("heading", { name: "Scratch event" })).toBeTruthy()
  })

  it("operates an event task through the API", async () => {
    const event: EventDetail = {
      id: 4,
      event_template_id: 2,
      name: "Wellness session",
      venue: "Tampines Hub",
      event_date: "2027-09-01",
      status: "open",
      is_cancelled: false,
      created_at: "2026-08-01 00:00:00",
      updated_at: "2026-08-01 00:00:00",
      tasks: [{
        id: 11,
        team_member_id: null,
        template_task_id: 7,
        name: "Book venue",
        body: "",
        due_at: "2027-08-01",
        category: "planning",
        status: "incomplete",
        position: 0,
        subtasks: [],
      }],
    }
    const updatedTask = { ...event.tasks[0], status: "ongoing" as const }
    const updateEventTask = vi.fn().mockResolvedValue(updatedTask)
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([event]),
      updateEventTask,
    } as unknown as AdminApi
    const user = userEvent.setup()

    const { container } = render(<AdminEventsPage api={api} />)
    await screen.findByRole("heading", { name: "Wellness session" })
    expect(container.querySelector(".event-operations-template-list")).toBeNull()
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))
    await user.click(screen.getByRole("button", { name: "Start task" }))

    expect(updateEventTask).toHaveBeenCalledWith(4, 11, { status: "ongoing" })
    expect(await screen.findByRole("button", { name: "Mark done" })).toBeTruthy()
  })

  it("moves a task to a new status by dropping its card", async () => {
    const event: EventDetail = {
      id: 4,
      event_template_id: 2,
      name: "Wellness session",
      venue: "Tampines Hub",
      event_date: "2027-09-01",
      status: "open",
      is_cancelled: false,
      created_at: "2026-08-01 00:00:00",
      updated_at: "2026-08-01 00:00:00",
      tasks: [{
        id: 11,
        team_member_id: null,
        template_task_id: 7,
        name: "Book venue",
        body: "",
        due_at: "2027-08-01",
        category: "planning",
        status: "incomplete",
        position: 0,
        subtasks: [],
      }],
    }
    const updatedTask = { ...event.tasks[0], status: "ongoing" as const }
    const updateEventTask = vi.fn().mockResolvedValue(updatedTask)
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([event]),
      updateEventTask,
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))
    const taskCard = screen.getByText("Book venue").closest("article")!
    const inProgressColumn = screen.getByRole("heading", { name: "In progress 0" }).closest("section")!

    fireEvent.dragStart(taskCard)
    fireEvent.dragOver(inProgressColumn)
    fireEvent.drop(inProgressColumn)

    expect(updateEventTask).toHaveBeenCalledWith(4, 11, { status: "ongoing" })
    expect(await screen.findByRole("button", { name: "Mark done" })).toBeTruthy()
  })

  it("shows mobile status tabs and keeps task actions available", async () => {
    const event: EventDetail = {
      id: 4,
      event_template_id: null,
      name: "Wellness session",
      venue: "Hall",
      event_date: "2027-09-01",
      status: "open",
      created_at: "",
      updated_at: "",
      tasks: [{
        id: 11,
        team_member_id: null,
        template_task_id: null,
        name: "Prepare room",
        body: "",
        due_at: "2027-08-30",
        category: "planning",
        status: "incomplete",
        position: 0,
        subtasks: [],
      }],
    }
    const updateEventTask = vi.fn().mockResolvedValue({ ...event.tasks[0], status: "ongoing" })
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([event]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
      updateEventTask,
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} initialEventId={4} />)
    const tabs = await screen.findByRole("tablist", { name: "Task status" })
    expect(within(tabs).getByRole("tab", { name: /To do 1/ }).getAttribute("aria-selected")).toBe("true")
    await user.click(screen.getByRole("button", { name: "Start task" }))
    expect(updateEventTask).toHaveBeenCalledWith(4, 11, { status: "ongoing" })
  })

  it("renders a compact read-only workspace for a closed event", async () => {
    const event: EventDetail = {
      id: 1,
      event_template_id: 2,
      name: "Yoga at Tampines Hub",
      venue: "Tampines Hub",
      event_date: "2026-06-14",
      status: "closed",
      is_cancelled: false,
      created_at: "2026-04-01 00:00:00",
      updated_at: "2026-06-15 00:00:00",
      tasks: [{
        id: 5,
        team_member_id: null,
        template_task_id: 7,
        name: "Book the event venue",
        body: "",
        due_at: "2026-05-03",
        category: "planning",
        status: "done",
        position: 0,
        subtasks: [],
      }],
    }
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([event]),
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: /Open event workspace/ }))

    const workspace = screen.getByRole("region", { name: "Yoga at Tampines Hub" })
    const backButton = screen.getByRole("button", { name: "Back to Events" })
    expect(workspace.contains(backButton)).toBe(false)
    expect(screen.getByRole("heading", { name: "To do 0" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "In progress 0" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Done 1" })).toBeTruthy()
    expect(screen.getAllByText("No Tasks")).toHaveLength(2)
    expect(screen.getByText(/closed events are read-only/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /start task|mark done|reopen task/i })).toBeNull()
    await user.click(screen.getByText("Book the event venue"))
    expect(screen.getByText("Task preview")).toBeTruthy()
    expect((screen.getByLabelText("Task name") as HTMLInputElement).readOnly).toBe(true)
    expect(screen.queryByRole("button", { name: "Edit Task" })).toBeNull()
  })

  it("saves a custom template and makes it a selectable starting point", async () => {
    const createdTemplate = { id: 8, name: "Custom workflow", description: "Reusable", is_built_in: false, created_at: "", updated_at: "", tasks: [], roles: [] }
    const createdTask = { id: 80, event_template_id: 8, name: "Welcome volunteers", body: "", relative_due_days: -7, category: "planning" as const, position: 0, subtasks: [] }
    const api = {
      listEventTemplates: vi.fn().mockResolvedValue([]), listEvents: vi.fn().mockResolvedValue([]), listTeamMembers: vi.fn().mockResolvedValue([]),
      createEventTemplate: vi.fn().mockResolvedValue(createdTemplate), createTemplateTask: vi.fn().mockResolvedValue(createdTask), createTemplateSubtask: vi.fn(),
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await screen.findByRole("heading", { name: "Event portfolio" })
    await user.click(screen.getByRole("button", { name: /new event/i }))
    await user.click(screen.getByRole("button", { name: /create custom template/i }))
    await user.type(screen.getByLabelText("Template name"), "Custom workflow")
    await user.type(screen.getByLabelText("Task title 1"), "Welcome volunteers")
    await user.click(screen.getByRole("button", { name: "Save Event Template" }))

    expect(api.createEventTemplate).toHaveBeenCalledWith({ name: "Custom workflow", description: "" })
    expect(api.createTemplateTask).toHaveBeenCalledWith(8, expect.objectContaining({ name: "Welcome volunteers", relative_due_days: 0 }))
    expect(screen.getByRole("button", { name: /Custom workflow/ })).toBeTruthy()
  })

  it("switches between the first and next five tasks in plan review", async () => {
    const tasks = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, event_template_id: 2, name: `Task ${index + 1}`, body: "", relative_due_days: 0, category: "planning" as const, position: index, subtasks: [] }))
    const template = { id: 2, name: "Distribution", description: "", is_built_in: true, created_at: "", updated_at: "", tasks, roles: [] }
    const api = { listEventTemplates: vi.fn().mockResolvedValue([template]), listEvents: vi.fn().mockResolvedValue([]), listTeamMembers: vi.fn().mockResolvedValue([]) } as unknown as AdminApi
    const user = userEvent.setup()

    render(<AdminEventsPage api={api} />)
    await screen.findByRole("heading", { name: "Event portfolio" })
    await user.click(screen.getByRole("button", { name: /new event/i }))
    await user.click(screen.getByRole("button", { name: /Distribution/ }))
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await user.type(screen.getByLabelText("Event name"), "Community event")
    fireEvent.change(screen.getByLabelText("Event date"), { target: { value: "2027-09-01" } })
    await user.type(screen.getByLabelText("Venue"), "Hall")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(screen.getByText("Task 1")).toBeTruthy()
    expect(screen.queryByText("Task 6")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Next 5" }))
    expect(screen.getByText("Task 6")).toBeTruthy()
    expect(screen.queryByText("Task 1")).toBeNull()
  })
})
