// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DashboardPage, EventCalendar } from "./App"
import type { AdminApi, EventDetail } from "./admin-api"


afterEach(cleanup)


describe("dashboard Event calendar", () => {
  it("renders API-backed KPIs and deadlines", async () => {
    const openEvent = vi.fn()
    const api = {
      listEvents: vi.fn().mockResolvedValue([]),
      getDashboardSummary: vi.fn().mockResolvedValue({ upcoming_events: 3, total_volunteers: 42, pending_volunteer_confirmations: 5, overdue_tasks: 2, tasks_due_soon: 7 }),
      listUpcomingDeadlines: vi.fn().mockResolvedValue([{ id: 9, event_id: 4, event_name: "Wellness session", name: "Book venue", due_at: "2026-08-08", category: "planning", status: "incomplete", team_member_id: null }]),
    } as unknown as AdminApi
    const user = userEvent.setup()

    render(<DashboardPage api={api} onOpenEvent={openEvent} onQuickAction={vi.fn()} />)
    expect(await screen.findByText("42")).toBeTruthy()
    expect(screen.getByText("Total Volunteers")).toBeTruthy()
    expect(within(screen.getByLabelText("Dashboard summary")).getByText("2")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: /book venue/i }))
    expect(openEvent).toHaveBeenCalledWith(4)
  })

  it("keeps dashboard data failures independent", async () => {
    const api = {
      listEvents: vi.fn().mockRejectedValue(new Error("calendar failed")),
      getDashboardSummary: vi.fn().mockRejectedValue(new Error("summary failed")),
      listUpcomingDeadlines: vi.fn().mockResolvedValue([]),
    } as unknown as AdminApi

    render(<DashboardPage api={api} onOpenEvent={vi.fn()} onQuickAction={vi.fn()} />)

    expect(await screen.findByText("Unable to load Events.")).toBeTruthy()
    expect(await screen.findByText("Unable to load dashboard summary.")).toBeTruthy()
    expect(await screen.findByText("No Tasks due in the next 14 days.")).toBeTruthy()
  })

  it("previews a calendar Event and opens its workspace", async () => {
    const event: EventDetail = {
      id: 7,
      event_template_id: 2,
      name: "Wellness Workshop",
      venue: "Tampines Hub",
      event_date: "2026-08-08",
      status: "open",
      is_cancelled: false,
      created_at: "2026-07-01 00:00:00",
      updated_at: "2026-07-01 00:00:00",
      tasks: [
        { id: 1, team_member_id: null, template_task_id: 1, name: "Book venue", body: "", due_at: "2026-07-01", category: "planning", status: "done", position: 0, subtasks: [] },
        { id: 2, team_member_id: null, template_task_id: 2, name: "Set up", body: "", due_at: "2026-08-08", category: "execution", status: "incomplete", position: 1, subtasks: [] },
      ],
    }
    const openWorkspace = vi.fn()
    const user = userEvent.setup()

    render(<EventCalendar events={[event]} onOpenWorkspace={openWorkspace} />)
    await user.click(screen.getByRole("button", { name: "Wellness Workshop" }))

    const preview = screen.getByRole("dialog", { name: "Wellness Workshop" })
    expect(within(preview).getByText("Tampines Hub")).toBeTruthy()
    expect(within(preview).getByText("1 of 2 Tasks completed")).toBeTruthy()
    await user.click(within(preview).getByRole("button", { name: "Open workspace" }))

    expect(openWorkspace).toHaveBeenCalledWith(7)
  })
})
