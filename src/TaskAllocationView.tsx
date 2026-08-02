import { useMemo, useState } from "react"
import type { EventDetail, EventPersonOption, EventSubtask, EventTask, EventTaskAssigneeInput, TaskAssigneeGroups, TaskCategory } from "./admin-api"

type Props = {
  event: EventDetail
  people: TaskAssigneeGroups
  readOnly: boolean
  onUpdateTaskAssignees: (task: EventTask, people: EventTaskAssigneeInput[]) => Promise<void>
  onUpdateSubtaskAssignees: (task: EventTask, subtask: EventSubtask, people: EventTaskAssigneeInput[]) => Promise<void>
  onOpenTask: (task: EventTask) => void
}

type DraggedAssignment = {
  personKey: string
  taskId: number
  subtaskId?: number
}

const categories: Array<{ id: TaskCategory; label: string }> = [
  { id: "planning", label: "Planning" },
  { id: "execution", label: "Execution" },
  { id: "post_execution", label: "Post-event" },
]

function personKey(person: Pick<EventPersonOption, "person_type" | "person_id">) {
  return `${person.person_type}:${person.person_id}`
}

function resolvePeople(assignees: EventTask["assignees"], options: EventPersonOption[]) {
  return (assignees ?? []).map((assignee) => ({
    ...options.find((person) => personKey(person) === personKey(assignee)),
    ...assignee,
  }))
}

function taskPeople(task: EventTask, options: EventPersonOption[]) {
  const current = resolvePeople(task.assignees, options)
  if (current.length) return current
  return options.filter((person) => person.person_type === "team_member"
    ? person.person_id === task.team_member_id
    : person.person_id === task.volunteer_id).map((person) => ({ ...person, is_lead: false }))
}

function subtaskPeople(subtask: EventSubtask, options: EventPersonOption[]) {
  return resolvePeople(subtask.assignees ?? [], options)
}

function taskTimingLabel(task: EventTask, eventDate: string) {
  const difference = Math.round((Date.parse(`${task.due_at.slice(0, 10)}T00:00:00Z`) - Date.parse(`${eventDate}T00:00:00Z`)) / 86400000)
  if (difference === 0) return "Event day"
  return `${Math.abs(difference)} day${Math.abs(difference) === 1 ? "" : "s"} ${difference < 0 ? "before" : "after"}`
}

