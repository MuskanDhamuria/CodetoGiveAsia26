// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ParticipantApp from "../ParticipantApp"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

// Computed relative to "today" (rather than hardcoded dates) so tests don't
// depend on faking the system clock and stay correct regardless of when
// they're run.
const NOW = new Date()
const TODAY_ISO = NOW.toISOString().slice(0, 10)

function isoDaysFromNow(days: number): string {
  const date = new Date(NOW)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const TODAY_EVENT = {
  id: 1,
  name: "Wellness Morning",
  venue: "Tampines Hub",
  description: "Bring a water bottle.",
  event_date: TODAY_ISO,
  status: "open",
}

// 40 days always lands in a different (earlier/later) calendar month than
// today, regardless of what day of the month "today" is.
const NEXT_MONTH_EVENT = {
  id: 2,
  name: "Digital Literacy Workshop",
  venue: "Jurong Community Hall",
  description: "Bring your own phone.",
  event_date: isoDaysFromNow(40),
  status: "closed",
}

const PAST_EVENT = {
  id: 3,
  name: "Founders Day 2025",
  venue: "City Hall",
  description: "Thanks for coming.",
  event_date: isoDaysFromNow(-40),
  status: "closed",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function mockFetch(events: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      const method = init?.method ?? "GET"

      if (url === "/api/v1/events?order=asc&limit=100" && method === "GET") {
        return jsonResponse({ items: events, total: events.length, limit: 100, offset: 0 })
      }
      if (url === "/api/v1/events/1" && method === "GET") {
        return jsonResponse(TODAY_EVENT)
      }
      throw new Error(`Unhandled request in test: ${method} ${url}`)
    }),
  )
}

function renderBrowse() {
  return render(
    <MemoryRouter initialEntries={["/participant"]}>
      <Routes>
        <Route path="/participant/*" element={<ParticipantApp />} />
      </Routes>
    </MemoryRouter>,
  )
}

// 40 days can cross 1-2 month boundaries depending on which months are
// involved; click a bounded number of times rather than assuming a fixed
// count, so the test isn't flaky depending on which day it runs.
async function clickUntilLinkVisible(user: ReturnType<typeof userEvent.setup>, buttonName: string, linkName: string) {
  for (let attempt = 0; attempt < 3 && !screen.queryByRole("link", { name: linkName }); attempt++) {
    await user.click(screen.getByRole("button", { name: buttonName }))
  }
}

