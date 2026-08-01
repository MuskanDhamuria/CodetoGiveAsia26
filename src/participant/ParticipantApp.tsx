import { useState } from "react";
import { NavLink, Outlet, Route, Routes } from "react-router-dom";
import {
  clearStoredParticipant,
  getStoredParticipant,
  storeParticipant,
  type StoredParticipant,
} from "./identity";
import EventBrowseList from "./components/EventBrowseList";
import EventDetailCard from "./components/EventDetailCard";
import MyEventsList from "./components/MyEventsList";
import SignInPage from "./components/SignInPage";
import "./participant.css";

export type ParticipantOutletContext = {
  participant: StoredParticipant | null;
  onIdentified: (participant: StoredParticipant) => void;
  onIdentityInvalid: () => void;
};

function ParticipantLayout() {
  const [participant, setParticipant] = useState<StoredParticipant | null>(getStoredParticipant);

  function handleIdentified(next: StoredParticipant) {
    storeParticipant(next);
    setParticipant(next);
  }

  function handleIdentityInvalid() {
    clearStoredParticipant();
    setParticipant(null);
  }

  const context: ParticipantOutletContext = {
    participant,
    onIdentified: handleIdentified,
    onIdentityInvalid: handleIdentityInvalid,
  };

  return (
    <div className="participant-shell">
      <header className="participant-header">
        <div>
          <p>Passion to Serve</p>
          <h1>Events</h1>
        </div>
        <nav className="participant-nav">
          <NavLink to="/participant" end>
            Browse
          </NavLink>
          <NavLink to="/participant/my-events">My Events</NavLink>
          {!participant && <NavLink to="/participant/sign-in">Sign in</NavLink>}
        </nav>
        {participant && <span className="participant-badge">Signed in as {participant.name}</span>}
      </header>
      <main className="participant-main">
        <Outlet context={context} />
      </main>
    </div>
  );
}

export default function ParticipantApp() {
  return (
    <Routes>
      <Route element={<ParticipantLayout />}>
        <Route index element={<EventBrowseList />} />
        <Route path="events/:eventId" element={<EventDetailCard />} />
        <Route path="my-events" element={<MyEventsList />} />
        <Route path="sign-in" element={<SignInPage />} />
      </Route>
    </Routes>
  );
}
