// PROTOTYPE ONLY: three task-hierarchy variants, switchable via ?variant=,
// mounted inside the existing event workspace.
import { useEffect, useState } from "react";

type Variant = "A" | "B" | "C";

const subtasks = [
  "Sort the collected items",
  "Manage item distribution",
  "Capture memories",
  "Clean up the venue",
];

const people = ["Unassigned", "John Tan", "Priya Nair", "Marcus Lee"];

function PhasePill() {
  return <span className="prototype-phase">Event day</span>;
}

function AssigneeSelect({ label = "Assignee" }: { label?: string }) {
  return (
    <label className="prototype-assignee">
      <span>{label}</span>
      <select defaultValue="Unassigned">
        {people.map((person) => (
          <option key={person}>{person}</option>
        ))}
      </select>
    </label>
  );
}

function VariantA() {
  const [checked, setChecked] = useState<string[]>(["Sort the collected items"]);

  return (
    <section className="prototype-board prototype-board-a">
      <header className="prototype-explainer">
        <div>
          <span>Variant A</span>
          <h2>One activity, one owner</h2>
        </div>
        <p>
          The PDF’s major activity is the Kanban card. Its nested actions are a
          lightweight checklist sharing one deadline and assignee.
        </p>
      </header>
      <div className="prototype-columns">
        <section className="prototype-column">
          <h3>To do <span>2</span></h3>
          <article className="prototype-task-card">
            <div className="prototype-card-heading">
              <PhasePill />
              <span className="prototype-date">9 Aug</span>
            </div>
            <h4>Event-day volunteer organising</h4>
            <div className="prototype-progress">
              <span>{checked.length} of {subtasks.length} complete</span>
              <i><b style={{ width: `${(checked.length / subtasks.length) * 100}%` }} /></i>
            </div>
            <div className="prototype-checklist">
              {subtasks.map((task) => (
                <label key={task}>
                  <input
                    checked={checked.includes(task)}
                    type="checkbox"
                    onChange={() =>
                      setChecked((current) =>
                        current.includes(task)
                          ? current.filter((item) => item !== task)
                          : [...current, task],
                      )
                    }
                  />
                  <span>{task}</span>
                </label>
              ))}
            </div>
            <AssigneeSelect />
          </article>
          <article className="prototype-task-card prototype-compact-card">
            <PhasePill />
            <h4>Communicate with beneficiaries</h4>
            <span>Due 2 Aug · Unassigned</span>
          </article>
        </section>
        <section className="prototype-column prototype-muted-column">
          <h3>In progress <span>1</span></h3>
          <article className="prototype-task-card prototype-compact-card">
            <span className="prototype-phase planning">Planning</span>
            <h4>Confirm collection schedule</h4>
            <span>Due 12 Jul · Priya Nair</span>
          </article>
        </section>
        <section className="prototype-column prototype-muted-column">
          <h3>Done <span>1</span></h3>
          <article className="prototype-task-card prototype-compact-card done">
            <span className="prototype-phase planning">Planning</span>
            <h4>Initiate team communication</h4>
            <span>Completed 18 Jun · John Tan</span>
          </article>
        </section>
      </div>
    </section>
  );
}

