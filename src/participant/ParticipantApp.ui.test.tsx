// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ParticipantApp from "./ParticipantApp"

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      const method = init?.method ?? "GET"

      if (url === "/api/v1/events?order=asc&limit=100" && method === "GET") {
        return jsonResponse({ items: [OPEN_EVENT], total: 1, limit: 100, offset: 0 })
      }
      if (url === "/api/v1/events/1" && method === "GET") {
        return jsonResponse(OPEN_EVENT)
      }
      if (url === "/api/v1/public/events/1/rsvp" && method === "POST") {
        return jsonResponse(
          {
            participant_id: 42,
            participant_name: "Alice",
            participant_contact_number: "+6591234567",
            participant_email: null,
            event_id: 1,
            rsvp_status: true,
          },
          201,
        )
      }
      if (url === "/api/v1/participants/42/events?limit=100" && method === "GET") {
        return jsonResponse({
          items: [{ ...OPEN_EVENT, rsvp_status: true, attendance: null }],
          total: 1,
          limit: 100,
          offset: 0,
        })
      }
      if (url === "/api/v1/participants/999/events?limit=100" && method === "GET") {
        return jsonResponse({ detail: "Participant 999 was not found" }, 404)
      }
      if (url.startsWith("/api/v1/participants/lookup?contact_number=") && method === "GET") {
        const raw = new URLSearchParams(url.split("?")[1]).get("contact_number") ?? ""
        const contactNumber = raw.replace(/[^\d+]/g, "")
        if (contactNumber === "+6591234567") {
          return jsonResponse({
            id: 42,
            name: "Returning Alice",
            contact_number: "+6591234567",
            email: null,
          })
        }
        return jsonResponse({ detail: "Participant not found" }, 404)
      }
      throw new Error(`Unhandled request in test: ${method} ${url}`)
    }),
  )
}

beforeEach(() => {
  mockFetch()
})

describe("Participant signup journey", () => {
  it("browses to an event and signs up as a first-time participant", async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/participant"]}>
        <Routes>
          <Route path="/participant/*" element={<ParticipantApp />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText("Wellness Morning")).toBeTruthy()
    await user.click(screen.getByRole("link", { name: /Wellness Morning/ }))

    expect(await screen.findByText("Bring a water bottle.")).toBeTruthy()
    await user.type(screen.getByLabelText("Name"), "Alice")
    await user.type(screen.getByLabelText("Phone number"), "+6591234567")
    await user.click(screen.getByRole("button", { name: "Sign up" }))

    expect(await screen.findByText("You're signed up for this event.")).toBeTruthy()
  })
})

describe("Public RSVP identity (TICKET-12 / TICKET-15)", () => {
  it("stores the backend's canonical participant identity, not the raw form input", async () => {
    // Simulates the RSVP's contact number matching a pre-existing
    // participant under a different name/formatting — the response's
    // participant_name/participant_contact_number are what should end up
    // in local storage and on screen, not what was just typed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString()
        const method = init?.method ?? "GET"

        if (url === "/api/v1/events?order=asc&limit=100" && method === "GET") {
          return jsonResponse({ items: [OPEN_EVENT], total: 1, limit: 100, offset: 0 })
        }
        if (url === "/api/v1/events/1" && method === "GET") {
          return jsonResponse(OPEN_EVENT)
        }
        if (url === "/api/v1/public/events/1/rsvp" && method === "POST") {
          return jsonResponse(
            {
              participant_id: 42,
              participant_name: "Canonical Alice",
              participant_contact_number: "+6591234567",
              participant_email: null,
              event_id: 1,
              rsvp_status: true,
            },
            201,
          )
        }
        if (url === "/api/v1/participants/42/events?limit=100" && method === "GET") {
          return jsonResponse({
            items: [{ ...OPEN_EVENT, rsvp_status: true, attendance: null }],
            total: 1,
            limit: 100,
            offset: 0,
          })
        }
        throw new Error(`Unhandled request in test: ${method} ${url}`)
      }),
    )

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/participant"]}>
        <Routes>
          <Route path="/participant/*" element={<ParticipantApp />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText("Wellness Morning")).toBeTruthy()
    await user.click(screen.getByRole("link", { name: /Wellness Morning/ }))

    expect(await screen.findByText("Bring a water bottle.")).toBeTruthy()
    await user.type(screen.getByLabelText("Name"), "Typo'd Alice")
    await user.type(screen.getByLabelText("Phone number"), "+6591234567")
    await user.click(screen.getByRole("button", { name: "Sign up" }))

    expect(await screen.findByText("You're signed up for this event.")).toBeTruthy()
    expect(await screen.findByText(/Signed in as Canonical Alice/)).toBeTruthy()
    expect(screen.queryByText(/Signed in as Typo'd Alice/)).toBeNull()
  })
})

describe("Stale local identity", () => {
  it("falls back to the signup form when the saved participant no longer exists", async () => {
    localStorage.setItem(
      "p2s.participant",
      JSON.stringify({
        participantId: 999,
        name: "Old Alice",
        contactNumber: "+6590000000",
        email: null,
      }),
    )

    render(
      <MemoryRouter initialEntries={["/participant/events/1"]}>
        <Routes>
          <Route path="/participant/*" element={<ParticipantApp />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText("Bring a water bottle.")).toBeTruthy()
    expect(await screen.findByLabelText("Name")).toBeTruthy()
    expect(screen.queryByText(/Signed in as Old Alice/)).toBeNull()
  })
})

describe("Sign in", () => {
  it("restores a returning participant's identity by phone number, without RSVPing", async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/participant/sign-in"]}>
        <Routes>
          <Route path="/participant/*" element={<ParticipantApp />} />
        </Routes>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText("Phone number"), "+6591234567")
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByText(/Signed in as Returning Alice/)).toBeTruthy()
    // Lands on My Events, not on an event's signup flow — no RSVP side effect.
    expect(screen.queryByRole("button", { name: "Sign up" })).toBeNull()
  })

  it("shows an honest empty state when no participant matches, not a raw API error", async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/participant/sign-in"]}>
        <Routes>
          <Route path="/participant/*" element={<ParticipantApp />} />
        </Routes>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText("Phone number"), "8765 4321")
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    expect(
      await screen.findByText(
        "We couldn't find that number — sign up for an event to get started.",
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/Signed in as/)).toBeNull()
  })

  it("hides the Sign in link once a participant is identified", async () => {
    localStorage.setItem(
      "p2s.participant",
      JSON.stringify({
        participantId: 42,
        name: "Returning Alice",
        contactNumber: "+6591234567",
        email: null,
      }),
    )

    render(
      <MemoryRouter initialEntries={["/participant"]}>
        <Routes>
          <Route path="/participant/*" element={<ParticipantApp />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Signed in as Returning Alice/)).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull()
  })
})

describe("Sign out", () => {
  it("clears the stored identity and shows the Sign in link again", async () => {
    // Regression test: restarting the backend with a fresh db while the
    // browser still has an old participant in localStorage left no way to
    // clear it short of clearing site data by hand.
    localStorage.setItem(
      "p2s.participant",
      JSON.stringify({
        participantId: 42,
        name: "Returning Alice",
        contactNumber: "+6591234567",
        email: null,
      }),
    )

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/participant"]}>
        <Routes>
          <Route path="/participant/*" element={<ParticipantApp />} />
        </Routes>
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole("button", { name: /Signed in as Returning Alice/ }))
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }))

    expect(screen.queryByText(/Signed in as/)).toBeNull()
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy()
    expect(localStorage.getItem("p2s.participant")).toBeNull()
  })
})
