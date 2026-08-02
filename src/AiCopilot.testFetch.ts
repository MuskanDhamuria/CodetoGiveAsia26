// Shared test helpers for AiCopilot.*.test.tsx (TICKET-67, TICKET-68).
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

// TICKET-68: AiCopilot reads window.innerWidth (via a lazy useState
// initializer) to decide whether it starts as a permanently-open desktop
// sidebar or a closed mobile popup. jsdom defaults innerWidth to 1024 —
// above the 810px breakpoint — so every existing test exercising the mobile
// popup flow (FAB click to open, close button, Escape) must force a mobile
// width before rendering, or it'll silently get desktop behavior instead.
// Call before render().
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  })
}

export function setMobileViewport() {
  setViewportWidth(375)
}

export function setDesktopViewport() {
  setViewportWidth(1400)
}

// TICKET-69: AiCopilot also re-derives desktop/mobile on a live `resize`
// event (not just at mount), so a test simulating the user dragging the
// window across the breakpoint mid-session needs to change the width AND
// dispatch the event React's listener is actually bound to.
export function resizeViewport(width: number) {
  setViewportWidth(width)
  window.dispatchEvent(new Event("resize"))
}
