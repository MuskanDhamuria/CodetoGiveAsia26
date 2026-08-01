// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import AdminEventsPage from "./AdminEventsPage"
import type { AdminApi, EventDetail } from "./admin-api"


afterEach(cleanup)


describe("API-backed organizer events", () => {
  it("creates an event from scratch without a template", async () => {
    const created: EventDetail = {
      id: 9,
      event_template_id: null,
      name: "Scratch event",
      venue: "Community Hall",
      event_date: "2027-09-01",
      status: "open",
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
    expect(await screen.findByText("Scratch event")).toBeTruthy()
  })

  it("operates an event task through the API", async () => {
    const event: EventDetail = {
      id: 4,
      event_template_id: 2,
      name: "Wellness session",
      venue: "Tampines Hub",
      event_date: "2027-09-01",
      status: "open",
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
    await screen.findByText("Wellness session")
    const eventList = container.querySelector(".event-operations-template-list")!
    expect(window.getComputedStyle(eventList).display).not.toBe("none")
    await user.click(await screen.findByRole("button", { name: "Open Wellness session" }))
    await user.click(screen.getByRole("button", { name: "Start task" }))

    expect(updateEventTask).toHaveBeenCalledWith(4, 11, { status: "ongoing" })
    expect(await screen.findByRole("button", { name: "Mark done" })).toBeTruthy()
  })

  it("renders a compact read-only workspace for a closed event", async () => {
    const event: EventDetail = {
      id: 1,
      event_template_id: 2,
      name: "Yoga at Tampines Hub",
      venue: "Tampines Hub",
      event_date: "2026-06-14",
      status: "closed",
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
    await user.click(await screen.findByRole("button", { name: "Open Yoga at Tampines Hub" }))

    const workspace = screen.getByRole("region", { name: "Yoga at Tampines Hub" })
    const backButton = screen.getByRole("button", { name: "Back to Events" })
    expect(workspace.contains(backButton)).toBe(false)
    expect(screen.getByRole("heading", { name: "To do 0" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "In progress 0" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Done 1" })).toBeTruthy()
    expect(screen.getAllByText("No Tasks")).toHaveLength(2)
    expect(screen.getByText(/closed events are read-only/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /start task|mark done|reopen task/i })).toBeNull()
  })
})
