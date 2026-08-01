import { useEffect, useMemo, useState } from "react"
import { clearVolunteerToken, getVolunteerDashboard, getVolunteerToken, listBeneficiaries, listEvents, type Beneficiary, type EventSummary, type VolunteerDashboardEvent } from "./volunteer-api"

const HERO_IMAGE = "/pts-community-hero.png"

const EVENT_IMAGES: Record<string, string> = {
  items:
    "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=1000&q=80",
  knowledge:
    "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1000&q=80",
  recreation:
    "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=1000&q=80",
  mindfulness:
    "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=1000&q=80",
}

type StatusFilter = "upcoming" | "all" | "past"

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

function eventImage(event: EventSummary) {
  const name = event.name.toLowerCase()
  if (name.includes("yoga") || name.includes("zumba") || name.includes("meditation")) {
    return EVENT_IMAGES.mindfulness
  }
  if (name.includes("knowledge") || name.includes("literacy") || name.includes("course")) {
    return EVENT_IMAGES.knowledge
  }
  if (name.includes("game") || name.includes("fun")) return EVENT_IMAGES.recreation
  return EVENT_IMAGES.items
}

function eventCategory(event: EventSummary) {
  const name = event.name.toLowerCase()
  if (name.includes("yoga") || name.includes("zumba") || name.includes("meditation")) {
    return "Peace-To-Serve · Mindfulness"
  }
  if (name.includes("knowledge") || name.includes("literacy") || name.includes("course")) {
    return "Knowledge-To-Serve"
  }
  if (name.includes("game") || name.includes("fun")) return "Peace-To-Serve · Recreation"
  return "Items-To-Serve"
}

function signupStatusLabel(status: string) {
  if (status === "requested") return "Pending approval"
  if (status === "approved") return "Approved"
  if (status === "rejected") return "Not approved"
  return status
}

