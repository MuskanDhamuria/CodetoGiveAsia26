// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AiCopilot from "./AiCopilot"
import { mockChatFetch, setDesktopViewport } from "./AiCopilot.testFetch"

afterEach(cleanup)

beforeEach(() => {
  // TICKET-68: the panel starts open on desktop, so these tests don't need
  // to click the FAB (which no longer renders there at all).
  setDesktopViewport()
})

function sseResponse(events: { event: string; data: unknown }[]): Response {
  const body = events
    .map(
      ({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("")
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

describe("AiCopilot suggested actions (TICKET-67)", () => {
  it("renders data-driven suggested actions above the static prompts on an empty conversation", async () => {
    mockChatFetch([
      {
        id: "pending_volunteer_confirmations",
        label: "3 volunteer signups need review",
        count: 3,
        prompt: "Which volunteer signups need approval?",
      },
      {
        id: "overdue_tasks",
        label: "2 tasks are overdue",
        count: 2,
        prompt: "Which tasks are overdue?",
      },
    ])

    render(<AiCopilot activePage="dashboard" />)

    await waitFor(() =>
      expect(screen.getByText("3 volunteer signups need review")).toBeTruthy(),
    )
    expect(screen.getByText("2 tasks are overdue")).toBeTruthy()
    // Static starter prompts still render alongside the dynamic ones.
    expect(screen.getByText("List my upcoming events")).toBeTruthy()
  })

  it("clicking a suggested action sends its prompt as a chat message", async () => {
    const chatFetch = mockChatFetch([
      {
        id: "overdue_tasks",
        label: "2 tasks are overdue",
        count: 2,
        prompt: "Which tasks are overdue?",
      },
    ])
    chatFetch.mockResolvedValue(
      sseResponse([
        { event: "token", data: { delta: "Here's what's overdue." } },
        { event: "done", data: {} },
      ]),
    )

    const user = userEvent.setup()
    render(<AiCopilot activePage="dashboard" />)
    await waitFor(() =>
      expect(screen.getByText("2 tasks are overdue")).toBeTruthy(),
    )

    await user.click(
      screen.getByRole("button", { name: "2 tasks are overdue" }),
    )

    await waitFor(() =>
      expect(screen.getByText("Here's what's overdue.")).toBeTruthy(),
    )
    const [url, init] = chatFetch.mock.calls[0]
    expect(url).toBe("/api/v1/ai/chat")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      messages: [{ role: "user", content: "Which tasks are overdue?" }],
    })
  })

  it("shows only the static prompts when there is nothing to surface", async () => {
    mockChatFetch([])

    render(<AiCopilot activePage="dashboard" />)

    await waitFor(() =>
      expect(screen.getByText("List my upcoming events")).toBeTruthy(),
    )
    expect(screen.queryByText("Needs your attention")).toBeNull()
  })

  it("falls back to just the static prompts when the brief request fails", async () => {
    mockChatFetch()
    // Force /dashboard/brief itself to fail, distinct from the default {items: []} success case.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString()
        if (url.endsWith("/dashboard/brief"))
          return Promise.reject(new Error("network error"))
        return Promise.reject(new Error("unexpected chat call"))
      }),
    )

    render(<AiCopilot activePage="dashboard" />)

    await waitFor(() =>
      expect(screen.getByText("List my upcoming events")).toBeTruthy(),
    )
    expect(screen.queryByText("Needs your attention")).toBeNull()
  })
})
