// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import EventOperationsMvp from "./EventOperationsMvp"

describe("Event Operations MVP primary organizer journey", () => {
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

    await user.click(screen.getByRole("button", { name: "Open event workspace" }))
    await user.clear(screen.getAllByLabelText("Task title")[0])
    await user.type(screen.getAllByLabelText("Task title")[0], "Confirm community partners")
    await user.tab()
    await user.selectOptions(screen.getAllByLabelText("Team Member")[0], "priya-nair")
    expect(screen.getByText("Assigned to Priya Nair")).toBeTruthy()
    const startTask = screen.getAllByRole("button", { name: "Start task" })[0]
    await user.click(startTask)
    expect(screen.getByText(/Task started:/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Mark done" }))
    await user.click(screen.getByRole("button", { name: "Reopen" }))
    expect(screen.getByText(/Task reopened:/)).toBeTruthy()

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
    expect(screen.getByRole("button", { name: "August community distribution" })).toBeTruthy()

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
})
