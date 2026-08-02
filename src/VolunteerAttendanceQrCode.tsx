import { useEffect, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { getVolunteerAttendanceQrToken } from "./volunteer-api"

// Shows a signed QR code an organizer scans at check-in to mark this
// volunteer present — see backend/attendance_qr.py for how the token itself
// is generated and verified.
export default function VolunteerAttendanceQrCode({ eventId }: { eventId: number }) {
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    let cancelled = false
    setStatus("loading")
    setToken(null)
    getVolunteerAttendanceQrToken(eventId)
      .then((result) => {
        if (cancelled) return
        setToken(result.token)
        setStatus("ready")
      })
      .catch(() => {
        if (!cancelled) setStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [eventId])

  if (status === "loading") return <p className="pts-attendance-qr-status">Loading your QR code…</p>
  if (status === "error" || !token) return <p className="pts-attendance-qr-status">Couldn't load your QR code.</p>

  return (
    <div className="pts-attendance-qr">
      <QRCodeSVG value={token} size={160} />
      <p>Show this to an organizer at check-in.</p>
    </div>
  )
}
