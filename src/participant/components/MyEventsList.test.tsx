// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ParticipantApp from "../ParticipantApp"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

const KNOWN_PARTICIPANT = {
  participantId: 42,
  name: "Alice",
  contactNumber: "+6591234567",
  email: null,
}

const OPEN_EVENT = {
  id: 1,
  name: "Wellness Morning",
  venue: "Tampines Hub",
  description: "Bring a water bottle.",
  event_date: "2099-01-01",
  event_time: "09:00",
  status: "open",
  is_cancelled: false,
}

const CANCELLED_EVENT = {
  ...OPEN_EVENT,
  id: 2,
  name: "Rained-out Beach Cleanup",
  status: "closed",
  is_cancelled: true,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function signInAs(participant: typeof KNOWN_PARTICIPANT) {
  localStorage.setItem("p2s.participant", JSON.stringify(participant))
}

function renderMyEvents() {
  return render(
    <MemoryRouter initialEntries={["/participant/my-events"]}>
      <Routes>
        <Route path="/participant/*" element={<ParticipantApp />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

function mockRoutes(handlers: Record<string, () => Response | Promise<Response>>) {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    const method = init?.method ?? "GET"
    const key = `${method} ${url}`
    const handler = handlers[key]
    if (!handler) throw new Error(`Unhandled request in test: ${key}`)
    return handler()
  })
}

describe("MyEventsList", () => {
  it("shows the sign-up prompt for a visitor with no saved identity", async () => {
    renderMyEvents()

    expect(await screen.findByText("Sign up for an event to see it here.")).toBeTruthy()
  })

  it("lists events the participant has RSVP'd to", async () => {
    signInAs(KNOWN_PARTICIPANT)
    mockRoutes({
      "GET /api/v1/participants/42/events?limit=100": () =>
        jsonResponse({
          items: [{ ...OPEN_EVENT, rsvp_status: true, attendance: null }],
          total: 1,
          limit: 100,
          offset: 0,
        }),
    })

    renderMyEvents()

    expect(await screen.findByText("Wellness Morning")).toBeTruthy()
    expect(screen.queryByText("Cancelled")).toBeNull()
  })

  describe("Cancelled events (TICKET-9)", () => {
    it("still shows a since-cancelled event, flagged Cancelled, instead of dropping it", async () => {
      signInAs(KNOWN_PARTICIPANT)
      mockRoutes({
        "GET /api/v1/participants/42/events?limit=100": () =>
          jsonResponse({
            items: [{ ...CANCELLED_EVENT, rsvp_status: true, attendance: null }],
            total: 1,
            limit: 100,
            offset: 0,
          }),
      })

      renderMyEvents()

      expect(await screen.findByText("Rained-out Beach Cleanup")).toBeTruthy()
      expect(screen.getByText("Cancelled")).toBeTruthy()
    })
  })
})