function VariantB() {
  return (
    <section className="prototype-board prototype-board-b">
      <header className="prototype-explainer">
        <div>
          <span>Variant B</span>
          <h2>Every action stands alone</h2>
        </div>
        <p>
          Every nested PDF action becomes an independent card with its own
          status, deadline, and assignee.
        </p>
      </header>
      <div className="prototype-columns">
        <section className="prototype-column">
          <h3>To do <span>4</span></h3>
          {subtasks.slice(0, 3).map((task, index) => (
            <article className="prototype-task-card prototype-atomic-card" key={task}>
              <div className="prototype-card-heading">
                <PhasePill />
                <span className="prototype-date">9 Aug</span>
              </div>
              <h4>{task}</h4>
              <span className="prototype-parent">Event-day volunteer organising</span>
              <AssigneeSelect label={`Owner ${index + 1}`} />
            </article>
          ))}
        </section>
        <section className="prototype-column">
          <h3>In progress <span>2</span></h3>
          <article className="prototype-task-card prototype-atomic-card">
            <div className="prototype-card-heading">
              <PhasePill />
              <span className="prototype-date">9 Aug</span>
            </div>
            <h4>Clean up the venue</h4>
            <span className="prototype-parent">Event-day volunteer organising</span>
            <AssigneeSelect />
          </article>
        </section>
        <section className="prototype-column prototype-muted-column">
          <h3>Done <span>1</span></h3>
          <article className="prototype-task-card prototype-compact-card done">
            <span className="prototype-phase planning">Planning</span>
            <h4>Initiate team communication</h4>
            <span>Completed 18 Jun · John Tan</span>
          </article>
        </section>
      </div>
    </section>
  );
}

function VariantC() {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="prototype-board prototype-board-c">
      <header className="prototype-explainer">
        <div>
          <span>Variant C</span>
          <h2>Activity summary with a work drawer</h2>
        </div>
        <p>
          The board stays compact, while opening an activity reveals subtasks
          that can each be assigned without becoming separate cards.
        </p>
      </header>
      <div className="prototype-split-view">
        <div className="prototype-mini-board">
          {["To do", "In progress", "Done"].map((column, columnIndex) => (
            <section className="prototype-column" key={column}>
              <h3>{column} <span>{columnIndex === 0 ? 2 : 1}</span></h3>
              {columnIndex === 0 && (
                <button
                  className={`prototype-summary-card ${expanded ? "active" : ""}`}
                  type="button"
                  onClick={() => setExpanded(true)}
                >
                  <div><PhasePill /><span>1 / 4</span></div>
                  <strong>Event-day volunteer organising</strong>
                  <span>9 Aug · 3 people needed →</span>
                </button>
              )}
              <article className="prototype-task-card prototype-compact-card">
                <span className="prototype-phase planning">Planning</span>
                <h4>{columnIndex === 2 ? "Initiate team communication" : "Confirm collection schedule"}</h4>
                <span>{columnIndex === 2 ? "Completed" : "Due 12 Jul"}</span>
              </article>
            </section>
          ))}
        </div>
        {expanded && (
          <aside className="prototype-drawer">
            <button type="button" onClick={() => setExpanded(false)}>Close</button>
            <PhasePill />
            <h3>Event-day volunteer organising</h3>
            <p>9 Aug 2027 · Distribution of pre-loved items</p>
            <div className="prototype-subtask-rows">
              {subtasks.map((task, index) => (
                <label key={task}>
                  <input defaultChecked={index === 0} type="checkbox" />
                  <strong>{task}</strong>
                  <select defaultValue="Unassigned" aria-label={`Assignee for ${task}`}>
                    {people.map((person) => <option key={person}>{person}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

const variants: { key: Variant; name: string }[] = [
  { key: "A", name: "Checklist card" },
  { key: "B", name: "Independent cards" },
  { key: "C", name: "Work drawer" },
];

export default function EventTaskHierarchyPrototype() {
  const initial = new URLSearchParams(window.location.search).get("variant");
  const [variant, setVariant] = useState<Variant>(
    initial === "B" || initial === "C" ? initial : "A",
  );

  function selectVariant(next: Variant) {
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState({}, "", url);
  }

  function cycle(direction: -1 | 1) {
    const index = variants.findIndex((item) => item.key === variant);
    selectVariant(variants[(index + direction + variants.length) % variants.length].key);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return (
    <>
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      {!import.meta.env.PROD && (
        <nav className="prototype-switcher" aria-label="Prototype variants">
          <button type="button" onClick={() => cycle(-1)} aria-label="Previous variant">←</button>
          <strong>{variant} — {variants.find((item) => item.key === variant)?.name}</strong>
          <button type="button" onClick={() => cycle(1)} aria-label="Next variant">→</button>
        </nav>
      )}
    </>
  );
}
