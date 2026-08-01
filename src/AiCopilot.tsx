import { useEffect, useRef, useState } from "react";
import type { Page } from "./App";

const pageContext: Record<Page, string> = {
  home: "Landing",
  dashboard: "Dashboard",
  events: "Events",
  volunteers: "Volunteers",
  ai: "AI Copilot",
};

const pageInsight: Record<Page, string> = {
  home: "I can help you set up your first volunteer event.",
  dashboard: "Five volunteers still need a reminder for Health Fair.",
  events: "National Day is on track, but registration needs 8 more volunteers.",
  volunteers: "Four high-match volunteers are available for your open roles.",
  ai: "Tell me the outcome you want and I’ll build a reviewable plan.",
};

const recommendedActions = [
  { title: "Send 5 reminders", action: "Review recipients" },
  { title: "Fill registration gaps", action: "View matches" },
  { title: "Prepare weekly summary", action: "Generate draft" },
];

export default function AiCopilot({ activePage }: { activePage: Page }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [goal, setGoal] = useState("");
  const fabRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  // The FAB and the close button aren't mounted at the same time (each only
  // renders for its own `open` state), so focus has to move after the swap
  // commits rather than inline in the click handler that toggles `open`.
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      closeButtonRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      fabRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
  }

  function loadGoal(nextGoal: string) {
    setGoal(nextGoal);
    setDraft(nextGoal);
  }

  function sendGoal() {
    if (!draft.trim()) return;
    setGoal(draft.trim());
    setDraft("");
  }

  return (
    <>
      {!open && (
        <button
          ref={fabRef}
          type="button"
          className="copilot-fab"
          aria-expanded={open}
          aria-controls="ai-copilot-panel"
          onClick={() => setOpen(true)}
        >
          <span>AI</span>
          Ask Passion AI
        </button>
      )}

      {open && <div className="copilot-backdrop" onClick={close} />}

      <aside
        id="ai-copilot-panel"
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        aria-label="AI Copilot"
        className={`copilot-panel${open ? " open" : ""}`}
      >
        <header className="copilot-header">
          <div>
            <p>{pageContext[activePage]}</p>
            <h2>AI Copilot</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={close} aria-label="Close AI Copilot">
            Close
          </button>
        </header>

        <div className="copilot-context">
          <strong>Needs your attention</strong>
          <p>{pageInsight[activePage]}</p>
        </div>

        <div className="copilot-chat">
          {recommendedActions.map(({ title, action }) => (
            <article key={title} className="suggestion-card">
              <p>{title}</p>
              <button type="button" onClick={() => loadGoal(title)}>
                {action}
              </button>
            </article>
          ))}

          <article className="suggestion-card">
            <p>Broadcast draft: Health Fair reminder</p>
            <button type="button" onClick={() => loadGoal("Review Health Fair reminder broadcast")}>
              Review
            </button>
          </article>

          {goal && (
            <div className="copilot-message">
              <p>Preparing: {goal}</p>
            </div>
          )}
        </div>

        <form
          className="copilot-composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendGoal();
          }}
        >
          <input
            aria-label="Message Passion AI"
            placeholder="Ask Passion AI…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" aria-label="Send message">
            ↑
          </button>
        </form>
      </aside>
    </>
  );
}
