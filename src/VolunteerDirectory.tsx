import { useEffect, useState } from "react"
import {
  listEventSignups,
  listEvents,
  listVolunteers,
  type EventSummary,
  type Signup,
  type VolunteerListItem,
} from "./volunteer-api"

const ALL_EVENTS = "all"

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

function statusPill(status: string) {
  return <span className={`table-status roster-status-${status}`}>{status}</span>
}

function attendanceLabel(attendance: boolean | null) {
  if (attendance === null) return <span className="roster-att roster-att-pending">Not recorded</span>
  return attendance ? (
    <span className="roster-att roster-att-yes">Attended</span>
  ) : (
    <span className="roster-att roster-att-no">Absent</span>
  )
}

export default function VolunteerDirectory() {
  const [volunteers, setVolunteers] = useState<VolunteerListItem[]>([])
  const [events, setEvents] = useState<EventSummary[]>([])
  const [eventFilter, setEventFilter] = useState<string>(ALL_EVENTS)
  const [signups, setSignups] = useState<Signup[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([listVolunteers(), listEvents()])
      .then(([volunteerData, eventData]) => {
        setVolunteers(volunteerData.items)
        setEvents(eventData.items)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load volunteers."))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (eventFilter === ALL_EVENTS) {
      setSignups([])
      return
    }
    setError(null)
    listEventSignups(Number(eventFilter))
      .then((data) => setSignups(data.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load event volunteers."))
  }, [eventFilter])

  const filteringByEvent = eventFilter !== ALL_EVENTS
  const term = search.trim().toLowerCase()

  const allRows = volunteers.filter((volunteer) => volunteer.name.toLowerCase().includes(term))
  const eventRows = signups.filter((signup) => signup.volunteer_name.toLowerCase().includes(term))
  const rowCount = filteringByEvent ? eventRows.length : allRows.length

  return (
    <section className="volunteer-directory" aria-label="Volunteer directory">
      <section className="crm-toolbar" aria-label="Volunteer controls">
        <label className="search-field">
          <span>Search</span>
          <input
            placeholder="Search volunteers"
            type="search"
            value={search}
            onChange={(input) => setSearch(input.target.value)}
          />
        </label>
        <label className="search-field">
          <span>Filter by event</span>
          <select value={eventFilter} onChange={(input) => setEventFilter(input.target.value)}>
            <option value={ALL_EVENTS}>All volunteers</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name} · {formatDate(event.event_date)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && <p className="event-roster-error">{error}</p>}

      <section className="volunteer-table-card">
        <div className="section-heading">
          <h2>{filteringByEvent ? "Volunteers for this event" : "All volunteers"}</h2>
          <span>{loading ? "Loading…" : `${rowCount} volunteer${rowCount === 1 ? "" : "s"}`}</span>
        </div>
        <div className="volunteer-table-wrap">
          {filteringByEvent ? (
            <table className="volunteer-table roster-table">
              <thead>
                <tr>
                  <th>Volunteer</th>
                  <th>Event Status</th>
                  <th>Assigned Role</th>
                  <th>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {eventRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="roster-empty">No volunteers for this event.</td>
                  </tr>
                ) : (
                  eventRows.map((signup) => (
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
          ) : (
            <table className="volunteer-table">
              <thead>
                <tr>
                  <th>Volunteer</th>
                  <th>Contact</th>
                  <th>Skills</th>
                  <th>Onboarding</th>
                  <th>Signed Up</th>
                  <th>Approved</th>
                  <th>Attended</th>
                </tr>
              </thead>
              <tbody>
                {allRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="roster-empty">No volunteers found.</td>
                  </tr>
                ) : (
                  allRows.map((volunteer) => (
                    <tr key={volunteer.id}>
                      <td>{volunteer.name}</td>
                      <td className="roster-muted">{volunteer.contact_number ?? volunteer.email ?? "—"}</td>
                      <td>{volunteer.skills.length ? volunteer.skills.join(", ") : <span className="roster-muted">—</span>}</td>
                      <td>{statusPill(volunteer.signup_status)}</td>
                      <td>{volunteer.counts.events_signed_up}</td>
                      <td>{volunteer.counts.events_approved}</td>
                      <td>{volunteer.counts.events_attended}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </section>
  )
}
