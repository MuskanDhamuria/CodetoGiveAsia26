export function formatEventDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

export function formatEventDateLong(dateStr: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

// "HH:MM" or "HH:MM:SS" -> "9:00 AM"; events without a set time have no
// start_time in the database, so this returns null rather than formatting
// garbage.
export function formatEventTime(timeStr: string | null): string | null {
  if (!timeStr) return null;
  return new Intl.DateTimeFormat("en-SG", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`2000-01-01T${timeStr}Z`));
}

// "YYYY-MM" -> "August 2026"
export function formatMonthLabel(monthKey: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${monthKey}-01T00:00:00Z`));
}

// Singapore is a fixed UTC+8 offset with no DST (matching DEFAULT_COUNTRY in
// phone.ts). Shifting the real UTC instant forward by that offset before
// reading its UTC calendar date/components gives "now" on Singapore's
// calendar, independent of the viewer's device timezone/clock settings —
// consistent with every other date computation in this module, which is
// UTC-anchored rather than viewer-local. Without this, todayIso() would
// return the wrong calendar date for up to 8 hours a day for anyone
// physically in Singapore, since their local midnight lands 8 hours before
// UTC's.
const SG_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export function sgNow(): Date {
  return new Date(Date.now() + SG_UTC_OFFSET_MS);
}

export function todayIso(): string {
  return sgNow().toISOString().slice(0, 10);
}
