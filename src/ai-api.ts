// Client for the AI assistant chat endpoint (TICKET-1's `POST /ai/chat`).
// Never talks to OpenRouter directly and never holds an API key — only this
// backend endpoint does.

export type ChatRole = "user" | "assistant"

export type ChatMessage = {
  role: ChatRole
  content: string
}

export type ToolResult =
  | { success: true; result: unknown }
  | { success: false; reason: string }

export type ChatStreamEvent =
  | { type: "token"; delta: string }
  | { type: "tool_call"; tool: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: ToolResult }
  | { type: "error"; reason: string }
  | { type: "done" }

function parseSseChunk(chunk: string): ChatStreamEvent | null {
  const lines = chunk.split("\n")
  const eventLine = lines.find((line) => line.startsWith("event: "))
  const dataLine = lines.find((line) => line.startsWith("data: "))
  if (!eventLine || !dataLine) return null

  const type = eventLine.slice("event: ".length)
  const data = JSON.parse(dataLine.slice("data: ".length))

  switch (type) {
    case "token":
      return { type: "token", delta: data.delta }
    case "tool_call":
      return { type: "tool_call", tool: data.tool, arguments: data.arguments }
    case "tool_result":
      return { type: "tool_result", tool: data.tool, result: data.result }
    case "error":
      return { type: "error", reason: data.reason }
    case "done":
      return { type: "done" }
    default:
      return null
  }
}

export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1"
  const response = await fetch(`${baseUrl}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  })

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? `Request failed with status ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const chunks = buffer.split("\n\n")
    buffer = chunks.pop() ?? ""
    for (const chunk of chunks) {
      const event = parseSseChunk(chunk)
      if (event) yield event
    }
  }
}
