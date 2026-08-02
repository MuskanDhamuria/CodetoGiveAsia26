import { useState, type FormEvent } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { updateParticipant } from "../api/client";
import type { ParticipantOutletContext } from "../ParticipantApp";
import { formatPhoneNumberAsYouType, isValidParticipantPhoneNumber } from "../phone";

export default function ProfileEditForm() {
  const { participant, onIdentified } = useOutletContext<ParticipantOutletContext>();
  const navigate = useNavigate();

  const [name, setName] = useState(participant?.name ?? "");
  const [contactNumber, setContactNumber] = useState(participant?.contactNumber ?? "");
  const [email, setEmail] = useState(participant?.email ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!participant) {
    return (
      <section className="profile-edit">
        <p className="event-browse-status">Sign in to edit your profile.</p>
      </section>
    );
  }

  function handleContactNumberChange(value: string) {
    setContactNumber(formatPhoneNumberAsYouType(value));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (contactNumber.trim() && !isValidParticipantPhoneNumber(contactNumber)) {
      setError("Enter a valid phone number.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await updateParticipant(participant!.participantId, {
        name: name.trim(),
        contact_number: contactNumber.trim() || null,
        email: email.trim() || null,
      });
      onIdentified({
        participantId: result.id,
        name: result.name,
        contactNumber: result.contact_number,
        email: result.email,
      });
      navigate("/participant/my-events");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your profile.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="signup-form profile-edit" onSubmit={handleSubmit}>
      <p>Update your details.</p>
      <label>
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        <span>Phone number</span>
        <input
          value={contactNumber}
          onChange={(event) => handleContactNumberChange(event.target.value)}
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
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
