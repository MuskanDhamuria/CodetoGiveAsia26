import { useEffect, useMemo, useState, type FormEvent } from "react"
import type { EventDetail, EventPersonOption, EventSubtask, EventTask, EventTaskAssigneeInput, TaskAssigneeGroups } from "./admin-api"
import TaskAllocationView from "./TaskAllocationView"
import {
  addEventOrganizer,
  addEventRole,
  approveSignup,
  deleteEventOrganizer,
  deleteEventRole,
  getVolunteer,
  listEventOrganizers,
  listEventRoles,
  listEventSignups,
  listOrganizerCandidates,
  rejectSignup,
  updateSignup,
  type EventOrganizer,
  type OrganizerCandidates,
  type Role,
  type Signup,
  type VolunteerDetail,
} from "./volunteer-api"

export type EventVolunteerApi = {
  addEventRole: typeof addEventRole
  listEventRoles: typeof listEventRoles
  listEventSignups: typeof listEventSignups
  getVolunteer: typeof getVolunteer
  approveSignup: typeof approveSignup
  rejectSignup: typeof rejectSignup
  updateSignup: typeof updateSignup
  deleteEventRole: typeof deleteEventRole
  listEventOrganizers?: typeof listEventOrganizers
  listOrganizerCandidates?: typeof listOrganizerCandidates
  addEventOrganizer?: typeof addEventOrganizer
  deleteEventOrganizer?: typeof deleteEventOrganizer
}

const defaultApi: EventVolunteerApi = {
  addEventRole,
  listEventRoles,
  listEventSignups,
  getVolunteer,
  approveSignup,
  rejectSignup,
  updateSignup,
  deleteEventRole,
  listEventOrganizers,
  listOrganizerCandidates,
  addEventOrganizer,
  deleteEventOrganizer,
}

type Props = {
  eventId: number
  event?: EventDetail
  taskPeople?: TaskAssigneeGroups
  readOnly: boolean
  api?: EventVolunteerApi
  onPeopleChanged?: () => void
  onUpdateTaskAssignees?: (task: EventTask, people: EventTaskAssigneeInput[]) => Promise<void>
  onUpdateSubtaskAssignees?: (task: EventTask, subtask: EventSubtask, people: EventTaskAssigneeInput[]) => Promise<void>
  onOpenTask?: (task: EventTask) => void
}

const emptyOrganizerCandidates: OrganizerCandidates = { pts_staff: [], volunteers: [] }

function contactFor(profile: VolunteerDetail | undefined) {
  if (!profile) return "Volunteer profile"
  return [profile.contact_number, profile.email].filter(Boolean).join(" · ") || "No contact details"
}

