import { useEffect, useMemo, useState } from "react";

// PROTOTYPE ONLY: three Event collection variants, switchable via
// `?variant=`, on the existing Events route.

export type EventCollectionItem = {
  id: string;
  name: string;
  date: string;
  day: number;
  venue: string;
  status: string;
  progress: number;
  tasksDone: number;
  tasksTotal: number;
};

const prototypeEvents: EventCollectionItem[] = [
  { id: "prototype-national-day", name: "National Day Celebration 2027", date: "9 Aug 2027", day: 9, venue: "Marina Bay Community Plaza", status: "Planning", progress: 68, tasksDone: 19, tasksTotal: 28 },
  { id: "prototype-health-fair", name: "Community Health Fair", date: "18 Aug 2027", day: 18, venue: "Tampines Hub", status: "Recruiting", progress: 54, tasksDone: 13, tasksTotal: 24 },
  { id: "prototype-beach-cleanup", name: "Beach Cleanup Drive", date: "24 Aug 2027", day: 24, venue: "East Coast Park Area C", status: "On track", progress: 81, tasksDone: 17, tasksTotal: 21 },
  { id: "prototype-food-sortathon", name: "Food Donation Sortathon", date: "15 Sep 2027", day: 15, venue: "Central Warehouse", status: "Needs attention", progress: 39, tasksDone: 9, tasksTotal: 23 },
  { id: "prototype-wellness", name: "Migrant Wellness Morning", date: "12 Jul 2027", day: 12, venue: "Jurong Community Hall", status: "Closed", progress: 100, tasksDone: 18, tasksTotal: 18 },
];

type Variant = "A" | "B" | "C";
type View = "list" | "calendar";

function EventStatus({ status }: { status: EventCollectionItem["status"] }) {
  return <span className={`collection-status status-${status.toLowerCase().replace(" ", "-")}`}>{status}</span>;
}

