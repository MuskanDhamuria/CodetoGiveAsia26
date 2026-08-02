import { useEffect, useRef, useState } from "react"
import { Html5Qrcode } from "html5-qrcode"
import { adminApi, type AdminApi, type AttendanceScanResult, type EventDetail } from "./admin-api"

type ScanFeedback = { kind: "success" | "already" | "error"; message: string }

const SCANNER_ELEMENT_ID = "attendance-qr-reader"
// Ignore an identical decode within this window so one lingering QR code in
// frame doesn't get submitted dozens of times per second.
const REPEAT_SCAN_COOLDOWN_MS = 4000

export default function AttendanceScannerPage({ api = adminApi }: { api?: AdminApi }) {
  const [events, setEvents] = useState<EventDetail[]>([])
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)

  const selectedEventIdRef = useRef<number | null>(null)
  const lastScanRef = useRef<{ token: string; time: number } | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)

  useEffect(() => {
    setLoading(true)
    api
      .listEvents()
      .then((data) => {
        setEvents(data)
        setSelectedEventId((current) => current ?? data[0]?.id ?? null)
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [api])

  useEffect(() => {
    selectedEventIdRef.current = selectedEventId
  }, [selectedEventId])

  useEffect(() => {
    if (!scanning) return
    let cancelled = false

    // Using the low-level Html5Qrcode API (start the camera ourselves)
    // rather than Html5QrcodeScanner (which renders its own "Request Camera
    // Permissions" UI and manages permission state internally) — that
    // higher-level component has a known flaky permission-detection path
    // that can get stuck showing the button with no way forward, even when
    // the browser's camera access itself works fine. Calling start()
    // directly triggers getUserMedia the same way a plain camera request
    // would, with nothing else in the way.
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID)
    scannerRef.current = scanner

    function handleDecoded(decodedText: string) {
      const eventId = selectedEventIdRef.current
      if (eventId === null) return

      const now = Date.now()
      const last = lastScanRef.current
      if (last && last.token === decodedText && now - last.time < REPEAT_SCAN_COOLDOWN_MS) {
        return
      }
      lastScanRef.current = { token: decodedText, time: now }

      api
        .scanAttendance(eventId, decodedText)
        .then((result: AttendanceScanResult) => {
          setFeedback({
            kind: result.already_marked ? "already" : "success",
            message: result.already_marked
              ? `${result.name} was already checked in.`
              : `${result.name} checked in as a ${result.role}.`,
          })
        })
        .catch((reason) => {
          setFeedback({
            kind: "error",
            message: reason instanceof Error ? reason.message : "Couldn't check them in.",
          })
        })
    }

    // html5-qrcode calls this constantly while no code is in frame — ignore
    // it entirely rather than surfacing it as an error.
    function handleDecodeFailure() {
      // no-op
    }

    const scanConfig = { fps: 10, qrbox: 250 }
    scanner
      .start({ facingMode: "environment" }, scanConfig, handleDecoded, handleDecodeFailure)
      .catch(() => {
        // Most desktop webcams don't support facingMode "environment" (no
        // rear camera) — fall back to whatever default camera is available.
        if (cancelled) return Promise.reject(new Error("cancelled"))
        return scanner.start({ facingMode: "user" }, scanConfig, handleDecoded, handleDecodeFailure)
      })
      .catch((reason) => {
        if (cancelled) return
        const message = reason instanceof Error ? reason.message : String(reason)
        setFeedback({ kind: "error", message: `Couldn't access the camera: ${message}` })
      })

    return () => {
      cancelled = true
      scannerRef.current = null
      scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => undefined)
    }
  }, [scanning, api])

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null

  return (
    <section className="whatsapp-panel-page" aria-label="Scan attendance">
      <div className="dashboard-shell">
        <header className="section-hero">
          <p>Attendance</p>
          <h1>Scan QR codes to check people in</h1>
          <span>
            Point the camera at a participant's or volunteer's QR code (shown on their
            dashboard) to mark them present for the selected event.
          </span>
        </header>

        {loading && <p className="public-events-state">Loading…</p>}

        {!loading && (
          <div className="whatsapp-panel-grid">
            <section className="volunteer-table-card whatsapp-card">
              <div className="whatsapp-card-heading">
                <h2>Event</h2>
                <p>{selectedEvent ? selectedEvent.name : "Choose an event"}</p>
              </div>
              <label className="search-field">
                <span>Scanning for</span>
                <select
                  value={selectedEventId ?? ""}
                  onChange={(event) => {
                    setSelectedEventId(Number(event.target.value))
                    setFeedback(null)
                  }}
                >
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name} · {event.event_date}
                    </option>
                  ))}
                </select>
              </label>
              <div className="whatsapp-panel-actions">
                {!scanning ? (
                  <button
                    type="button"
                    className="whatsapp-button-primary"
                    disabled={selectedEventId === null}
                    onClick={() => {
                      setFeedback(null)
                      setScanning(true)
                    }}
                  >
                    Start scanning
                  </button>
                ) : (
                  <button
                    type="button"
                    className="whatsapp-button-secondary"
                    onClick={() => setScanning(false)}
                  >
                    Stop scanning
                  </button>
                )}
              </div>
              {feedback && (
                <p className={`whatsapp-panel-message attendance-scan-feedback attendance-scan-${feedback.kind}`}>
                  {feedback.message}
                </p>
              )}
            </section>

            <section className="volunteer-table-card whatsapp-card">
              <div className="whatsapp-card-heading">
                <h2>Camera</h2>
                <p>Allow camera access when prompted</p>
              </div>
              {scanning ? (
                <div id={SCANNER_ELEMENT_ID} className="attendance-scanner-viewport" />
              ) : (
                <p className="roster-muted">Click "Start scanning" to open the camera.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  )
}
