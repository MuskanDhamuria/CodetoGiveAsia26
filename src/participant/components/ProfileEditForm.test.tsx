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

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={["/participant/profile"]}>
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

describe("ProfileEditForm (TICKET-46)", () => {
  it("prompts to sign in when there's no saved identity", async () => {
    renderProfile()

    expect(await screen.findByText("Sign in to edit your profile.")).toBeTruthy()
  })

  it("pre-fills the form with the saved identity and saves edits via PATCH", async () => {
    signInAs(KNOWN_PARTICIPANT)
    mockRoutes({
      "PATCH /api/v1/participants/42": () =>
        jsonResponse({
          id: 42,
          name: "Alice Tan",
          contact_number: "+6591234567",
          email: "alice.tan@example.com",
          created_at: "2026-01-01T00:00:00",
          updated_at: "2026-01-01T00:00:00",
        }),
    })

    const user = userEvent.setup()
    renderProfile()

    const nameInput = (await screen.findByLabelText("Name")) as HTMLInputElement
    expect(nameInput.value).toBe("Alice")

    await user.clear(nameInput)
    await user.type(nameInput, "Alice Tan")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    expect(await screen.findByText("Signed in as Alice Tan")).toBeTruthy()
  })

  it("surfaces a backend error instead of silently failing", async () => {
    signInAs(KNOWN_PARTICIPANT)
    mockRoutes({
      "PATCH /api/v1/participants/42": () =>
        jsonResponse({ detail: "Participant contact number or email already exists" }, 409),
    })

    const user = userEvent.setup()
    renderProfile()

    await screen.findByLabelText("Name")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    expect(
      await screen.findByText("Participant contact number or email already exists"),
    ).toBeTruthy()
  })
})
