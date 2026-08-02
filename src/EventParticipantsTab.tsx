import { useEffect, useState } from "react"
import { listEventParticipants, type Participation } from "./volunteer-api"

export type EventParticipantsApi = {
  listEventParticipants: typeof listEventParticipants
}

const defaultApi: EventParticipantsApi = { listEventParticipants }

type Props = {
  eventId: number
  api?: EventParticipantsApi
}

function attendanceLabel(attendance: boolean | null) {
  if (attendance === null) return <span className="roster-att roster-att-pending">Not recorded</span>
  return attendance ? (
    <span className="roster-att roster-att-yes">Present</span>
  ) : (
    <span className="roster-att roster-att-no">Absent</span>
  )
}

function repeatSignupLabel(repeatSignup: boolean | null) {
  if (repeatSignup === null) return <span className="roster-att roster-att-pending">N/A</span>
  return repeatSignup ? (
    <span className="roster-att roster-att-yes">Returning</span>
  ) : (
    <span className="roster-att roster-att-no">First time</span>
  )
}

export default function EventParticipantsTab({ eventId, api = defaultApi }: Props) {
  const [participants, setParticipants] = useState<Participation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .listEventParticipants(eventId)
      .then((data) => setParticipants(data.items))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load Participants."))
      .finally(() => setLoading(false))
  }, [eventId, api])

  const rsvpCount = participants.filter((participant) => participant.rsvp_status).length
  const attendedCount = participants.filter((participant) => participant.attendance).length

  if (loading) return <p role="status">Loading Participants…</p>

  return (
    <div className="volunteer-table-card">
      <div className="section-heading">
        <h3>Participants</h3>
        <span>
          {participants.length} registered · {rsvpCount} RSVP'd · {attendedCount} attended
        </span>
      </div>
      {error && <p aria-live="polite" className="api-workspace-feedback error" role="alert">{error}</p>}
      <div className="volunteer-table-wrap">
        <table className="volunteer-table roster-table">
          <thead>
            <tr>
              <th>Participant</th>
              <th>Contact</th>
              <th>RSVP</th>
              <th>Repeat signup</th>
              <th>Attendance</th>
            </tr>
          </thead>
          <tbody>
            {participants.length === 0 ? (
              <tr>
                <td className="roster-empty" colSpan={5}>No Participants registered yet.</td>
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
                  <td>{repeatSignupLabel(participant.repeat_signup)}</td>
                  <td>{attendanceLabel(participant.attendance)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
