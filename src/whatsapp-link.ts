// Shared helper for the public "Chat with us on WhatsApp" link used across
// the community portal and the volunteer account pages.
//
// The bot's number is fetched from the backend at runtime (GET
// /api/v1/public/whatsapp-config), not baked into the frontend build. To
// change the number, just set WHATSAPP_DISPLAY_NUMBER on the backend and
// reload the page — no frontend rebuild/redeploy needed.
import { useEffect, useState } from "react"

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8000/api/v1"

const FALLBACK_NUMBER = "6580000000"
const WHATSAPP_GREETING = "Hi! I'd like to know about upcoming Passion To Serve events."

let cachedNumber: string | null = null
let inFlight: Promise<string> | null = null

function fetchWhatsAppNumber(): Promise<string> {
  if (cachedNumber) return Promise.resolve(cachedNumber)
  if (!inFlight) {
    inFlight = fetch(`${API_BASE}/public/whatsapp-config`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((body: { number: string }) => {
        cachedNumber = body.number
        return cachedNumber
      })
      .catch(() => FALLBACK_NUMBER)
  }
  return inFlight
}

function buildLink(number: string) {
  return `https://wa.me/${number}?text=${encodeURIComponent(WHATSAPP_GREETING)}`
}

/** React hook: returns a WhatsApp chat link, updating once the real number loads. */
export function useWhatsAppChatLink(): string {
  const [link, setLink] = useState(() => buildLink(cachedNumber ?? FALLBACK_NUMBER))

  useEffect(() => {
    let cancelled = false
    fetchWhatsAppNumber().then((number) => {
      if (!cancelled) setLink(buildLink(number))
    })
    return () => {
      cancelled = true
    }
  }, [])

  return link
}
