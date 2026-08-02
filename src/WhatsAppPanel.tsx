import { useEffect, useMemo, useState } from "react"
import {
  adminApi,
  type AdminApi,
  type Announcement,
  type Audience,
  type Certificate,
  type EventDetail,
  type TeamMember,
  type TeamMemberWhatsAppLink,
} from "./admin-api"

function formatDateTime(value: string | null) {
  if (!value) return "—"
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}

export default function WhatsAppPanel({ api = adminApi }: { api?: AdminApi }) {
  const [events, setEvents] = useState<EventDetail[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null)

  const [link, setLink] = useState<TeamMemberWhatsAppLink | null>(null)
  const [phoneInput, setPhoneInput] = useState("")
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkMessage, setLinkMessage] = useState<string | null>(null)

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [audience, setAudience] = useState<Audience>("all")
  const [sendBusy, setSendBusy] = useState(false)
  const [sendMessage, setSendMessage] = useState<string | null>(null)

  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [certBusy, setCertBusy] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.listEvents(), api.listTeamMembers()])
      .then(([eventData, memberData]) => {
        setEvents(eventData)
        setTeamMembers(memberData)
        setSelectedEventId((current) => current ?? eventData[0]?.id ?? null)
        setSelectedMemberId((current) => current ?? memberData[0]?.id ?? null)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load data."))
      .finally(() => setLoading(false))
  }, [api])

  useEffect(() => {
    if (selectedMemberId === null) return
    setLinkMessage(null)
    api
      .getTeamMemberWhatsAppLink(selectedMemberId)
      .then((result) => {
        setLink(result)
        setPhoneInput(result?.phone_number ?? "")
      })
      .catch(() => setLink(null))
  }, [api, selectedMemberId])

  function reloadEventData(eventId: number) {
    api.listAnnouncements(eventId).then(setAnnouncements).catch(() => setAnnouncements([]))
    api.listCertificates(eventId).then(setCertificates).catch(() => setCertificates([]))
  }

  useEffect(() => {
    if (selectedEventId === null) return
    reloadEventData(selectedEventId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, selectedEventId])

  const selectedMember = useMemo(
    () => teamMembers.find((member) => member.id === selectedMemberId) ?? null,
    [teamMembers, selectedMemberId],
  )

  async function handleLink() {
    if (selectedMemberId === null || !phoneInput.trim()) return
    setLinkBusy(true)
    setLinkMessage(null)
    try {
      const result = await api.linkTeamMemberWhatsApp(selectedMemberId, phoneInput.trim())
      setLink(result)
      setLinkMessage(`Linked. ${selectedMember?.name ?? "This organizer"} now has bot admin commands on WhatsApp.`)
    } catch (reason) {
      setLinkMessage(reason instanceof Error ? reason.message : "Could not link this number.")
    } finally {
      setLinkBusy(false)
    }
  }

  async function handleUnlink() {
    if (selectedMemberId === null) return
    setLinkBusy(true)
    setLinkMessage(null)
    try {
      await api.unlinkTeamMemberWhatsApp(selectedMemberId)
      setLink(null)
      setLinkMessage("Unlinked. This number no longer has bot admin access.")
    } catch (reason) {
      setLinkMessage(reason instanceof Error ? reason.message : "Could not unlink this number.")
    } finally {
      setLinkBusy(false)
    }
  }

  async function handleSendAnnouncement(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    if (selectedEventId === null || !title.trim() || !body.trim()) return
    setSendBusy(true)
    setSendMessage(null)
    try {
      const created = await api.createAnnouncement(selectedEventId, {
        title: title.trim(),
        body: body.trim(),
        audience,
      })
      setAnnouncements((current) => [created, ...current])
      setTitle("")
      setBody("")
      setSendMessage(`Sent to ${created.delivered_count} recipient(s).`)
    } catch (reason) {
      setSendMessage(reason instanceof Error ? reason.message : "Could not send announcement.")
    } finally {
      setSendBusy(false)
    }
  }

  async function handleSendReminder() {
    if (selectedEventId === null) return
    setSendBusy(true)
    setSendMessage(null)
    try {
      const created = await api.createReminder(selectedEventId)
      setAnnouncements((current) => [created, ...current])
      setSendMessage(`Reminder sent to ${created.delivered_count} approved volunteer(s).`)
    } catch (reason) {
      setSendMessage(reason instanceof Error ? reason.message : "Could not send reminder.")
    } finally {
      setSendBusy(false)
    }
  }

  async function handleGenerateCertificates() {
    if (selectedEventId === null) return
    setCertBusy(true)
    try {
      const generated = await api.generateCertificates(selectedEventId)
      setCertificates(generated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate certificates.")
    } finally {
      setCertBusy(false)
    }
  }

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null

  return (
    <section className="whatsapp-panel-page" aria-label="WhatsApp bot">
      <div className="dashboard-shell">
      <header className="section-hero">
        <p>WhatsApp bot</p>
        <h1>Announcements, reminders &amp; certificates</h1>
        <span>
          Manage what the WhatsApp bot sends organizers, volunteers, and
          participants, and control who has admin access to it.
        </span>
      </header>

      {loading && <p className="public-events-state">Loading…</p>}
      {error && <p className="event-roster-error">{error}</p>}

      {!loading && (
        <div className="whatsapp-panel-grid">
          <section className="volunteer-table-card whatsapp-card">
            <div className="whatsapp-card-heading">
              <h2>Organizer WhatsApp access</h2>
              <p>Admin bot commands only work for linked numbers</p>
            </div>
            <label className="search-field">
              <span>Team member</span>
              <select
                value={selectedMemberId ?? ""}
                onChange={(event) => setSelectedMemberId(Number(event.target.value))}
              >
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="search-field">
              <span>WhatsApp number</span>
              <input
                placeholder="+6591234567"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
              />
            </label>
            <div className="whatsapp-panel-actions">
              <button
                type="button"
                className="whatsapp-button-primary"
                onClick={() => void handleLink()}
                disabled={linkBusy || !phoneInput.trim()}
              >
                {link ? "Update link" : "Link number"}
              </button>
              {link && (
                <button type="button" className="api-danger-button" onClick={() => void handleUnlink()} disabled={linkBusy}>
                  Unlink
                </button>
              )}
            </div>
            {linkMessage && <p className="whatsapp-panel-message">{linkMessage}</p>}
            <p className="roster-muted">
              {link ? `Currently linked to ${link.phone_number}.` : "No WhatsApp number linked to this team member yet."}
            </p>
          </section>

          <section className="volunteer-table-card whatsapp-card">
            <div className="whatsapp-card-heading">
              <h2>Send an announcement</h2>
              <p>{selectedEvent ? selectedEvent.name : "Choose an event"}</p>
            </div>
            <label className="search-field">
              <span>Event</span>
              <select
                value={selectedEventId ?? ""}
                onChange={(event) => setSelectedEventId(Number(event.target.value))}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name} · {event.event_date}
                  </option>
                ))}
              </select>
            </label>
            <form onSubmit={(event) => void handleSendAnnouncement(event)} className="whatsapp-panel-form">
              <label className="search-field">
                <span>Title</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Venue change" />
              </label>
              <label className="search-field">
                <span>Message</span>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="We've moved to Hall B, same time."
                  rows={3}
                />
              </label>
              <label className="search-field">
                <span>Audience</span>
                <select value={audience} onChange={(event) => setAudience(event.target.value as Audience)}>
                  <option value="all">Everyone subscribed</option>
                  <option value="participants">Participants of this event</option>
                  <option value="volunteers">Approved volunteers of this event</option>
                </select>
              </label>
              <div className="whatsapp-panel-actions">
                <button
                  type="submit"
                  className="whatsapp-button-primary"
                  disabled={sendBusy || !title.trim() || !body.trim() || selectedEventId === null}
                >
                  Send announcement
                </button>
                <button
                  type="button"
                  className="whatsapp-button-secondary"
                  onClick={() => void handleSendReminder()}
                  disabled={sendBusy || selectedEventId === null}
                >
                  Send shift reminder
                </button>
              </div>
            </form>
            {sendMessage && <p className="whatsapp-panel-message">{sendMessage}</p>}

            <div className="volunteer-table-wrap">
              <table className="volunteer-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Audience</th>
                    <th>Sent</th>
                    <th>Delivered</th>
                    <th>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {announcements.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="roster-empty">No announcements sent for this event yet.</td>
                    </tr>
                  ) : (
                    announcements.map((announcement) => (
                      <tr key={announcement.id}>
                        <td>{announcement.title}</td>
                        <td>{announcement.audience}</td>
                        <td>{formatDateTime(announcement.sent_at)}</td>
                        <td>{announcement.delivered_count}</td>
                        <td>{announcement.failed_count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="volunteer-table-card whatsapp-card">
            <div className="whatsapp-card-heading">
              <h2>Certificates</h2>
              <p>For everyone with recorded attendance</p>
            </div>
            <div className="whatsapp-panel-actions">
              <button
                type="button"
                className="whatsapp-button-primary"
                onClick={() => void handleGenerateCertificates()}
                disabled={certBusy || selectedEventId === null}
              >
                {certBusy ? "Generating…" : "Generate & send certificates"}
              </button>
            </div>
            <div className="volunteer-table-wrap">
              <table className="volunteer-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Issued</th>
                    <th>Delivered</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {certificates.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="roster-empty">No certificates issued for this event yet.</td>
                    </tr>
                  ) : (
                    certificates.map((certificate) => (
                      <tr key={certificate.id}>
                        <td>{certificate.participant_id ? `Participant #${certificate.participant_id}` : `Volunteer #${certificate.volunteer_id}`}</td>
                        <td>{formatDateTime(certificate.issued_at)}</td>
                        <td>{formatDateTime(certificate.delivered_at)}</td>
                        <td>
                          <a href={certificate.link} target="_blank" rel="noreferrer">
                            View
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
      </div>
    </section>
  )
}
