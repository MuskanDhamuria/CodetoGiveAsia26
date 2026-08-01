import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { ParticipantOutletContext } from "../ParticipantApp";
import AccountSignupForm from "./AccountSignupForm";
import SignInForm from "./SignInForm";

export default function SignInPage() {
  const { participant, onIdentified } = useOutletContext<ParticipantOutletContext>();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");

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
        <h1>{mode === "sign-in" ? "Sign in" : "Create account"}</h1>
      </header>
      {mode === "sign-in" ? (
        <>
          <SignInForm
            onSignedIn={(next) => {
              onIdentified(next);
              navigate("/participant/my-events");
            }}
          />
          <p>
            New here?{" "}
            <button type="button" className="link-button" onClick={() => setMode("sign-up")}>
              Create an account
            </button>{" "}
            without signing up for an event.
          </p>
        </>
      ) : (
        <>
          <AccountSignupForm
            onSignedUp={(next) => {
              onIdentified(next);
              navigate("/participant/my-events");
            }}
          />
          <p>
            Already have an account?{" "}
            <button type="button" className="link-button" onClick={() => setMode("sign-in")}>
              Sign in
            </button>
          </p>
        </>
      )}
    </section>
  );
}
