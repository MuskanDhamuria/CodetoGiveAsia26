// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AiCopilot from "./AiCopilot"
import { mockChatFetch, setMobileViewport } from "./AiCopilot.testFetch"

afterEach(cleanup)

let fetch: ReturnType<typeof mockChatFetch>

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

async function openPanel(onDataChanged?: () => void) {
  const user = userEvent.setup()
  render(<AiCopilot activePage="dashboard" onDataChanged={onDataChanged} />)
  await user.click(screen.getByRole("button", { name: /Ask Passion AI/ }))
  return user
}

beforeEach(() => {
  // TICKET-68: this file exercises the FAB-open flow, which is mobile-only
  // now that desktop starts permanently open.
  setMobileViewport()
  fetch = mockChatFetch()
})

describe("AiCopilot chat (TICKET-5)", () => {
  it("sends the message to the backend and streams the assistant reply", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "token", data: { delta: "Hello" } },
        { event: "token", data: { delta: " there" } },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "Hi")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByText("Hello there")).toBeTruthy())

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe("/api/v1/ai/chat")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      messages: [{ role: "user", content: "Hi" }],
    })
  })

  it("clears the conversation via the Clear chat button (TICKET-36)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "token", data: { delta: "Hello there" } },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    expect(screen.queryByRole("button", { name: "Clear chat" })).toBeNull()

    await user.type(screen.getByLabelText("Message Passion AI"), "Hi")
    await user.click(screen.getByRole("button", { name: "Send message" }))
    await waitFor(() => expect(screen.getByText("Hello there")).toBeTruthy())

    await user.click(screen.getByRole("button", { name: "Clear chat" }))

    expect(screen.queryByText("Hello there")).toBeNull()
    expect(screen.queryByText("Hi")).toBeNull()
    expect(screen.queryByRole("button", { name: "Clear chat" })).toBeNull()
    // Back to the empty-conversation starter-prompt state.
    expect(
      screen.getByText("Ask me to help manage an event — I'll show you a draft before creating anything."),
    ).toBeTruthy()
  })

  it("suppresses the generic status line once the model's own text narrates the result", async () => {
    // create_event_draft is exercised separately in AiCopilot.draft.test.tsx
    // (TICKET-6) since a successful draft renders a suggestion-card instead
    // of this generic status line. When the model already says "No events
    // found.", a second "list_events succeeded." line under it would just
    // be noise — it must not render.
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "tool_call", data: { tool: "list_events", arguments: {} } },
        {
          event: "tool_result",
          data: {
            tool: "list_events",
            result: { success: true, result: { items: [] } },
          },
        },
        { event: "token", data: { delta: "No events found." } },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "List events")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByText("No events found.")).toBeTruthy())
    expect(screen.queryByText("list_events succeeded.")).toBeNull()
  })

  it("falls back to the generic status line when the model leaves no trailing text", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "tool_call", data: { tool: "list_events", arguments: {} } },
        {
          event: "tool_result",
          data: { tool: "list_events", result: { success: true, result: { items: [] } } },
        },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "List events")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByText("list_events succeeded.")).toBeTruthy())
  })

  it("always shows a tool failure, even when the model also produced text", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "tool_call", data: { tool: "cancel_event", arguments: { event_id: 999 } } },
        {
          event: "tool_result",
          data: {
            tool: "cancel_event",
            result: { success: false, reason: "Event 999 was not found" },
          },
        },
        { event: "token", data: { delta: "Sorry, I couldn't find that event." } },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "Cancel event 999")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() =>
      expect(screen.getByText("cancel_event failed: Event 999 was not found")).toBeTruthy(),
    )
    expect(screen.getByText("Sorry, I couldn't find that event.")).toBeTruthy()
  })

  it("renders template names and descriptions instead of a bare status line (TICKET-12)", async () => {
    // list_event_templates can be the only thing that happens in a turn —
    // the organizer needs to see the actual templates, not just
    // "list_event_templates succeeded.", to know it's their turn to act.
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "tool_call", data: { tool: "list_event_templates", arguments: {} } },
        {
          event: "tool_result",
          data: {
            tool: "list_event_templates",
            result: {
              success: true,
              result: {
                items: [
                  { id: 1, name: "Skill Enhancement", description: "Coordinate a learning session." },
                  { id: 2, name: "Wellness", description: "Run a wellbeing session." },
                ],
              },
            },
          },
        },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "What templates do we have?")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByText("Templates found:")).toBeTruthy())
    expect(screen.queryByText("list_event_templates succeeded.")).toBeNull()
    expect(screen.getByText("Skill Enhancement", { exact: false })).toBeTruthy()
    expect(screen.getByText("Coordinate a learning session.", { exact: false })).toBeTruthy()
    expect(screen.getByText("Wellness", { exact: false })).toBeTruthy()
  })

  it("says so when a template search comes back empty", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "tool_call", data: { tool: "list_event_templates", arguments: { q: "nope" } } },
        {
          event: "tool_result",
          data: {
            tool: "list_event_templates",
            result: { success: true, result: { items: [] } },
          },
        },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "Any templates for X?")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByText("No matching templates found.")).toBeTruthy())
  })

  it("shows the backend's plain-language error when the stream reports one", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "error", data: { reason: "OpenRouter request failed" } },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "Hi")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByText("OpenRouter request failed")).toBeTruthy())
  })

  it("renders a markdown numbered list and bold text properly (TICKET-11)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        {
          event: "token",
          data: {
            delta:
              "Here are the upcoming events:\n\n1. **Yoga at Tampines Hub** - open\n2. **Zumba at Boon Lay** - closed",
          },
        },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "List events")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2))
    const items = screen.getAllByRole("listitem")
    expect(items[0].textContent).toBe("Yoga at Tampines Hub - open")
    expect(items[1].textContent).toBe("Zumba at Boon Lay - closed")
    // Bold renders as a real <strong>, not literal "**" markers.
    expect(screen.getByText("Yoga at Tampines Hub").tagName).toBe("STRONG")
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it("sends prior turns as history alongside the next message", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        sseResponse([{ event: "token", data: { delta: "Hi!" } }, { event: "done", data: {} }]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ event: "token", data: { delta: "Sure." } }, { event: "done", data: {} }]),
      )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "Hello")
    await user.click(screen.getByRole("button", { name: "Send message" }))
    await waitFor(() => expect(screen.getByText("Hi!")).toBeTruthy())

    await user.type(screen.getByLabelText("Message Passion AI"), "Follow up")
    await user.click(screen.getByRole("button", { name: "Send message" }))
    await waitFor(() => expect(screen.getByText("Sure.")).toBeTruthy())

    const [, secondInit] = vi.mocked(fetch).mock.calls[1]
    expect(JSON.parse((secondInit as RequestInit).body as string)).toEqual({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
        { role: "user", content: "Follow up" },
      ],
    })
  })

  it("drops a whitespace-only assistant turn from history and doesn't render an empty bubble", async () => {
    // A turn that only makes a tool call (e.g. list_event_templates) can
    // leave the assistant message as whitespace-only ("\n\n" observed live,
    // not necessarily fully empty). The backend's ChatMessage.content
    // rejects both empty and whitespace-only strings — sending one back on
    // the next turn used to 422. It's also confusing to show a human an
    // empty chat bubble, so it must not render either.
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        sseResponse([
          { event: "tool_call", data: { tool: "list_events", arguments: {} } },
          {
            event: "tool_result",
            data: { tool: "list_events", result: { success: true, result: { items: [] } } },
          },
          { event: "token", data: { delta: "\n\n" } },
          { event: "done", data: {} },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ event: "token", data: { delta: "Sure." } }, { event: "done", data: {} }]),
      )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "Any events?")
    await user.click(screen.getByRole("button", { name: "Send message" }))
    await waitFor(() => expect(screen.getByText("list_events succeeded.")).toBeTruthy())

    expect(document.querySelectorAll(".copilot-message-assistant").length).toBe(0)

    await user.type(screen.getByLabelText("Message Passion AI"), "Follow up")
    await user.click(screen.getByRole("button", { name: "Send message" }))
    await waitFor(() => expect(screen.getByText("Sure.")).toBeTruthy())

    const [, secondInit] = vi.mocked(fetch).mock.calls[1]
    expect(JSON.parse((secondInit as RequestInit).body as string)).toEqual({
      messages: [
        { role: "user", content: "Any events?" },
        { role: "user", content: "Follow up" },
      ],
    })
  })

  it("renders a readable message instead of [object Object] for a validation error", async () => {
    // FastAPI's 422 `detail` is a list of {loc, msg, type} objects, not a
    // string — stringifying it directly used to render "[object Object]".
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: [{ loc: ["body", "messages", 0, "content"], msg: "String should have at least 1 character", type: "string_too_short" }],
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "Hi")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() =>
      expect(screen.getByText("String should have at least 1 character")).toBeTruthy(),
    )
    expect(screen.queryByText("[object Object]")).toBeNull()
  })
})

