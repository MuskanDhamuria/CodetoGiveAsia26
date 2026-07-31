export type EventPhase = "Planning" | "Execution" | "Post-execution"
export type TaskStatus = "To do" | "In progress" | "Done"

export type TemplateTask = {
  id: string
  title: string
  phase: EventPhase
  relativeDeadlineDays: number
  subtaskTitles: string[]
}

export type EventTemplate = {
  id: string
  name: string
  description: string
  isBuiltIn: boolean
  tasks: TemplateTask[]
}

export type TemplateTaskInput = Omit<TemplateTask, "id">

export type EventTemplateInput = {
  name: string
  description: string
  tasks: TemplateTaskInput[]
}

export type EventTask = {
  id: string
  title: string
  phase: EventPhase
  relativeDeadlineDays: number
  deadline: string
  status: TaskStatus
  assigneeId: string | null
  subtasks: { title: string; completed: boolean }[]
}

export type Event = {
  id: string
  name: string
  date: string
  venue: string
  sourceTemplateId: string
  sourceTemplateName: string
  status: "Open" | "Closed"
  tasks: EventTask[]
}

export function eventsForCollection(
  events: Event[],
  includeClosed = false,
): Event[] {
  return events
    .filter((event) => includeClosed || event.status !== "Closed")
    .sort((left, right) => left.date.localeCompare(right.date))
}

export type TeamMember = {
  id: string
  name: string
}

export type CreateEventInput = {
  templateId: string
  name: string
  date: string
  venue: string
}

export type EventDraft = {
  id: string
  templateId: string
  name: string
  date: string
  venue: string
  tasks: EventTask[]
}

export type EventDraftTaskInput = Pick<
  EventTask,
  "title" | "phase" | "relativeDeadlineDays" | "assigneeId" | "subtasks"
> & { taskId: string }

export type EventTaskInput = Pick<
  EventTask,
  "title" | "phase" | "assigneeId" | "subtasks"
> & {
  deadline: string
}

export type EventTaskRef = {
  eventId: string
  taskId: string
}

export type NewEventTaskInput = Pick<EventTaskInput, "title" | "phase" | "deadline">

export interface EventOperations {
  listEventTemplates(): EventTemplate[]
  createCustomEventTemplate(input: EventTemplateInput): EventTemplate
  updateEventTemplate(
    input: EventTemplateInput & { templateId: string },
  ): EventTemplate
  resetBuiltInEventTemplate(templateId: string): EventTemplate
  deleteCustomEventTemplate(templateId: string): void
  listTeamMembers(): TeamMember[]
  listEvents(options?: { includeClosed?: boolean }): Event[]
  getEvent(eventId: string): Event | undefined
  updateEvent(
    eventId: string,
    changes: Partial<Pick<Event, "name" | "date" | "venue">>,
  ): Event
  closeEvent(eventId: string): Event
  reopenEvent(eventId: string): Event
  deleteEvent(eventId: string): void
  createEventDraft(templateId: string): EventDraft
  updateEventDraft(
    draftId: string,
    changes: Pick<EventDraft, "name" | "date" | "venue">,
  ): EventDraft
  changeEventDraftTemplate(draftId: string, templateId: string): EventDraft
  updateEventDraftTask(
    draftId: string,
    input: EventDraftTaskInput,
  ): EventDraft
  addEventDraftTask(draftId: string): EventDraft
  removeEventDraftTask(draftId: string, taskId: string): EventDraft
  discardEventDraft(draftId: string): void
  createEventFromDraft(draftId: string): Event
  createEvent(input: CreateEventInput): Event
  startTask(input: EventTaskRef): EventTask
  markTaskDone(input: EventTaskRef): EventTask
  reopenTask(input: EventTaskRef): EventTask
  updateEventTask(
    input: EventTaskRef & EventTaskInput,
  ): EventTask
  addEventTask(input: { eventId: string } & NewEventTaskInput): EventTask
  removeEventTask(input: EventTaskRef): void
  moveEventTask(input: {
    direction: -1 | 1
  } & EventTaskRef): Event
  toggleSubtask(input: {
    subtaskIndex: number
  } & EventTaskRef): EventTask
}

type TemplateTaskFixture = [string, EventPhase, number, string[]?]

