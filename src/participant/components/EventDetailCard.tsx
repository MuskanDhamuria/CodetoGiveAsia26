import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  ApiError,
  cancelRegistration,
  getEvent,
  getMyEvents,
  registerForEvent,
  type EventSummary,
} from "../api/client";
import { formatEventDateLong } from "../dateFormat";
import type { ParticipantOutletContext } from "../ParticipantApp";
import SignupForm from "./SignupForm";

// The backend uses this exact message when a participant_id doesn't exist —
// distinguishing it from other 404s (e.g. "Event not found") matters so we
// only clear the saved identity when it's actually the identity that's bad.
function isStaleIdentityError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.message === "Participant not found";
}

export default function EventDetailCard() {
  const { eventId } = useParams<{ eventId: string }>();
  const { participant, onIdentified, onIdentityInvalid } = useOutletContext<ParticipantOutletContext>();
  const numericEventId = Number(eventId);

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [isSignedUp, setIsSignedUp] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getEvent(numericEventId)
      .then((data) => {
        if (cancelled) return;
        setEvent(data);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [numericEventId]);

  useEffect(() => {
    if (!participant) {
      setIsSignedUp(false);
      return;
    }
    let cancelled = false;
    getMyEvents(participant.participantId)
      .then((response) => {
        if (!cancelled) setIsSignedUp(response.items.some((item) => item.id === numericEventId));
      })
      .catch((error) => {
        if (cancelled) return;
        if (isStaleIdentityError(error)) {
          onIdentityInvalid();
        }
        setIsSignedUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, [participant, numericEventId, onIdentityInvalid]);

  async function handleSignup(participantId: number) {
    setActionPending(true);
    setActionError(null);
    try {
      await registerForEvent(numericEventId, participantId);
      setIsSignedUp(true);
    } catch (error) {
      if (isStaleIdentityError(error)) {
        onIdentityInvalid();
        setActionError("Your saved sign-in has expired — please sign up again.");
      } else {
        setActionError(error instanceof Error ? error.message : "Couldn't sign up.");
      }
    } finally {
      setActionPending(false);
    }
  }

  async function handleCancel() {
    if (!participant) return;
    setActionPending(true);
    setActionError(null);
    try {
      await cancelRegistration(numericEventId, participant.participantId);
      setIsSignedUp(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't cancel signup.");
    } finally {
      setActionPending(false);
    }
  }

  if (status === "loading") return <p className="event-detail-status">Loading event…</p>;
  if (status === "error" || !event) return <p className="event-detail-status">Event not found.</p>;

  return (
    <article className="event-detail">
      <header>
        <p>Event</p>
        <h1>{event.name}</h1>
      </header>
      <dl className="event-detail-meta">
        <div>
          <dt>Date</dt>
          <dd>{formatEventDateLong(event.event_date)}</dd>
        </div>
        <div>
          <dt>Venue</dt>
          <dd>{event.venue}</dd>
        </div>
      </dl>
      {event.description && <p className="event-detail-description">{event.description}</p>}

      <div className="event-detail-action">
        {isSignedUp ? (
          <>
            <p className="event-detail-confirmed">You're signed up for this event.</p>
            <button type="button" onClick={handleCancel} disabled={actionPending}>
              Cancel my signup
            </button>
          </>
        ) : event.status === "closed" ? (
          <p className="event-detail-closed">Registration is closed for this event.</p>
        ) : participant ? (
          <button
            type="button"
            onClick={() => handleSignup(participant.participantId)}
            disabled={actionPending}
          >
            Sign up
          </button>
        ) : (
          <SignupForm
            eventId={numericEventId}
            onSignedUp={(nextParticipant) => {
              onIdentified(nextParticipant);
              setIsSignedUp(true);
            }}
          />
        )}
        {actionError && <p className="event-detail-error">{actionError}</p>}
      </div>
    </article>
  );
}
