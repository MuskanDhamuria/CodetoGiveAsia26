import { useEffect, useState } from "react"
import {
  listEventParticipants,
  listEventSignups,
  updateParticipation,
  updateSignup,
  type Participation,
  type Signup,
} from "./volunteer-api"

export type EventAttendanceApi = {
  listEventSignups: typeof listEventSignups
  listEventParticipants: typeof listEventParticipants
  updateSignup: typeof updateSignup
  updateParticipation: typeof updateParticipation
}

const defaultApi: EventAttendanceApi = {
  listEventSignups,
  listEventParticipants,
  updateSignup,
  updateParticipation,
}

type Props = {
  eventId: number
  readOnly: boolean
  api?: EventAttendanceApi
}

function attendanceLabel(attendance: boolean | null) {
  if (attendance === null) return <span className="roster-att roster-att-pending">Not recorded</span>
  return attendance ? (
    <span className="roster-att roster-att-yes">Attended</span>
  ) : (
    <span className="roster-att roster-att-no">Absent</span>
  )
}

export default function EventAttendanceTab({ eventId, readOnly, api = defaultApi }: Props) {
  const [signups, setSignups] = useState<Signup[]>([])
  const [participants, setParticipants] = useState<Participation[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    setNotice("")
    Promise.all([
      api.listEventSignups(eventId, { status: "approved" }),
      api.listEventParticipants(eventId),
    ])
      .then(([signupData, participantData]) => {
        if (!active) return
        setSignups(signupData.items)
        setParticipants(participantData.items)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load attendance.")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, eventId])

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const matchesSearch = (name: string) =>
    !normalizedSearch || name.toLocaleLowerCase().includes(normalizedSearch)

  const filteredVolunteers = signups.filter((signup) => matchesSearch(signup.volunteer_name))
  const filteredParticipants = participants.filter((participant) => matchesSearch(participant.name))

  const volunteerAttendedCount = signups.filter((signup) => signup.attendance).length
  const participantAttendedCount = participants.filter((participant) => participant.attendance).length

  async function markVolunteerAttendance(signup: Signup, attendance: boolean | null) {
    const key = `volunteer:${signup.id}`
    setBusyKey(key)
    setError("")
    setNotice("")
    try {
      const updated = await api.updateSignup(eventId, signup.id, { attendance })
      setSignups((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setNotice(
        attendance === null
          ? `Cleared ${signup.volunteer_name}'s attendance.`
          : `Marked ${signup.volunteer_name} as ${attendance ? "attended" : "absent"}.`,
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update attendance.")
    } finally {
      setBusyKey(null)
    }
  }

  async function markParticipantAttendance(participant: Participation, attendance: boolean | null) {
    const key = `participant:${participant.participant_id}`
    setBusyKey(key)
    setError("")
    setNotice("")
    try {
      const updated = await api.updateParticipation(eventId, participant.participant_id, { attendance })
      setParticipants((current) =>
        current.map((item) => (item.participant_id === updated.participant_id ? updated : item)),
      )
      setNotice(
        attendance === null
          ? `Cleared ${participant.name}'s attendance.`
          : `Marked ${participant.name} as ${attendance ? "attended" : "absent"}.`,
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update attendance.")
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) return <p className="event-volunteer-loading" role="status">Loading attendance…</p>

  return (
    <section className="event-attendance-workspace" aria-label="Attendance workspace">
      <div className="event-volunteer-summary" aria-label="Attendance summary">
        <div><span>Approved Volunteers</span><strong>{signups.length}</strong></div>
        <div><span>Volunteers Attended</span><strong>{volunteerAttendedCount}</strong></div>
        <div><span>Registered Participants</span><strong>{participants.length}</strong></div>
        <div><span>Participants Attended</span><strong>{participantAttendedCount}</strong></div>
      </div>

      <div className="event-volunteer-toolbar">
        <div>
          <h3>Manual attendance</h3>
          <p>Mark who showed up. This is independent of QR scanning — use it for anyone who wasn't scanned in.</p>
        </div>
        <label>
          <span className="sr-only">Search attendance</span>
          <input
            type="search"
            placeholder="Search volunteers or participants"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {error && <p className="api-workspace-feedback error" role="alert">{error}</p>}
      {notice && <p className="api-workspace-feedback" aria-live="polite">{notice}</p>}
      {readOnly && (
        <p className="event-attendance-readonly-notice">
          This event is cancelled, so attendance can no longer be edited.
        </p>
      )}

      <section className="event-attendance-section" aria-labelledby="attendance-volunteers-heading">
        <header>
          <h3 id="attendance-volunteers-heading">Volunteers</h3>
          <p>{filteredVolunteers.length ? `${filteredVolunteers.length} approved` : "No approved volunteers to show"}</p>
        </header>
        <div className="event-attendance-list">
          {filteredVolunteers.length === 0 ? (
            <p className="event-attendance-empty">No approved volunteers match.</p>
          ) : (
            filteredVolunteers.map((signup) => {
              const key = `volunteer:${signup.id}`
              return (
                <article key={signup.id} className="event-attendance-row">
                  <div className="event-attendance-who">
                    <strong>{signup.volunteer_name}</strong>
                    <span>{signup.assigned_role_name ?? "No role assigned"}</span>
                  </div>
                  {attendanceLabel(signup.attendance)}
                  {!readOnly && (
                    <div className="event-attendance-actions">
                      <button
                        type="button"
                        className="event-attendance-present"
                        disabled={busyKey === key || signup.attendance === true}
                        onClick={() => void markVolunteerAttendance(signup, true)}
                      >
                        Mark present
                      </button>
                      <button
                        type="button"
                        className="event-attendance-absent"
                        disabled={busyKey === key || signup.attendance === false}
                        onClick={() => void markVolunteerAttendance(signup, false)}
                      >
                        Mark absent
                      </button>
                      <button
                        type="button"
                        className="event-attendance-clear"
                        disabled={busyKey === key || signup.attendance === null}
                        onClick={() => void markVolunteerAttendance(signup, null)}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </article>
              )
            })
          )}
        </div>
      </section>

      <section className="event-attendance-section" aria-labelledby="attendance-participants-heading">
        <header>
          <h3 id="attendance-participants-heading">Participants</h3>
          <p>{filteredParticipants.length ? `${filteredParticipants.length} registered` : "No registered participants to show"}</p>
        </header>
        <div className="event-attendance-list">
          {filteredParticipants.length === 0 ? (
            <p className="event-attendance-empty">No registered participants match.</p>
          ) : (
            filteredParticipants.map((participant) => {
              const key = `participant:${participant.participant_id}`
              return (
                <article key={participant.participant_id} className="event-attendance-row">
                  <div className="event-attendance-who">
                    <strong>{participant.name}</strong>
                    <span>{participant.contact_number ?? participant.email ?? "No contact on file"}</span>
                  </div>
                  {attendanceLabel(participant.attendance)}
                  {!readOnly && (
                    <div className="event-attendance-actions">
                      <button
                        type="button"
                        className="event-attendance-present"
                        disabled={busyKey === key || participant.attendance === true}
                        onClick={() => void markParticipantAttendance(participant, true)}
                      >
                        Mark present
                      </button>
                      <button
                        type="button"
                        className="event-attendance-absent"
                        disabled={busyKey === key || participant.attendance === false}
                        onClick={() => void markParticipantAttendance(participant, false)}
                      >
                        Mark absent
                      </button>
                      <button
                        type="button"
                        className="event-attendance-clear"
                        disabled={busyKey === key || participant.attendance === null}
                        onClick={() => void markParticipantAttendance(participant, null)}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </article>
              )
            })
          )}
        </div>
      </section>
    </section>
  )
}