export default function EventVolunteerTab({ eventId, event, taskPeople, readOnly, api = defaultApi, onPeopleChanged, onUpdateTaskAssignees, onUpdateSubtaskAssignees, onOpenTask }: Props) {
  const [roles, setRoles] = useState<Role[]>([])
  const [signups, setSignups] = useState<Signup[]>([])
  const [profiles, setProfiles] = useState<Record<number, VolunteerDetail>>({})
  const [roleChoice, setRoleChoice] = useState<Record<number, number>>({})
  const [search, setSearch] = useState("")
  const [showRejected, setShowRejected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busySignupId, setBusySignupId] = useState<number | null>(null)
  const [showRoleManager, setShowRoleManager] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [savingRole, setSavingRole] = useState(false)
  const [busyRoleId, setBusyRoleId] = useState<number | null>(null)
  const [organizers, setOrganizers] = useState<EventOrganizer[]>([])
  const [organizerCandidates, setOrganizerCandidates] = useState<OrganizerCandidates>(emptyOrganizerCandidates)
  const [showOrganizerManager, setShowOrganizerManager] = useState(false)
  const [organizerChoice, setOrganizerChoice] = useState("")
  const [savingOrganizer, setSavingOrganizer] = useState(false)
  const [busyOrganizerId, setBusyOrganizerId] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    setNotice("")
    const organizersRequest = api.listEventOrganizers?.(eventId) ?? Promise.resolve([])
    const candidatesRequest = api.listOrganizerCandidates?.(eventId) ?? Promise.resolve(emptyOrganizerCandidates)
    Promise.all([api.listEventRoles(eventId), api.listEventSignups(eventId), organizersRequest, candidatesRequest])
      .then(async ([loadedRoles, loadedSignups, loadedOrganizers, loadedCandidates]) => {
        if (!active) return
        setRoles(loadedRoles)
        setSignups(loadedSignups.items)
        setOrganizers(loadedOrganizers)
        setOrganizerCandidates(loadedCandidates)
        const volunteerIds = [...new Set(loadedSignups.items.map((signup) => signup.volunteer_id))]
        const loadedProfiles = await Promise.allSettled(
          volunteerIds.map((volunteerId) => api.getVolunteer(volunteerId)),
        )
        if (!active) return
        const profileMap: Record<number, VolunteerDetail> = {}
        loadedProfiles.forEach((result) => {
          if (result.status === "fulfilled") profileMap[result.value.id] = result.value
        })
        setProfiles(profileMap)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load event volunteers.")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, eventId])

  async function refreshOrganizerData() {
    if (!api.listEventOrganizers || !api.listOrganizerCandidates) return
    const [loadedOrganizers, loadedCandidates] = await Promise.all([
      api.listEventOrganizers(eventId),
      api.listOrganizerCandidates(eventId),
    ])
    setOrganizers(loadedOrganizers)
    setOrganizerCandidates(loadedCandidates)
  }

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const matchesSearch = (signup: Signup) => {
    if (!normalizedSearch) return true
    const profile = profiles[signup.volunteer_id]
    return [
      signup.volunteer_name,
      profile?.contact_number,
      profile?.email,
      ...(profile?.skills.map((skill) => skill.name) ?? []),
      ...signup.preferred_role_names,
      signup.assigned_role_name,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch))
  }

  const pending = signups.filter((signup) => signup.status === "requested" && matchesSearch(signup))
  const rejected = signups.filter((signup) => signup.status === "rejected" && matchesSearch(signup))
  const totals = useMemo(() => ({
    requests: signups.length,
    pending: signups.filter((signup) => signup.status === "requested").length,
    approved: signups.filter((signup) => signup.status === "approved").length,
    attendance: signups.filter(
      (signup) => signup.status === "approved" && signup.attendance !== null,
    ).length,
  }), [signups])

  const enrichedTaskPeople = useMemo<TaskAssigneeGroups | undefined>(() => {
    if (!taskPeople) return undefined
    const enrich = (person: EventPersonOption): EventPersonOption => {
      const organizer = organizers.find((candidate) => candidate.person_type === person.person_type && candidate.person_id === person.person_id)
      const volunteerId = person.person_type === "volunteer" ? person.person_id : organizer?.volunteer_id
      const signup = signups.find((candidate) => candidate.volunteer_id === volunteerId)
      const profile = volunteerId ? profiles[volunteerId] : undefined
      return {
        ...person,
        contact_number: profile?.contact_number ?? null,
        preferences: signup?.preferred_role_names ?? [],
      }
    }
    return {
      organizers: taskPeople.organizers.map(enrich),
      volunteers: taskPeople.volunteers.map(enrich),
    }
  }, [organizers, profiles, signups, taskPeople])

  function replaceSignup(updated: Signup) {
    setSignups((current) => current.map((signup) => signup.id === updated.id ? updated : signup))
  }

  function chosenRole(signup: Signup) {
    return roleChoice[signup.id] ?? signup.assigned_role_id ?? roles[0]?.id
  }

  async function handleApprove(signup: Signup) {
    const roleId = chosenRole(signup)
    if (roleId === undefined) {
      setError("This event has no volunteer roles available for assignment.")
      return
    }
    setBusySignupId(signup.id)
    setError("")
    setNotice("")
    try {
      const updated = await api.approveSignup(eventId, signup.id, { assigned_role_id: roleId })
      replaceSignup(updated)
      setNotice(`${signup.volunteer_name} was approved and added to the event team.`)
      await refreshOrganizerData()
      onPeopleChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to approve this volunteer.")
    } finally {
      setBusySignupId(null)
    }
  }

  async function handleReject(signup: Signup) {
    setBusySignupId(signup.id)
    setError("")
    setNotice("")
    try {
      const updated = await api.rejectSignup(eventId, signup.id)
      replaceSignup(updated)
      setNotice(`${signup.volunteer_name}'s request was rejected.`)
      await refreshOrganizerData()
      onPeopleChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reject this request.")
    } finally {
      setBusySignupId(null)
    }
  }

  function assignedToRole(roleId: number) {
    return signups.filter(
      (signup) => signup.status !== "rejected" && signup.assigned_role_id === roleId,
    ).length
  }

  async function handleAddRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const roleName = newRoleName.trim()
    if (!roleName) return
    setSavingRole(true)
    setError("")
    setNotice("")
    try {
      const created = await api.addEventRole(eventId, roleName)
      setRoles((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
      setNewRoleName("")
      setNotice(`${created.name} was added to this event.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add this role.")
    } finally {
      setSavingRole(false)
    }
  }

  async function handleDeleteRole(role: Role) {
    setBusyRoleId(role.id)
    setError("")
    setNotice("")
    try {
      await api.deleteEventRole(eventId, role.id)
      setRoles((current) => current.filter((item) => item.id !== role.id))
      setNotice(`${role.name} was removed from this event.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove this role.")
    } finally {
      setBusyRoleId(null)
    }
  }

  async function handleAddOrganizer() {
    if (!organizerChoice || !api.addEventOrganizer) return
    const [personType, rawId] = organizerChoice.split(":")
    setSavingOrganizer(true)
    setError("")
    setNotice("")
    try {
      const created = await api.addEventOrganizer(eventId, {
        person_type: personType as "team_member" | "volunteer",
        person_id: Number(rawId),
      })
      await refreshOrganizerData()
      setOrganizerChoice("")
      setNotice(`${created.name} is now an event organiser.`)
      onPeopleChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add this organiser.")
    } finally {
      setSavingOrganizer(false)
    }
  }

  async function handleRemoveOrganizer(organizer: EventOrganizer) {
    if (!api.deleteEventOrganizer) return
    setBusyOrganizerId(organizer.id)
    setError("")
    setNotice("")
    try {
      await api.deleteEventOrganizer(eventId, organizer.id)
      await refreshOrganizerData()
      setNotice(`${organizer.name} is no longer an event organiser.`)
      onPeopleChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove this organiser.")
    } finally {
      setBusyOrganizerId(null)
    }
  }

  if (loading) return <p className="event-volunteer-loading" role="status">Loading event volunteers…</p>

  return (
    <section className="event-volunteer-workspace" aria-label="Volunteer workspace">
      <div className="event-volunteer-summary" aria-label="Volunteer summary">
        <div><span>Requests</span><strong>{totals.requests}</strong></div>
        <div><span>Pending</span><strong>{totals.pending}</strong></div>
        <div><span>Approved</span><strong>{totals.approved}</strong></div>
        <div><span>Attendance recorded</span><strong>{totals.attendance}</strong></div>
      </div>

      <div className="event-volunteer-toolbar">
        <div>
          <h3>Volunteer workspace</h3>
          <p>Review requests, manage organisers and allocate people to event tasks.</p>
        </div>
        <label>
          <span className="sr-only">Search event volunteers</span>
          <input
            type="search"
            placeholder="Search volunteers or skills"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {error && <p className="api-workspace-feedback error" role="alert">{error}</p>}
      {notice && <p className="api-workspace-feedback" aria-live="polite">{notice}</p>}

      <section className="event-volunteer-requests" aria-labelledby="pending-volunteer-heading">
        <header>
          <div>
            <h3 id="pending-volunteer-heading">Pending requests</h3>
            <p>{pending.length ? `${pending.length} awaiting review` : "No requests awaiting review"}</p>
          </div>
          <div className="event-volunteer-request-header-actions">
            {roles.length === 0 && pending.length > 0 && <span>No preference options configured</span>}
            {!readOnly && <button type="button" onClick={() => setShowRoleManager(true)}>Manage preference options</button>}
          </div>
        </header>
        {pending.length > 0 && (
          <div className="event-volunteer-request-list">
            {pending.map((signup) => {
              const profile = profiles[signup.volunteer_id]
              return (
                <article key={signup.id}>
                  <div className="event-volunteer-request-person">
                    <strong>{signup.volunteer_name}</strong>
                    <span>{contactFor(profile)}</span>
                    <div className="event-volunteer-skills">
                      {profile?.skills.length
                        ? profile.skills.map((skill) => <span key={skill.id}>{skill.name}</span>)
                        : <span className="empty">No skills added</span>}
                    </div>
                  </div>
                  <div className="event-volunteer-preferences">
                    <span>Preferred roles</span>
                    <strong>{signup.preferred_role_names.join(", ") || "Any available role"}</strong>
                  </div>
                  {!readOnly && (
                    <div className="event-volunteer-request-actions">
                      <label>
                        <span>Assign role</span>
                        <select
                          aria-label={`Assign role to ${signup.volunteer_name}`}
                          disabled={busySignupId === signup.id || roles.length === 0}
                          value={chosenRole(signup) ?? ""}
                          onChange={(event) => setRoleChoice((current) => ({
                            ...current,
                            [signup.id]: Number(event.target.value),
                          }))}
                        >
                          {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="approve"
                        disabled={busySignupId === signup.id || roles.length === 0}
                        onClick={() => void handleApprove(signup)}
                      >Approve</button>
                      <button
                        type="button"
                        className="reject"
                        disabled={busySignupId === signup.id}
                        onClick={() => void handleReject(signup)}
                      >Reject</button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="event-organizer-panel" aria-labelledby="event-organizer-heading">
        <header>
          <div>
            <h3 id="event-organizer-heading">Event organisers</h3>
            <p>People coordinating planning and delivery for this event.</p>
          </div>
          {!readOnly && <button type="button" onClick={() => setShowOrganizerManager(true)}>Manage organisers</button>}
        </header>
        {organizers.length ? (
          <div className="event-organizer-list">
            {organizers.map((organizer) => (
              <article key={organizer.id}>
                <div>
                  <strong>{organizer.name}</strong>
                  <span>{organizer.email || "No email recorded"}</span>
                </div>
                <span className={`event-organizer-badge ${organizer.person_type}`}>
                  {organizer.identity_label}
                </span>
              </article>
            ))}
          </div>
        ) : <p className="event-organizer-empty">No event organisers assigned yet.</p>}
      </section>

      {event && enrichedTaskPeople && onUpdateTaskAssignees && onOpenTask && <section className="event-volunteer-task-allocation" aria-labelledby="team-allocation-heading">
        <header>
          <div>
            <h3 id="team-allocation-heading">Team allocation</h3>
            <p>{readOnly ? "Final task assignments for this event." : "Drag people onto tasks or subtasks. Drag an assignment back to People to remove it."}</p>
          </div>
        </header>
        <TaskAllocationView
          event={event}
          people={enrichedTaskPeople}
          readOnly={readOnly}
          onUpdateTaskAssignees={onUpdateTaskAssignees}
          onUpdateSubtaskAssignees={onUpdateSubtaskAssignees ?? (async () => undefined)}
          onOpenTask={onOpenTask}
        />
      </section>}

      {signups.some((signup) => signup.status === "rejected") && (
        <section className="event-volunteer-rejected">
          <button type="button" onClick={() => setShowRejected((current) => !current)}>
            {showRejected ? "Hide" : "Show"} rejected requests ({signups.filter((signup) => signup.status === "rejected").length})
          </button>
          {showRejected && (
            <ul>
              {rejected.map((signup) => <li key={signup.id}>{signup.volunteer_name}</li>)}
              {!rejected.length && <li>No rejected requests match your search.</li>}
            </ul>
          )}
        </section>
      )}

      {showRoleManager && (
        <div className="event-creation-overlay event-role-manager-overlay" role="presentation">
          <section aria-labelledby="event-role-manager-title" aria-modal="true" className="event-creation-dialog event-role-manager-dialog" role="dialog">
            <header>
              <div>
                <p>Volunteer preferences</p>
                <h2 id="event-role-manager-title">Manage preference options</h2>
              </div>
              <button aria-label="Close role manager" className="event-creation-close" type="button" onClick={() => setShowRoleManager(false)}>×</button>
            </header>
            <div className="event-creation-body event-role-manager-body">
              <p className="event-role-manager-note">
                Changes apply only to this event. The template remains the default for future events.
              </p>
              <form className="event-role-manager-add" onSubmit={(event) => void handleAddRole(event)}>
                <label>
                  <span>New preference</span>
                  <input
                    maxLength={80}
                    placeholder="e.g. Translation support"
                    value={newRoleName}
                    onChange={(event) => setNewRoleName(event.target.value)}
                  />
                </label>
                <button disabled={savingRole || !newRoleName.trim()} type="submit">
                  {savingRole ? "Adding…" : "Add preference"}
                </button>
              </form>
              <div className="event-role-manager-list">
                {roles.map((role) => {
                  const assignedCount = assignedToRole(role.id)
                  return (
                    <article key={role.id}>
                      <div>
                        <strong>{role.name}</strong>
                        <span>{assignedCount} {assignedCount === 1 ? "volunteer" : "volunteers"} assigned</span>
                      </div>
                      <button
                        className="api-danger-button"
                        disabled={assignedCount > 0 || busyRoleId === role.id}
                        title={assignedCount > 0 ? "Reassign volunteers before removing this role" : undefined}
                        type="button"
                        onClick={() => void handleDeleteRole(role)}
                      >
                        {busyRoleId === role.id ? "Removing…" : assignedCount > 0 ? "Reassign first" : "Remove"}
                      </button>
                    </article>
                  )
                })}
                {!roles.length && <p>No preference options have been added to this event yet.</p>}
              </div>
            </div>
            <footer>
              <button type="button" onClick={() => setShowRoleManager(false)}>Done</button>
            </footer>
          </section>
        </div>
      )}

      {showOrganizerManager && (
        <div className="event-creation-overlay event-role-manager-overlay" role="presentation">
          <section aria-labelledby="event-organizer-manager-title" aria-modal="true" className="event-creation-dialog event-organizer-manager-dialog" role="dialog">
            <header>
              <div>
                <p>Event planning team</p>
                <h2 id="event-organizer-manager-title">Manage organisers</h2>
              </div>
              <button aria-label="Close organiser manager" className="event-creation-close" type="button" onClick={() => setShowOrganizerManager(false)}>×</button>
            </header>
            <div className="event-creation-body event-organizer-manager-body">
              <p className="event-role-manager-note">
                Organiser access is event-specific. Approved volunteers keep their event-day role when promoted.
              </p>
              <div className="event-organizer-add">
                <label>
                  <span>Add organiser</span>
                  <select value={organizerChoice} onChange={(event) => setOrganizerChoice(event.target.value)}>
                    <option value="">Select a person</option>
                    <optgroup label="PTS staff">
                      {organizerCandidates.pts_staff.map((person) => (
                        <option key={`team-${person.person_id}`} value={`team_member:${person.person_id}`}>{person.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Approved volunteers">
                      {organizerCandidates.volunteers.map((person) => (
                        <option key={`volunteer-${person.person_id}`} value={`volunteer:${person.person_id}`}>{person.name}</option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <button disabled={savingOrganizer || !organizerChoice} type="button" onClick={() => void handleAddOrganizer()}>Add organiser</button>
              </div>
              <div className="event-organizer-manager-list">
                {organizers.map((organizer) => (
                  <article key={organizer.id}>
                    <div>
                      <strong>{organizer.name}</strong>
                      <span>{organizer.identity_label}</span>
                    </div>
                    <button disabled={busyOrganizerId === organizer.id} type="button" onClick={() => void handleRemoveOrganizer(organizer)}>Remove</button>
                  </article>
                ))}
                {!organizers.length && <p>No organisers assigned yet.</p>}
              </div>
            </div>
            <footer><button type="button" onClick={() => setShowOrganizerManager(false)}>Done</button></footer>
          </section>
        </div>
      )}
    </section>
  )
}
