import { useEffect, useMemo, useState } from "react"
import {
  listEventRoles,
  listEvents,
  publicSignup,
  getVolunteerMe,
  getVolunteerToken,
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

function formatTime(value: string | null) {
  if (!value) return ""
  const [hourText, minute] = value.split(":")
  const hour = Number(hourText)
  if (!Number.isInteger(hour)) return value
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`
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
  const [countryCode, setCountryCode] = useState("+65")
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
    if (!getVolunteerToken()) return
    getVolunteerMe()
      .then((volunteer) => {
        setName(volunteer.name)
        setEmail(volunteer.email ?? "")
        const knownCodes = ["+880", "+65", "+60", "+62", "+63", "+91", "+95", "+86", "+84", "+1", "+44"]
        const matchedCode = knownCodes.find((code) => volunteer.contact_number?.startsWith(code))
        if (matchedCode) {
          setCountryCode(matchedCode)
          setPhone((volunteer.contact_number ?? "").slice(matchedCode.length))
        } else {
          setPhone(volunteer.contact_number ?? "")
        }
      })
      .catch(() => undefined)
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
    const localPhone = phone.replace(/\D/g, "")
    if (!localPhone) return setError("Please enter your phone number.")
    if (localPhone.length < 6) return setError("Please enter a valid phone number.")
    setSubmitting(true)
    setError(null)
    try {
      const result = await publicSignup(eventId, {
        name: name.trim(),
        contact_number: `${countryCode}${localPhone}`,
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
        <a className="pts-signup-logo" href="?page=community">
          <img src="/pts-logo.png" alt="" />Passion To Serve
        </a>
        <nav className="pts-signup-nav">
          <a href="?page=community">Events</a>
          {getVolunteerToken() && <a href="?page=volunteer-dashboard">My dashboard</a>}
          <span className="pts-signup-tag">Volunteer Sign-Up</span>
        </nav>
      </header>

      <section className="pts-signup-hero pts-signup-hero-image">
        <div>
          <p>Passion To Serve community</p>
          <h1>Give your time. Make an impact.</h1>
          <span>Choose an event and join a community of volunteers serving together.</span>
        </div>
      </section>

      <main className="pts-signup-main pts-signup-layout">
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
          <>
          {selectedEvent && (
            <aside className="pts-event-preview">
              <p className="pts-account-eyebrow">You are joining</p>
              <h2>{selectedEvent.name}</h2>
              <div className="pts-event-preview-line"><strong>{formatDate(selectedEvent.event_date)}</strong><span>{selectedEvent.venue}</span></div>
              {(selectedEvent.start_time || selectedEvent.end_time) && (
                <div className="pts-event-preview-line"><strong>Time</strong><span>{formatTime(selectedEvent.start_time)}{selectedEvent.end_time ? ` – ${formatTime(selectedEvent.end_time)}` : ""}</span></div>
              )}
              <p className="pts-event-description">{selectedEvent.description || "Join us for a meaningful day of service with the Passion To Serve community."}</p>
              <a href="#event-picker" className="pts-change-event">Choose another event</a>
            </aside>
          )}
          <form className="pts-signup-card" onSubmit={handleSubmit}>
            <label className="pts-field">
              <span id="event-picker">Event</span>
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
                {(selectedEvent.start_time || selectedEvent.end_time) && ` · ${formatTime(selectedEvent.start_time)}${selectedEvent.end_time ? `–${formatTime(selectedEvent.end_time)}` : ""}`}
              </p>
            )}

            <label className="pts-field">
              <span>Full name</span>
              <input value={name} onChange={(input) => setName(input.target.value)} placeholder="Your name" />
            </label>
            <label className="pts-field">
              <span>Phone number</span>
              <div className="pts-phone-row">
                <select
                  aria-label="Country code"
                  value={countryCode}
                  onChange={(input) => setCountryCode(input.target.value)}
                >
                  <option value="+65">SG +65</option>
                  <option value="+60">MY +60</option>
                  <option value="+62">ID +62</option>
                  <option value="+63">PH +63</option>
                  <option value="+91">IN +91</option>
                  <option value="+880">BD +880</option>
                  <option value="+95">MM +95</option>
                  <option value="+86">CN +86</option>
                  <option value="+84">VN +84</option>
                  <option value="+1">US/CA +1</option>
                  <option value="+44">UK +44</option>
                </select>
                <input
                  value={phone}
                  onChange={(input) => setPhone(input.target.value)}
                  placeholder="8123 4567"
                  inputMode="tel"
                />
              </div>
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
          </>
        )}
      </main>
    </div>
  )
}
