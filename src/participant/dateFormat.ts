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

// "HH:MM" or "HH:MM:SS" -> "9:00 AM"
export function formatEventTime(timeStr: string): string {
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

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
