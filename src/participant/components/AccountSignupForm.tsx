import { useState, type FormEvent } from "react";
import { publicSignup, resendParticipantOtp, verifyParticipantOtp } from "../api/client";
import type { StoredParticipant } from "../identity";
import { formatPhoneNumberAsYouType, isValidParticipantPhoneNumber } from "../phone";

export default function AccountSignupForm({
  onSignedUp,
}: {
  onSignedUp: (participant: StoredParticipant) => void;
}) {
  const [name, setName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState<{
    participant: StoredParticipant;
    verifyToken: string;
  } | null>(null);

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
      const result = await publicSignup({
        name: name.trim(),
        contact_number: contactNumber.trim(),
        email: email.trim() || null,
      });
      const participant: StoredParticipant = {
        participantId: result.participant_id,
        name: result.participant_name,
        contactNumber: result.participant_contact_number,
        email: result.participant_email,
      };
      if (result.phone_verified || !result.verify_token) {
        onSignedUp(participant);
      } else {
        setPendingVerification({ participant, verifyToken: result.verify_token });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account.");
    } finally {
      setPending(false);
    }
  }

  if (pendingVerification) {
    return (
      <ParticipantOtpVerification
        participant={pendingVerification.participant}
        verifyToken={pendingVerification.verifyToken}
        onVerified={() => onSignedUp(pendingVerification.participant)}
        onSkip={() => onSignedUp(pendingVerification.participant)}
      />
    );
  }

  return (
    <form className="signup-form" onSubmit={handleSubmit}>
      <p>Create an account now — you can browse and sign up for events later.</p>
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
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

function ParticipantOtpVerification({
  participant,
  verifyToken: initialVerifyToken,
  onVerified,
  onSkip,
}: {
  participant: StoredParticipant;
  verifyToken: string;
  onVerified: () => void;
  onSkip: () => void;
}) {
  const [verifyToken, setVerifyToken] = useState(initialVerifyToken);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return setError("Enter the 6-digit code we sent you on WhatsApp.");
    setVerifying(true);
    setError(null);
    try {
      await verifyParticipantOtp(participant.participantId, verifyToken, code.trim());
      onVerified();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That code didn't work.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    setResending(true)
    setError(null)
    setResent(false)
    try {
      const result = await resendParticipantOtp(participant.participantId, verifyToken)
      if (result.verify_token) setVerifyToken(result.verify_token)
      setResent(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not resend the code.")
    } finally {
      setResending(false)
    }
  }

  return (
    <form className="signup-form" onSubmit={handleVerify}>
      <p>We sent a 6-digit code to your WhatsApp — enter it below to verify your number.</p>
      <label>
        <span>6-digit code</span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="123456"
          inputMode="numeric"
          maxLength={8}
          autoFocus
        />
      </label>
      {error && <p className="signup-form-error">{error}</p>}
      {resent && !error && <p>A new code is on its way.</p>}
      <button type="submit" disabled={verifying}>
        {verifying ? "Verifying…" : "Verify"}
      </button>
      <p>
        Didn't get a code?{" "}
        <button type="button" onClick={handleResend} disabled={resending}>
          {resending ? "Resending…" : "Resend code"}
        </button>
      </p>
      <p>
        <button type="button" onClick={onSkip}>I'll verify later</button>
      </p>
    </form>
  );
}
