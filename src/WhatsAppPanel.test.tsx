// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import WhatsAppPanel from "./WhatsAppPanel"
import type { AdminApi, CertificateCandidate, EventDetail } from "./admin-api"

afterEach(cleanup)

const event: EventDetail = {
  id: 1, event_template_id: null, name: "Yoga at Tampines Hub", venue: "Hall A",
  event_date: "2026-08-14", status: "closed", is_cancelled: false,
  created_at: "", updated_at: "", tasks: [],
}

function buildCandidates(): CertificateCandidate[] {
  return [
    { type: "participant", id: 1, name: "Jia Yu", attended: true, already_issued: true, already_delivered: true },
    { type: "participant", id: 2, name: "Mike", attended: true, already_issued: true, already_delivered: true },
    { type: "participant", id: 3, name: "No Cert Yet", attended: false, already_issued: false, already_delivered: false },
  ]
}

function buildApi(overrides: Partial<AdminApi> = {}): AdminApi {
  return {
    listEventTemplates: vi.fn().mockResolvedValue([]),
    createEventTemplate: vi.fn(),
    createTemplateTask: vi.fn(),
    createTemplateSubtask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue([event]),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    rescheduleEvent: vi.fn(),
    closeEvent: vi.fn(),
    reopenEvent: vi.fn(),
    cancelEvent: vi.fn(),
    deleteEvent: vi.fn(),
    createEventTask: vi.fn(),
    updateEventTask: vi.fn(),
    deleteEventTask: vi.fn(),
    createEventSubtask: vi.fn(),
    updateEventSubtask: vi.fn(),
    deleteEventSubtask: vi.fn(),
    createEventSubtaskTimeLog: vi.fn(),
    listTeamMembers: vi.fn().mockResolvedValue([]),
    listEventTaskAssignees: vi.fn(),
    getDashboardSummary: vi.fn(),
    listUpcomingDeadlines: vi.fn(),
    listAnnouncements: vi.fn().mockResolvedValue([]),
    createAnnouncement: vi.fn(),
    createReminder: vi.fn(),
    generateCertificates: vi.fn(),
    listCertificates: vi.fn().mockResolvedValue([]),
    listCertificateCandidates: vi.fn().mockResolvedValue(buildCandidates()),
    sendCertificates: vi.fn().mockResolvedValue([]),
    getTeamMemberWhatsAppLink: vi.fn().mockResolvedValue(null),
    linkTeamMemberWhatsApp: vi.fn(),
    unlinkTeamMemberWhatsApp: vi.fn(),
    scanAttendance: vi.fn(),
    ...overrides,
  } as unknown as AdminApi
}

describe("WhatsAppPanel", () => {
  it("shows a shared event filter plus an event selector directly on the Certificates card", async () => {
    const api = buildApi()
    render(<WhatsAppPanel api={api} />)

    await screen.findByText("Jia Yu")
    expect(screen.getByText("Filtering by event")).toBeTruthy()
    // One selector in the shared "Filtering by event" section, one inside
    // the Certificates card itself, both kept in sync via selectedEventId.
    const eventSelectors = screen.getAllByLabelText("Event")
    expect(eventSelectors).toHaveLength(2)
    const certificatesCard = screen.getByText("Certificates").closest("section")!
    expect(within(certificatesCard).getByLabelText("Event")).toBeTruthy()
  })

  it("filters the certificate recipient list by delivery status", async () => {
    const api = buildApi()
    const user = userEvent.setup()
    render(<WhatsAppPanel api={api} />)

    await screen.findByText("Jia Yu")
    expect(screen.getByText("Mike")).toBeTruthy()
    expect(screen.getByText("No Cert Yet")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Not sent (1)" }))
    expect(screen.queryByText("Jia Yu")).toBeNull()
    expect(screen.queryByText("Mike")).toBeNull()
    expect(screen.getByText("No Cert Yet")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Sent (2)" }))
    expect(screen.getByText("Jia Yu")).toBeTruthy()
    expect(screen.getByText("Mike")).toBeTruthy()
    expect(screen.queryByText("No Cert Yet")).toBeNull()

    await user.click(screen.getByRole("button", { name: "All (3)" }))
    expect(screen.getByText("Jia Yu")).toBeTruthy()
    expect(screen.getByText("No Cert Yet")).toBeTruthy()
  })

  it("select all who attended only selects from the active filter", async () => {
    const api = buildApi()
    const user = userEvent.setup()
    render(<WhatsAppPanel api={api} />)

    await screen.findByText("Jia Yu")
    await user.click(screen.getByRole("button", { name: "Not sent (1)" }))
    await user.click(screen.getByRole("button", { name: "Select all who attended" }))

    // "No Cert Yet" (id 3) didn't attend, so nothing gets selected even
    // though it's the only row visible under the "Not sent" filter.
    expect(screen.getByRole("button", { name: "Send to selected (0)" })).toBeTruthy()
  })
})