function compactDate(value: string) {
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

function scheduledLabel(subtask: EventSubtask, eventDate: string) {
  if (!subtask.scheduled_start || !subtask.scheduled_end) return null
  const start = new Date(subtask.scheduled_start)
  const end = new Date(subtask.scheduled_end)
  const date = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short" }).format(start)
  const times = new Intl.DateTimeFormat("en-SG", { hour: "numeric", minute: "2-digit" })
  const eventDay = subtask.scheduled_start.slice(0, 10) === eventDate
  return `${date}${eventDay ? " · Event day" : ""} · ${times.format(start)}–${times.format(end)}`
}

function effortLabel(subtask: EventSubtask) {
  const logged = (subtask.time_logs ?? []).reduce((total, log) => total + log.minutes_spent, 0)
  const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}h`
  if (subtask.estimated_minutes != null) return `${hours(logged)} logged · ${hours(subtask.estimated_minutes)} estimated`
  return logged ? `${hours(logged)} logged` : "Effort-based"
}

export default function TaskAllocationView({ event, people, readOnly, onUpdateTaskAssignees, onUpdateSubtaskAssignees, onOpenTask }: Props) {
  const [collapsed, setCollapsed] = useState<Record<TaskCategory, boolean>>({ planning: false, execution: false, post_execution: true })
  const [filter, setFilter] = useState<"all" | "unassigned" | "no_event_day">("all")
  const [query, setQuery] = useState("")
  const [draggedPersonKey, setDraggedPersonKey] = useState<string | null>(null)
  const [draggedAssignment, setDraggedAssignment] = useState<DraggedAssignment | null>(null)
  const [peopleDropActive, setPeopleDropActive] = useState(false)
  const [dropTaskId, setDropTaskId] = useState<number | null>(null)
  const [dropSubtaskKey, setDropSubtaskKey] = useState<string | null>(null)

  const allPeople = useMemo(() => {
    const unique = new Map<string, EventPersonOption>()
    for (const person of [...people.organizers, ...people.volunteers]) unique.set(personKey(person), person)
    return [...unique.values()]
  }, [people])

  const assignmentCounts = useMemo(() => {
    const counts = new Map<string, { total: number; eventDay: boolean }>()
    for (const person of allPeople) counts.set(personKey(person), { total: 0, eventDay: false })
    for (const task of event.tasks) {
      const allocations = task.subtasks.length
        ? task.subtasks.flatMap((subtask) => subtaskPeople(subtask, allPeople).map((person) => ({ person, eventDay: subtask.scheduled_start?.slice(0, 10) === event.event_date })))
        : taskPeople(task, allPeople).map((person) => ({ person, eventDay: task.due_at.slice(0, 10) === event.event_date }))
      for (const { person, eventDay } of allocations) {
        const key = personKey(person)
        const current = counts.get(key) ?? { total: 0, eventDay: false }
        counts.set(key, { total: current.total + 1, eventDay: current.eventDay || eventDay })
      }
    }
    return counts
  }, [allPeople, event])

  const visiblePeople = allPeople.filter((person) => {
    const summary = assignmentCounts.get(personKey(person)) ?? { total: 0, eventDay: false }
    if (filter === "unassigned" && summary.total > 0) return false
    if (filter === "no_event_day" && summary.eventDay) return false
    const search = query.trim().toLowerCase()
    return !search || person.name.toLowerCase().includes(search) || (person.email ?? "").toLowerCase().includes(search)
  })
  const unassigned = visiblePeople.filter((person) => (assignmentCounts.get(personKey(person))?.total ?? 0) === 0)
  const allocated = visiblePeople.filter((person) => (assignmentCounts.get(personKey(person))?.total ?? 0) > 0)

  function personCard(person: EventPersonOption) {
    const summary = assignmentCounts.get(personKey(person)) ?? { total: 0, eventDay: false }
    const organizer = people.organizers.some((candidate) => personKey(candidate) === personKey(person))
    return <article className={`task-allocation-person${summary.total ? " allocated" : ""}`} draggable={!readOnly} key={personKey(person)}
      onDragEnd={() => { setDraggedPersonKey(null); setDraggedAssignment(null); setPeopleDropActive(false) }} onDragStart={(dragEvent) => {
        if (readOnly) return
        const key = personKey(person)
        setDraggedPersonKey(key)
        dragEvent.dataTransfer.effectAllowed = "copy"
        dragEvent.dataTransfer.setData("application/x-event-person", key)
      }}>
      <header><strong>{person.name}</strong><span>{organizer ? "Organiser" : "Volunteer"}</span></header>
      <p>{[person.contact_number, person.email].filter(Boolean).join(" · ") || "No contact details"}</p>
      {!!person.preferences?.length && <div className="task-allocation-preferences">{person.preferences.map((preference) => <span key={preference}>{preference}</span>)}</div>}
      <small>{summary.total} assignment{summary.total === 1 ? "" : "s"}{summary.eventDay ? " · Event day assigned" : " · No event-day work"}</small>
    </article>
  }

  async function addPersonToSubtask(task: EventTask, subtask: EventSubtask, key: string) {
    const person = allPeople.find((candidate) => personKey(candidate) === key)
    if (!person) return
    const currentSubtaskPeople = subtaskPeople(subtask, allPeople)
    const currentTaskPeople = taskPeople(task, allPeople)
    const needsSubtaskAssignment = !currentSubtaskPeople.some((candidate) => personKey(candidate) === key)
    const needsTaskAssignment = !currentTaskPeople.some((candidate) => personKey(candidate) === key)
    if (!needsSubtaskAssignment && !needsTaskAssignment) return
    if (needsSubtaskAssignment) {
      await onUpdateSubtaskAssignees(task, subtask, [...currentSubtaskPeople, person].map((assignee) => ({
        person_type: assignee.person_type,
        person_id: assignee.person_id,
      })))
    }
    if (needsTaskAssignment) {
      await onUpdateTaskAssignees(task, [...currentTaskPeople, person].map((assignee) => ({
        person_type: assignee.person_type,
        person_id: assignee.person_id,
        is_lead: Boolean(assignee.is_lead),
      })))
    }
  }

  async function addPersonToTask(task: EventTask, key: string) {
    const person = allPeople.find((candidate) => personKey(candidate) === key)
    if (!person) return
    const current = taskPeople(task, allPeople)
    if (current.some((candidate) => personKey(candidate) === key)) return
    await onUpdateTaskAssignees(task, [...current, person].map((assignee) => ({
      person_type: assignee.person_type,
      person_id: assignee.person_id,
      is_lead: Boolean(assignee.is_lead),
    })))
  }

  async function removeAssignment(assignment: DraggedAssignment) {
    const task = event.tasks.find((candidate) => candidate.id === assignment.taskId)
    if (!task) return
    if (assignment.subtaskId != null) {
      const subtask = task.subtasks.find((candidate) => candidate.id === assignment.subtaskId)
      if (!subtask) return
      await onUpdateSubtaskAssignees(task, subtask, subtaskPeople(subtask, allPeople)
        .filter((person) => personKey(person) !== assignment.personKey)
        .map((person) => ({ person_type: person.person_type, person_id: person.person_id })))
      return
    }

    for (const subtask of task.subtasks) {
      const current = subtaskPeople(subtask, allPeople)
      if (!current.some((person) => personKey(person) === assignment.personKey)) continue
      await onUpdateSubtaskAssignees(task, subtask, current
        .filter((person) => personKey(person) !== assignment.personKey)
        .map((person) => ({ person_type: person.person_type, person_id: person.person_id })))
    }
    await onUpdateTaskAssignees(task, taskPeople(task, allPeople)
      .filter((person) => personKey(person) !== assignment.personKey)
      .map((person) => ({ person_type: person.person_type, person_id: person.person_id, is_lead: Boolean(person.is_lead) })))
  }

  async function toggleLead(task: EventTask, person: EventPersonOption) {
    const current = new Map(taskPeople(task, allPeople).map((assignee) => [personKey(assignee), assignee]))
    const key = personKey(person)
    const existing = current.get(key)
    current.set(key, { ...person, ...existing, is_lead: !existing?.is_lead })
    await onUpdateTaskAssignees(task, [...current.values()].map((assignee) => ({
      person_type: assignee.person_type,
      person_id: assignee.person_id,
      is_lead: Boolean(assignee.is_lead),
    })))
  }

  return <div className="task-allocation-layout">
    <aside className={`task-allocation-people${peopleDropActive ? " drop-target" : ""}`} aria-label="People available for task assignment"
      onDragLeave={(dragEvent) => {
        if (!dragEvent.currentTarget.contains(dragEvent.relatedTarget as Node | null)) setPeopleDropActive(false)
      }}
      onDragOver={(dragEvent) => {
        if (!readOnly && draggedAssignment) {
          dragEvent.preventDefault()
          dragEvent.dataTransfer.dropEffect = "move"
          setPeopleDropActive(true)
        }
      }}
      onDrop={(dragEvent) => {
        if (readOnly || !draggedAssignment) return
        dragEvent.preventDefault()
        setPeopleDropActive(false)
        void removeAssignment(draggedAssignment)
      }}>
      <header><h4>People</h4><span>{unassigned.length} need assignment</span></header>
      <input aria-label="Search people" placeholder="Search people" value={query} onChange={(input) => setQuery(input.target.value)} />
      <div className="task-allocation-filters" role="group" aria-label="People filters">
        <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>All</button>
        <button className={filter === "unassigned" ? "active" : ""} type="button" onClick={() => setFilter("unassigned")}>Unassigned</button>
        <button className={filter === "no_event_day" ? "active" : ""} type="button" onClick={() => setFilter("no_event_day")}>No event-day task</button>
      </div>
      <section><h5>Need assignment</h5>{unassigned.length ? unassigned.map(personCard) : <p>Everyone has an assignment.</p>}</section>
      <section><h5>Already allocated</h5>{allocated.length ? allocated.map(personCard) : <p>No one allocated yet.</p>}</section>
    </aside>

    <div className="task-allocation-phases">
      {categories.map((category) => {
        const tasks = event.tasks.filter((task) => task.category === category.id).sort((a, b) => a.due_at.localeCompare(b.due_at))
        const unassignedCount = tasks.reduce((count, task) => count + task.subtasks.filter((subtask) => !(subtask.assignees ?? []).length).length, 0)
        return <section className="task-allocation-phase" key={category.id}>
          <button aria-expanded={!collapsed[category.id]} className="task-allocation-phase-heading" type="button"
            onClick={() => setCollapsed((current) => ({ ...current, [category.id]: !current[category.id] }))}
            onDragEnter={() => draggedPersonKey && setCollapsed((current) => ({ ...current, [category.id]: false }))}>
            <span>{collapsed[category.id] ? "▶" : "▼"} {category.label}</span>
            <small>{tasks.length} tasks{unassignedCount ? ` · ${unassignedCount} subtasks unassigned` : ""}</small>
          </button>
          {!collapsed[category.id] && <div className="task-allocation-task-grid">
            {tasks.map((task) => {
              const taskTeam = new Map<string, ReturnType<typeof taskPeople>[number]>()
              taskPeople(task, allPeople).forEach((person) => taskTeam.set(personKey(person), person))
              task.subtasks.flatMap((subtask) => subtaskPeople(subtask, allPeople)).forEach((person) => {
                const key = personKey(person)
                if (!taskTeam.has(key)) taskTeam.set(key, { ...person, is_lead: false })
              })
              const sortedTaskTeam = [...taskTeam.values()].sort((a, b) => Number(Boolean(b.is_lead)) - Number(Boolean(a.is_lead)) || a.name.localeCompare(b.name))
              return <article className={`task-allocation-task${dropTaskId === task.id ? " drop-target" : ""}`} key={task.id}
                onClick={() => onOpenTask(task)}
                onDragLeave={(dragEvent) => {
                  if (!dragEvent.currentTarget.contains(dragEvent.relatedTarget as Node | null)) {
                    setDropTaskId((current) => current === task.id ? null : current)
                  }
                }}
                onDragOver={(dragEvent) => {
                  if (readOnly || dropSubtaskKey) return
                  dragEvent.preventDefault()
                  dragEvent.dataTransfer.dropEffect = "copy"
                  setDropTaskId(task.id)
                }}
                onDrop={(dragEvent) => {
                  if (readOnly || dropSubtaskKey) return
                  dragEvent.preventDefault()
                  dragEvent.stopPropagation()
                  const person = dragEvent.dataTransfer.getData("application/x-event-person") || draggedPersonKey
                  setDropTaskId(null)
                  if (person) void addPersonToTask(task, person)
                }}>
                <div><span className={taskTimingLabel(task, event.event_date) === "Event day" ? "event-day" : ""}>{compactDate(task.due_at)} · {taskTimingLabel(task, event.event_date)}</span><small>{task.status === "incomplete" ? "To do" : task.status === "ongoing" ? "In progress" : "Done"}</small></div>
                <strong>{task.name}</strong>
                {sortedTaskTeam.length > 0 && <div className="task-allocation-task-team">
                  {sortedTaskTeam.map((person) => <div className={`task-allocation-task-person${person.is_lead ? " lead" : ""}`} draggable={!readOnly} key={personKey(person)}
                    onDragEnd={() => { setDraggedPersonKey(null); setDraggedAssignment(null); setPeopleDropActive(false) }}
                    onDragStart={(dragEvent) => {
                      if (readOnly) return
                      const key = personKey(person)
                      setDraggedPersonKey(key)
                      setDraggedAssignment({ personKey: key, taskId: task.id })
                      dragEvent.stopPropagation()
                      dragEvent.dataTransfer.effectAllowed = "copyMove"
                      dragEvent.dataTransfer.setData("application/x-event-person", key)
                    }}>
                    <span>{person.name}</span>
                    <button aria-label={person.is_lead ? `Remove ${person.name} as task lead` : `Make ${person.name} a task lead`}
                      disabled={readOnly} title={person.is_lead ? "Remove task lead" : "Make task lead"} type="button"
                      onClick={(clickEvent) => { clickEvent.stopPropagation(); void toggleLead(task, person) }}>
                      {person.is_lead ? "★" : "☆"}
                    </button>
                  </div>)}
                </div>}
                <div className="task-allocation-subtasks">
                  {task.subtasks.map((subtask) => {
                    const assigned = subtaskPeople(subtask, allPeople)
                    const key = `${task.id}:${subtask.id}`
                    return <section className={`task-allocation-subtask${dropSubtaskKey === key ? " drop-target" : ""}`} key={subtask.id}
                      onDragLeave={() => setDropSubtaskKey((current) => current === key ? null : current)}
                      onDragOver={(dragEvent) => { if (!readOnly) { dragEvent.preventDefault(); dragEvent.stopPropagation(); dragEvent.dataTransfer.dropEffect = "copy"; setDropTaskId(null); setDropSubtaskKey(key) } }}
                      onDrop={(dragEvent) => {
                        if (readOnly) return
                        dragEvent.preventDefault(); dragEvent.stopPropagation()
                        const person = dragEvent.dataTransfer.getData("application/x-event-person") || draggedPersonKey
                        setDropSubtaskKey(null)
                        if (person) void addPersonToSubtask(task, subtask, person)
                      }}>
                      <header><strong>{subtask.title}</strong><span>{subtask.completed ? "Done" : "Open"}</span></header>
                      <small className={subtask.scheduled_start?.slice(0, 10) === event.event_date ? "event-day" : ""}>{scheduledLabel(subtask, event.event_date) ?? effortLabel(subtask)}</small>
                      <footer>{assigned.length ? assigned.map((person) => <div className="task-allocation-assignee" draggable={!readOnly} key={personKey(person)}
                        onDragEnd={() => { setDraggedPersonKey(null); setDraggedAssignment(null); setPeopleDropActive(false) }}
                        onDragStart={(dragEvent) => {
                          if (readOnly) return
                          const key = personKey(person)
                          setDraggedPersonKey(key)
                          setDraggedAssignment({ personKey: key, taskId: task.id, subtaskId: subtask.id })
                          dragEvent.stopPropagation()
                          dragEvent.dataTransfer.effectAllowed = "copyMove"
                          dragEvent.dataTransfer.setData("application/x-event-person", key)
                        }}>
                        <span>{person.name}</span>
                      </div>) : <em>Drop people here</em>}</footer>
                    </section>
                  })}
                  {!task.subtasks.length && <p className="task-allocation-no-subtasks">Open the task to add subtasks.</p>}
                </div>
              </article>
            })}
            {!tasks.length && <p>No {category.label.toLowerCase()} tasks.</p>}
          </div>}
        </section>
      })}
    </div>
  </div>
}
