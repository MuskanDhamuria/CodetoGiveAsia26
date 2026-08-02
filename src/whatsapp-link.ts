// Shared helper for the public "Chat with us on WhatsApp" link used across
// the community portal and the volunteer account pages.
//
// Set VITE_WHATSAPP_NUMBER (E.164, digits only, e.g. 6591234567) to the
// bot's real Cloud API number before going live. This placeholder is only
// here so the link has somewhere to point during local/demo testing.
const WHATSAPP_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined) ?? "6580000000"
const WHATSAPP_GREETING = "Hi! I'd like to know about upcoming Passion To Serve events."

export function whatsappChatLink() {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_GREETING)}`
}
