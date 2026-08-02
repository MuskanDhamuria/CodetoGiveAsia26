import { Link } from "react-router-dom";
import type { EventSummary } from "../api/client";

// Adapted from src/EventOperationsMvp.tsx's EventCalendar (see
// docs/tickets.md TICKET-2) for this page's EventSummary shape and routing —
// event cells link straight to the detail page instead of an onOpen callback.
function monthLabel(month: Date): string {
  return new Intl.DateTimeFormat("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(month);
}

// Past events are greyed out regardless of status; upcoming (today or
// later) events are colored by registration status instead.
function pillClassName(event: EventSummary, today: string): string {
  if (event.event_date < today) return "event-calendar-pill event-calendar-pill-past";
  return `event-calendar-pill event-calendar-pill-${event.status}`;
}

export default function EventCalendarView({
  events,
  month,
  today,
  onChangeMonth,
}: {
  events: EventSummary[];
  month: Date;
  today: string;
  onChangeMonth: (direction: -1 | 1) => void;
}) {
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstWeekday = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 });

  return (
    <section aria-label={`${monthLabel(month)} event calendar`} className="event-collection-calendar">
      <header>
        <button aria-label="Previous month" type="button" onClick={() => onChangeMonth(-1)}>
          ←
        </button>
        <h3>{monthLabel(month)}</h3>
        <button aria-label="Next month" type="button" onClick={() => onChangeMonth(1)}>
          →
        </button>
      </header>
      <div className="event-calendar-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="event-calendar-grid">
        {cells.map((_, index) => {
          const day = index - firstWeekday + 1;
          const dateStr = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayEvents =
            day > 0 && day <= daysInMonth ? events.filter((event) => event.event_date === dateStr) : [];
          return (
            <div key={index} className={dayEvents.length ? "has-events" : ""}>
              {day > 0 && day <= daysInMonth && <span>{day}</span>}
              {dayEvents.map((event) => (
                <Link
                  key={event.id}
                  to={`events/${event.id}`}
                  className={pillClassName(event, today)}
                  aria-label={event.name}
                >
                  <span>{event.name}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
