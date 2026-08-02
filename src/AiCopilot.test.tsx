// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import AiCopilot from "./AiCopilot"
import { mockChatFetch } from "./AiCopilot.testFetch"

afterEach(cleanup)

beforeEach(() => {
  mockChatFetch()
})

// `getByRole` excludes aria-hidden elements from the accessibility tree
// entirely, so the panel (which is aria-hidden while closed) has to be
// looked up directly rather than through a role query.
function getPanel() {
  const panel = document.getElementById("ai-copilot-panel")
  if (!panel) throw new Error("#ai-copilot-panel not found")
  return panel
}

describe("AiCopilot collapsible panel (TICKET-10)", () => {
  it("is collapsed by default, showing only the FAB", () => {
    render(<AiCopilot activePage="dashboard" />)

    expect(screen.getByRole("button", { name: /Ask Passion AI/ })).toBeTruthy()
    const panel = getPanel()
    expect(panel.getAttribute("aria-hidden")).toBe("true")
    expect(panel.getAttribute("aria-modal")).toBe("false")
    expect(panel.className).not.toMatch(/\bopen\b/)
  })

  it("opens the panel from the FAB, focusing the close button", async () => {
    const user = userEvent.setup()
    render(<AiCopilot activePage="events" />)

    await user.click(screen.getByRole("button", { name: /Ask Passion AI/ }))

    const panel = getPanel()
    expect(panel.getAttribute("aria-hidden")).toBe("false")
    expect(panel.getAttribute("aria-modal")).toBe("true")
    expect(panel.className).toMatch(/\bopen\b/)
    expect(screen.queryByRole("button", { name: /Ask Passion AI/ })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close AI Copilot" }))
  })

  it("closes on Escape and returns focus to the FAB", async () => {
    const user = userEvent.setup()
    render(<AiCopilot activePage="events" />)

    await user.click(screen.getByRole("button", { name: /Ask Passion AI/ }))
    await user.keyboard("{Escape}")

    const panel = getPanel()
    expect(panel.getAttribute("aria-hidden")).toBe("true")
    expect(panel.className).not.toMatch(/\bopen\b/)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Ask Passion AI/ }))
  })

  it("closes via the close button and returns focus to the FAB", async () => {
    const user = userEvent.setup()
    render(<AiCopilot activePage="events" />)

    await user.click(screen.getByRole("button", { name: /Ask Passion AI/ }))
    await user.click(screen.getByRole("button", { name: "Close AI Copilot" }))

    expect(getPanel().getAttribute("aria-hidden")).toBe("true")
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Ask Passion AI/ }))
  })

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup()
    const { container } = render(<AiCopilot activePage="events" />)

    await user.click(screen.getByRole("button", { name: /Ask Passion AI/ }))
    const backdrop = container.querySelector(".copilot-backdrop")
    expect(backdrop).not.toBeNull()
    await user.click(backdrop as Element)

    expect(getPanel().getAttribute("aria-hidden")).toBe("true")
  })

  it("the FAB exposes aria-expanded/aria-controls pointing at the panel", () => {
    render(<AiCopilot activePage="dashboard" />)

    const fab = screen.getByRole("button", { name: /Ask Passion AI/ })
    expect(fab.getAttribute("aria-expanded")).toBe("false")
    expect(fab.getAttribute("aria-controls")).toBe("ai-copilot-panel")
    expect(getPanel().id).toBe("ai-copilot-panel")
  })
})
