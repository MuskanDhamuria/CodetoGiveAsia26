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

// FastAPI's `detail` is a plain string for HTTPException, but a list of
// {loc, msg, type} objects for a Pydantic 422 — stringifying the latter
// directly renders as "[object Object]", so pull out just the messages.
function formatErrorDetail(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((issue) =>
        issue && typeof issue === "object" && "msg" in issue
          ? String(issue.msg)
          : null,
      )
      .filter((msg): msg is string => msg !== null)
    if (messages.length > 0) return messages.join("; ")
  }
  return `Request failed with status ${status}`
}

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
    throw new Error(formatErrorDetail(payload?.detail, response.status))
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

// Directly dispatches one named tool call, bypassing the LLM (TICKET-6's
// draft-approval flow) — used once the organizer explicitly confirms a
// create_event_draft preview, so publish_event fires from that click
// rather than a second chat turn.
export async function invokeTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1"
  const response = await fetch(`${baseUrl}/ai/tools/${toolName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ arguments: args }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(formatErrorDetail(payload?.detail, response.status))
  }

  return response.json()
}

// TICKET-67: ranked, actionable items (pending signup approvals, overdue
// tasks, tasks due soon) for the AI panel's suggested-actions section.
export type DashboardBriefItem = {
  id: string
  label: string
  count: number
  prompt: string
}

export async function getDashboardBrief(): Promise<{
  items: DashboardBriefItem[]
}> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1"
  const response = await fetch(`${baseUrl}/dashboard/brief`)

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(formatErrorDetail(payload?.detail, response.status))
  }

  return response.json()
}
