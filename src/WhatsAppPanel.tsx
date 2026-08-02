import { useEffect, useMemo, useState } from "react"
import {
  adminApi,
  type AdminApi,
  type Announcement,
  type Audience,
  type Certificate,
  type CertificateCandidate,
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
  const [candidates, setCandidates] = useState<CertificateCandidate[]>([])
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set())
  const [sendCertBusy, setSendCertBusy] = useState(false)
  const [certMessage, setCertMessage] = useState<string | null>(null)
  const [certFilter, setCertFilter] = useState<"all" | "sent" | "not_sent">("all")

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
    api.listCertificateCandidates(eventId).then(setCandidates).catch(() => setCandidates([]))
    setSelectedRecipients(new Set())
    setCertMessage(null)
    setCertFilter("all")
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
      await api.listCertificateCandidates(selectedEventId).then(setCandidates)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate certificates.")
    } finally {
      setCertBusy(false)
    }
  }

  function candidateKey(candidate: Pick<CertificateCandidate, "type" | "id">) {
    return `${candidate.type}:${candidate.id}`
  }

  function toggleRecipient(candidate: CertificateCandidate) {
    setSelectedRecipients((current) => {
      const next = new Set(current)
      const key = candidateKey(candidate)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const filteredCandidates = candidates.filter((candidate) => {
    if (certFilter === "sent") return candidate.already_delivered
    if (certFilter === "not_sent") return !candidate.already_delivered
    return true
  })
  const sentCount = candidates.filter((candidate) => candidate.already_delivered).length
  const notSentCount = candidates.length - sentCount

  function selectAllAttended() {
    setSelectedRecipients(new Set(filteredCandidates.filter((c) => c.attended).map(candidateKey)))
  }

  function clearSelection() {
    setSelectedRecipients(new Set())
  }

  async function handleSendSelectedCertificates() {
    if (selectedEventId === null || selectedRecipients.size === 0) return
    setSendCertBusy(true)
    setCertMessage(null)
    try {
      const recipients = candidates
        .filter((candidate) => selectedRecipients.has(candidateKey(candidate)))
        .map(({ type, id }) => ({ type, id }))
      const sent = await api.sendCertificates(selectedEventId, recipients)
      setCertMessage(`Sent ${sent.length} certificate(s).`)
      setSelectedRecipients(new Set())
      await Promise.all([
        api.listCertificates(selectedEventId).then(setCertificates),
        api.listCertificateCandidates(selectedEventId).then(setCandidates),
      ])
    } catch (reason) {
      setCertMessage(reason instanceof Error ? reason.message : "Could not send certificates.")
    } finally {
      setSendCertBusy(false)
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
        <section className="whatsapp-event-filter volunteer-table-card whatsapp-card">
          <div className="whatsapp-card-heading">
            <h2>Filtering by event</h2>
            <p>Applies to both announcements and certificates below</p>
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
        </section>
      )}

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
              <p>{selectedEvent ? selectedEvent.name : "Choose an event above"}</p>
            </div>
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
              <p>Generate for everyone who attended, or pick specific people</p>
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
            <div className="whatsapp-panel-actions">
              <button
                type="button"
                className="whatsapp-button-primary"
                onClick={() => void handleGenerateCertificates()}
                disabled={certBusy || selectedEventId === null}
              >
                {certBusy ? "Generating…" : "Generate & send to everyone who attended"}
              </button>
            </div>

            <div className="whatsapp-card-heading">
              <h3>Pick recipients manually</h3>
              <p>Everyone registered for this event, attendance or not</p>
            </div>
            <div className="whatsapp-cert-filter" role="group" aria-label="Filter by certificate delivery status">
              <button
                type="button"
                className={certFilter === "all" ? "whatsapp-filter-active" : "whatsapp-filter"}
                onClick={() => setCertFilter("all")}
              >
                All ({candidates.length})
              </button>
              <button
                type="button"
                className={certFilter === "sent" ? "whatsapp-filter-active" : "whatsapp-filter"}
                onClick={() => setCertFilter("sent")}
              >
                Sent ({sentCount})
              </button>
              <button
                type="button"
                className={certFilter === "not_sent" ? "whatsapp-filter-active" : "whatsapp-filter"}
                onClick={() => setCertFilter("not_sent")}
              >
                Not sent ({notSentCount})
              </button>
            </div>
            <div className="whatsapp-panel-actions">
              <button type="button" className="whatsapp-button-secondary" onClick={selectAllAttended} disabled={filteredCandidates.length === 0}>
                Select all who attended
              </button>
              <button type="button" className="whatsapp-button-secondary" onClick={clearSelection} disabled={selectedRecipients.size === 0}>
                Clear selection
              </button>
              <button
                type="button"
                className="whatsapp-button-primary"
                onClick={() => void handleSendSelectedCertificates()}
                disabled={sendCertBusy || selectedRecipients.size === 0}
              >
                {sendCertBusy ? "Sending…" : `Send to selected (${selectedRecipients.size})`}
              </button>
            </div>
            {certMessage && <p className="whatsapp-panel-message">{certMessage}</p>}

            <div className="volunteer-table-wrap">
              <table className="volunteer-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Attended</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="roster-empty">
                        {candidates.length === 0 ? "No one is registered for this event yet." : "No one matches this filter."}
                      </td>
                    </tr>
                  ) : (
                    filteredCandidates.map((candidate) => {
                      const key = candidateKey(candidate)
                      return (
                        <tr key={key}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedRecipients.has(key)}
                              onChange={() => toggleRecipient(candidate)}
                            />
                          </td>
                          <td>{candidate.name}</td>
                          <td>{candidate.type === "participant" ? "Participant" : "Volunteer"}</td>
                          <td>{candidate.attended ? "Yes" : "No"}</td>
                          <td>
                            {candidate.already_delivered
                              ? "Delivered"
                              : candidate.already_issued
                                ? "Issued, not delivered"
                                : "Not issued"}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="whatsapp-card-heading">
              <h3>Issued certificates</h3>
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
