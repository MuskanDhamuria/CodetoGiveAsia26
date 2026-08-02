// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import EventAttendanceTab, { type EventAttendanceApi } from "./EventAttendanceTab"
import type { Participation, Signup } from "./volunteer-api"

afterEach(cleanup)

function buildApi(overrides: Partial<EventAttendanceApi> = {}): EventAttendanceApi {
  const signup: Signup = {
    id: 1, event_id: 9, volunteer_id: 3, volunteer_name: "Devi Suresh",
    status: "approved", assigned_role_id: 1, assigned_role_name: "Setup Crew",
    preferred_role_names: [], is_leader: false, attendance: null,
  }
  const participant: Participation = {
    participant_id: 5, name: "Kumar Selvam", contact_number: "+6591230101",
    email: null, rsvp_status: true, attendance: null,
  }
  return {
    listEventSignups: vi.fn().mockResolvedValue({ items: [signup], total: 1, limit: 100, offset: 0 }),
    listEventParticipants: vi.fn().mockResolvedValue({ items: [participant], total: 1, limit: 100, offset: 0 }),
    updateSignup: vi.fn().mockResolvedValue({ ...signup, attendance: true }),
    updateParticipation: vi.fn().mockResolvedValue({ ...participant, attendance: true }),
    ...overrides,
  }
}

describe("EventAttendanceTab", () => {
  it("lists approved volunteers and registered participants regardless of attendance", async () => {
    const api = buildApi()
    render(<EventAttendanceTab eventId={9} readOnly={false} api={api} />)

    expect(await screen.findByText("Devi Suresh")).toBeTruthy()
    expect(screen.getByText("Kumar Selvam")).toBeTruthy()
    expect(api.listEventSignups).toHaveBeenCalledWith(9, { status: "approved" })
    expect(api.listEventParticipants).toHaveBeenCalledWith(9)
  })

  it("marks a volunteer present via updateSignup", async () => {
    const api = buildApi()
    const user = userEvent.setup()
    render(<EventAttendanceTab eventId={9} readOnly={false} api={api} />)

    const row = (await screen.findByText("Devi Suresh")).closest("article")!
    await user.click(within(row).getByRole("button", { name: "Mark present" }))

    expect(api.updateSignup).toHaveBeenCalledWith(9, 1, { attendance: true })
    expect(await screen.findByText(/Marked Devi Suresh as attended/)).toBeTruthy()
  })

  it("marks a participant absent via updateParticipation, independent of QR attendance", async () => {
    const api = buildApi()
    const user = userEvent.setup()
    render(<EventAttendanceTab eventId={9} readOnly={false} api={api} />)

    const row = (await screen.findByText("Kumar Selvam")).closest("article")!
    await user.click(within(row).getByRole("button", { name: "Mark absent" }))

    expect(api.updateParticipation).toHaveBeenCalledWith(9, 5, { attendance: false })
  })

  it("hides the mark controls when read only", async () => {
    const api = buildApi()
    render(<EventAttendanceTab eventId={9} readOnly api={api} />)

    await screen.findByText("Devi Suresh")
    expect(screen.queryByRole("button", { name: "Mark present" })).toBeNull()
    expect(screen.getByText(/attendance can no longer be edited/)).toBeTruthy()
  })
})
