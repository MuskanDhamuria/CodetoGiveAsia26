import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ApiError, getMyEvents, type EventForParticipant } from "../api/client";
import { formatEventDate, formatEventTime } from "../dateFormat";
import type { ParticipantOutletContext } from "../ParticipantApp";

function isStaleIdentityError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.message === "Participant not found";
}

export default function MyEventsList() {
  const { participant, onIdentityInvalid } = useOutletContext<ParticipantOutletContext>();
  const [events, setEvents] = useState<EventForParticipant[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!participant) {
      setEvents([]);
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    getMyEvents(participant.participantId)
      .then((data) => {
        if (!cancelled) {
          setEvents(data.items);
          setStatus("ready");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (isStaleIdentityError(error)) {
          // Falls back to the "sign up to see it here" empty state below,
          // since `participant` becomes null once this clears.
          onIdentityInvalid();
          return;
        }
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [participant, onIdentityInvalid]);

  if (!participant) {
    return (
      <section className="my-events">
        <p className="event-browse-status">Sign up for an event to see it here.</p>
        <Link to="/participant">Browse events</Link>
      </section>
    );
  }

  if (status === "loading") return <p className="event-browse-status">Loading your events…</p>;
  if (status === "error") return <p className="event-browse-status">Couldn't load your events.</p>;

  return (
    <section className="my-events">
      {events.length === 0 && (
        <p className="event-browse-status">You haven't signed up for any events yet.</p>
      )}
      <ul className="event-browse-list">
        {events.map((event) => (
          <li key={event.id}>
            <Link to={`/participant/events/${event.id}`} className="event-browse-card">
              <div>
                <h2>{event.name}</h2>
                <p>{event.venue}</p>
              </div>
              <div className="event-browse-meta">
                <span>
                  {formatEventDate(event.event_date)} · {formatEventTime(event.event_time)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