describe("List view", () => {
  it("has no Upcoming/Past toggle — only List/Calendar", async () => {
    mockFetch([TODAY_EVENT])
    renderBrowse()

    await screen.findByText("Wellness Morning")
    expect(screen.queryByRole("tab", { name: "Upcoming" })).toBeNull()
    expect(screen.queryByRole("tab", { name: "Past" })).toBeNull()
    expect(screen.getByRole("tab", { name: "List" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Calendar" })).toBeTruthy()
  })

  it("groups upcoming events by month, sorted chronologically", async () => {
    mockFetch([NEXT_MONTH_EVENT, TODAY_EVENT])
    renderBrowse()

    await screen.findByText("Wellness Morning")
    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)
    const monthName = (dateStr: string) =>
      new Intl.DateTimeFormat("en-SG", { month: "long", timeZone: "UTC" }).format(new Date(`${dateStr}T00:00:00Z`))
    // Today's event's month must appear before the +40-day event's month.
    const todayMonthIndex = headings.findIndex((text) => text?.includes(monthName(TODAY_ISO)))
    const nextMonthIndex = headings.findIndex((text) => text?.includes(monthName(NEXT_MONTH_EVENT.event_date)))
    expect(todayMonthIndex).toBeGreaterThanOrEqual(0)
    expect(nextMonthIndex).toBeGreaterThan(todayMonthIndex)
  })

  it("collapses past events into a summary at the top, hidden until expanded", async () => {
    const user = userEvent.setup()
    mockFetch([TODAY_EVENT, PAST_EVENT])
    renderBrowse()

    await screen.findByText("Wellness Morning")
    const details = screen.getByText("Past events (1)").closest("details")
    expect(details).toBeTruthy()
    // Collapsed by default. (jsdom has no CSS layout engine, so it can't
    // reflect <details>'s native hide-when-closed rendering — the `open`
    // property is the one thing that's actually meaningful to assert here.)
    expect((details as HTMLDetailsElement).open).toBe(false)

    await user.click(screen.getByText("Past events (1)"))
    expect((details as HTMLDetailsElement).open).toBe(true)
    expect(within(details as HTMLElement).getByText("Founders Day 2025")).toBeTruthy()
    // Past events don't show the registration-status badge.
    expect(within(details as HTMLElement).queryByText(/Registration/)).toBeNull()
  })

  it("does not show a past-events summary when there are no past events", async () => {
    mockFetch([TODAY_EVENT])
    renderBrowse()

    await screen.findByText("Wellness Morning")
    expect(screen.queryByText(/Past events/)).toBeNull()
  })
})

describe("Calendar view", () => {
  it("has no Upcoming/Past toggle", async () => {
    mockFetch([TODAY_EVENT])
    const user = userEvent.setup()
    renderBrowse()

    await screen.findByText("Wellness Morning")
    await user.click(screen.getByRole("tab", { name: "Calendar" }))

    expect(screen.queryByRole("tab", { name: "Upcoming" })).toBeNull()
    expect(screen.queryByRole("tab", { name: "Past" })).toBeNull()
  })

  it("plots events on their date and opens the detail page on click", async () => {
    mockFetch([TODAY_EVENT])
    const user = userEvent.setup()
    renderBrowse()

    expect(await screen.findByText("Wellness Morning")).toBeTruthy()
    await user.click(screen.getByRole("tab", { name: "Calendar" }))

    await user.click(screen.getByRole("link", { name: "Wellness Morning" }))
    expect(await screen.findByText("Bring a water bottle.")).toBeTruthy()
  })

  it("navigates to the next/previous month and back", async () => {
    mockFetch([TODAY_EVENT])
    const user = userEvent.setup()
    renderBrowse()

    await screen.findByText("Wellness Morning")
    await user.click(screen.getByRole("tab", { name: "Calendar" }))

    const initialMonthLabel = screen.getByRole("heading", { level: 3 }).textContent
    expect(screen.getByRole("link", { name: "Wellness Morning" })).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Next month" }))
    expect(screen.getByRole("heading", { level: 3 }).textContent).not.toBe(initialMonthLabel)
    expect(screen.queryByRole("link", { name: "Wellness Morning" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Previous month" }))
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(initialMonthLabel)
    expect(screen.getByRole("link", { name: "Wellness Morning" })).toBeTruthy()
  })

  it("switching back to List view shows the flat list again", async () => {
    mockFetch([TODAY_EVENT])
    const user = userEvent.setup()
    renderBrowse()

    await screen.findByText("Wellness Morning")
    await user.click(screen.getByRole("tab", { name: "Calendar" }))
    expect(screen.queryByText("Registration open")).toBeNull()

    await user.click(screen.getByRole("tab", { name: "List" }))
    expect(screen.getByText("Registration open")).toBeTruthy()
  })

  it("colors a past event grey regardless of status", async () => {
    mockFetch([PAST_EVENT])
    const user = userEvent.setup()
    renderBrowse()

    await screen.findByRole("tab", { name: "Calendar" })
    await user.click(screen.getByRole("tab", { name: "Calendar" }))
    await clickUntilLinkVisible(user, "Previous month", "Founders Day 2025")

    const link = screen.getByRole("link", { name: "Founders Day 2025" })
    expect(link.className).toContain("event-calendar-pill-past")
    expect(link.className).not.toContain("event-calendar-pill-open")
    expect(link.className).not.toContain("event-calendar-pill-closed")
  })

  it("colors an upcoming open event's pill distinctly from a closed one", async () => {
    mockFetch([TODAY_EVENT, NEXT_MONTH_EVENT])
    const user = userEvent.setup()
    renderBrowse()

    await screen.findByRole("tab", { name: "Calendar" })
    await user.click(screen.getByRole("tab", { name: "Calendar" }))

    const openLink = screen.getByRole("link", { name: "Wellness Morning" })
    expect(openLink.className).toContain("event-calendar-pill-open")

    await clickUntilLinkVisible(user, "Next month", "Digital Literacy Workshop")
    const closedLink = screen.getByRole("link", { name: "Digital Literacy Workshop" })
    expect(closedLink.className).toContain("event-calendar-pill-closed")
  })
})
