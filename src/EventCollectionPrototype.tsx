import { useEffect, useMemo, useState } from "react";

// PROTOTYPE ONLY: three Event collection variants, switchable via
// `?variant=`, on the existing Events route.

type PrototypeEvent = {
  name: string;
  date: string;
  day: number;
  venue: string;
  status: "Planning" | "Recruiting" | "On track" | "Needs attention" | "Closed";
  progress: number;
  tasksDone: number;
  tasksTotal: number;
};

const prototypeEvents: PrototypeEvent[] = [
  { name: "National Day Celebration 2027", date: "9 Aug 2027", day: 9, venue: "Marina Bay Community Plaza", status: "Planning", progress: 68, tasksDone: 19, tasksTotal: 28 },
  { name: "Community Health Fair", date: "18 Aug 2027", day: 18, venue: "Tampines Hub", status: "Recruiting", progress: 54, tasksDone: 13, tasksTotal: 24 },
  { name: "Beach Cleanup Drive", date: "24 Aug 2027", day: 24, venue: "East Coast Park Area C", status: "On track", progress: 81, tasksDone: 17, tasksTotal: 21 },
  { name: "Food Donation Sortathon", date: "15 Sep 2027", day: 15, venue: "Central Warehouse", status: "Needs attention", progress: 39, tasksDone: 9, tasksTotal: 23 },
  { name: "Migrant Wellness Morning", date: "12 Jul 2027", day: 12, venue: "Jurong Community Hall", status: "Closed", progress: 100, tasksDone: 18, tasksTotal: 18 },
];

const variantNames = {
  A: "Chronological ledger",
  B: "Calendar command",
  C: "Portfolio split",
} as const;

type Variant = keyof typeof variantNames;
type View = "list" | "calendar";

function EventStatus({ status }: { status: PrototypeEvent["status"] }) {
  return <span className={`collection-status status-${status.toLowerCase().replace(" ", "-")}`}>{status}</span>;
}

function CollectionControls({
  showClosed,
  view,
  onNewEvent,
  onShowClosed,
  onView,
}: {
  showClosed: boolean;
  view: View;
  onNewEvent: () => void;
  onShowClosed: () => void;
  onView: (view: View) => void;
}) {
  return (
    <div className="collection-controls">
      <div className="collection-view-toggle" aria-label="Collection view">
        <button className={view === "list" ? "active" : ""} type="button" onClick={() => onView("list")}>List</button>
        <button className={view === "calendar" ? "active" : ""} type="button" onClick={() => onView("calendar")}>Calendar</button>
      </div>
      <label className="collection-closed-toggle">
        <input checked={showClosed} type="checkbox" onChange={onShowClosed} />
        Show closed
      </label>
      <button className="collection-new-event" type="button" onClick={onNewEvent}><span>＋</span> New event</button>
    </div>
  );
}

