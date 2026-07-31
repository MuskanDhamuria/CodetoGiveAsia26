import { useState } from "react";
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

function Composer({
  draft,
  onChange,
  onSend,
}: {
  draft: string;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <form
      className="copilot-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <textarea
        aria-label="Message Passion AI"
        placeholder="Ask Passion AI…"
        rows={1}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="submit" aria-label="Send message">
        ↑
      </button>
    </form>
  );
}

export default function AiCopilot({ activePage }: { activePage: Page }) {
  const [draft, setDraft] = useState("");
  const [goal, setGoal] = useState("");

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
    <aside className="copilot-sidebar" aria-label="AI Copilot">
      <header className="copilot-brief-header">
        <div>
          <p>Workspace intelligence</p>
          <h2>{pageContext[activePage]} brief</h2>
        </div>
        <div className="copilot-ai-mark">AI</div>
      </header>

      <div className="copilot-brief-body">
        <section className="copilot-priority-card">
          <span>Needs your attention</span>
          <h3>{pageInsight[activePage]}</h3>
          <button type="button" onClick={() => loadGoal("Resolve this for me")}>
            Resolve with AI
          </button>
        </section>

        <section className="copilot-action-stack">
          <div className="copilot-section-label">
            <strong>Recommended actions</strong>
            <span>3 ready</span>
          </div>
          {[
            ["Send 5 reminders", "Review recipients"],
            ["Fill registration gaps", "View matches"],
            ["Prepare weekly summary", "Generate draft"],
          ].map(([title, action], index) => (
            <button key={title} type="button" onClick={() => loadGoal(title)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{title}</strong>
              <em>{action} →</em>
            </button>
          ))}
        </section>

        <section className="copilot-approval-queue">
          <div className="copilot-section-label">
            <strong>Approval queue</strong>
            <span>1 item</span>
          </div>
          <article>
            <div>
              <span>Broadcast draft</span>
              <strong>Health Fair reminder</strong>
            </div>
            <button type="button">Review</button>
          </article>
        </section>

        {goal && <p className="copilot-active-goal">Preparing: {goal}</p>}
      </div>

      <div className="copilot-brief-composer">
        <span>What outcome do you need?</span>
        <Composer draft={draft} onChange={setDraft} onSend={sendGoal} />
      </div>
    </aside>
  );
}
