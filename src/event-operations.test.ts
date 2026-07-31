import { describe, expect, it } from "vitest"
import {
  createInMemoryEventOperations,
  type EventOperations,
} from "./event-operations"

export function eventOperationsContract(
  createOperations: () => EventOperations,
) {
  describe("Event Operations contract", () => {
    it("creates an Event with an independent copied plan and relative deadlines", () => {
      const operations = createOperations()
      const template = operations
        .listEventTemplates()
        .find((item) => item.name === "Distribution of pre-loved items")

      expect(template).toBeDefined()

      const event = operations.createEvent({
        templateId: template!.id,
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })

      expect(event.sourceTemplateName).toBe("Distribution of pre-loved items")
      expect(event.tasks).toHaveLength(12)
      expect(event.tasks[0]).toMatchObject({
        title: "Align the team on holding the event",
        status: "To do",
        deadline: "2027-06-14",
      })

      event.tasks[0].title = "Changed only in returned value"
      expect(operations.getEvent(event.id)!.tasks[0].title).toBe(
        "Align the team on holding the event",
      )
    })

    it("starts a To do Task without changing its Subtasks", () => {
      const operations = createOperations()
      const event = operations.createEvent({
        templateId: "distribution-of-pre-loved-items",
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })
      const task = event.tasks[8]

      const started = operations.startTask({
        eventId: event.id,
        taskId: task.id,
      })

      expect(started.status).toBe("In progress")
      expect(started.subtasks).toEqual([
        { title: "Sort collected items", completed: false },
        { title: "Distribute items", completed: false },
        { title: "Capture event memories", completed: false },
        { title: "Clean the venue", completed: false },
      ])
    })

    it("lists open Events earliest first and restores closed Events in chronological order", () => {
      const operations = createOperations()
      const september = operations.createEvent({
        templateId: "wellness",
        name: "September wellbeing session",
        date: "2027-09-18",
        venue: "Tampines Hub",
      })
      const august = operations.createEvent({
        templateId: "skill-enhancement",
        name: "August skills session",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })
      const july = operations.createEvent({
        templateId: "distribution-of-pre-loved-items",
        name: "July distribution",
        date: "2027-07-12",
        venue: "Jurong Community Hall",
      })

      operations.closeEvent(july.id)

      expect(operations.listEvents().map((event) => event.name)).toEqual([
        august.name,
        september.name,
      ])
      expect(
        operations.listEvents({ includeClosed: true }).map((event) => event.name),
      ).toEqual([july.name, august.name, september.name])
      expect(operations.getEvent(july.id)).toMatchObject({ status: "Closed" })
    })

    it("rejects starting a Task that is already in progress", () => {
      const operations = createOperations()
      const event = operations.createEvent({
        templateId: "distribution-of-pre-loved-items",
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })
      const task = event.tasks[0]

      operations.startTask({ eventId: event.id, taskId: task.id })

      expect(() =>
        operations.startTask({ eventId: event.id, taskId: task.id }),
      ).toThrow("Only To do Tasks can be started.")
    })

    it("keeps built-in fixtures and Team Members available through the contract", () => {
      const operations = createOperations()

      expect(
        operations.listEventTemplates().map((template) => template.name),
      ).toEqual([
        "Distribution of pre-loved items",
        "Wellness",
        "Skill Enhancement",
      ])
      expect(
        operations.listTeamMembers().map((member) => member.name),
      ).toContain("Priya Nair")
    })

    it("creates, updates, reorders, and deletes a custom Event Template", () => {
      const operations = createOperations()
      const template = operations.createCustomEventTemplate({
        name: "Community outreach",
        description: "A reusable local outreach workflow.",
        tasks: [
          {
            title: "Book a venue",
            phase: "Planning",
            relativeDeadlineDays: -14,
            subtaskTitles: ["Confirm availability"],
          },
        ],
      })

      expect(template).toMatchObject({
        isBuiltIn: false,
        name: "Community outreach",
        tasks: [
          { title: "Book a venue", subtaskTitles: ["Confirm availability"] },
        ],
      })

      const event = operations.createEvent({
        templateId: template.id,
        name: "Community outreach day",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })

      const updated = operations.updateEventTemplate({
        templateId: template.id,
        name: "Community outreach day",
        description: "An updated workflow.",
        tasks: [
          {
            title: "Welcome participants",
            phase: "Execution",
            relativeDeadlineDays: 0,
            subtaskTitles: [],
          },
          {
            title: "Book a venue",
            phase: "Planning",
            relativeDeadlineDays: -14,
            subtaskTitles: ["Confirm availability"],
          },
        ],
      })

      expect(updated.tasks.map((task) => task.title)).toEqual([
        "Welcome participants",
        "Book a venue",
      ])
      operations.deleteCustomEventTemplate(template.id)
      expect(operations.listEventTemplates()).not.toContainEqual(
        expect.objectContaining({ id: template.id }),
      )
      expect(operations.getEvent(event.id)).toMatchObject({
        sourceTemplateId: template.id,
        sourceTemplateName: "Community outreach",
        tasks: [expect.objectContaining({ title: "Book a venue" })],
      })
    })

    it("rejects incomplete custom Event Templates and protects built-ins from deletion", () => {
      const operations = createOperations()

      expect(() =>
        operations.createCustomEventTemplate({
          name: "",
          description: "",
          tasks: [],
        }),
      ).toThrow("Enter an Event Template name.")
      expect(() =>
        operations.createCustomEventTemplate({
          name: "Incomplete plan",
          description: "",
          tasks: [
            {
              title: "",
              phase: "Planning",
              relativeDeadlineDays: -1,
              subtaskTitles: [],
            },
          ],
        }),
      ).toThrow("Complete every Event Template Task.")
      expect(() =>
        operations.deleteCustomEventTemplate("distribution-of-pre-loved-items"),
      ).toThrow("Built-in Event Templates cannot be deleted.")
    })

    it("resets a built-in Event Template while keeping existing Event plans independent", () => {
      const operations = createOperations()
      const event = operations.createEvent({
        templateId: "distribution-of-pre-loved-items",
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })

      operations.updateEventTemplate({
        templateId: "distribution-of-pre-loved-items",
        name: "Refined distribution",
        description: "A temporary session change.",
        tasks: [
          {
            title: "One revised Task",
            phase: "Planning",
            relativeDeadlineDays: -1,
            subtaskTitles: [],
          },
        ],
      })
      expect(operations.getEvent(event.id)!.tasks).toHaveLength(12)
      expect(operations.listEventTemplates()).toContainEqual(
        expect.objectContaining({ name: "Refined distribution" }),
      )

      operations.resetBuiltInEventTemplate("distribution-of-pre-loved-items")
      const reset = operations
        .listEventTemplates()
        .find((template) => template.id === "distribution-of-pre-loved-items")
      expect(reset).toMatchObject({
        name: "Distribution of pre-loved items",
        tasks: expect.arrayContaining([
          expect.objectContaining({
            title: "Align the team on holding the event",
          }),
        ]),
      })
    })

    it("creates an Event only when its isolated draft is committed", () => {
      const operations = createOperations()
      const draft = operations.createEventDraft(
        "distribution-of-pre-loved-items",
      )

      operations.updateEventDraft(draft.id, {
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })
      expect(operations.listEvents()).toEqual([])

      const event = operations.createEventFromDraft(draft.id)
      expect(event.name).toBe("August community distribution")
      expect(operations.listEvents()).toHaveLength(1)

      const discarded = operations.createEventDraft(
        "distribution-of-pre-loved-items",
      )
      operations.discardEventDraft(discarded.id)
      expect(operations.listEvents()).toHaveLength(1)
    })

    it("keeps an incomplete draft isolated when creation is rejected", () => {
      const operations = createOperations()
      const draft = operations.createEventDraft(
        "distribution-of-pre-loved-items",
      )

      expect(() => operations.createEventFromDraft(draft.id)).toThrow(
        "Enter an Event name.",
      )
      expect(operations.listEvents()).toEqual([])

      operations.updateEventDraft(draft.id, {
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })
      expect(operations.createEventFromDraft(draft.id).name).toBe(
        "August community distribution",
      )
    })

    it("creates an independent editable plan inside a draft", () => {
      const operations = createOperations()
      const draft = operations.createEventDraft(
        "distribution-of-pre-loved-items",
      )
      const originalTask = draft.tasks[0]

      operations.updateEventDraftTask(draft.id, {
        taskId: originalTask.id,
        title: "Confirm community partners",
        phase: "Execution",
        relativeDeadlineDays: -2,
        assigneeId: "priya-nair",
        subtasks: [{ title: "Call the venue", completed: false }],
      })
      operations.updateEventDraft(draft.id, {
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })

      const event = operations.createEventFromDraft(draft.id)
      expect(event.tasks[0]).toMatchObject({
        title: "Confirm community partners",
        phase: "Execution",
        relativeDeadlineDays: -2,
        deadline: "2027-08-07",
        assigneeId: "priya-nair",
        subtasks: [{ title: "Call the venue", completed: false }],
      })
      expect(
        operations
          .listEventTemplates()
          .find((template) => template.id === draft.templateId)!.tasks[0].title,
      ).toBe("Align the team on holding the event")
    })

    it("changes a draft template without losing Event details", () => {
      const operations = createOperations()
      const draft = operations.createEventDraft(
        "distribution-of-pre-loved-items",
      )
      operations.updateEventDraft(draft.id, {
        name: "Wellness day",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })

      const changed = operations.changeEventDraftTemplate(draft.id, "wellness")

      expect(changed).toMatchObject({
        templateId: "wellness",
        name: "Wellness day",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })
      expect(changed.tasks).toHaveLength(7)
    })

    it("rejects a draft plan with no Tasks without creating an Event", () => {
      const operations = createOperations()
      const draft = operations.createEventDraft(
        "distribution-of-pre-loved-items",
      )
      operations.updateEventDraft(draft.id, {
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })
      draft.tasks.forEach((task) =>
        operations.removeEventDraftTask(draft.id, task.id),
      )

      expect(() => operations.createEventFromDraft(draft.id)).toThrow(
        "Keep at least one Task in this Event plan.",
      )
      expect(operations.listEvents()).toEqual([])
    })

    it("operates an active Event plan and recalculates Task deadlines from its date", () => {
      const operations = createOperations()
      const event = operations.createEvent({
        templateId: "distribution-of-pre-loved-items",
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })
      const task = event.tasks[0]

      const updated = operations.updateEventTask({
        eventId: event.id,
        taskId: task.id,
        title: "Confirm community partners",
        phase: "Planning",
        deadline: "2027-08-07",
        assigneeId: "priya-nair",
        subtasks: [{ title: "Call the venue", completed: false }],
      })
      expect(updated).toMatchObject({
        title: "Confirm community partners",
        relativeDeadlineDays: -2,
        deadline: "2027-08-07",
        assigneeId: "priya-nair",
      })

      const moved = operations.updateEvent(event.id, { date: "2027-08-16" })
      expect(moved.tasks[0]).toMatchObject({
        deadline: "2027-08-14",
        relativeDeadlineDays: -2,
      })
    })

    it("keeps Subtask completion separate from the strict Task status cycle", () => {
      const operations = createOperations()
      const event = operations.createEvent({
        templateId: "distribution-of-pre-loved-items",
        name: "August community distribution",
        date: "2027-08-09",
        venue: "Marina Bay Community Plaza",
      })
      const task = event.tasks[8]

      expect(operations.toggleSubtask({ eventId: event.id, taskId: task.id, subtaskIndex: 0 })).toMatchObject({
        status: "To do",
        subtasks: expect.arrayContaining([expect.objectContaining({ completed: true })]),
      })
      operations.startTask({ eventId: event.id, taskId: task.id })
      expect(operations.markTaskDone({ eventId: event.id, taskId: task.id }).status).toBe("Done")
      expect(operations.reopenTask({ eventId: event.id, taskId: task.id }).status).toBe("In progress")
      expect(operations.markTaskDone({ eventId: event.id, taskId: task.id }).status).toBe("Done")
      expect(() => operations.startTask({ eventId: event.id, taskId: task.id })).toThrow(
        "Only To do Tasks can be started.",
      )
      expect(() => operations.reopenTask({ eventId: event.id, taskId: event.tasks[0].id })).toThrow(
        "Only Done Tasks can be reopened.",
      )
    })

    it("makes a closed Event read-only, then reopens or deletes it deliberately", () => {
      const operations = createOperations()
      const event = operations.createEvent({
        templateId: "wellness",
        name: "September wellbeing session",
        date: "2027-09-18",
        venue: "Tampines Hub",
      })

      operations.closeEvent(event.id)
      expect(() => operations.startTask({ eventId: event.id, taskId: event.tasks[0].id })).toThrow(
        "Closed Events are read-only.",
      )
      expect(operations.reopenEvent(event.id).status).toBe("Open")
      operations.deleteEvent(event.id)
      expect(operations.getEvent(event.id)).toBeUndefined()
    })

    it("starts manually added Tasks unassigned with an unchecked empty checklist", () => {
      const operations = createOperations()
      const event = operations.createEvent({
        templateId: "wellness",
        name: "September wellbeing session",
        date: "2027-09-18",
        venue: "Tampines Hub",
      })

      const task = operations.addEventTask({
        eventId: event.id,
        title: "Set up signage",
        phase: "Execution",
        deadline: "2027-09-18",
      })

      expect(task).toMatchObject({
        status: "To do",
        assigneeId: null,
        subtasks: [],
      })
    })
  })
}

eventOperationsContract(createInMemoryEventOperations)
