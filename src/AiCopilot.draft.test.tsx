// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AiCopilot from "./AiCopilot"
import { mockChatFetch } from "./AiCopilot.testFetch"

afterEach(cleanup)

let fetch: ReturnType<typeof mockChatFetch>

const DRAFT_EVENT = {
  event_template_id: null,
  name: "Yoga at Tampines Hub",
  venue: "Tampines Hub",
  event_date: "2099-01-01",
  description: "A wellness session",
  start_time: null,
  end_time: null,
  beneficiary_id: null,
}

function sseResponse(events: { event: string; data: unknown }[]): Response {
  const body = events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("")
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function draftResponse(overrides: Partial<typeof DRAFT_EVENT> = {}) {
  return sseResponse([
    { event: "tool_call", data: { tool: "create_event_draft", arguments: {} } },
    {
      event: "tool_result",
      data: {
        tool: "create_event_draft",
        result: { success: true, result: { status: "draft", event: { ...DRAFT_EVENT, ...overrides } } },
      },
    },
    { event: "token", data: { delta: "Here's a draft for you to review." } },
    { event: "done", data: {} },
  ])
}

async function openPanelWithDraft(onDataChanged?: () => void) {
  vi.mocked(fetch).mockImplementationOnce(async () => draftResponse())

  const user = userEvent.setup()
  render(<AiCopilot activePage="dashboard" onDataChanged={onDataChanged} />)
  await user.click(screen.getByRole("button", { name: /Ask Passion AI/ }))
  await user.type(screen.getByLabelText("Message Passion AI"), "Create a yoga event")
  await user.click(screen.getByRole("button", { name: "Send message" }))

  await waitFor(() => expect(screen.getByText("Yoga at Tampines Hub")).toBeTruthy())
  return user
}

beforeEach(() => {
  fetch = mockChatFetch()
})

describe("AiCopilot draft preview + approval (TICKET-6)", () => {
  it("renders a suggestion-card instead of a generic status line for a draft", async () => {
    await openPanelWithDraft()

    expect(screen.getByText("Yoga at Tampines Hub")).toBeTruthy()
    expect(screen.getByText("Tampines Hub · 2099-01-01")).toBeTruthy()
    expect(screen.getByText("A wellness session")).toBeTruthy()
    expect(screen.queryByText("create_event_draft succeeded.")).toBeNull()
    expect(screen.getByRole("button", { name: "Create Event" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy()
  })

  it("lets the organizer edit fields before confirming, without calling the backend", async () => {
    const user = await openPanelWithDraft()
    const callsBeforeEdit = vi.mocked(fetch).mock.calls.length

    await user.click(screen.getByRole("button", { name: "Edit" }))
    const nameInput = screen.getByDisplayValue("Yoga at Tampines Hub")
    await user.clear(nameInput)
    await user.type(nameInput, "Sunrise Yoga")
    await user.click(screen.getByRole("button", { name: "Done editing" }))

    expect(screen.getByText("Sunrise Yoga")).toBeTruthy()
    // Editing is purely local — no request fired until Create Event is clicked.
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBeforeEdit)
  })

  it("only calls publish_event on explicit confirmation, with the edited fields", async () => {
    const user = await openPanelWithDraft()

    await user.click(screen.getByRole("button", { name: "Edit" }))
    const nameInput = screen.getByDisplayValue("Yoga at Tampines Hub")
    await user.clear(nameInput)
    await user.type(nameInput, "Sunrise Yoga")
    await user.click(screen.getByRole("button", { name: "Done editing" }))

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: true, result: { id: 5, name: "Sunrise Yoga" } }),
    )
    await user.click(screen.getByRole("button", { name: "Create Event" }))

    await waitFor(() => expect(screen.getByText("publish_event succeeded.")).toBeTruthy())
    // The card is gone once published — no stale Edit/Create buttons left behind.
    expect(screen.queryByRole("button", { name: "Create Event" })).toBeNull()

    const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!
    expect(url).toBe("/api/v1/ai/tools/publish_event")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      arguments: { ...DRAFT_EVENT, name: "Sunrise Yoga" },
    })
  })

  it("keeps the card open and shows a plain-language reason when publish fails", async () => {
    const user = await openPanelWithDraft()

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, reason: "Event template 999 was not found" }),
    )
    await user.click(screen.getByRole("button", { name: "Create Event" }))

    await waitFor(() =>
      expect(
        screen.getByText("publish_event failed: Event template 999 was not found"),
      ).toBeTruthy(),
    )
    // Still there so the organizer can fix the draft and retry.
    expect(screen.getByRole("button", { name: "Create Event" })).toBeTruthy()
  })

  it("calls onDataChanged once publish_event succeeds (TICKET-35)", async () => {
    const onDataChanged = vi.fn()
    const user = await openPanelWithDraft(onDataChanged)

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: true, result: { id: 5, name: "Yoga at Tampines Hub" } }),
    )
    await user.click(screen.getByRole("button", { name: "Create Event" }))

    await waitFor(() => expect(screen.getByText("publish_event succeeded.")).toBeTruthy())
    expect(onDataChanged).toHaveBeenCalledTimes(1)
  })

  it("does not call onDataChanged when publish_event fails (TICKET-35)", async () => {
    const onDataChanged = vi.fn()
    const user = await openPanelWithDraft(onDataChanged)

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, reason: "Event template 999 was not found" }),
    )
    await user.click(screen.getByRole("button", { name: "Create Event" }))

    await waitFor(() =>
      expect(
        screen.getByText("publish_event failed: Event template 999 was not found"),
      ).toBeTruthy(),
    )
    expect(onDataChanged).not.toHaveBeenCalled()
  })
})
