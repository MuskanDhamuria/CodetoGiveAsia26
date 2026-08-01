// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ParticipantApp from "../ParticipantApp"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

const OPEN_EVENT = {
  id: 1,
  name: "Wellness Morning",
  venue: "Tampines Hub",
  description: "Bring a water bottle.",
  event_date: "2099-01-01",
  event_time: "09:00",
  status: "open",
}

const CLOSED_EVENT = {
  ...OPEN_EVENT,
  id: 2,
  name: "Fully Booked Workshop",
  status: "closed",
}

const KNOWN_PARTICIPANT = {
  participantId: 42,
  name: "Alice",
  contactNumber: "+6591234567",
  email: null,
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

function renderEvent(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
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

describe("Cancelling a signup (TICKET-16 / TICKET-10)", () => {
  it("returns to the Sign up state after a successful cancel", async () => {
    signInAs(KNOWN_PARTICIPANT)
    mockRoutes({
      "GET /api/v1/events/1": () => jsonResponse(OPEN_EVENT),
      "GET /api/v1/participants/42/events?limit=100": () =>
        jsonResponse({
          items: [{ ...OPEN_EVENT, rsvp_status: true, attendance: null }],
          total: 1,
          limit: 100,
          offset: 0,
        }),
      "PATCH /api/v1/events/1/participants/42": () =>
        jsonResponse({ event_id: 1, participant_id: 42, rsvp_status: false, attendance: null }),
    })

    const user = userEvent.setup()
    renderEvent("/participant/events/1")

    expect(await screen.findByText("You're signed up for this event.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Cancel my signup" }))

    expect(await screen.findByRole("button", { name: "Sign up" })).toBeTruthy()
    expect(screen.queryByText("You're signed up for this event.")).toBeNull()
  })

  it("recovers cleanly when the registration is already gone (404) instead of showing a stale Cancel button", async () => {
    signInAs(KNOWN_PARTICIPANT)
    mockRoutes({
      "GET /api/v1/events/1": () => jsonResponse(OPEN_EVENT),
      "GET /api/v1/participants/42/events?limit=100": () =>
        jsonResponse({
          items: [{ ...OPEN_EVENT, rsvp_status: true, attendance: null }],
          total: 1,
          limit: 100,
          offset: 0,
        }),
      "PATCH /api/v1/events/1/participants/42": () =>
        jsonResponse({ detail: "Registration not found" }, 404),
    })

    const user = userEvent.setup()
    renderEvent("/participant/events/1")

    expect(await screen.findByText("You're signed up for this event.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Cancel my signup" }))

    expect(await screen.findByRole("button", { name: "Sign up" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Cancel my signup" })).toBeNull()
    expect(screen.queryByText(/Registration not found/)).toBeNull()
  })
})

describe("A known participant signing up for another event (TICKET-16)", () => {
  it("registers directly with one click, without going through the signup form", async () => {
    signInAs(KNOWN_PARTICIPANT)
    mockRoutes({
      "GET /api/v1/events/1": () => jsonResponse(OPEN_EVENT),
      "GET /api/v1/participants/42/events?limit=100": () =>
        jsonResponse({ items: [], total: 0, limit: 100, offset: 0 }),
      "POST /api/v1/events/1/participants": () =>
        jsonResponse(
          { event_id: 1, participant_id: 42, rsvp_status: true, attendance: null },
          201,
        ),
    })

    const user = userEvent.setup()
    renderEvent("/participant/events/1")

    const signUpButton = await screen.findByRole("button", { name: "Sign up" })
    expect(screen.queryByLabelText("Name")).toBeNull()

    await user.click(signUpButton)

    expect(await screen.findByText("You're signed up for this event.")).toBeTruthy()
  })
})

describe("Closed events (TICKET-16)", () => {
  it("shows the closed message with no signup affordance for a visitor with no existing RSVP", async () => {
    mockRoutes({
      "GET /api/v1/events/2": () => jsonResponse(CLOSED_EVENT),
    })

    renderEvent("/participant/events/2")

    expect(await screen.findByText("Registration is closed for this event.")).toBeTruthy()
    expect(screen.queryByLabelText("Name")).toBeNull()
    expect(screen.queryByRole("button", { name: "Sign up" })).toBeNull()
  })
})

describe("Signup-check failures surface an error instead of hiding as 'not signed up' (TICKET-16 / TICKET-11)", () => {
  it("shows an error state instead of the Sign up button on a non-404 failure", async () => {
    signInAs(KNOWN_PARTICIPANT)
    mockRoutes({
      "GET /api/v1/events/1": () => jsonResponse(OPEN_EVENT),
      "GET /api/v1/participants/42/events?limit=100": () =>
        jsonResponse({ detail: "Internal Server Error" }, 500),
    })

    renderEvent("/participant/events/1")

    expect(
      await screen.findByText("Couldn't check your registration status. Refresh the page to try again."),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Sign up" })).toBeNull()
  })
})
