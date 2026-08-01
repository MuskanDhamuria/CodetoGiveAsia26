import { useEffect, useState } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  ApiError,
  cancelRegistration,
  getEvent,
  getMyEvents,
  registerForEvent,
  type EventSummary,
} from "../api/client";
import { formatEventDateLong, formatEventTime } from "../dateFormat";
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
  const navigate = useNavigate();
  const location = useLocation();
  const numericEventId = Number(eventId);

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [isSignedUp, setIsSignedUp] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Tracks the separate "is this participant already signed up" check below,
  // distinct from `status` (which tracks loading the event itself) — see
  // TICKET-11.
  const [signupCheckStatus, setSignupCheckStatus] = useState<"idle" | "checking" | "ready" | "error">(
    "idle",
  );
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
      setSignupCheckStatus("idle");
      return;
    }
    let cancelled = false;
    setSignupCheckStatus("checking");
    getMyEvents(participant.participantId)
      .then((response) => {
        if (cancelled) return;
        setIsSignedUp(response.items.some((item) => item.id === numericEventId));
        setSignupCheckStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setIsSignedUp(false);
        if (isStaleIdentityError(error)) {
          onIdentityInvalid();
          setSignupCheckStatus("idle");
          return;
        }
        // A transient failure here (dropped network, backend blip) must not
        // look identical to "you're genuinely not signed up" — that would
        // let an already-registered participant see the "Sign up" button
        // again with no indication anything went wrong. See TICKET-11.
        setSignupCheckStatus("error");
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
      if (error instanceof ApiError && error.status === 404) {
        // The registration is already gone one way or another — either it
        // was cancelled elsewhere, or the participant record itself was
        // deleted (participations cascade-delete with it, so this 404s as
        // "Registration not found" rather than "Participant not found" and
        // isStaleIdentityError doesn't catch it). Either way there's
        // nothing left to cancel, so drop back to "not signed up" instead
        // of leaving a stale "Cancel my signup" button next to a raw
        // "Registration not found" error. Distinguishing the two causes to
        // also clear the saved identity in the participant-deleted case is
        // still open — see docs/tickets.md TICKET-10/TICKET-7.
        setIsSignedUp(false);
      } else {
        setActionError(error instanceof Error ? error.message : "Couldn't cancel signup.");
      }
    } finally {
      setActionPending(false);
    }
  }

  // `location.key` is "default" only when this entry has no history to go
  // back to — a cold load/deep link (e.g. a WhatsApp bot event link, see
  // docs/tickets.md TICKET-8). navigate(-1) would silently no-op there, so
  // fall back to the browse list instead of leaving Back inert.
  function handleBack() {
    if (location.key !== "default") navigate(-1);
    else navigate("/participant");
  }

  const backButton = (
    <button type="button" className="event-detail-back" onClick={handleBack} aria-label="Back">
      ← Back
    </button>
  );

  if (status === "loading") {
    return (
      <div className="event-detail">
        {backButton}
        <p className="event-detail-status">Loading event…</p>
      </div>
    );
  }
  if (status === "error" || !event) {
    return (
      <div className="event-detail">
        {backButton}
        <p className="event-detail-status">Event not found.</p>
      </div>
    );
  }

  return (
    <article className="event-detail">
      {backButton}
      <header>
        <p>Event</p>
        <h1>{event.name}</h1>
      </header>
      <dl className="event-detail-meta">
        <div>
          <dt>Date</dt>
          <dd>
            {formatEventDateLong(event.event_date)} at {formatEventTime(event.event_time)}
          </dd>
        </div>
        <div>
          <dt>Venue</dt>
          <dd>{event.venue}</dd>
        </div>
      </dl>
      {event.description && <p className="event-detail-description">{event.description}</p>}

      <div className="event-detail-action">
        {signupCheckStatus === "error" ? (
          <p className="event-detail-error">
            Couldn't check your registration status. Refresh the page to try again.
          </p>
        ) : isSignedUp ? (
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
