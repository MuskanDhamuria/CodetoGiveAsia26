import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  addEventRole,
  approveSignup,
  deleteEventRole,
  getVolunteer,
  listEventRoles,
  listEventSignups,
  rejectSignup,
  updateSignup,
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
}

type Props = {
  eventId: number
  readOnly: boolean
  api?: EventVolunteerApi
}

function contactFor(profile: VolunteerDetail | undefined) {
  if (!profile) return "Volunteer profile"
  return [profile.contact_number, profile.email].filter(Boolean).join(" · ") || "No contact details"
}

function attendanceValue(attendance: boolean | null) {
  if (attendance === null) return ""
  return attendance ? "attended" : "absent"
}

export default function EventVolunteerTab({ eventId, readOnly, api = defaultApi }: Props) {
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
  const [draggedSignupId, setDraggedSignupId] = useState<number | null>(null)
  const [dragOverRole, setDragOverRole] = useState<string | null>(null)
  const [showRoleManager, setShowRoleManager] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [savingRole, setSavingRole] = useState(false)
  const [busyRoleId, setBusyRoleId] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    setNotice("")
    Promise.all([api.listEventRoles(eventId), api.listEventSignups(eventId)])
      .then(async ([loadedRoles, loadedSignups]) => {
        if (!active) return
        setRoles(loadedRoles)
        setSignups(loadedSignups.items)
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
  const approved = signups.filter((signup) => signup.status === "approved" && matchesSearch(signup))
  const rejected = signups.filter((signup) => signup.status === "rejected" && matchesSearch(signup))
  const totals = useMemo(() => ({
    requests: signups.length,
    pending: signups.filter((signup) => signup.status === "requested").length,
    approved: signups.filter((signup) => signup.status === "approved").length,
    attendance: signups.filter(
      (signup) => signup.status === "approved" && signup.attendance !== null,
    ).length,
  }), [signups])

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
      setNotice(`${signup.volunteer_name} was approved and added to the role board.`)
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reject this request.")
    } finally {
      setBusySignupId(null)
    }
  }

  async function updateVolunteer(signup: Signup, changes: Parameters<EventVolunteerApi["updateSignup"]>[2], success: string) {
    setBusySignupId(signup.id)
    setError("")
    setNotice("")
    try {
      const updated = await api.updateSignup(eventId, signup.id, changes)
      replaceSignup(updated)
      setNotice(success)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update this volunteer.")
    } finally {
      setBusySignupId(null)
    }
  }

  function moveVolunteer(signup: Signup, roleId: number | null) {
    if (readOnly || signup.assigned_role_id === roleId) return
    const roleName = roles.find((role) => role.id === roleId)?.name ?? "Unassigned"
    void updateVolunteer(
      signup,
      { assigned_role_id: roleId, ...(signup.is_leader ? { is_leader: false } : {}) },
      `${signup.volunteer_name} moved to ${roleName}.${signup.is_leader ? " Lead status was removed." : ""}`,
    )
  }

  function volunteersFor(roleId: number | null) {
    return approved
      .filter((signup) => signup.assigned_role_id === roleId)
      .sort((left, right) => Number(right.is_leader) - Number(left.is_leader)
        || left.volunteer_name.localeCompare(right.volunteer_name))
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

  function volunteerCard(signup: Signup) {
    const profile = profiles[signup.volunteer_id]
    return (
      <article
        className={`event-volunteer-card${signup.is_leader ? " is-lead" : ""}${draggedSignupId === signup.id ? " dragging" : ""}`}
        draggable={!readOnly && busySignupId !== signup.id}
        key={signup.id}
        onDragEnd={() => {
          setDraggedSignupId(null)
          setDragOverRole(null)
        }}
        onDragStart={(dragEvent) => {
          if (readOnly) return
          setDraggedSignupId(signup.id)
          dragEvent.dataTransfer.effectAllowed = "move"
          dragEvent.dataTransfer.setData("text/plain", String(signup.id))
        }}
      >
        <header>
          <div>
            {signup.is_leader && <span className="event-volunteer-lead">Lead</span>}
            <strong>{signup.volunteer_name}</strong>
          </div>
          {!readOnly && (
            <button
              type="button"
              disabled={busySignupId === signup.id}
              onClick={() => void updateVolunteer(
                signup,
                { is_leader: !signup.is_leader },
                signup.is_leader
                  ? `${signup.volunteer_name} is no longer a role lead.`
                  : `${signup.volunteer_name} is now a role lead.`,
              )}
            >
              {signup.is_leader ? "Remove lead" : "Make lead"}
            </button>
          )}
        </header>
        <span className="event-volunteer-contact">{contactFor(profile)}</span>
        <div className="event-volunteer-skills">
          {profile?.skills.length
            ? profile.skills.slice(0, 3).map((skill) => <span key={skill.id}>{skill.name}</span>)
            : <span className="empty">No skills added</span>}
        </div>
        {!readOnly && (
          <div className="event-volunteer-card-controls">
            <label>
              <span>Role</span>
              <select
                aria-label={`Role for ${signup.volunteer_name}`}
                disabled={busySignupId === signup.id}
                value={signup.assigned_role_id ?? ""}
                onChange={(event) => moveVolunteer(signup, event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Unassigned</option>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
            <label>
              <span>Attendance</span>
              <select
                aria-label={`Attendance for ${signup.volunteer_name}`}
                disabled={busySignupId === signup.id}
                value={attendanceValue(signup.attendance)}
                onChange={(event) => {
                  const attendance = event.target.value === "" ? null : event.target.value === "attended"
                  void updateVolunteer(signup, { attendance }, `Attendance updated for ${signup.volunteer_name}.`)
                }}
              >
                <option value="">Not recorded</option>
                <option value="attended">Attended</option>
                <option value="absent">Absent</option>
              </select>
            </label>
          </div>
        )}
        {readOnly && (
          <span className={`event-volunteer-attendance ${attendanceValue(signup.attendance) || "pending"}`}>
            {signup.attendance === null ? "Attendance not recorded" : signup.attendance ? "Attended" : "Absent"}
          </span>
        )}
      </article>
    )
  }

  function roleColumn(role: Role | null) {
    const roleId = role?.id ?? null
    const roleKey = role ? String(role.id) : "unassigned"
    const volunteers = volunteersFor(roleId)
    return (
      <section
        aria-label={`${role?.name ?? "Unassigned"} volunteers`}
        className={`event-volunteer-role-column${dragOverRole === roleKey ? " drag-over" : ""}`}
        key={roleKey}
        onDragLeave={() => setDragOverRole((current) => current === roleKey ? null : current)}
        onDragOver={(event) => {
          if (readOnly) return
          event.preventDefault()
          event.dataTransfer.dropEffect = "move"
          setDragOverRole(roleKey)
        }}
        onDrop={(event) => {
          if (readOnly) return
          event.preventDefault()
          const signupId = Number(event.dataTransfer.getData("text/plain")) || draggedSignupId
          setDraggedSignupId(null)
          setDragOverRole(null)
          const signup = signups.find((item) => item.id === signupId)
          if (signup) moveVolunteer(signup, roleId)
        }}
      >
        <h4>
          <span>{role?.name ?? "Unassigned"}</span>
          <span>{volunteers.length} {volunteers.length === 1 ? "volunteer" : "volunteers"}</span>
        </h4>
        {!volunteers.length && (
          <p>{normalizedSearch ? "No matching volunteers" : role ? "Drag an approved volunteer here" : "Everyone has a role"}</p>
        )}
        {volunteers.map(volunteerCard)}
      </section>
    )
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
          <p>Review requests, then drag approved volunteers into their event roles.</p>
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
          {roles.length === 0 && pending.length > 0 && <span>No event roles configured</span>}
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

      <section className="event-volunteer-allocation" aria-labelledby="role-allocation-heading">
        <header>
          <div>
            <h3 id="role-allocation-heading">Role allocation</h3>
            <p>{readOnly ? "Final volunteer allocation for this event." : "Drag cards between roles or use the role selector on each card."}</p>
          </div>
          <div className="event-volunteer-allocation-actions">
            <span>{approved.length} approved</span>
            {!readOnly && <button type="button" onClick={() => setShowRoleManager(true)}>Manage roles</button>}
          </div>
        </header>
        <div className="event-volunteer-unassigned">
          {roleColumn(null)}
        </div>
        <div className="event-volunteer-role-board">
          {roles.map(roleColumn)}
        </div>
      </section>

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
                <p>Event volunteer roles</p>
                <h2 id="event-role-manager-title">Manage roles</h2>
              </div>
              <button aria-label="Close role manager" className="event-creation-close" type="button" onClick={() => setShowRoleManager(false)}>×</button>
            </header>
            <div className="event-creation-body event-role-manager-body">
              <p className="event-role-manager-note">
                Changes apply only to this event. The template remains the default for future events.
              </p>
              <form className="event-role-manager-add" onSubmit={(event) => void handleAddRole(event)}>
                <label>
                  <span>New role</span>
                  <input
                    maxLength={80}
                    placeholder="e.g. Translation support"
                    value={newRoleName}
                    onChange={(event) => setNewRoleName(event.target.value)}
                  />
                </label>
                <button disabled={savingRole || !newRoleName.trim()} type="submit">
                  {savingRole ? "Adding…" : "Add role"}
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
                {!roles.length && <p>No roles have been added to this event yet.</p>}
              </div>
            </div>
            <footer>
              <button type="button" onClick={() => setShowRoleManager(false)}>Done</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  )
}
