import { useState } from "react";
import type { Page } from "./App";

const prompts = [
  "Create an event for me",
  "Send targeted broadcast to participants",
  "Draft and follow up on emails for me",
];

const pageContext: Record<Page, string> = {
  home: "Landing",
  dashboard: "Dashboard",
  events: "Events",
  volunteers: "Volunteers",
  ai: "AI Copilot",
};

export default function AiCopilot({
  activePage,
  isOpen,
  onOpen,
  onClose,
}: {
  activePage: Page;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [goal, setGoal] = useState("");

  function loadGoal(nextGoal: string) {
    setDraft(nextGoal);
    setGoal(nextGoal);
  }

  function sendGoal() {
    if (!draft.trim()) return;
    setGoal(draft.trim());
    setDraft("");
  }

  return (
    <>
      <button
        className="copilot-fab"
        type="button"
        aria-controls="copilot-panel"
        aria-expanded={isOpen}
        onClick={onOpen}
      >
        <span>AI</span>
        Copilot
      </button>

      <aside
        className={`copilot-panel copilot-workflow-panel ${isOpen ? "open" : ""}`}
        id="copilot-panel"
        aria-hidden={!isOpen}
      >
        <header className="copilot-workflow-header">
          <div>
            <p>Passion AI</p>
            <h2>Copilot</h2>
          </div>
          <button type="button" aria-label="Close AI Copilot" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="copilot-page-context">
          <span>Working in</span>
          <strong>{pageContext[activePage]}</strong>
        </div>

        <div className="copilot-workflow-body">
          <div>
            <p className="copilot-eyebrow">Plan before sending</p>
            <h3>Turn a request into a reviewable workflow.</h3>
          </div>

          <ol className="copilot-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Choose a goal</strong>
                <p>{goal || "Pick one of the common tasks below."}</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Review the draft</strong>
                <p>Copilot gathers details and shows you what it will do.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Approve the action</strong>
                <p>Nothing goes out until you confirm it.</p>
              </div>
            </li>
          </ol>

          <div className="copilot-prompts" aria-label="Sample prompts">
            {prompts.map((prompt) => (
              <button key={prompt} type="button" onClick={() => loadGoal(prompt)}>
                {prompt}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </div>

        <form
          className="copilot-workflow-composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendGoal();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Tell Copilot what you need"
          />
          <button type="submit">Send</button>
        </form>
      </aside>
    </>
  );
}
