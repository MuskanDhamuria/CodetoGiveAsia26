import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAllEvents, type EventSummary } from "../api/client";
import { formatEventDate, formatEventTime, formatMonthLabel, sgNow, todayIso } from "../dateFormat";
import EventCalendarView from "./EventCalendarView";

type View = "list" | "calendar";

type MonthGroup = {
  key: string;
  label: string;
  events: EventSummary[];
};

// Groups events by "YYYY-MM", preserving whatever order `events` is already
// sorted in (both the group order and the events within each group).
function groupByMonth(events: EventSummary[]): MonthGroup[] {
  const groups = new Map<string, EventSummary[]>();
  for (const event of events) {
    const key = event.event_date.slice(0, 7);
    const existing = groups.get(key);
    if (existing) existing.push(event);
    else groups.set(key, [event]);
  }
  return Array.from(groups.entries()).map(([key, groupEvents]) => ({
    key,
    label: formatMonthLabel(key),
    events: groupEvents,
  }));
}

function startOfCurrentMonth(): Date {
  const now = sgNow();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function EventListItem({ event, showStatus }: { event: EventSummary; showStatus: boolean }) {
  const time = formatEventTime(event.event_time);
  return (
    <li>
      <Link to={`events/${event.id}`} className="event-browse-card">
        <div>
          <h3>{event.name}</h3>
          <p>{event.venue}</p>
        </div>
        <div className="event-browse-meta">
          <span>
            {formatEventDate(event.event_date)}
            {time && <> · {time}</>}
          </span>
          {showStatus && (
            <span className={`event-status status-${event.status}`}>
              {event.status === "open" ? "Registration open" : "Registration closed"}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

export default function EventBrowseList() {
  const [view, setView] = useState<View>("list");
  const [month, setMonth] = useState<Date>(startOfCurrentMonth);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getAllEvents()
      .then((data) => {
        if (cancelled) return;
        setEvents(data.items);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const today = todayIso();

  // Cancelled events aren't available to browse or sign up for — participants
  // who already RSVP'd see them flagged in MyEventsList/EventDetailCard instead.
  const visibleEvents = useMemo(() => events.filter((event) => !event.is_cancelled), [events]);

  const upcomingGroups = useMemo(() => {
    const upcoming = visibleEvents
      .filter((event) => event.event_date >= today)
      .sort((a, b) => a.event_date.localeCompare(b.event_date));
    return groupByMonth(upcoming);
  }, [visibleEvents, today]);

  const pastGroups = useMemo(() => {
    // Most-recent-month-first, most-recent-day-first within each month.
    const past = visibleEvents
      .filter((event) => event.event_date < today)
      .sort((a, b) => b.event_date.localeCompare(a.event_date));
    return groupByMonth(past);
  }, [visibleEvents, today]);

  const pastCount = useMemo(() => pastGroups.reduce((total, group) => total + group.events.length, 0), [pastGroups]);
  const upcomingCount = visibleEvents.length - pastCount;

  return (
    <section className="event-browse">
      <div className="event-browse-tabs" role="tablist" aria-label="Collection view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "list"}
          className={view === "list" ? "active" : ""}
          onClick={() => setView("list")}
        >
          List
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "calendar"}
          className={view === "calendar" ? "active" : ""}
          onClick={() => setView("calendar")}
        >
          Calendar
        </button>
      </div>

      {status === "loading" && <p className="event-browse-status">Loading events…</p>}
      {status === "error" && <p className="event-browse-status">Couldn't load events. Try again shortly.</p>}

      {status === "ready" && view === "calendar" && (
        <EventCalendarView
          events={visibleEvents}
          month={month}
          today={today}
          onChangeMonth={(direction) =>
            setMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + direction, 1)))
          }
        />
      )}

      {status === "ready" && view === "list" && (
        <>
          {visibleEvents.length === 0 && <p className="event-browse-status">No events right now.</p>}

          {pastCount > 0 && (
            <details className="event-browse-past">
              <summary>Past events ({pastCount})</summary>
              <div className="event-browse-past-content">
                {pastGroups.map((group) => (
                  <div key={group.key} className="event-browse-month-group">
                    <h2 className="event-browse-month-heading">{group.label}</h2>
                    <ul className="event-browse-list">
                      {group.events.map((event) => (
                        <EventListItem key={event.id} event={event} showStatus={false} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          )}

          {upcomingCount === 0 && pastCount > 0 && (
            <p className="event-browse-status">No upcoming events right now.</p>
          )}

          {upcomingGroups.map((group) => (
            <div key={group.key} className="event-browse-month-group">
              <h2 className="event-browse-month-heading">{group.label}</h2>
              <ul className="event-browse-list">
                {group.events.map((event) => (
                  <EventListItem key={event.id} event={event} showStatus />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
