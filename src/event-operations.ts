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
  tasks: EventTask[]
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
}

export interface EventOperations {
  listEventTemplates(): EventTemplate[]
  createCustomEventTemplate(input: EventTemplateInput): EventTemplate
  updateEventTemplate(
    input: EventTemplateInput & { templateId: string },
  ): EventTemplate
  resetBuiltInEventTemplate(templateId: string): EventTemplate
  deleteCustomEventTemplate(templateId: string): void
  listTeamMembers(): TeamMember[]
  listEvents(): Event[]
  getEvent(eventId: string): Event | undefined
  createEventDraft(templateId: string): EventDraft
  updateEventDraft(
    draftId: string,
    changes: Pick<EventDraft, "name" | "date" | "venue">,
  ): EventDraft
  discardEventDraft(draftId: string): void
  createEventFromDraft(draftId: string): Event
  createEvent(input: CreateEventInput): Event
  startTask(input: { eventId: string; taskId: string }): EventTask
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
    listEvents: () => copy(events),
    getEvent: (eventId) => {
      const event = events.find((item) => item.id === eventId)
      return event ? copy(event) : undefined
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
      }
      drafts.set(draft.id, draft)
      return copy(draft)
    },
    updateEventDraft: (draftId, changes) => {
      const draft = drafts.get(draftId)
      if (!draft) throw new Error("Event draft not found.")
      Object.assign(draft, changes)
      return copy(draft)
    },
    discardEventDraft: (draftId) => {
      if (!drafts.delete(draftId)) throw new Error("Event draft not found.")
    },
    createEventFromDraft: (draftId) => {
      const draft = drafts.get(draftId)
      if (!draft) throw new Error("Event draft not found.")
      const event = createEvent(draft)
      drafts.delete(draftId)
      return event
    },
    createEvent,
    startTask: ({ eventId, taskId }) => {
      const event = events.find((item) => item.id === eventId)
      const task = event?.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error("Task not found.")
      if (task.status !== "To do")
        throw new Error("Only To do Tasks can be started.")
      task.status = "In progress"
      return copy(task)
    },
  }
}
