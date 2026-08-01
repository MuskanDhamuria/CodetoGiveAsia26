import { useState, type FormEvent } from "react";
import { ApiError, lookupParticipant } from "../api/client";
import type { StoredParticipant } from "../identity";
import { formatPhoneNumberAsYouType, isValidParticipantPhoneNumber } from "../phone";

export default function SignInForm({
  onSignedIn,
}: {
  onSignedIn: (participant: StoredParticipant) => void;
}) {
  const [contactNumber, setContactNumber] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  function handleContactNumberChange(value: string) {
    setContactNumber(formatPhoneNumberAsYouType(value));
    setNotFound(false);
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!contactNumber.trim()) {
      setError("Enter your phone number.");
      return;
    }
    if (!isValidParticipantPhoneNumber(contactNumber)) {
      setError("Enter a valid phone number.");
      return;
    }
    setPending(true);
    setError(null);
    setNotFound(false);
    try {
      const participant = await lookupParticipant(contactNumber);
      onSignedIn({
        participantId: participant.id,
        name: participant.name,
        contactNumber: participant.contact_number,
        email: participant.email,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't sign you in.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="signup-form" onSubmit={handleSubmit}>
      <p>
        This isn't a secure login — it just looks up a previous sign-up on
        this device by phone number.
      </p>
      <label>
        <span>Phone number</span>
        <input
          value={contactNumber}
          onChange={(event) => handleContactNumberChange(event.target.value)}
          required
          type="tel"
          inputMode="tel"
          placeholder="9123 4567"
        />
      </label>
      {notFound && (
        <p className="signup-form-error">
          We couldn't find that number — sign up for an event to get started.
        </p>
      )}
      {error && <p className="signup-form-error">{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
