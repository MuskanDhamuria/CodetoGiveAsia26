import { AsYouType, isValidPhoneNumber } from "libphonenumber-js";

// The participant portal's audience is Singapore-based, so a number typed
// without an explicit country code (no leading "+") is assumed to be local.
// A "+"-prefixed number is parsed using its own country code regardless,
// which is how other countries get handled without a country picker.
// Keep in sync with backend/phone.py's DEFAULT_REGION.
const DEFAULT_COUNTRY = "SG";

// Formats a phone number as the participant types it (inserts spaces the
// same way the final number will read), without requiring them to type the
// spacing themselves.
export function formatPhoneNumberAsYouType(value: string): string {
  return new AsYouType(DEFAULT_COUNTRY).input(value);
}

export function isValidParticipantPhoneNumber(value: string): boolean {
  return isValidPhoneNumber(value, DEFAULT_COUNTRY);
}
