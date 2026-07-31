// PROTOTYPE ONLY: three New Event flow variants, switchable via
// ?page=events&prototype=event-creation&variant=A|B|C on the existing Events route.
import { useEffect, useState } from "react";

type Variant = "A" | "B" | "C";
type Step = 1 | 2 | 3;

const templates = [
  { name: "Distribution of pre-loved items", description: "Collect, sort, and distribute essential items.", tasks: 12, tag: "Built-in" },
  { name: "Wellness", description: "A focused wellbeing session for migrant workers.", tasks: 7, tag: "Built-in" },
  { name: "Skill Enhancement", description: "Coordinate a practical learning session.", tasks: 10, tag: "Built-in" },
];

const generatedTasks = [
  ["Align the team on holding the event", "Planning", "14 Jun 2027", "56 days before Event"],
  ["Identify supporting-organization contacts", "Planning", "21 Jun 2027", "49 days before Event"],
  ["Confirm collection venues and schedules", "Planning", "28 Jun 2027", "42 days before Event"],
  ["Notify beneficiary migrant workers", "Planning", "19 Jul 2027", "21 days before Event"],
  ["Run distribution day", "Execution", "9 Aug 2027", "Event day"],
];

function StepRail({ step }: { step: Step }) {
  return <ol className="creation-steps">{["Choose template", "Event details", "Review plan"].map((label, index) => <li className={index + 1 === step ? "active" : index + 1 < step ? "done" : ""} key={label}><span>{index + 1 < step ? "✓" : index + 1}</span>{label}</li>)}</ol>;
}

function TemplateChoices({ selected, choose }: { selected: string; choose: (name: string) => void }) {
  return <div className="creation-template-list">{templates.map((template) => <button className={selected === template.name ? "selected" : ""} type="button" key={template.name} onClick={() => choose(template.name)}><span>{template.tag}</span><strong>{template.name}</strong><small>{template.description}</small><em>{template.tasks} Tasks · 8-week horizon</em></button>)}</div>;
}

function DetailsForm() {
  return <div className="creation-fields"><label>Event name<input defaultValue="August community distribution" /></label><label>Event date<input type="date" defaultValue="2027-08-09" /></label><label>Venue<input defaultValue="Marina Bay Community Plaza" /></label></div>;
}

function PlanPreview() {
  return <div className="creation-plan"><div className="creation-plan-summary"><span>Auto-generated plan</span><strong>5 shown of 12 Tasks</strong><small>Deadlines stay relative to 9 Aug 2027</small></div>{generatedTasks.map(([task, phase, date, relative]) => <article key={task}><span className={`creation-phase ${phase === "Execution" ? "execution" : ""}`}>{phase}</span><div><strong>{task}</strong><small>{date} · {relative}</small></div><select defaultValue="Unassigned" aria-label={`Assignee for ${task}`}><option>Unassigned</option><option>Priya Nair</option><option>John Tan</option><option>Marcus Lee</option></select><button type="button" aria-label={`Edit ${task}`}>Edit</button></article>)}</div>;
}

function VariantA() {
  const [step, setStep] = useState<Step>(1); const [template, setTemplate] = useState(templates[0].name);
  return <section className="creation-prototype creation-a"><div className="creation-dialog" role="dialog" aria-modal="true" aria-labelledby="creation-dialog-title"><header className="creation-dialog-header"><div><p>New Event</p><h1 id="creation-dialog-title">Build a scheduled event</h1></div><button type="button" className="creation-close" aria-label="Close create Event dialog">×</button></header><StepRail step={step} /><main><header><p>Step {step} of 3</p><h2>{step === 1 ? "Start with a reusable Event Template" : step === 2 ? "Give this Event its details" : "Review the copied plan"}</h2><span>{step === 1 ? "You can tailor the plan after it is generated." : step === 2 ? `${template} will supply the Task structure.` : "Edits affect this Event only."}</span></header>{step === 1 && <><TemplateChoices selected={template} choose={setTemplate} /><button className="creation-link" type="button">＋ Create custom template</button></>}{step === 2 && <DetailsForm />}{step === 3 && <PlanPreview />}<footer><button type="button" className="creation-cancel">Cancel</button>{step > 1 && <button type="button" onClick={() => setStep((step - 1) as Step)}>Back</button>}<button className="creation-primary" type="button" onClick={() => step === 3 ? undefined : setStep((step + 1) as Step)}>{step === 3 ? "Create event" : "Continue"}</button></footer></main></div></section>;
}