function PrototypeCalendar({
  events,
  month,
  onMonth,
  onOpen,
}: {
  events: PrototypeEvent[];
  month: number;
  onMonth: (direction: number) => void;
  onOpen: (event: PrototypeEvent) => void;
}) {
  const monthName = month === 7 ? "July" : month === 8 ? "August" : "September";
  const monthEvents = events.filter((event) => event.date.includes(monthName.slice(0, 3)));
  const offset = month === 7 ? 3 : month === 8 ? 6 : 2;
  const days = Array.from({ length: 35 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= 31 ? day : null;
  });

  return (
    <section className="collection-calendar">
      <header>
        <button type="button" onClick={() => onMonth(-1)} aria-label="Previous month">←</button>
        <h2>{monthName} 2027</h2>
        <button type="button" onClick={() => onMonth(1)} aria-label="Next month">→</button>
      </header>
      <div className="collection-calendar-days">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="collection-calendar-grid">
        {days.map((day, index) => {
          const dayEvents = monthEvents.filter((event) => event.day === day);
          return (
            <div className={dayEvents.length ? "has-event" : ""} key={`${day ?? "blank"}-${index}`}>
              <span>{day}</span>
              {dayEvents.map((event) => (
                <button key={event.name} type="button" onClick={() => onOpen(event)}>
                  <i />
                  <strong>{event.name}</strong>
                  <small>{event.status}</small>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type VariantProps = {
  events: PrototypeEvent[];
  view: View;
  month: number;
  showClosed: boolean;
  selected: PrototypeEvent;
  onMonth: (direction: number) => void;
  onNewEvent: () => void;
  onOpen: (event: PrototypeEvent) => void;
  onSelect: (event: PrototypeEvent) => void;
  onShowClosed: () => void;
  onView: (view: View) => void;
};

function VariantA({ events, view, month, showClosed, onMonth, onNewEvent, onOpen, onShowClosed, onView }: VariantProps) {
  return (
    <div className="collection-variant collection-variant-a">
      <header className="collection-titlebar">
        <div><p>Events</p><h1>Every event, in order.</h1><span>Plan ahead without losing sight of what comes next.</span></div>
        <CollectionControls {...{ showClosed, view, onNewEvent, onShowClosed, onView }} />
      </header>
      {view === "calendar" ? (
        <PrototypeCalendar events={events} month={month} onMonth={onMonth} onOpen={onOpen} />
      ) : (
        <section className="ledger">
          <div className="ledger-heading"><span>Date</span><span>Event</span><span>Progress</span><span>Status</span><span /></div>
          {events.map((event, index) => (
            <article key={event.name}>
              <div className="ledger-date"><strong>{event.day}</strong><span>{event.date.split(" ")[1]}</span><small>{event.date.split(" ")[2]}</small></div>
              <div><p>{index === 0 && event.status !== "Closed" ? "NEXT UP" : event.venue}</p><h2>{event.name}</h2><span>{event.venue}</span></div>
              <div className="ledger-progress"><span>{event.tasksDone} of {event.tasksTotal} tasks</span><i><b style={{ width: `${event.progress}%` }} /></i></div>
              <EventStatus status={event.status} />
              <button type="button" onClick={() => onOpen(event)}>Open workspace <span>→</span></button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function VariantB({ events, month, showClosed, onMonth, onNewEvent, onOpen, onShowClosed }: VariantProps) {
  const upcoming = events.filter((event) => event.status !== "Closed").slice(0, 3);
  return (
    <div className="collection-variant collection-variant-b">
      <aside className="calendar-sidebar">
        <div><p>Event operations</p><h1>Calendar</h1></div>
        <button className="collection-new-event" type="button" onClick={onNewEvent}><span>＋</span> New event</button>
        <section><p>Coming up</p>
          {upcoming.map((event) => (
            <button type="button" key={event.name} onClick={() => onOpen(event)}>
              <span>{event.date}</span><strong>{event.name}</strong><small>{event.venue}</small>
            </button>
          ))}
        </section>
        <label className="collection-closed-toggle"><input checked={showClosed} type="checkbox" onChange={onShowClosed} /> Include closed events</label>
      </aside>
      <main>
        <header><div><p>Event-only calendar</p><h2>Coordinate the month at a glance</h2></div><span>{events.length} visible events</span></header>
        <PrototypeCalendar events={events} month={month} onMonth={onMonth} onOpen={onOpen} />
      </main>
    </div>
  );
}

function VariantC({ events, view, month, showClosed, selected, onMonth, onNewEvent, onOpen, onSelect, onShowClosed, onView }: VariantProps) {
  return (
    <div className="collection-variant collection-variant-c">
      <header className="portfolio-header">
        <div><p>Events / Portfolio</p><h1>Event portfolio</h1></div>
        <CollectionControls {...{ showClosed, view, onNewEvent, onShowClosed, onView }} />
      </header>
      {view === "calendar" ? (
        <PrototypeCalendar events={events} month={month} onMonth={onMonth} onOpen={onOpen} />
      ) : (
        <div className="portfolio-split">
          <section className="portfolio-index">
            <header><span>{events.length} events</span><span>Earliest first</span></header>
            {events.map((event) => (
              <button className={selected.name === event.name ? "active" : ""} type="button" key={event.name} onClick={() => onSelect(event)}>
                <time><strong>{event.day}</strong>{event.date.split(" ")[1]}</time>
                <span><strong>{event.name}</strong><small>{event.venue}</small></span>
                <EventStatus status={event.status} />
              </button>
            ))}
          </section>
          <aside className="portfolio-preview">
            <p>Selected event</p><EventStatus status={selected.status} />
            <h2>{selected.name}</h2><span>{selected.date} · {selected.venue}</span>
            <div className="portfolio-score"><strong>{selected.progress}%</strong><span>plan complete</span><i><b style={{ width: `${selected.progress}%` }} /></i></div>
            <dl><div><dt>Tasks done</dt><dd>{selected.tasksDone}</dd></div><div><dt>Tasks remaining</dt><dd>{selected.tasksTotal - selected.tasksDone}</dd></div></dl>
            <button type="button" onClick={() => onOpen(selected)}>Open event workspace <span>→</span></button>
          </aside>
        </div>
      )}
    </div>
  );
}

function PrototypeSwitcher({ current, onCycle }: { current: Variant; onCycle: (direction: number) => void }) {
  if (import.meta.env.PROD) return null;
  return (
    <div className="prototype-switcher" aria-label="Prototype variant switcher">
      <button type="button" onClick={() => onCycle(-1)} aria-label="Previous variant">←</button>
      <strong>{current} — {variantNames[current]}</strong>
      <button type="button" onClick={() => onCycle(1)} aria-label="Next variant">→</button>
    </div>
  );
}

export default function EventCollectionPrototype() {
  const params = new URLSearchParams(window.location.search);
  const initialVariant = params.get("variant");
  const [variant, setVariant] = useState<Variant>(initialVariant === "A" || initialVariant === "B" ? initialVariant : "C");
  const [view, setView] = useState<View>(variant === "B" ? "calendar" : "list");
  const [showClosed, setShowClosed] = useState(false);
  const [month, setMonth] = useState(8);
  const [selected, setSelected] = useState(prototypeEvents[0]);
  const [notice, setNotice] = useState("");
  const visibleEvents = useMemo(
    () =>
      prototypeEvents
        .filter((event) => showClosed || event.status !== "Closed")
        .sort((left, right) => {
          const month = (event: PrototypeEvent) =>
            event.date.includes("Jul") ? 7 : event.date.includes("Aug") ? 8 : 9;
          return month(left) * 100 + left.day - (month(right) * 100 + right.day);
        }),
    [showClosed],
  );

  function setUrlVariant(next: Variant) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("variant", next);
    window.history.replaceState({}, "", nextUrl);
    setVariant(next);
    if (next === "B") setView("calendar");
  }

  function cycle(direction: number) {
    const variants: Variant[] = ["A", "B", "C"];
    const next = variants[(variants.indexOf(variant) + direction + variants.length) % variants.length];
    setUrlVariant(next);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [variant]);

  const props: VariantProps = {
    events: visibleEvents,
    view,
    month,
    showClosed,
    selected,
    onMonth: (direction) => setMonth((value) => Math.min(9, Math.max(7, value + direction))),
    onNewEvent: () => setNotice("New Event flow would open here."),
    onOpen: (event) => setNotice(`Opening ${event.name} workspace…`),
    onSelect: setSelected,
    onShowClosed: () => setShowClosed((value) => !value),
    onView: setView,
  };

  return (
    <>
      {variant === "A" && <VariantA {...props} />}
      {variant === "B" && <VariantB {...props} />}
      {variant === "C" && <VariantC {...props} />}
      {notice && <button className="collection-notice" type="button" onClick={() => setNotice("")}>{notice}<span>Dismiss</span></button>}
      <PrototypeSwitcher current={variant} onCycle={cycle} />
    </>
  );
}
