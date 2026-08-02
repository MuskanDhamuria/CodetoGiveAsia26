// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import AiCopilot from "./AiCopilot"
import {
  mockChatFetch,
  resizeViewport,
  setDesktopViewport,
  setMobileViewport,
} from "./AiCopilot.testFetch"

afterEach(cleanup)

beforeEach(() => {
  setDesktopViewport()
  mockChatFetch()
})

function getPanel() {
  const panel = document.getElementById("ai-copilot-panel")
  if (!panel) throw new Error("#ai-copilot-panel not found")
  return panel
}

describe("AiCopilot permanent desktop sidebar (TICKET-68)", () => {
  it("starts open on desktop, with no FAB to reveal it", () => {
    render(<AiCopilot activePage="dashboard" />)

    const panel = getPanel()
    expect(panel.getAttribute("aria-hidden")).toBe("false")
    expect(panel.className).toMatch(/\bopen\b/)
    expect(screen.queryByRole("button", { name: /Ask Passion AI/ })).toBeNull()
  })

  it("has no close button and isn't a modal dialog", () => {
    render(<AiCopilot activePage="dashboard" />)

    expect(screen.queryByRole("button", { name: "Close AI Copilot" })).toBeNull()
    expect(getPanel().getAttribute("aria-modal")).toBe("false")
  })

  it("stays open on Escape", async () => {
    const user = userEvent.setup()
    render(<AiCopilot activePage="dashboard" />)

    await user.keyboard("{Escape}")

    const panel = getPanel()
    expect(panel.getAttribute("aria-hidden")).toBe("false")
    expect(panel.className).toMatch(/\bopen\b/)
  })
})

describe("AiCopilot responds to live resizing (TICKET-69)", () => {
  it("collapses and shows the FAB when resized down to mobile while open", () => {
    render(<AiCopilot activePage="dashboard" />)
    expect(getPanel().getAttribute("aria-hidden")).toBe("false")

    act(() => resizeViewport(375))

    expect(getPanel().getAttribute("aria-hidden")).toBe("true")
    expect(screen.getByRole("button", { name: /Ask Passion AI/ })).toBeTruthy()
  })

  it("expands and hides the FAB when resized up to desktop while closed", () => {
    setMobileViewport()
    render(<AiCopilot activePage="dashboard" />)
    expect(getPanel().getAttribute("aria-hidden")).toBe("true")

    act(() => resizeViewport(1400))

    expect(getPanel().getAttribute("aria-hidden")).toBe("false")
    expect(screen.queryByRole("button", { name: /Ask Passion AI/ })).toBeNull()
  })

  it("does not reopen a manually-closed mobile panel just from resizing within mobile widths", async () => {
    setMobileViewport()
    const user = userEvent.setup()
    render(<AiCopilot activePage="dashboard" />)

    await user.click(screen.getByRole("button", { name: /Ask Passion AI/ }))
    expect(getPanel().getAttribute("aria-hidden")).toBe("false")

    act(() => resizeViewport(400))

    // Still mobile (under the 810px breakpoint) — the manual open shouldn't
    // be reset just because a resize event fired.
    expect(getPanel().getAttribute("aria-hidden")).toBe("false")
  })
})
