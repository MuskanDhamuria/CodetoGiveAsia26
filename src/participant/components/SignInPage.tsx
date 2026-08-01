import { useNavigate, useOutletContext } from "react-router-dom";
import type { ParticipantOutletContext } from "../ParticipantApp";
import SignInForm from "./SignInForm";

export default function SignInPage() {
  const { participant, onIdentified } = useOutletContext<ParticipantOutletContext>();
  const navigate = useNavigate();

  if (participant) {
    return (
      <section className="event-detail">
        <p className="event-detail-confirmed">You're already signed in as {participant.name}.</p>
      </section>
    );
  }

  return (
    <section className="event-detail">
      <header>
        <p>Participant</p>
        <h1>Sign in</h1>
      </header>
      <SignInForm
        onSignedIn={(next) => {
          onIdentified(next);
          navigate("/participant/my-events");
        }}
      />
    </section>
  );
}
