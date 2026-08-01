import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPastEvents, getUpcomingEvents, type EventSummary } from "../api/client";
import { formatEventDate } from "../dateFormat";

type Tab = "upcoming" | "past";

export default function EventBrowseList() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const request = tab === "upcoming" ? getUpcomingEvents() : getPastEvents();
    request
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
  }, [tab]);

  return (
    <section className="event-browse">
      <div className="event-browse-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "upcoming"}
          className={tab === "upcoming" ? "active" : ""}
          onClick={() => setTab("upcoming")}
        >
          Upcoming
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "past"}
          className={tab === "past" ? "active" : ""}
          onClick={() => setTab("past")}
        >
          Past
        </button>
      </div>

      {status === "loading" && <p className="event-browse-status">Loading events…</p>}
      {status === "error" && <p className="event-browse-status">Couldn't load events. Try again shortly.</p>}
      {status === "ready" && events.length === 0 && (
        <p className="event-browse-status">No {tab} events right now.</p>
      )}

      <ul className="event-browse-list">
        {events.map((event) => (
          <li key={event.id}>
            <Link to={`events/${event.id}`} className="event-browse-card">
              <div>
                <h2>{event.name}</h2>
                <p>{event.venue}</p>
              </div>
              <div className="event-browse-meta">
                <span>{formatEventDate(event.event_date)}</span>
                {tab === "upcoming" && (
                  <span className={`event-status status-${event.status}`}>
                    {event.status === "open" ? "Registration open" : "Registration closed"}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