function createTemplateTasks(
  templateId: string,
  rows: TemplateTaskFixture[],
): TemplateTask[] {
  return rows.map(
    ([title, phase, relativeDeadlineDays, subtaskTitles = []], index) => ({
      id: `${templateId}-task-${index + 1}`,
      title,
      phase,
      relativeDeadlineDays,
      subtaskTitles,
    }),
  )
}

const distributionTasks = createTemplateTasks("distribution", [
  ["Align the team on holding the event", "Planning", -56],
  ["Identify supporting-organization contacts", "Planning", -49],
  ["Confirm collection venues and schedules", "Planning", -42],
  ["Arrange collection transport", "Planning", -35],
  ["Arrange warehouse storage", "Planning", -35],
  ["Notify beneficiary migrant workers", "Planning", -21],
  ["Promote the event on social media", "Planning", -21],
  ["Recruit volunteers", "Planning", -14],
  [
    "Run distribution day",
    "Execution",
    0,
    [
      "Sort collected items",
      "Distribute items",
      "Capture event memories",
      "Clean the venue",
    ],
  ],
  ["Send volunteer certificates", "Post-execution", 3],
  ["Send volunteer acknowledgements", "Post-execution", 3],
  ["Share the event recap on social media", "Post-execution", 7],
])

export const builtInEventTemplates: EventTemplate[] = [
  {
    id: "distribution-of-pre-loved-items",
    name: "Distribution of pre-loved items",
    description: "Collect, sort, and distribute essential items.",
    isBuiltIn: true,
    tasks: distributionTasks,
  },
  {
    id: "wellness",
    name: "Wellness",
    description: "Run a focused wellbeing session for migrant workers.",
    isBuiltIn: true,
    tasks: createTemplateTasks("wellness", [
      ["Align the team on holding the event", "Planning", -56],
      ["Book the event venue", "Planning", -42],
      ["Confirm the volunteer wellness instructor", "Planning", -42],
      ["Notify beneficiary migrant workers", "Planning", -21],
      [
        "Run the wellness event",
        "Execution",
        0,
        [
          "Set up the audio system",
          "Capture event memories",
          "Distribute post-event food",
        ],
      ],
      ["Send volunteer acknowledgements", "Post-execution", 3],
      ["Share the event recap on social media", "Post-execution", 7],
    ]),
  },
  {
    id: "skill-enhancement",
    name: "Skill Enhancement",
    description: "Coordinate a practical learning session.",
    isBuiltIn: true,
    tasks: createTemplateTasks("skill", [
      ["Align the team on holding the event", "Planning", -56],
      ["Coordinate course administration", "Planning", -49],
      ["Confirm a venue with suitable infrastructure", "Planning", -42],
      ["Notify beneficiary migrant workers", "Planning", -21],
      ["Promote the event on social media", "Planning", -21],
      ["Recruit volunteers", "Planning", -14],
      [
        "Run the skill-enhancement session",
        "Execution",
        0,
        [
          "Set up the required computer lab or seating",
          "Capture event memories",
          "Restore the venue",
        ],
      ],
      ["Send volunteer certificates", "Post-execution", 3],
      ["Send volunteer acknowledgements", "Post-execution", 3],
      ["Share the event recap on social media", "Post-execution", 7],
    ]),
  },
]

const teamMembers: TeamMember[] = [
  { id: "john-tan", name: "John Tan" },
  { id: "priya-nair", name: "Priya Nair" },
  { id: "marcus-lee", name: "Marcus Lee" },
  { id: "aisha-rahman", name: "Aisha Rahman" },
]

export function deadlineFor(
  eventDate: string,
  relativeDeadlineDays: number,
): string {
  const [year, month, day] = eventDate.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + relativeDeadlineDays))
  return date.toISOString().slice(0, 10)
}

