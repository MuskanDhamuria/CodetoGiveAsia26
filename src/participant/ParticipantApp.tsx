import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";
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

function ParticipantMenu({ participant, onSignOut }: { participant: StoredParticipant; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  return (
    <div className="participant-menu" ref={containerRef}>
      <button
        type="button"
        className="participant-badge"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Signed in as {participant.name}
      </button>
      {open && (
        <div className="participant-menu-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function ParticipantLayout() {
  const [participant, setParticipant] = useState<StoredParticipant | null>(getStoredParticipant);
  const navigate = useNavigate();

  function handleIdentified(next: StoredParticipant) {
    storeParticipant(next);
    setParticipant(next);
  }

  function handleIdentityInvalid() {
    clearStoredParticipant();
    setParticipant(null);
  }

  function handleSignOut() {
    clearStoredParticipant();
    setParticipant(null);
    navigate("/participant/sign-in");
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
        {participant && <ParticipantMenu participant={participant} onSignOut={handleSignOut} />}
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