function CollectionControls({
  showClosed,
  showCancelled,
  view,
  onNewEvent,
  onShowClosed,
  onShowCancelled,
  onView,
}: {
  showClosed: boolean;
  showCancelled: boolean;
  view: View;
  onNewEvent: () => void;
  onShowClosed: () => void;
  onShowCancelled: () => void;
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
      <label className="collection-closed-toggle">
        <input checked={showCancelled} type="checkbox" onChange={onShowCancelled} />
        Show cancelled
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
  events: EventCollectionItem[];
  month: number;
  onMonth: (direction: number) => void;
  onOpen: (event: EventCollectionItem) => void;
}) {
  const monthName = month === 7 ? "July" : month === 8 ? "August" : "September";
  const monthEvents = events.filter((event) => event.date.includes(monthName.slice(0, 3)));
  const offset = month === 7 ? 3 : month === 8 ? 6 : 2;
  const days = Array.from({ length: 35 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= 31 ? day : null;
  });

  return (
    <section aria-label={`${monthName} 2027 Event calendar`} className="collection-calendar">
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
  events: EventCollectionItem[];
  view: View;
  month: number;
  showClosed: boolean;
  showCancelled: boolean;
  selected: EventCollectionItem;
  onMonth: (direction: number) => void;
  onNewEvent: () => void;
  onOpen: (event: EventCollectionItem) => void;
  onSelect: (event: EventCollectionItem) => void;
  onShowClosed: () => void;
  onShowCancelled: () => void;
  onView: (view: View) => void;
  openOnSelect: boolean;
};

function VariantA({ events, view, month, showClosed, showCancelled, onMonth, onNewEvent, onOpen, onShowClosed, onShowCancelled, onView }: VariantProps) {
  return (
    <div className="collection-variant collection-variant-a">
      <header className="collection-titlebar">
        <div><p>Events</p><h1>Every event, in order.</h1><span>Plan ahead without losing sight of what comes next.</span></div>
        <CollectionControls {...{ showClosed, showCancelled, view, onNewEvent, onShowClosed, onShowCancelled, onView }} />
      </header>
      {view === "calendar" ? (
        <PrototypeCalendar events={events} month={month} onMonth={onMonth} onOpen={onOpen} />
      ) : (
        <section className="ledger">
          <div className="ledger-heading"><span>Date</span><span>Event</span><span>Progress</span><span>Status</span><span /></div>
          {events.map((event, index) => (
            <article key={event.name}>
              <div className="ledger-date"><strong>{event.day}</strong><span>{event.date.split(" ")[1]}</span><small>{event.date.split(" ")[2]}</small></div>
              <div><p>{index === 0 && event.status !== "Closed" && event.status !== "Cancelled" ? "NEXT UP" : event.venue}</p><h2>{event.name}</h2><span>{event.venue}</span></div>
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

function VariantB({ events, month, showClosed, showCancelled, onMonth, onNewEvent, onOpen, onShowClosed, onShowCancelled }: VariantProps) {
  const upcoming = events.filter((event) => event.status !== "Closed" && event.status !== "Cancelled").slice(0, 3);
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
        <label className="collection-closed-toggle"><input checked={showCancelled} type="checkbox" onChange={onShowCancelled} /> Include cancelled events</label>
      </aside>
      <main>
        <header><div><p>Event-only calendar</p><h2>Coordinate the month at a glance</h2></div><span>{events.length} visible events</span></header>
        <PrototypeCalendar events={events} month={month} onMonth={onMonth} onOpen={onOpen} />
      </main>
    </div>
  );
}

function VariantC({ events, view, month, showClosed, showCancelled, selected, onMonth, onNewEvent, onOpen, onSelect, onShowClosed, onShowCancelled, onView, openOnSelect }: VariantProps) {
  return (
    <div className="collection-variant collection-variant-c">
      <header className="portfolio-header">
        <div><p>Events / Portfolio</p><h1>Event portfolio</h1></div>
        <CollectionControls {...{ showClosed, showCancelled, view, onNewEvent, onShowClosed, onShowCancelled, onView }} />
      </header>
      {view === "calendar" ? (
        <PrototypeCalendar events={events} month={month} onMonth={onMonth} onOpen={onOpen} />
      ) : (
        <div className="portfolio-split">
          <section className="portfolio-index">
            <header><span>{events.length} events</span><span>Earliest first</span></header>
            {events.map((event) => (
              <button aria-label={`Open ${event.name}`} className={selected.name === event.name ? "active" : ""} type="button" key={event.name} onClick={() => { onSelect(event); if (openOnSelect) onOpen(event); }}>
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
      {view === "list" && !openOnSelect && (
        <div aria-label="Mobile selected Event actions" className="portfolio-mobile-actions" role="region">
          <span>{selected.name}</span>
          <button type="button" onClick={() => onOpen(selected)}>Open workspace</button>
        </div>
      )}
    </div>
  );
}

export default function EventCollectionPrototype({
  events: liveEvents,
  onNewEvent,
  onOpen,
  initialShowClosed = false,
  initialShowCancelled = false,
  openOnSelect = false,
}: {
  events?: EventCollectionItem[];
  onNewEvent?: () => void;
  onOpen?: (event: EventCollectionItem) => void;
  initialShowClosed?: boolean;
  initialShowCancelled?: boolean;
  openOnSelect?: boolean;
}) {
  const params = new URLSearchParams(window.location.search);
  const initialVariant = params.get("variant");
  const variant: Variant = initialVariant === "A" || initialVariant === "B" || initialVariant === "C" ? initialVariant : "C";
  const [view, setView] = useState<View>(variant === "B" ? "calendar" : "list");
  const [showClosed, setShowClosed] = useState(initialShowClosed);
  const [showCancelled, setShowCancelled] = useState(initialShowCancelled);
  const [month, setMonth] = useState(8);
  const sourceEvents = liveEvents ?? prototypeEvents;
  const [selected, setSelected] = useState(sourceEvents[0]);
  const [notice, setNotice] = useState("");

  const visibleEvents = useMemo(
    () =>
      sourceEvents
        .filter((event) => (showClosed || event.status !== "Closed") && (showCancelled || event.status !== "Cancelled"))
        .sort((left, right) => {
          const month = (event: EventCollectionItem) =>
            event.date.includes("Jul") ? 7 : event.date.includes("Aug") ? 8 : 9;
          return month(left) * 100 + left.day - (month(right) * 100 + right.day);
        }),
    [showClosed, showCancelled, sourceEvents],
  );

  useEffect(() => {
    setSelected((current) =>
      sourceEvents.find((event) => event.id === current?.id) ?? sourceEvents[0],
    );
  }, [sourceEvents]);

  if (!selected) {
    return (
      <div className="collection-variant collection-variant-c">
        <header className="portfolio-header">
          <div><p>Events / Portfolio</p><h1>Event portfolio</h1><span>No Events scheduled yet.</span></div>
          <button className="collection-new-event" type="button" onClick={onNewEvent}><span>＋</span> New event</button>
        </header>
      </div>
    );
  }

  const props: VariantProps = {
    events: visibleEvents,
    view,
    month,
    showClosed,
    showCancelled,
    selected,
    onMonth: (direction) => setMonth((value) => Math.min(9, Math.max(7, value + direction))),
    onNewEvent: onNewEvent ?? (() => setNotice("New Event flow would open here.")),
    onOpen: onOpen ?? ((event) => setNotice(`Opening ${event.name} workspace…`)),
    onSelect: setSelected,
    onShowClosed: () => setShowClosed((value) => !value),
    onShowCancelled: () => setShowCancelled((value) => !value),
    onView: setView,
    openOnSelect,
  };

  return (
    <>
      {variant === "A" && <VariantA {...props} />}
      {variant === "B" && <VariantB {...props} />}
      {variant === "C" && <VariantC {...props} />}
      {notice && <button className="collection-notice" type="button" onClick={() => setNotice("")}>{notice}<span>Dismiss</span></button>}
    </>
  );
}