export function relativeDeadlineDaysFor(eventDate: string, deadline: string): number {
  return Math.round(
    (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${eventDate}T00:00:00Z`)) /
      86_400_000,
  )
}

function validateEventDetails(
  input: Pick<CreateEventInput, "name" | "date" | "venue">,
) {
  if (!input.name.trim()) throw new Error("Enter an Event name.")
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))
  ) {
    throw new Error("Choose an Event date.")
  }
  if (!input.venue.trim()) throw new Error("Enter a venue.")
}

function validateTemplateInput(input: EventTemplateInput) {
  if (!input.name.trim()) throw new Error("Enter an Event Template name.")
  if (input.tasks.length === 0) {
    throw new Error("Add at least one Event Template Task.")
  }
  if (
    input.tasks.some(
      (task) =>
        !task.title.trim() ||
        !["Planning", "Execution", "Post-execution"].includes(task.phase) ||
        !Number.isInteger(task.relativeDeadlineDays),
    )
  ) {
    throw new Error("Complete every Event Template Task.")
  }
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

export function createInMemoryEventOperations(): EventOperations {
  const bundledTemplates = copy(builtInEventTemplates)
  const templates = copy(bundledTemplates)
  const events: Event[] = []
  const drafts = new Map<string, EventDraft>()
  let nextEventId = 1
  let nextDraftId = 1
  let nextTemplateId = 1

  function templateTasksFrom(input: TemplateTaskInput[], templateId: string) {
    return input.map((task, index) => ({
      id: `${templateId}-task-${index + 1}`,
      title: task.title.trim(),
      phase: task.phase,
      relativeDeadlineDays: task.relativeDeadlineDays,
      subtaskTitles: task.subtaskTitles
        .map((title) => title.trim())
        .filter(Boolean),
    }))
  }

  function createEvent(input: CreateEventInput): Event {
    validateEventDetails(input)
    const template = templates.find((item) => item.id === input.templateId)
    if (!template) throw new Error("Choose a valid Event Template.")

    const event: Event = {
      id: `event-${nextEventId++}`,
      name: input.name,
      date: input.date,
      venue: input.venue,
      sourceTemplateId: template.id,
      sourceTemplateName: template.name,
      status: "Open",
      tasks: template.tasks.map((task) => ({
        id: `${task.id}-event-${nextEventId - 1}`,
        title: task.title,
        phase: task.phase,
        relativeDeadlineDays: task.relativeDeadlineDays,
        deadline: deadlineFor(input.date, task.relativeDeadlineDays),
        status: "To do",
        assigneeId: null,
        subtasks: task.subtaskTitles.map((title) => ({
          title,
          completed: false,
        })),
      })),
    }
    events.push(event)
    return copy(event)
  }

  function copiedTasks(template: EventTemplate, eventDate = ""): EventTask[] {
    return template.tasks.map((task) => ({
      id: `${task.id}-draft-${nextDraftId}`,
      title: task.title,
      phase: task.phase,
      relativeDeadlineDays: task.relativeDeadlineDays,
      deadline: eventDate ? deadlineFor(eventDate, task.relativeDeadlineDays) : "",
      status: "To do",
      assigneeId: null,
      subtasks: task.subtaskTitles.map((title) => ({ title, completed: false })),
    }))
  }

  function requireDraft(draftId: string): EventDraft {
    const draft = drafts.get(draftId)
    if (!draft) throw new Error("Event draft not found.")
    return draft
  }

  function requireEvent(eventId: string): Event {
    const event = events.find((item) => item.id === eventId)
    if (!event) throw new Error("Event not found.")
    return event
  }

  function requireEditableEvent(eventId: string): Event {
    const event = requireEvent(eventId)
    if (event.status === "Closed") throw new Error("Closed Events are read-only.")
    return event
  }

  function requireTask(event: Event, taskId: string): EventTask {
    const task = event.tasks.find((item) => item.id === taskId)
    if (!task) throw new Error("Task not found.")
    return task
  }

  function validateEventTaskInput(input: EventTaskInput) {
    if (!input.title.trim()) throw new Error("Enter a Task title.")
    if (!input.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) {
      throw new Error("Set a Task deadline.")
    }
    if (
      input.assigneeId !== null &&
      !teamMembers.some((member) => member.id === input.assigneeId)
    ) {
      throw new Error("Choose a valid Team Member.")
    }
  }

  return {
    listEventTemplates: () => copy(templates),
    createCustomEventTemplate: (input) => {
      validateTemplateInput(input)
      const id = `custom-template-${nextTemplateId++}`
      const template: EventTemplate = {
        id,
        name: input.name.trim(),
        description: input.description.trim(),
        isBuiltIn: false,
        tasks: templateTasksFrom(input.tasks, id),
      }
      templates.push(template)
      return copy(template)
    },
    updateEventTemplate: ({ templateId, ...input }) => {
      validateTemplateInput(input)
      const template = templates.find((item) => item.id === templateId)
      if (!template) throw new Error("Event Template not found.")
      template.name = input.name.trim()
      template.description = input.description.trim()
      template.tasks = templateTasksFrom(input.tasks, template.id)
      return copy(template)
    },
    resetBuiltInEventTemplate: (templateId) => {
      const bundledTemplate = bundledTemplates.find(
        (item) => item.id === templateId,
      )
      if (!bundledTemplate)
        throw new Error("Only built-in Event Templates can be reset.")
      const index = templates.findIndex((item) => item.id === templateId)
      if (index === -1) throw new Error("Event Template not found.")
      templates[index] = copy(bundledTemplate)
      return copy(templates[index])
    },
    deleteCustomEventTemplate: (templateId) => {
      const index = templates.findIndex((item) => item.id === templateId)
      if (index === -1) throw new Error("Event Template not found.")
      if (templates[index].isBuiltIn) {
        throw new Error("Built-in Event Templates cannot be deleted.")
      }
      templates.splice(index, 1)
    },
    listTeamMembers: () => copy(teamMembers),
    listEvents: ({ includeClosed = false } = {}) =>
      copy(eventsForCollection(events, includeClosed)),
    getEvent: (eventId) => {
      const event = events.find((item) => item.id === eventId)
      return event ? copy(event) : undefined
    },
    updateEvent: (eventId, changes) => {
      const event = requireEditableEvent(eventId)
      const next = { ...event, ...changes }
      validateEventDetails(next)
      event.name = next.name.trim()
      event.date = next.date
      event.venue = next.venue.trim()
      event.tasks.forEach((task) => {
        task.deadline = deadlineFor(event.date, task.relativeDeadlineDays)
      })
      return copy(event)
    },
    closeEvent: (eventId) => {
      const event = requireEvent(eventId)
      event.status = "Closed"
      return copy(event)
    },
    reopenEvent: (eventId) => {
      const event = requireEvent(eventId)
      event.status = "Open"
      return copy(event)
    },
    deleteEvent: (eventId) => {
      const index = events.findIndex((item) => item.id === eventId)
      if (index === -1) throw new Error("Event not found.")
      events.splice(index, 1)
    },
    createEventDraft: (templateId) => {
      if (!templates.some((item) => item.id === templateId)) {
        throw new Error("Choose a valid Event Template.")
      }
      const draft: EventDraft = {
        id: `draft-${nextDraftId++}`,
        templateId,
        name: "",
        date: "",
        venue: "",
        tasks: copiedTasks(templates.find((item) => item.id === templateId)!),
      }
      drafts.set(draft.id, draft)
      return copy(draft)
    },
    updateEventDraft: (draftId, changes) => {
      const draft = requireDraft(draftId)
      Object.assign(draft, changes)
      if (changes.date) {
        draft.tasks.forEach((task) => {
          task.deadline = deadlineFor(changes.date, task.relativeDeadlineDays)
        })
      }
      return copy(draft)
    },
    changeEventDraftTemplate: (draftId, templateId) => {
      const draft = requireDraft(draftId)
      const template = templates.find((item) => item.id === templateId)
      if (!template) throw new Error("Choose a valid Event Template.")
      draft.templateId = templateId
      draft.tasks = copiedTasks(template, draft.date)
      return copy(draft)
    },
    updateEventDraftTask: (draftId, { taskId, ...changes }) => {
      const draft = requireDraft(draftId)
      const task = draft.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error("Draft Task not found.")
      if (!changes.title.trim()) throw new Error("Enter a Task title.")
      if (!Number.isInteger(changes.relativeDeadlineDays)) {
        throw new Error("Set a Task deadline.")
      }
      if (
        changes.assigneeId !== null &&
        !teamMembers.some((member) => member.id === changes.assigneeId)
      ) {
        throw new Error("Choose a valid Team Member.")
      }
      Object.assign(task, changes)
      task.deadline = draft.date
        ? deadlineFor(draft.date, task.relativeDeadlineDays)
        : ""
      return copy(draft)
    },
    addEventDraftTask: (draftId) => {
      const draft = requireDraft(draftId)
      draft.tasks.push({
        id: `draft-task-${nextDraftId}-${draft.tasks.length + 1}`,
        title: "New Task",
        phase: "Planning",
        relativeDeadlineDays: 0,
        deadline: draft.date ? deadlineFor(draft.date, 0) : "",
        status: "To do",
        assigneeId: null,
        subtasks: [],
      })
      return copy(draft)
    },
    removeEventDraftTask: (draftId, taskId) => {
      const draft = requireDraft(draftId)
      const index = draft.tasks.findIndex((task) => task.id === taskId)
      if (index === -1) throw new Error("Draft Task not found.")
      draft.tasks.splice(index, 1)
      return copy(draft)
    },
    discardEventDraft: (draftId) => {
      if (!drafts.delete(draftId)) throw new Error("Event draft not found.")
    },
    createEventFromDraft: (draftId) => {
      const draft = requireDraft(draftId)
      validateEventDetails(draft)
      if (draft.tasks.length === 0) {
        throw new Error("Keep at least one Task in this Event plan.")
      }
      const template = templates.find((item) => item.id === draft.templateId)
      if (!template) throw new Error("Choose a valid Event Template.")
      const event: Event = {
        id: `event-${nextEventId++}`,
        name: draft.name,
        date: draft.date,
        venue: draft.venue,
        sourceTemplateId: template.id,
        sourceTemplateName: template.name,
        status: "Open",
        tasks: draft.tasks.map((task) => ({
          ...copy(task),
          id: `${task.id}-event-${nextEventId - 1}`,
          deadline: deadlineFor(draft.date, task.relativeDeadlineDays),
        })),
      }
      events.push(event)
      drafts.delete(draftId)
      return copy(event)
    },
    createEvent,
    startTask: ({ eventId, taskId }) => {
      const task = requireTask(requireEditableEvent(eventId), taskId)
      if (task.status !== "To do")
        throw new Error("Only To do Tasks can be started.")
      task.status = "In progress"
      return copy(task)
    },
    markTaskDone: ({ eventId, taskId }) => {
      const task = requireTask(requireEditableEvent(eventId), taskId)
      if (task.status !== "In progress") {
        throw new Error("Only In progress Tasks can be marked done.")
      }
      task.status = "Done"
      return copy(task)
    },
    reopenTask: ({ eventId, taskId }) => {
      const task = requireTask(requireEditableEvent(eventId), taskId)
      if (task.status !== "Done") throw new Error("Only Done Tasks can be reopened.")
      task.status = "In progress"
      return copy(task)
    },
    updateEventTask: ({ eventId, taskId, ...changes }) => {
      const event = requireEditableEvent(eventId)
      const task = requireTask(event, taskId)
      validateEventTaskInput(changes)
      task.title = changes.title.trim()
      task.phase = changes.phase
      task.relativeDeadlineDays = relativeDeadlineDaysFor(event.date, changes.deadline)
      task.deadline = deadlineFor(event.date, task.relativeDeadlineDays)
      task.assigneeId = changes.assigneeId
      task.subtasks = changes.subtasks.map((subtask) => ({
        title: subtask.title.trim(),
        completed: subtask.completed,
      })).filter((subtask) => subtask.title)
      return copy(task)
    },
    addEventTask: ({ eventId, ...input }) => {
      const event = requireEditableEvent(eventId)
      validateEventTaskInput({ ...input, assigneeId: null, subtasks: [] })
      const task: EventTask = {
        id: `${event.id}-task-${event.tasks.length + 1}`,
        title: input.title.trim(),
        phase: input.phase,
        relativeDeadlineDays: relativeDeadlineDaysFor(event.date, input.deadline),
        deadline: input.deadline,
        status: "To do",
        assigneeId: null,
        subtasks: [],
      }
      event.tasks.push(task)
      return copy(task)
    },
    removeEventTask: ({ eventId, taskId }) => {
      const event = requireEditableEvent(eventId)
      const index = event.tasks.findIndex((item) => item.id === taskId)
      if (index === -1) throw new Error("Task not found.")
      event.tasks.splice(index, 1)
    },
    moveEventTask: ({ eventId, taskId, direction }) => {
      const event = requireEditableEvent(eventId)
      const index = event.tasks.findIndex((item) => item.id === taskId)
      if (index === -1) throw new Error("Task not found.")
      const target = index + direction
      if (target >= 0 && target < event.tasks.length) {
        ;[event.tasks[index], event.tasks[target]] = [
          event.tasks[target],
          event.tasks[index],
        ]
      }
      return copy(event)
    },
    toggleSubtask: ({ eventId, taskId, subtaskIndex }) => {
      const task = requireTask(requireEditableEvent(eventId), taskId)
      const subtask = task.subtasks[subtaskIndex]
      if (!subtask) throw new Error("Subtask not found.")
      subtask.completed = !subtask.completed
      return copy(task)
    },
  }
}
