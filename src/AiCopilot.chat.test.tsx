// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AiCopilot from "./AiCopilot"

afterEach(cleanup)

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

async function openPanel() {
  const user = userEvent.setup()
  render(<AiCopilot activePage="dashboard" />)
  await user.click(screen.getByRole("button", { name: /Ask Passion AI/ }))
  return user
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
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

  it("renders tool_call/tool_result activity inline in the chat", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { event: "tool_call", data: { tool: "create_event_draft", arguments: {} } },
        {
          event: "tool_result",
          data: {
            tool: "create_event_draft",
            result: { success: true, result: { status: "draft" } },
          },
        },
        { event: "token", data: { delta: "Draft ready." } },
        { event: "done", data: {} },
      ]),
    )

    const user = await openPanel()
    await user.type(screen.getByLabelText("Message Passion AI"), "Create an event")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByText("create_event_draft succeeded.")).toBeTruthy())
    expect(screen.getByText("Draft ready.")).toBeTruthy()
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
})
