import { useEffect, useState } from "react"
import { clearVolunteerToken, getVolunteerDashboard, getVolunteerToken, type VolunteerDashboard as DashboardData, type VolunteerDashboardEvent } from "./volunteer-api"
import { AccountHeader } from "./VolunteerRegister"

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date)
}

function focusedEventFromUrl() {
  const value = Number(new URLSearchParams(window.location.search).get("focusEvent"))
  return Number.isInteger(value) && value > 0 ? value : null
}

function EventRow({ event, focused }: { event: VolunteerDashboardEvent; focused: boolean }) {
  return <article id={`volunteer-event-${event.event_id}`} className={`pts-dashboard-event ${focused ? "focused" : ""}`}><div><p>{event.signup_status}</p><h3>{event.event_name}</h3><span>{formatDate(event.event_date)} · {event.venue}</span></div><aside>{event.assigned_role_name || "Role to be confirmed"}<small>{event.attendance === null ? "Attendance pending" : event.attendance ? "Attended" : "Not attended"}</small></aside></article>
}

export default function VolunteerDashboard({ onBack, onSignIn }: { onBack: () => void; onSignIn: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focusedEventId] = useState(focusedEventFromUrl)
  useEffect(() => {
    if (!getVolunteerToken()) {
      setError("Please sign in to view your volunteer dashboard.")
      return
    }
    getVolunteerDashboard().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load your dashboard."))
  }, [])

  useEffect(() => {
    if (!data || focusedEventId === null) return
    document.getElementById(`volunteer-event-${focusedEventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [data, focusedEventId])

  function signOut() {
    clearVolunteerToken()
    onBack()
  }

  return <div className="pts-account-page"><AccountHeader label="Volunteer dashboard" onSignOut={signOut} /><main className="pts-dashboard-main">
    <div className="pts-dashboard-top"><div><p className="pts-account-eyebrow">Your volunteer space</p><h1>{data ? `Hello, ${data.volunteer.name.split(" ")[0]}.` : "Your volunteer dashboard"}</h1><span>Keep track of the events you are helping to make happen.</span></div></div>
    {error && <p className="pts-signup-error">{error}</p>}
    {!data && !error && <p className="pts-dashboard-state">Loading your dashboard…</p>}
    {!data && error && <button className="pts-signup-submit pts-dashboard-signin" type="button" onClick={onSignIn}>Sign in to continue</button>}
    {data && <>
      <section className="pts-dashboard-section"><div className="pts-dashboard-section-heading"><div><p className="pts-account-eyebrow">Coming up</p><h2>Active event sign-ups</h2></div><span>{data.active_events.length} event{data.active_events.length === 1 ? "" : "s"}</span></div>{data.active_events.length ? data.active_events.map((event) => <EventRow key={event.signup_id} event={event} focused={event.event_id === focusedEventId} />) : <p className="pts-dashboard-empty">You have no upcoming event sign-ups yet.</p>}</section>
      <section className="pts-dashboard-section"><div className="pts-dashboard-section-heading"><div><p className="pts-account-eyebrow">Your record</p><h2>Past events</h2></div><span>{data.past_events.length} event{data.past_events.length === 1 ? "" : "s"}</span></div>{data.past_events.length ? data.past_events.map((event) => <EventRow key={event.signup_id} event={event} focused={event.event_id === focusedEventId} />) : <p className="pts-dashboard-empty">Your completed events will appear here.</p>}</section>
      <section className="pts-dashboard-section pts-locked-section"><div><p className="pts-account-eyebrow">Available after approval</p><h2>Your volunteer tools</h2><p>Skills, certificates, and participation records will unlock after an organiser approves you for an event.</p></div><div className="pts-locked-tools"><span>Skills</span><span>Certificates</span><span>Participation records</span></div></section>
    </>}
  </main></div>
}
