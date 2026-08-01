import { useEffect, useMemo, useState } from "react"
import {
  listEventRoles,
  listEvents,
  publicSignup,
  type EventSummary,
  type Role,
} from "./volunteer-api"

function formatDate(isoDate: string) {
  const parsed = new Date(`${isoDate}T00:00:00Z`)
  return Number.isNaN(parsed.getTime())
    ? isoDate
    : new Intl.DateTimeFormat("en-SG", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(parsed)
}

function readEventFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get("event")
  const value = raw ? Number(raw) : NaN
  return Number.isInteger(value) ? value : null
}

export default function VolunteerSignup() {
  const [events, setEvents] = useState<EventSummary[]>([])
  const [eventId, setEventId] = useState<number | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ eventName: string; created: boolean } | null>(null)

  useEffect(() => {
    listEvents()
      .then((data) => {
        const open = data.items.filter((event) => event.status !== "closed")
        const list = open.length ? open : data.items
        setEvents(list)
        const fromUrl = readEventFromUrl()
        const initial = list.find((event) => event.id === fromUrl) ?? list[0]
        if (initial) setEventId(initial.id)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load events."))
  }, [])

  useEffect(() => {
    if (eventId === null) return
    setSelectedRoles(new Set())
    listEventRoles(eventId)
      .then(setRoles)
      .catch(() => setRoles([]))
  }, [eventId])

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === eventId) ?? null,
    [events, eventId],
  )

  function toggleRole(roleId: number) {
    setSelectedRoles((current) => {
      const next = new Set(current)
      if (next.has(roleId)) next.delete(roleId)
      else next.add(roleId)
      return next
    })
  }

  async function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    if (eventId === null || !selectedEvent) return
    if (!name.trim()) return setError("Please enter your name.")
    if (!phone.trim()) return setError("Please enter your phone number.")
    setSubmitting(true)
    setError(null)
    try {
      const result = await publicSignup(eventId, {
        name: name.trim(),
        contact_number: phone.trim(),
        email: email.trim() || undefined,
        role_ids: [...selectedRoles],
      })
      setDone({ eventName: selectedEvent.name, created: result.volunteer_created })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pts-signup">
      <header className="pts-signup-topbar">
        <span className="pts-signup-logo">Passion To Serve</span>
        <span className="pts-signup-tag">Volunteer Sign-Up</span>
      </header>

      <section className="pts-signup-hero">
        <h1>Volunteer with us</h1>
        <p>Lend your time to an upcoming event. We'll confirm your spot by phone or email.</p>
      </section>

      <main className="pts-signup-main">
        {done ? (
          <div className="pts-signup-card pts-signup-success">
            <div className="pts-signup-check">✓</div>
            <h2>You're signed up!</h2>
            <p>
              Thanks{done.created ? "" : " again"} for volunteering for{" "}
              <strong>{done.eventName}</strong>. Your request is <strong>pending approval</strong> —
              an organiser will be in touch to confirm your role.
            </p>
            <button
              type="button"
              className="pts-signup-secondary"
              onClick={() => {
                setDone(null)
                setName("")
                setPhone("")
                setEmail("")
                setSelectedRoles(new Set())
              }}
            >
              Sign up for another event
            </button>
          </div>
        ) : (
          <form className="pts-signup-card" onSubmit={handleSubmit}>
            <label className="pts-field">
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
              <p className="pts-signup-eventmeta">
                {formatDate(selectedEvent.event_date)} · {selectedEvent.venue}
              </p>
            )}

            <label className="pts-field">
              <span>Full name</span>
              <input value={name} onChange={(input) => setName(input.target.value)} placeholder="Your name" />
            </label>
            <label className="pts-field">
              <span>Phone number</span>
              <input
                value={phone}
                onChange={(input) => setPhone(input.target.value)}
                placeholder="+65 8123 4567"
                inputMode="tel"
              />
            </label>
            <label className="pts-field">
              <span>Email <em>(optional)</em></span>
              <input
                value={email}
                onChange={(input) => setEmail(input.target.value)}
                placeholder="you@example.com"
                type="email"
              />
            </label>

            {roles.length > 0 && (
              <fieldset className="pts-roles">
                <legend>Which roles interest you? <em>(choose any)</em></legend>
                {roles.map((role) => (
                  <label key={role.id} className="pts-role">
                    <input
                      type="checkbox"
                      checked={selectedRoles.has(role.id)}
                      onChange={() => toggleRole(role.id)}
                    />
                    <span>{role.name}</span>
                  </label>
                ))}
              </fieldset>
            )}

            {error && <p className="pts-signup-error">{error}</p>}

            <button type="submit" className="pts-signup-submit" disabled={submitting || eventId === null}>
              {submitting ? "Submitting…" : "Sign me up"}
            </button>
            <p className="pts-signup-note">
              We'll only use your details to coordinate this event.
            </p>
          </form>
        )}
      </main>
    </div>
  )
}