describe("AiCopilot recommended actions (TICKET-34)", () => {
  it("shows starter prompts on an empty conversation and sends one on click", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([{ event: "token", data: { delta: "Sure." } }, { event: "done", data: {} }]),
    )

    const user = await openPanel()
    expect(screen.getByText("List my upcoming events")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "List my upcoming events" }))

    await waitFor(() => expect(screen.getByText("Sure.")).toBeTruthy())
    // The suggestions were an empty-conversation affordance, not a menu —
    // the chip itself (not the now-sent user message of the same text)
    // must not linger once the conversation has content.
    expect(screen.queryByRole("button", { name: "List my upcoming events" })).toBeNull()

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe("/api/v1/ai/chat")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      messages: [{ role: "user", content: "List my upcoming events" }],
    })
  })
})

describe("AiCopilot data refresh callback (TICKET-35)", () => {
  it("calls onDataChanged once a mutating tool call succeeds", async () => {
    const onDataChanged = vi.fn()
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "tool_call", data: { tool: "cancel_event", arguments: { event_id: 1 } } },
        {
          event: "tool_result",
          data: { tool: "cancel_event", result: { success: true, result: { id: 1 } } },
        },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel(onDataChanged)
    await user.type(screen.getByLabelText("Message Passion AI"), "Cancel event 1")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByText("cancel_event succeeded.")).toBeTruthy())
    expect(onDataChanged).toHaveBeenCalledTimes(1)
  })

  it("does not call onDataChanged for a read-only tool result", async () => {
    const onDataChanged = vi.fn()
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "tool_call", data: { tool: "list_events", arguments: {} } },
        {
          event: "tool_result",
          data: { tool: "list_events", result: { success: true, result: { items: [] } } },
        },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel(onDataChanged)
    await user.type(screen.getByLabelText("Message Passion AI"), "List events")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByText("list_events succeeded.")).toBeTruthy())
    expect(onDataChanged).not.toHaveBeenCalled()
  })

  it("does not call onDataChanged when a mutating tool call fails", async () => {
    const onDataChanged = vi.fn()
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "tool_call", data: { tool: "cancel_event", arguments: { event_id: 999 } } },
        {
          event: "tool_result",
          data: {
            tool: "cancel_event",
            result: { success: false, reason: "Event 999 was not found" },
          },
        },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel(onDataChanged)
    await user.type(screen.getByLabelText("Message Passion AI"), "Cancel event 999")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() =>
      expect(screen.getByText("cancel_event failed: Event 999 was not found")).toBeTruthy(),
    )
    expect(onDataChanged).not.toHaveBeenCalled()
  })
})
