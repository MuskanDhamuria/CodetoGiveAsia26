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

  it("approves a requested event from the expanded profile", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v1/volunteers")) return json({ items: [{ id: 1, name: "Aisha Rahman", contact_number: "+6584567890", email: "aisha@example.com", signup_status: "approved", skills: [], counts: { events_signed_up: 1, events_approved: 0, events_attended: 0 } }], total: 1, limit: 50, offset: 0 })
      if (url.endsWith("/api/v1/events")) return json({ items: [{ id: 4, name: "Food drive", venue: "Hall", event_date: "2027-09-01", description: "", start_time: null, end_time: null, status: "open", beneficiary_id: 1 }], total: 1, limit: 50, offset: 0 })
      if (url.endsWith("/api/v1/volunteers/1")) return json({ id: 1, name: "Aisha Rahman", contact_number: "+6584567890", email: "aisha@example.com", signup_status: "approved", skills: [], interests: [], counts: { events_signed_up: 1, events_approved: 0, events_attended: 0 } })
      if (url.endsWith("/api/v1/volunteers/1/events")) return json({ items: [{ signup_id: 8, event_id: 4, event_name: "Food drive", event_date: "2027-09-01", status: "requested", assigned_role_id: null, assigned_role_name: null, preferred_role_names: ["Registration"], is_leader: false, attendance: null }], total: 1, limit: 50, offset: 0 })
      if (url.endsWith("/api/v1/events/4/roles")) return json([{ id: 3, name: "Registration", category: "volunteer", is_required: false }])
      if (url.endsWith("/api/v1/events/4/volunteer-signups/8/approve") && init?.method === "POST") return json({ id: 8, event_id: 4, volunteer_id: 1, volunteer_name: "Aisha Rahman", status: "approved", assigned_role_id: 3, assigned_role_name: "Registration", preferred_role_names: ["Registration"], is_leader: false, attendance: null })
      return json({ detail: `Unexpected request: ${url}` }, 500)
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<VolunteerDirectory />)
    await user.click(await screen.findByRole("button", { name: "View profile" }))
    expect(await screen.findByRole("combobox", { name: "Role for Food drive" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Approve" }))

    expect(await screen.findByText("Food drive request approved.")).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/4/volunteer-signups/8/approve",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ assigned_role_id: 3 }) }),
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
    expect(styles).toMatch(/\.volunteer-table th\s*\{[^}]*position:\s*relative/)
  })
})