export default function PublicEventsPortal({
  onVolunteerSignup,
  onVolunteerDashboard,
  onEventSignup,
}: {
  onVolunteerSignup: () => void
  onVolunteerDashboard: (eventId?: number) => void
  onEventSignup: (eventId: number) => void
}) {
  const [events, setEvents] = useState<EventSummary[]>([])
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([])
  const [beneficiaryId, setBeneficiaryId] = useState("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("upcoming")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(Boolean(getVolunteerToken()))
  const [signupsByEvent, setSignupsByEvent] = useState<Map<number, VolunteerDashboardEvent>>(new Map())

  function signOut() {
    clearVolunteerToken()
    setSignedIn(false)
    setSignupsByEvent(new Map())
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([listEvents(), listBeneficiaries()])
      .then(([eventData, beneficiaryData]) => {
        setEvents(eventData.items)
        setBeneficiaries(beneficiaryData.items)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load events."))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!signedIn) return
    getVolunteerDashboard()
      .then((dashboard) => {
        const signups = [...dashboard.active_events, ...dashboard.past_events]
        setSignupsByEvent(new Map(signups.map((signup) => [signup.event_id, signup])))
      })
      .catch(() => undefined)
  }, [signedIn])

  const beneficiaryNames = useMemo(
    () => new Map(beneficiaries.map((beneficiary) => [beneficiary.id, beneficiary.name])),
    [beneficiaries],
  )

  const visibleEvents = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return events
      .filter((event) => beneficiaryId === "all" || String(event.beneficiary_id ?? "") === beneficiaryId)
      .filter((event) => {
        if (statusFilter === "all") return true
        if (statusFilter === "past") return event.event_date < today || event.status === "closed"
        return event.event_date >= today && event.status !== "closed"
      })
      .sort((left, right) => left.event_date.localeCompare(right.event_date))
  }, [beneficiaryId, events, statusFilter])

  return (
    <div className="public-events-portal">
      <header className="public-events-header">
        <a className="public-events-brand" href="?page=community" aria-label="Passion To Serve home">
          <img src="/pts-logo.png" alt="" />
          <span>Passion To Serve</span>
        </a>
        <nav className="public-events-nav" aria-label="Public navigation">
          <a className="public-events-nav-link" href="#events">Events</a>
          <button
            type="button"
            className="public-events-volunteer-link"
            onClick={() => signedIn ? onVolunteerDashboard() : onVolunteerSignup()}
          >
            {signedIn ? "My dashboard" : "Volunteer sign up"}
          </button>
          {signedIn && (
            <button type="button" className="public-events-signout-link" onClick={signOut}>
              Sign out
            </button>
          )}
        </nav>
      </header>

      <section className="public-events-hero" style={{ backgroundImage: `url(${HERO_IMAGE})` }}>
        <div className="public-events-hero-overlay" />
        <div className="public-events-hero-copy">
          <p>Passion To Serve community</p>
          <h1>Make time for a little more good.</h1>
          <span>Find an upcoming event and join us in serving our communities.</span>
        </div>
      </section>

      <main className="public-events-main" id="events">
        <div className="public-events-intro">
          <p className="public-events-eyebrow">Our events</p>
          <h2>Ways to serve, together</h2>
          <p>Browse upcoming activities and choose the cause that speaks to you.</p>
        </div>

        <section className="public-events-filters" aria-label="Event filters">
          <div className="public-events-filter-tabs" role="group" aria-label="Event timing">
            {(["upcoming", "all", "past"] as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                className={statusFilter === filter ? "active" : ""}
                onClick={() => setStatusFilter(filter)}
              >
                {filter === "upcoming" ? "Upcoming" : filter === "all" ? "All events" : "Past events"}
              </button>
            ))}
          </div>
          <label className="public-events-beneficiary-filter">
            <span>Serving</span>
            <select value={beneficiaryId} onChange={(event) => setBeneficiaryId(event.target.value)}>
              <option value="all">All beneficiary groups</option>
              {beneficiaries.map((beneficiary) => (
                <option key={beneficiary.id} value={beneficiary.id}>{beneficiary.name}</option>
              ))}
            </select>
          </label>
        </section>

        {loading && <p className="public-events-state">Loading events…</p>}
        {error && <p className="public-events-state error">{error}</p>}
        {!loading && !error && visibleEvents.length === 0 && (
          <p className="public-events-state">No events match these filters yet.</p>
        )}

        {!loading && !error && visibleEvents.length > 0 && (
          <section className="public-events-grid" aria-label="Events list">
            {visibleEvents.map((event) => {
              const signup = signupsByEvent.get(event.id)
              return <article className="public-event-card" key={event.id}>
                <div className="public-event-card-image" style={{ backgroundImage: `url(${eventImage(event)})` }}>
                  <span>{signup ? `Already signed up · ${signupStatusLabel(signup.signup_status)}` : event.status === "closed" ? "Past event" : "Open for sign-up"}</span>
                </div>
                <div className="public-event-card-body">
                  <p className="public-event-category">{eventCategory(event)}</p>
                  <h3>{event.name}</h3>
                  <p className="public-event-beneficiary">
                    Serving {beneficiaryNames.get(event.beneficiary_id ?? -1) ?? "our community"}
                  </p>
                  <div className="public-event-meta">
                    <span>{formatDate(event.event_date)}</span>
                    <span>{event.venue}</span>
                  </div>
                  <button
                    type="button"
                    className={`public-event-details-button ${signup ? "signed-up" : ""}`}
                    disabled={event.status === "closed" && !signup}
                    onClick={() => signup ? onVolunteerDashboard(event.id) : onEventSignup(event.id)}
                  >
                    {signup ? `View status · ${signupStatusLabel(signup.signup_status)}` : event.status === "closed" ? "Past event" : "Sign up for this event"}
                  </button>
                </div>
              </article>
            } )}
          </section>
        )}
      </main>
    </div>
  )
}