function VariantB() {
  const [template, setTemplate] = useState(templates[0].name); const [showBuilder, setShowBuilder] = useState(false);
  return <section className="creation-prototype creation-b"><header><div><p>New Event / Plan library</p><h1>Choose the work before the date</h1></div><button className="creation-primary" type="button">Continue with {template.split(" ")[0]} →</button></header><div className="creation-b-split"><main><p className="creation-eyebrow">Reusable Event Templates</p><TemplateChoices selected={template} choose={setTemplate} /><button className="creation-link" type="button" onClick={() => setShowBuilder(true)}>＋ Build a custom template</button></main><aside><span>Selected template</span><h2>{template}</h2><p>{templates.find((item) => item.name === template)?.description}</p><dl><div><dt>Tasks</dt><dd>{templates.find((item) => item.name === template)?.tasks}</dd></div><div><dt>Deadline rule</dt><dd>Relative to Event date</dd></div></dl><strong>What happens next</strong><ol><li>Name the Event, date it, and choose a venue.</li><li>Review an independent, editable Task plan.</li></ol></aside></div>{showBuilder && <div className="creation-builder" role="dialog"><div><button type="button" onClick={() => setShowBuilder(false)}>×</button><p>Custom Event Template</p><h2>Make a reusable workflow</h2><label>Template name<input placeholder="e.g. Community outreach" /></label>{["Welcome and orientation", "Run the session"].map((task, index) => <article key={task}><span>{index + 1}</span><strong>{task}</strong><small>Planning · 14 days before Event</small></article>)}<button className="creation-primary" type="button" onClick={() => setShowBuilder(false)}>Save template</button></div></div>}</section>;
}

function VariantC() {
  const [editing, setEditing] = useState(false);
  return <section className="creation-prototype creation-c"><header><p>New Event</p><h1>Confirm the plan at a glance</h1><span>A plan-first review that keeps Event details visible beside every Task.</span></header><div className="creation-c-grid"><aside><span>Event details</span><h2>August community distribution</h2><dl><div><dt>Date</dt><dd>9 Aug 2027</dd></div><div><dt>Venue</dt><dd>Marina Bay Community Plaza</dd></div><div><dt>From template</dt><dd>Distribution of pre-loved items</dd></div></dl><button className="creation-link" type="button">Change details</button><hr /><strong>12 Tasks · 4 phases</strong><small>Every deadline follows the Event date.</small></aside><main><div className="creation-plan-summary"><span>Auto-generated plan</span><strong>Planning</strong><button type="button" onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit plan"}</button></div><PlanPreview />{editing && <button className="creation-add-task" type="button">＋ Add Task</button>}<footer><button type="button">Back</button><button className="creation-primary" type="button">Create event</button></footer></main></div></section>;
}

const labels: Record<Variant, string> = { A: "Guided workspace", B: "Template library", C: "Plan-first review" };

export default function EventCreationPrototype() {
  const initial = new URLSearchParams(window.location.search).get("variant"); const [variant, setVariant] = useState<Variant>(initial === "B" || initial === "C" ? initial : "A");
  function cycle(direction: number) { const values: Variant[] = ["A", "B", "C"]; const next = values[(values.indexOf(variant) + direction + values.length) % values.length]; setVariant(next); const url = new URL(window.location.href); url.searchParams.set("variant", next); window.history.replaceState({}, "", url); }
  useEffect(() => { const handler = (event: KeyboardEvent) => { const target = event.target as HTMLElement; if (target.matches("input, textarea, select, [contenteditable]")) return; if (event.key === "ArrowLeft") cycle(-1); if (event.key === "ArrowRight") cycle(1); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); });
  return <>{variant === "A" && <VariantA />}{variant === "B" && <VariantB />}{variant === "C" && <VariantC />}{!import.meta.env.PROD && <nav className="prototype-switcher" aria-label="Prototype variants"><button type="button" onClick={() => cycle(-1)}>←</button><strong>{variant} — {labels[variant]}</strong><button type="button" onClick={() => cycle(1)}>→</button></nav>}</>;
}
