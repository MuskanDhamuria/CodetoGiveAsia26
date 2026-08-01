import { useEffect, useState } from "react"
import {
  approveSignup,
  listEventParticipants,
  listEventRoles,
  listEventSignups,
  listEvents,
  rejectSignup,
  type EventSummary,
  type Participation,
  type Role,
  type Signup,
} from "./volunteer-api"

function formatDate(isoDate: string) {
  const parsed = new Date(`${isoDate}T00:00:00Z`)
  return Number.isNaN(parsed.getTime())
    ? isoDate
    : new Intl.DateTimeFormat("en-SG", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(parsed)
}

function attendanceLabel(attendance: boolean | null) {
  if (attendance === null) return <span className="roster-att roster-att-pending">Not recorded</span>
  return attendance ? (
    <span className="roster-att roster-att-yes">Attended</span>
  ) : (
    <span className="roster-att roster-att-no">Absent</span>
  )
}

function statusPill(status: Signup["status"]) {
  return <span className={`table-status roster-status-${status}`}>{status}</span>
}

export default function EventRoster() {
  const [events, setEvents] = useState<EventSummary[]>([])
  const [eventId, setEventId] = useState<number | null>(null)
  const [signups, setSignups] = useState<Signup[]>([])
  const [participants, setParticipants] = useState<Participation[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [roleChoice, setRoleChoice] = useState<Record<number, number>>({})
  const [pendingAction, setPendingAction] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listEvents()
      .then((data) => {
        setEvents(data.items)
        if (data.items.length > 0) setEventId(data.items[0].id)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load events."))
  }, [])

  function loadRoster(id: number) {
    setLoading(true)
    setError(null)
    return Promise.all([
      listEventSignups(id),
      listEventParticipants(id),
      listEventRoles(id),
    ])
      .then(([signupData, participantData, roleData]) => {
        setSignups(signupData.items)
        setParticipants(participantData.items)
        setRoles(roleData)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load roster."))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (eventId === null) return
    setNotice(null)
    void loadRoster(eventId)
  }, [eventId])

  const selectedEvent = events.find((event) => event.id === eventId)
  const pendingRequests = signups.filter((signup) => signup.status === "requested")
  const approvedCount = signups.filter((signup) => signup.status === "approved").length
  const rsvpCount = participants.filter((participant) => participant.rsvp_status).length
  const attendedCount = participants.filter((participant) => participant.attendance).length

  function roleFor(signup: Signup): number | undefined {
    return roleChoice[signup.id] ?? signup.assigned_role_id ?? roles[0]?.id
  }

  async function handleApprove(signup: Signup) {
    if (eventId === null) return
    const assignedRoleId = roleFor(signup)
    if (assignedRoleId === undefined) {
      setError("This event has no roles to assign.")
      return
    }
    setPendingAction(signup.id)
    setError(null)
    try {
      await approveSignup(eventId, signup.id, { assigned_role_id: assignedRoleId })
      await loadRoster(eventId)
      setNotice(`Approved ${signup.volunteer_name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve.")
    } finally {
      setPendingAction(null)
    }
  }

  async function handleReject(signup: Signup) {
    if (eventId === null) return
    setPendingAction(signup.id)
    setError(null)
    try {
      await rejectSignup(eventId, signup.id)
      await loadRoster(eventId)
      setNotice(`Rejected ${signup.volunteer_name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject.")
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <section className="event-roster" aria-label="Event roster">
      <div className="event-roster-picker">
        <label className="search-field">
          <span>Event</span>
          <select
            value={eventId ?? ""}
            onChange={(input) => setEventId(input.target.value ? Number(input.target.value) : null)}
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name} · {formatDate(event.event_date)}
              </option>
            ))}
          </select>
        </label>
        {selectedEvent && (
          <p className="event-roster-meta">
            {selectedEvent.venue} · <em>{selectedEvent.status}</em>
          </p>
        )}
      </div>

      {error && <p className="event-roster-error">{error}</p>}
      {notice && <p className="event-roster-notice">{notice}</p>}
      {loading && <p className="event-roster-loading">Loading roster…</p>}

      {!loading && (
        <>
          {pendingRequests.length > 0 && (
            <div className="volunteer-table-card roster-requests-card">
              <div className="section-heading">
                <h2>Pending requests</h2>
                <span>{pendingRequests.length} awaiting your review</span>
              </div>
              <ul className="roster-requests">
                {pendingRequests.map((signup) => (
                  <li key={signup.id} className="roster-request">
                    <div className="roster-request-who">
                      <strong>{signup.volunteer_name}</strong>
                      <span className="roster-muted">
                        prefers {signup.assigned_role_name ?? "any role"}
                      </span>
                    </div>
                    <div className="roster-request-actions">
                      <label className="roster-role-select">
                        <span className="sr-only">Assign role</span>
                        <select
                          value={roleFor(signup) ?? ""}
                          disabled={pendingAction === signup.id || roles.length === 0}
                          onChange={(input) =>
                            setRoleChoice((current) => ({
                              ...current,
                              [signup.id]: Number(input.target.value),
                            }))
                          }
                        >
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="roster-approve"
                        disabled={pendingAction === signup.id}
                        onClick={() => handleApprove(signup)}
                      >
                        {pendingAction === signup.id ? "Working…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="roster-reject"
                        disabled={pendingAction === signup.id}
                        onClick={() => handleReject(signup)}
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="volunteer-table-card">
            <div className="section-heading">
              <h2>Volunteers</h2>
              <span>
                {signups.length} signed up · {approvedCount} approved
              </span>
            </div>
            <div className="volunteer-table-wrap">
              <table className="volunteer-table roster-table">
                <thead>
                  <tr>
                    <th>Volunteer</th>
                    <th>Status</th>
                    <th>Assigned Role</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {signups.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="roster-empty">No volunteers signed up yet.</td>
                    </tr>
                  ) : (
                    signups.map((signup) => (
                      <tr key={signup.id}>
                        <td>
                          {signup.volunteer_name}
                          {signup.is_leader && <span className="roster-lead" title="Team leader">★ lead</span>}
                        </td>
                        <td>{statusPill(signup.status)}</td>
                        <td>{signup.assigned_role_name ?? <span className="roster-muted">—</span>}</td>
                        <td>{attendanceLabel(signup.attendance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="volunteer-table-card">
            <div className="section-heading">
              <h2>Participants</h2>
              <span>
                {participants.length} registered · {rsvpCount} RSVP'd · {attendedCount} attended
              </span>
            </div>
            <div className="volunteer-table-wrap">
              <table className="volunteer-table roster-table">
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Contact</th>
                    <th>RSVP</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="roster-empty">No participants registered yet.</td>
                    </tr>
                  ) : (
                    participants.map((participant) => (
                      <tr key={participant.participant_id}>
                        <td>{participant.name}</td>
                        <td className="roster-muted">{participant.contact_number ?? participant.email ?? "—"}</td>
                        <td>
                          {participant.rsvp_status ? (
                            <span className="roster-att roster-att-yes">RSVP'd</span>
                          ) : (
                            <span className="roster-att roster-att-pending">No reply</span>
                          )}
                        </td>
                        <td>{attendanceLabel(participant.attendance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
