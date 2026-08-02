// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import VolunteerDirectory from "./VolunteerDirectory"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("VolunteerDirectory", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("expands a profile inline and permanently removes it after confirmation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v1/volunteers") && !init?.method) {
        return json({
          items: [{
            id: 1,
            name: "Aisha Rahman",
            contact_number: "+6584567890",
            email: "aisha@example.com",
            signup_status: "approved",
            skills: ["Mandarin"],
            counts: { events_signed_up: 1, events_approved: 1, events_attended: 0 },
          }],
          total: 1,
          limit: 50,
          offset: 0,
        })
      }
      if (url.endsWith("/api/v1/events")) {
        return json({ items: [], total: 0, limit: 50, offset: 0 })
      }
      if (url.endsWith("/api/v1/volunteers/1/events")) {
        return json({ items: [], total: 0, limit: 50, offset: 0 })
      }
      if (url.endsWith("/api/v1/volunteers/1") && init?.method === "DELETE") {
        return new Response(null, { status: 204 })
      }
      if (url.endsWith("/api/v1/volunteers/1")) {
        return json({
          id: 1,
          name: "Aisha Rahman",
          contact_number: "+6584567890",
          email: "aisha@example.com",
          signup_status: "approved",
          skills: [{ id: 1, name: "Mandarin" }],
          interests: [],
          counts: { events_signed_up: 1, events_approved: 1, events_attended: 0 },
        })
      }
      return json({ detail: `Unexpected request: ${url}` }, 500)
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<VolunteerDirectory />)
    await screen.findByText("aisha@example.com")
    await user.click(screen.getByRole("button", { name: "View profile" }))

    expect(await screen.findByRole("region", { name: "Aisha Rahman profile" })).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()

    await user.click(screen.getByRole("button", { name: "Remove volunteer" }))
    expect(screen.getByText("Permanently remove Aisha Rahman?")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Remove permanently" }))

    await waitFor(() => expect(screen.getByText("No volunteers match these filters.")).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/volunteers/1",
      { method: "DELETE" },
    )
  })
})

describe("Volunteer directory mobile layout", () => {
  it("contains the wide volunteer list inside its own scroll region", () => {
    const styles = readFileSync("src/index.css", "utf8")

    expect(styles).toMatch(/\.volunteer-directory\s*\{[^}]*max-width:\s*100%/)
    expect(styles).toMatch(/\.crm-toolbar\s*\{[^}]*min-width:\s*0/)
    expect(styles).toMatch(/\.search-field[\s\S]*min-width:\s*0/)
    expect(styles).toMatch(/\.search-field input,[\s\S]*\.search-field select,[\s\S]*min-width:\s*0[^}]*max-width:\s*100%/)
    expect(styles).toMatch(/\.volunteer-table-card\s*\{[^}]*min-width:\s*0/)
    expect(styles).toMatch(/\.volunteer-table-wrap\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/)
  })
})
