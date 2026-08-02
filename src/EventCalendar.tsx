import { useEffect, useMemo, useState } from "react";
import type { EventDetail } from "./admin-api";

// TICKET-70: extracted out of App.tsx so it can be shared with
// AdminEventsPage.tsx's real Events/Calendar view without a circular
// import (App.tsx already imports AdminEventsPage.tsx).
export function EventCalendar({
  events,
  onOpenWorkspace,
}: {
  events: EventDetail[];
  onOpenWorkspace: (eventId: number) => void;
}) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initialDate = (events.find((event) => event.status === "open") ?? events[0])?.event_date;
    return initialDate
      ? new Date(`${initialDate.slice(0, 7)}-01T00:00:00Z`)
      : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  });
  const [hasPositionedInitialMonth, setHasPositionedInitialMonth] = useState(events.length > 0);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const year = visibleMonth.getUTCFullYear();
  const month = visibleMonth.getUTCMonth();
  const leadingBlanks = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  const monthEvents = useMemo(() => {
    const grouped = new Map<number, EventDetail[]>();
    for (const event of events) {
      const [eventYear, eventMonth, eventDay] = event.event_date.split("-").map(Number);
      if (eventYear !== year || eventMonth !== month + 1) continue;
      grouped.set(eventDay, [...(grouped.get(eventDay) ?? []), event]);
    }
    return grouped;
  }, [events, month, year]);
  const selectedEvent = events.find((event) => event.id === selectedEventId);

  useEffect(() => {
    if (!events.length || hasPositionedInitialMonth) return;
    const nextEvent = events.find((event) => event.status === "open") ?? events[0];
    setVisibleMonth(new Date(`${nextEvent.event_date.slice(0, 7)}-01T00:00:00Z`));
    setHasPositionedInitialMonth(true);
  }, [events, hasPositionedInitialMonth]);

  function moveMonth(offset: number) {
    setSelectedEventId(null);
    setVisibleMonth(new Date(Date.UTC(year, month + offset, 1)));
  }

  return (
    <div className="calendar">
      <div className="calendar-top">
        <button aria-label="Previous month" type="button" onClick={() => moveMonth(-1)}>←</button>
        <h3>{new Intl.DateTimeFormat("en-SG", { month: "long", year: "numeric", timeZone: "UTC" }).format(visibleMonth)}</h3>
        <button aria-label="Next month" type="button" onClick={() => moveMonth(1)}>→</button>
      </div>
      <div className="calendar-grid calendar-days">
        {days.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((day, index) => (
          <div className="calendar-cell" key={`${day ?? "blank"}-${index}`}>
            {day && (
              <>
                <strong>{day}</strong>
                {monthEvents.get(day)?.map((event) => (
                  <button
                    aria-label={event.name}
                    className={`calendar-event-button ${event.status}`}
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedEventId(event.id)}
                  >
                    <span>{event.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
      {selectedEvent && (
        <section
          aria-label={selectedEvent.name}
          aria-modal="false"
          className="calendar-event-preview"
          role="dialog"
        >
          <header>
            <span className={`calendar-preview-status ${selectedEvent.status}`}>{selectedEvent.status}</span>
            <button aria-label="Close Event preview" type="button" onClick={() => setSelectedEventId(null)}>×</button>
          </header>
          <h4>{selectedEvent.name}</h4>
          <dl>
            <div><dt>Date</dt><dd>{new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedEvent.event_date}T00:00:00Z`))}</dd></div>
            <div><dt>Venue</dt><dd>{selectedEvent.venue}</dd></div>
          </dl>
          <p>{selectedEvent.tasks.filter((task) => task.status === "done").length} of {selectedEvent.tasks.length} Tasks completed</p>
          <button className="calendar-preview-open" type="button" onClick={() => onOpenWorkspace(selectedEvent.id)}>Open workspace</button>
        </section>
      )}
    </div>
  );
}
