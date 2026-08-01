import { useState, type FormEvent } from "react";
import { publicRsvp } from "../api/client";
import type { StoredParticipant } from "../identity";
import { formatPhoneNumberAsYouType, isValidParticipantPhoneNumber } from "../phone";

export default function SignupForm({
  eventId,
  onSignedUp,
}: {
  eventId: number;
  onSignedUp: (participant: StoredParticipant) => void;
}) {
  const [name, setName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleContactNumberChange(value: string) {
    setContactNumber(formatPhoneNumberAsYouType(value));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !contactNumber.trim()) {
      setError("Enter your name and phone number.");
      return;
    }
    if (!isValidParticipantPhoneNumber(contactNumber)) {
      setError("Enter a valid phone number.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await publicRsvp(eventId, {
        name: name.trim(),
        contact_number: contactNumber.trim(),
        email: email.trim() || null,
      });
      // Store what the backend actually matched/created, not the raw form
      // input — this RSVP may have attached to a pre-existing participant
      // (matched by contact number/email) whose canonical name/number
      // differ from what was just typed. See TICKET-12/TICKET-15.
      onSignedUp({
        participantId: result.participant_id,
        name: result.participant_name,
        contactNumber: result.participant_contact_number,
        email: result.participant_email,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign you up.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="signup-form" onSubmit={handleSubmit}>
      <p>Enter your details to sign up. We'll remember you on this device.</p>
      <label>
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
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
      <label>
        <span>Email (optional)</span>
        <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
      </label>
      {error && <p className="signup-form-error">{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Signing up…" : "Sign up"}
      </button>
    </form>
  );
}
