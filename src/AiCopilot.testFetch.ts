// Shared test helper for AiCopilot.*.test.tsx (TICKET-67).
//
// AiCopilot now fires a GET /dashboard/brief request as soon as the panel
// opens on an empty conversation, in addition to whatever chat/tool fetches
// a given test cares about. Stubbing global fetch with a single vi.fn() (the
// old pattern) makes that brief request consume slots from the same
// mockResolvedValueOnce queue the tests use for chat responses, breaking
// call-order and call-count assertions. Routing by URL keeps the brief
// request answered but out of the mock the tests actually inspect.
import { vi } from "vitest"

type DashboardBriefItem = {
  id: string
  label: string
  count: number
  prompt: string
}

export function mockChatFetch(briefItems: DashboardBriefItem[] = []) {
  const chatFetch = vi.fn()
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.endsWith("/dashboard/brief")) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: briefItems }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }
      return chatFetch(input, init)
    }),
  )
  return chatFetch
}
