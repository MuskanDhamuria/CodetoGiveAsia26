import { Fragment, useEffect, useMemo, useState } from "react"
import { formatPhoneForDisplay } from "./phone"
import {
  deleteVolunteer,
  getVolunteer,
  listEventSignups,
  listEvents,
  listVolunteerEvents,
  listVolunteers,
  type EventSummary,
  type Signup,
  type VolunteerDetail,
  type VolunteerEventHistory,
  type VolunteerListItem,
} from "./volunteer-api"

const ALL_EVENTS = "all"
const ALL_SKILLS = "all"

type VolunteerDirectoryProps = {
  onOpenEvent?: (eventId: number) => void
}

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

function searchableVolunteer(volunteer: VolunteerListItem) {
  return [
    volunteer.name,
    volunteer.contact_number,
    formatPhoneForDisplay(volunteer.contact_number),
    volunteer.email,
    ...volunteer.skills,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export default function VolunteerDirectory({ onOpenEvent }: VolunteerDirectoryProps) {
  const [volunteers, setVolunteers] = useState<VolunteerListItem[]>([])
  const [events, setEvents] = useState<EventSummary[]>([])
  const [eventFilter, setEventFilter] = useState<string>(ALL_EVENTS)
  const [skillFilter, setSkillFilter] = useState<string>(ALL_SKILLS)
  const [signups, setSignups] = useState<Signup[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [eventLoading, setEventLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedVolunteerId, setSelectedVolunteerId] = useState<number | null>(null)
  const [profile, setProfile] = useState<VolunteerDetail | null>(null)
  const [profileHistory, setProfileHistory] = useState<VolunteerEventHistory[]>([])
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileReloadKey, setProfileReloadKey] = useState(0)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([listVolunteers(), listEvents()])
      .then(([volunteerData, eventData]) => {
        setVolunteers(volunteerData.items)
        setEvents(eventData.items)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load volunteers."))
      .finally(() => setLoading(false))
  }, [reloadKey])

  useEffect(() => {
    if (eventFilter === ALL_EVENTS) {
      setSignups([])
      setEventLoading(false)
      return
    }
    setEventLoading(true)
    setError(null)
    listEventSignups(Number(eventFilter))
      .then((data) => setSignups(data.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load event volunteers."))
      .finally(() => setEventLoading(false))
  }, [eventFilter])

  useEffect(() => {
    setDeleteConfirmOpen(false)
    setDeleteError(null)
    if (selectedVolunteerId === null) {
      setProfile(null)
      setProfileHistory([])
      setProfileError(null)
      return
    }

    let cancelled = false
    setProfileLoading(true)
    setProfileError(null)
    Promise.all([getVolunteer(selectedVolunteerId), listVolunteerEvents(selectedVolunteerId)])
      .then(([volunteer, history]) => {
        if (cancelled) return
        setProfile(volunteer)
        setProfileHistory(history.items)
      })
      .catch((err) => {
        if (!cancelled) {
          setProfileError(err instanceof Error ? err.message : "Failed to load volunteer details.")
        }
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedVolunteerId, profileReloadKey])

  useEffect(() => {
    if (selectedVolunteerId === null) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedVolunteerId(null)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [selectedVolunteerId])

  const filteringByEvent = eventFilter !== ALL_EVENTS
  const term = search.trim().toLowerCase()
  const selectedEvent = events.find((event) => String(event.id) === eventFilter)
  const volunteerById = useMemo(
    () => new Map(volunteers.map((volunteer) => [volunteer.id, volunteer])),
    [volunteers],
  )
  const skills = useMemo(
    () => [...new Set(volunteers.flatMap((volunteer) => volunteer.skills))].sort(),
    [volunteers],
  )

  const allRows = volunteers.filter((volunteer) => {
    const matchesSearch = term === "" || searchableVolunteer(volunteer).includes(term)
    const matchesSkill = skillFilter === ALL_SKILLS || volunteer.skills.includes(skillFilter)
    return matchesSearch && matchesSkill
  })
  const eventRows = signups.filter((signup) => {
    const volunteer = volunteerById.get(signup.volunteer_id)
    const searchable = volunteer ? searchableVolunteer(volunteer) : signup.volunteer_name.toLowerCase()
    const matchesSearch = term === "" || searchable.includes(term)
    const matchesSkill = skillFilter === ALL_SKILLS || volunteer?.skills.includes(skillFilter)
    return matchesSearch && matchesSkill
  })
  const rowCount = filteringByEvent ? eventRows.length : allRows.length
  const tableLoading = loading || (filteringByEvent && eventLoading)

  function toggleVolunteerProfile(volunteerId: number) {
    setSelectedVolunteerId((current) => current === volunteerId ? null : volunteerId)
  }

  async function handleDeleteVolunteer() {
    if (selectedVolunteerId === null || profile === null) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteVolunteer(selectedVolunteerId)
      setVolunteers((current) => current.filter((volunteer) => volunteer.id !== selectedVolunteerId))
      setSignups((current) => current.filter((signup) => signup.volunteer_id !== selectedVolunteerId))
      setSelectedVolunteerId(null)
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "Could not remove this volunteer.")
    } finally {
      setDeleting(false)
    }
  }

  function expandedProfileRow(columnCount: number) {
    return (
      <tr className="volunteer-expanded-row">
        <td colSpan={columnCount}>
          <section className="volunteer-inline-profile" aria-label={`${profile?.name ?? "Volunteer"} profile`}>
            <header className="volunteer-inline-header">
              <div>
                <p>Volunteer profile</p>
                <h3>{profile?.name ?? "Loading volunteer…"}</h3>
              </div>
              <button type="button" aria-label="Close volunteer profile" onClick={() => setSelectedVolunteerId(null)}>×</button>
            </header>

            {profileLoading && <p className="volunteer-profile-state">Loading volunteer details…</p>}
            {profileError && (
              <p className="event-roster-error">
                {profileError}
                <button type="button" className="roster-retry" onClick={() => setProfileReloadKey((key) => key + 1)}>Retry</button>
              </p>
            )}

            {!profileLoading && profile && (
              <>
                <div className="volunteer-inline-summary">
                  <section className="volunteer-profile-contact">
                    <div><span>Phone</span><strong>{formatPhoneForDisplay(profile.contact_number) ?? "Not provided"}</strong></div>
                    <div><span>Email</span><strong>{profile.email ?? "Not provided"}</strong></div>
                  </section>

                  <section className="volunteer-inline-details">
                    <div>
                      <h4>Skills</h4>
                      <div className="volunteer-profile-tags">
                        {profile.skills.length
                          ? profile.skills.map((skill) => <span key={skill.id}>{skill.name}</span>)
                          : <p>No skills have been added yet.</p>}
                      </div>
                    </div>
                    <div>
                      <h4>Role interests</h4>
                      <div className="volunteer-profile-tags">
                        {profile.interests.length
                          ? profile.interests.map((interest) => (
                              <span key={interest.role_id}>{interest.name}{interest.is_lead ? " · lead" : ""}</span>
                            ))
                          : <p>No role interests have been added yet.</p>}
                      </div>
                    </div>
                  </section>

                  <section className="volunteer-profile-counts" aria-label="Volunteer event summary">
                    <div><strong>{profile.counts.events_signed_up}</strong><span>Requests</span></div>
                    <div><strong>{profile.counts.events_approved}</strong><span>Approved</span></div>
                    <div><strong>{profile.counts.events_attended}</strong><span>Attended</span></div>
                  </section>
                </div>

                <section className="volunteer-inline-history">
                  <div className="volunteer-history-heading">
                    <h4>Event history</h4>
                    <span>{profileHistory.length} event{profileHistory.length === 1 ? "" : "s"}</span>
                  </div>
                  {profileHistory.length ? (
                    <div className="volunteer-history-list">
                      {profileHistory.map((event) => (
                        <article key={event.signup_id}>
                          <div>
                            <strong>{event.event_name}</strong>
                            <span>{formatDate(event.event_date)}</span>
                          </div>
                          <div>
                            {statusPill(event.status)}
                            <span>{event.assigned_role_name ?? "Role not assigned"}{event.is_leader ? " · lead" : ""}</span>
                            {attendanceLabel(event.attendance)}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : <p className="volunteer-profile-state">No event history yet.</p>}
                </section>

                <footer className="volunteer-profile-footer">
                  {deleteConfirmOpen ? (
                    <div className="volunteer-delete-confirm" role="alert">
                      <div>
                        <strong>Permanently remove {profile.name}?</strong>
                        <span>Their account, event sign-ups, roles and attendance history will also be deleted. This cannot be undone.</span>
                        {deleteError && <em>{deleteError}</em>}
                      </div>
                      <div>
                        <button type="button" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>Cancel</button>
                        <button type="button" className="volunteer-delete-confirm-button" onClick={handleDeleteVolunteer} disabled={deleting}>
                          {deleting ? "Removing…" : "Remove permanently"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="volunteer-delete-trigger" onClick={() => setDeleteConfirmOpen(true)}>
                      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>
                      Remove volunteer
                    </button>
                  )}
                </footer>
              </>
            )}
          </section>
        </td>
      </tr>
    )
  }

  return (
    <section className="volunteer-directory" aria-label="Volunteer directory">
      <section className="crm-toolbar volunteer-directory-toolbar" aria-label="Volunteer controls">
        <label className="search-field">
          <span>Search</span>
          <input
            placeholder="Name, phone, email or skill"
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
        <label className="search-field">
          <span>Filter by skill</span>
          <select value={skillFilter} onChange={(input) => setSkillFilter(input.target.value)}>
            <option value={ALL_SKILLS}>All skills</option>
            {skills.map((skill) => <option key={skill} value={skill}>{skill}</option>)}
          </select>
        </label>
      </section>

      {error && (
        <p className="event-roster-error">
          {error}
          <button type="button" className="roster-retry" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </button>
        </p>
      )}

      <section className="volunteer-table-card">
        <div className="section-heading volunteer-directory-heading">
          <div>
            <h2>{filteringByEvent ? selectedEvent?.name ?? "Volunteers for this event" : "All volunteers"}</h2>
            {filteringByEvent && selectedEvent && (
              <p>{formatDate(selectedEvent.event_date)} · {selectedEvent.venue}</p>
            )}
          </div>
          <div className="volunteer-directory-heading-actions">
            <span>{tableLoading ? "Loading…" : `${rowCount} volunteer${rowCount === 1 ? "" : "s"}`}</span>
            {filteringByEvent && selectedEvent && onOpenEvent && (
              <button type="button" onClick={() => onOpenEvent(selectedEvent.id)}>Manage in Events</button>
            )}
          </div>
        </div>
        <div className="volunteer-table-wrap">
          {filteringByEvent ? (
            <table className="volunteer-table roster-table">
              <thead>
                <tr>
                  <th>Volunteer</th>
                  <th>Event application</th>
                  <th>Assigned role</th>
                  <th>Attendance</th>
                  <th><span className="sr-only">View</span></th>
                </tr>
              </thead>
              <tbody>
                {!tableLoading && eventRows.length === 0 ? (
                  <tr><td colSpan={5} className="roster-empty">No volunteers match these filters.</td></tr>
                ) : (
                  eventRows.map((signup) => (
                    <Fragment key={signup.id}>
                      <tr className={selectedVolunteerId === signup.volunteer_id ? "volunteer-row-open" : ""}>
                        <td>
                          <button className="volunteer-row-name" type="button" onClick={() => toggleVolunteerProfile(signup.volunteer_id)}>
                            {signup.volunteer_name}
                          </button>
                          {signup.is_leader && <span className="roster-lead" title="Team leader">★ lead</span>}
                        </td>
                        <td>{statusPill(signup.status)}</td>
                        <td>{signup.assigned_role_name ?? <span className="roster-muted">Not assigned</span>}</td>
                        <td>{attendanceLabel(signup.attendance)}</td>
                        <td className="volunteer-row-action">
                          <button type="button" onClick={() => toggleVolunteerProfile(signup.volunteer_id)}>
                            {selectedVolunteerId === signup.volunteer_id ? "Close profile" : "View profile"}
                          </button>
                        </td>
                      </tr>
                      {selectedVolunteerId === signup.volunteer_id && expandedProfileRow(5)}
                    </Fragment>
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
                  <th>Event requests</th>
                  <th>Approved events</th>
                  <th>Events attended</th>
                  <th><span className="sr-only">View</span></th>
                </tr>
              </thead>
              <tbody>
                {!tableLoading && allRows.length === 0 ? (
                  <tr><td colSpan={7} className="roster-empty">No volunteers match these filters.</td></tr>
                ) : (
                  allRows.map((volunteer) => (
                    <Fragment key={volunteer.id}>
                      <tr className={selectedVolunteerId === volunteer.id ? "volunteer-row-open" : ""}>
                        <td>
                          <button className="volunteer-row-name" type="button" onClick={() => toggleVolunteerProfile(volunteer.id)}>
                            {volunteer.name}
                          </button>
                        </td>
                        <td className="roster-muted">
                          {volunteer.contact_number && <span>{formatPhoneForDisplay(volunteer.contact_number)}</span>}
                          {volunteer.email && <small>{volunteer.email}</small>}
                          {!volunteer.contact_number && !volunteer.email && "—"}
                        </td>
                        <td>
                          <div className="volunteer-skill-list">
                            {volunteer.skills.length
                              ? volunteer.skills.map((skill) => <span key={skill}>{skill}</span>)
                              : <span className="roster-muted">No skills added</span>}
                          </div>
                        </td>
                        <td>{volunteer.counts.events_signed_up}</td>
                        <td>{volunteer.counts.events_approved}</td>
                        <td>{volunteer.counts.events_attended}</td>
                        <td className="volunteer-row-action">
                          <button type="button" onClick={() => toggleVolunteerProfile(volunteer.id)}>
                            {selectedVolunteerId === volunteer.id ? "Close profile" : "View profile"}
                          </button>
                        </td>
                      </tr>
                      {selectedVolunteerId === volunteer.id && expandedProfileRow(7)}
                    </Fragment>
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
