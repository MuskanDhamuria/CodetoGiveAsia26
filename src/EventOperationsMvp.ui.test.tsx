// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { readFileSync } from "node:fs"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import EventOperationsMvp from "./EventOperationsMvp"

afterEach(cleanup)

describe("Event Operations MVP primary organizer journey", () => {
  it("provides a mobile action bar for opening the selected Event workspace", async () => {
    const user = userEvent.setup()
    render(<EventOperationsMvp />)

    const actionBar = screen.getByRole("region", { name: "Mobile selected Event actions" })
    expect(within(actionBar).getByText("Distribution of clothes")).toBeTruthy()

    await user.click(within(actionBar).getByRole("button", { name: "Open workspace" }))
    expect(screen.getByRole("region", { name: "Distribution of clothes" })).toBeTruthy()
  })

  it("renders the Event workspace as a three-column Kanban board", async () => {
    const user = userEvent.setup()
    render(<EventOperationsMvp />)

    await user.click(screen.getAllByRole("button", { name: /new event/i })[0])
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await user.type(screen.getByLabelText("Event name"), "Kanban layout check")
    fireEvent.change(screen.getByLabelText("Event date"), { target: { value: "2027-08-09" } })
    await user.type(screen.getByLabelText("Venue"), "Marina Bay Community Plaza")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await user.click(screen.getByRole("button", { name: "Create event" }))
    await user.click(screen.getByRole("button", { name: /Kanban layout check/ }))
    await user.click(screen.getByRole("button", { name: /Open event workspace/ }))

    const workspace = screen.getByRole("region", { name: "Kanban layout check" })
    const board = workspace.querySelector(".event-operations-kanban")
    expect(board).toBeTruthy()
    expect(board?.querySelectorAll(":scope > section")).toHaveLength(3)
    expect(Array.from(board?.querySelectorAll(":scope > section > h4") ?? []).map((heading) => heading.textContent)).toEqual([
      "To do",
      "In progress",
      "Done",
    ])
    expect(screen.getByRole("tablist", { name: "Task status" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /To do/ }).getAttribute("aria-selected")).toBe("true")
    await user.click(screen.getByRole("tab", { name: /Done/ }))
    expect(screen.getByRole("tab", { name: /Done/ }).getAttribute("aria-selected")).toBe("true")

    const styles = readFileSync("src/EventOperationsMvp.css", "utf8")
    expect(styles).toMatch(/\.event-operations-kanban\s*\{[^}]*display:\s*grid/)
    expect(styles).toMatch(/\.event-operations-kanban\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(240px,\s*1fr\)\)/)
    expect(styles).not.toMatch(/\.event-operations-kanban\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/)

    await user.click(screen.getByRole("button", { name: /Back to Events/ }))
    expect(screen.getByRole("heading", { name: "Event portfolio" })).toBeTruthy()
  })

  it("creates, operates, closes, reopens, and finds an Event in Calendar", async () => {
    const user = userEvent.setup()
    render(<EventOperationsMvp />)

    await user.click(screen.getAllByRole("button", { name: /new event/i })[0])
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await user.type(screen.getByLabelText("Event name"), "August community distribution")
    fireEvent.change(screen.getByLabelText("Event date"), { target: { value: "2027-08-09" } })
    await user.type(screen.getByLabelText("Venue"), "Marina Bay Community Plaza")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(screen.getByText("Auto-generated plan")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Create event" }))
    expect(screen.getByText("Event created from its Event Template.")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: /August community distribution/ }))
    await user.click(screen.getByRole("button", { name: /Open event workspace/ }))
    await user.clear(screen.getAllByLabelText("Task title")[0])
    await user.type(screen.getAllByLabelText("Task title")[0], "Confirm community partners")
    await user.tab()
    await user.selectOptions(screen.getAllByLabelText("Team Member")[0], "priya-nair")
    expect(screen.getByText("Assigned to Priya Nair")).toBeTruthy()
    const startTask = screen.getAllByRole("button", { name: "Start task" })[0]
    await user.click(startTask)
    expect(screen.getByText(/Task started:/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Mark done" }))
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Move up" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Move down" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Remove Task" })).toBeNull()

    fireEvent.change(screen.getByLabelText("Event date"), { target: { value: "2027-08-16" } })
    expect(screen.getAllByText("56 days before Event").length).toBeGreaterThan(0)

    await user.click(screen.getByRole("button", { name: "Close event" }))
    const closeConfirmation = screen.getByRole("region", { name: "Confirm action" })
    await user.click(within(closeConfirmation).getByRole("button", { name: "Close event" }))
    expect(screen.getByText("This Event is closed. Reopen it to make changes.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Start task" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Reopen event" }))
    const reopenConfirmation = screen.getByRole("region", { name: "Confirm action" })
    await user.click(within(reopenConfirmation).getByRole("button", { name: "Reopen event" }))
    expect(screen.getByText("Event reopened. You can make changes again.")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Calendar" }))
    expect(screen.getByLabelText("August 2027 Event calendar")).toBeTruthy()
    expect(screen.getByRole("button", { name: /August community distribution/ })).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "New Event Template" }))
    const templateEditor = screen.getByRole("heading", { name: "New Event Template" }).closest("form")!
    await user.type(within(templateEditor).getByLabelText("Event Template name"), "Community follow-up")
    await user.type(within(templateEditor).getByLabelText("Task title"), "Confirm venue")
    await user.click(within(templateEditor).getByRole("button", { name: "Save Event Template" }))
    expect(screen.getByText("Event Template saved.")).toBeTruthy()

    await user.selectOptions(
      screen.getByLabelText("New Events start with an Event Template"),
      "custom-template-1",
    )
    await user.click(screen.getAllByRole("button", { name: /new event/i })[0])
    expect(screen.getAllByText("Community follow-up").length).toBeGreaterThan(1)
    await user.click(screen.getByRole("button", { name: "Cancel Event creation" }))
    await user.click(screen.getByRole("button", { name: "Discard draft" }))
    expect(screen.getByText("Event draft discarded.")).toBeTruthy()
  })

  it("keeps the creation steps above the mobile menu and lets Back leave step 1", async () => {
    const user = userEvent.setup()
    render(<EventOperationsMvp />)

    await user.click(screen.getAllByRole("button", { name: /new event/i })[0])

    const backButton = screen.getByRole("button", { name: "Back" })
    expect(backButton.hasAttribute("disabled")).toBe(false)
    expect(screen.getByText("Choose template")).toBeTruthy()

    await user.click(backButton)
    expect(screen.getByText("Discard this Event draft?")).toBeTruthy()

    const styles = readFileSync("src/EventOperationsMvp.css", "utf8")
    expect(styles).toMatch(/\.event-creation-overlay\s*\{[^}]*z-index:\s*(1\d\d|[2-9]\d\d)/)
    expect(styles).toMatch(/\.event-creation-dialog\s*\{[^}]*max-height:\s*100dvh/)
  })
})
