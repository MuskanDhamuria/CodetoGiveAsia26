import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import AiCopilot from "./AiCopilot";
import EventCollectionPrototype from "./EventCollectionPrototype";
import EventCreationPrototype from "./EventCreationPrototype";
import EventTaskHierarchyPrototype from "./EventTaskHierarchyPrototype";
import EventOperationsMvp from "./EventOperationsMvp";
import AdminEventsPage from "./AdminEventsPage";
import { adminApi, type AdminApi, type DashboardSummary, type EventDetail, type UpcomingDeadline } from "./admin-api";
import VolunteerDirectory from "./VolunteerDirectory";
import VolunteerSignup from "./VolunteerSignup";
import PublicEventsPortal from "./PublicEventsPortal";
import VolunteerRegister from "./VolunteerRegister";
import VolunteerLogin from "./VolunteerLogin";
import VolunteerDashboard from "./VolunteerDashboard";

export type Page = "home" | "dashboard" | "events" | "volunteers" | "ai" | "signup" | "community" | "volunteer-register" | "volunteer-login" | "volunteer-dashboard";

const navLinks: { label: string; page: Page }[] = [
  { label: "Dashboard", page: "dashboard" },
  { label: "Events", page: "events" },
  { label: "Volunteers", page: "volunteers" },
];

const pageLabels: Record<Page, string> = {
  home: "Landing",
  dashboard: "Dashboard",
  events: "Events",
  volunteers: "Volunteers",
  ai: "AI Copilot",
  signup: "Volunteer Sign-Up",
  community: "Community Events",
  "volunteer-register": "Volunteer Registration",
  "volunteer-login": "Volunteer Sign In",
  "volunteer-dashboard": "Volunteer Dashboard",
};

function readInitialPage(pathname = window.location.pathname): Page {
  if (pathname === "/admin" || pathname === "/admin/") {
    return "home";
  }

  if (pathname.startsWith("/admin/")) {
    const adminPage = pathname.split("/")[2];
    return adminPage === "dashboard" || adminPage === "events" || adminPage === "volunteers" || adminPage === "ai"
      ? adminPage
      : "home";
  }

  if (pathname === "/community") return "community";
  if (pathname === "/signup") return "signup";
  if (pathname === "/volunteer-register") return "volunteer-register";
  if (pathname === "/volunteer-login") return "volunteer-login";
  if (pathname === "/volunteer-dashboard") return "volunteer-dashboard";

  const page = new URLSearchParams(window.location.search).get("page");
  return page === "dashboard" || page === "events" || page === "volunteers" || page === "ai" || page === "signup" || page === "community" || page === "volunteer-register" || page === "volunteer-login" || page === "volunteer-dashboard"
    ? page
    : "home";
}

const heroImage =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260626_041422_4a459e05-abce-4150-9fb7-4ededc423cd1.png&w=1280&q=85";

const activities = [
  "John Tan accepted invitation",
  "Reminder broadcast sent",
  "Certificates generated",
  "Health Fair registration reached 85%",
];

const insights = [
  { icon: "!", text: "Five volunteers have not responded." },
  { icon: "^", text: "Registration is lower than expected." },
  { icon: "*", text: "Reuse last year's National Day workflow." },
];

type FlowAction =
  | "create-event"
  | "invite-volunteers"
  | "generate-report"
  | "send-broadcast";

const quickActions: { label: string; action: FlowAction }[] = [
  { label: "Create Event", action: "create-event" },
  { label: "Invite Volunteers", action: "invite-volunteers" },
  { label: "Generate Report", action: "generate-report" },
  { label: "Send Broadcast", action: "send-broadcast" },
];

const events = [
  {
    name: "National Day Celebration 2027",
    date: "9 Aug 2027",
    venue: "Marina Bay Community Plaza",
    status: "Planning",
    progress: 68,
    volunteers: 126,
    participants: 850,
    readiness: 82,
  },
  {
    name: "Community Health Fair",
    date: "18 Sep 2027",
    venue: "Tampines Hub",
    status: "Recruiting",
    progress: 54,
    volunteers: 72,
    participants: 420,
    readiness: 71,
  },
  {
    name: "Beach Cleanup Drive",
    date: "2 Oct 2027",
    venue: "East Coast Park Area C",
    status: "On Track",
    progress: 81,
    volunteers: 94,
    participants: 300,
    readiness: 88,
  },
  {
    name: "Food Donation Sortathon",
    date: "15 Nov 2027",
    venue: "Central Warehouse",
    status: "Needs Attention",
    progress: 39,
    volunteers: 38,
    participants: 140,
    readiness: 56,
  },
];

const kanbanColumns = [
  {
    title: "To Plan",
    cards: ["Confirm stage layout", "Draft volunteer briefing", "Lock sponsor booth list"],
  },
  {
    title: "In Progress",
    cards: ["Recruit usher team", "Prepare broadcast schedule", "Collect performer profiles"],
  },
  {
    title: "Ready",
    cards: ["Venue permit approved", "First aid partner confirmed", "Certificate template approved"],
  },
];

const volunteers = [
  {
    name: "John Tan",
    email: "john.tan@example.com",
    phone: "+65 8123 4567",
    emergency: "Mei Tan, +65 9001 2345",
    photo:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&q=80",
    skills: ["First Aid", "Registration", "Crowd Control"],
    languages: ["English", "Mandarin", "Hokkien"],
    availability: "Weekends",
    previousEvents: 12,
    hours: 86,
    status: "Active",
    matchScore: 96,
    history: ["Health Fair 2026", "National Day 2026", "Food Drive 2025"],
  },
  {
    name: "Priya Nair",
    email: "priya.nair@example.com",
    phone: "+65 8234 5678",
    emergency: "Anil Nair, +65 9012 3456",
    photo:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80",
    skills: ["Photography", "Registration", "Team Leader"],
    languages: ["English", "Tamil", "Hindi"],
    availability: "Evenings",
    previousEvents: 9,
    hours: 64,
    status: "Available",
    matchScore: 91,
    history: ["Beach Cleanup Drive", "Impact Night", "Orientation Day"],
  },
  {
    name: "Marcus Lee",
    email: "marcus.lee@example.com",
    phone: "+65 8345 6789",
    emergency: "Samantha Lee, +65 9123 4567",
    photo:
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=240&q=80",
    skills: ["Logistics", "Crowd Control", "First Aid"],
    languages: ["English", "Mandarin", "Malay"],
    availability: "Weekdays",
    previousEvents: 15,
    hours: 118,
    status: "Active",
    matchScore: 94,
    history: ["National Day 2026", "Community Health Fair", "Town Hall"],
  },
  {
    name: "Aisha Rahman",
    email: "aisha.rahman@example.com",
    phone: "+65 8456 7890",
    emergency: "Nadia Rahman, +65 9234 5678",
    photo:
      "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=240&q=80",
    skills: ["Registration", "Logistics", "Photography"],
    languages: ["English", "Malay"],
    availability: "Flexible",
    previousEvents: 7,
    hours: 52,
    status: "Pending",
    matchScore: 87,
    history: ["Food Donation Sortathon", "Volunteer Training", "Health Fair"],
  },
];

const volunteerRecommendations = [
  "Registration Team",
  "Logistics Lead",
  "Photography",
  "Team Leader",
];

const copilotSuggestions: Record<
  Page,
  {
    scope: string;
    summary: string;
    action: string;
  }[]
> = {
  home: [
    {
      scope: "Getting started",
      summary:
        "I can help build your first volunteer event workflow from recruitment to impact reporting.",
      action: "Create Plan",
    },
  ],
  dashboard: [
    {
      scope: "Response Risk",
      summary: "Five volunteers haven't responded.",
      action: "Send Reminder",
    },
    {
      scope: "Registration Trend",
      summary: "Registration for Health Fair is lower than expected.",
      action: "Generate Broadcast",
    },
  ],
  events: [
    {
      scope: "Staffing Gap",
      summary: "Registration team is understaffed. Recommend assigning John Tan.",
      action: "Approve",
    },
    {
      scope: "Workflow Memory",
      summary:
        "Last year's National Day event experienced long registration queues. Reuse improved workflow?",
      action: "Approve",
    },
  ],
  volunteers: [
    {
      scope: "Role Match",
      summary:
        "Sarah Lim has extensive healthcare volunteering experience. Recommend assigning as Team Lead.",
      action: "Approve",
    },
    {
      scope: "Availability Conflict",
      summary: "John Tan is unavailable for this event. Find replacement volunteer.",
      action: "Approve",
    },
  ],
  ai: [
    {
      scope: "Command Ready",
      summary:
        "Ask me to draft outreach, find volunteer gaps, generate reports or prepare event runbooks.",
      action: "Start Task",
    },
  ],
};

function Navbar({
  activePage,
  onNavigate,
}: {
  activePage: Page;
  onNavigate: (page: Page) => void;
}) {
  return (
    <nav className="navbar" aria-label="Primary navigation">
      <div className="navbar-inner">
        <button
          className="logo"
          type="button"
          aria-label="Passion to Serve home"
          onClick={() => onNavigate("home")}
        >
          Passion to Serve<span className="logo-mark">R</span>
        </button>
        <div className="nav-links">
          {navLinks.map((link) => (
            <button
              className={activePage === link.page ? "active" : ""}
              key={link.label}
              type="button"
              onClick={() => onNavigate(link.page)}
            >
              {link.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function CurvedLines() {
  return (
    <>
      <div className="side-lines side-lines-left" aria-hidden="true">
        {Array.from({ length: 20 }, (_, index) => (
          <span
            key={`left-${index}`}
            style={{
              animationDelay: `${index * 0.25}s`,
              width: `${60 + index * 10}px`,
            }}
          />
        ))}
      </div>
      <div className="side-lines side-lines-right" aria-hidden="true">
        {Array.from({ length: 20 }, (_, index) => (
          <span
            key={`right-${index}`}
            style={{
              animationDelay: `${index * 0.25}s`,
              width: `${60 + index * 10}px`,
            }}
          />
        ))}
      </div>
      <div className="top-lines" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <span
            key={`top-${index}`}
            style={{
              animationDelay: `${index * 0.25}s`,
              width: `${72 + index * 12}px`,
            }}
          />
        ))}
      </div>
    </>
  );
}

function LandingPage({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <section
      className="hero"
      style={{ "--hero-image": `url("${heroImage}")` } as React.CSSProperties}
    >
      <CurvedLines />
      <div className="hero-content">
        <h1>
          <span className="title-line">Manage</span>
          <span className="title-line serif italic">Volunteer Events</span>
          <span className="title-line">with AI.</span>
        </h1>
        <p>
          Plan, coordinate and automate volunteer events-from recruitment and
          communications to certificates and impact reports-all in one
          intelligent platform.
        </p>
        <div className="cta-row">
          <button className="primary-cta" type="button" onClick={onGetStarted}>
            Get Started
          </button>
        </div>
      </div>
      <div className="hero-blur" aria-hidden="true" />
    </section>
  );
}

function KpiCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="kpi-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{helper}</span>
    </article>
  );
}

export function EventCalendar({
  events,
  onOpenWorkspace,
}: {
  events: EventDetail[];
  onOpenWorkspace: (eventId: number) => void;
}) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initialDate = (events.find((event) => event.status === "open") ?? events[0])?.event_date;
    return initialDate
      ? new Date(`${initialDate.slice(0, 7)}-01T00:00:00Z`)
      : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  });
  const [hasPositionedInitialMonth, setHasPositionedInitialMonth] = useState(events.length > 0);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const year = visibleMonth.getUTCFullYear();
  const month = visibleMonth.getUTCMonth();
  const leadingBlanks = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  const monthEvents = useMemo(() => {
    const grouped = new Map<number, EventDetail[]>();
    for (const event of events) {
      const [eventYear, eventMonth, eventDay] = event.event_date.split("-").map(Number);
      if (eventYear !== year || eventMonth !== month + 1) continue;
      grouped.set(eventDay, [...(grouped.get(eventDay) ?? []), event]);
    }
    return grouped;
  }, [events, month, year]);
  const selectedEvent = events.find((event) => event.id === selectedEventId);

  useEffect(() => {
    if (!events.length || hasPositionedInitialMonth) return;
    const nextEvent = events.find((event) => event.status === "open") ?? events[0];
    setVisibleMonth(new Date(`${nextEvent.event_date.slice(0, 7)}-01T00:00:00Z`));
    setHasPositionedInitialMonth(true);
  }, [events, hasPositionedInitialMonth]);

  function moveMonth(offset: number) {
    setSelectedEventId(null);
    setVisibleMonth(new Date(Date.UTC(year, month + offset, 1)));
  }

  return (
    <div className="calendar">
      <div className="calendar-top">
        <button aria-label="Previous month" type="button" onClick={() => moveMonth(-1)}>←</button>
        <h3>{new Intl.DateTimeFormat("en-SG", { month: "long", year: "numeric", timeZone: "UTC" }).format(visibleMonth)}</h3>
        <button aria-label="Next month" type="button" onClick={() => moveMonth(1)}>→</button>
      </div>
      <div className="calendar-grid calendar-days">
        {days.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((day, index) => (
          <div className="calendar-cell" key={`${day ?? "blank"}-${index}`}>
            {day && (
              <>
                <strong>{day}</strong>
                {monthEvents.get(day)?.map((event) => (
                  <button
                    aria-label={event.name}
                    className={`calendar-event-button ${event.status}`}
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedEventId(event.id)}
                  >
                    {event.name}
                  </button>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
      {selectedEvent && (
        <section
          aria-label={selectedEvent.name}
          aria-modal="false"
          className="calendar-event-preview"
          role="dialog"
        >
          <header>
            <span className={`calendar-preview-status ${selectedEvent.status}`}>{selectedEvent.status}</span>
            <button aria-label="Close Event preview" type="button" onClick={() => setSelectedEventId(null)}>×</button>
          </header>
          <h4>{selectedEvent.name}</h4>
          <dl>
            <div><dt>Date</dt><dd>{new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedEvent.event_date}T00:00:00Z`))}</dd></div>
            <div><dt>Venue</dt><dd>{selectedEvent.venue}</dd></div>
          </dl>
          <p>{selectedEvent.tasks.filter((task) => task.status === "done").length} of {selectedEvent.tasks.length} Tasks completed</p>
          <button className="calendar-preview-open" type="button" onClick={() => onOpenWorkspace(selectedEvent.id)}>Open workspace</button>
        </section>
      )}
    </div>
  );
}

export function DashboardPage({
  onQuickAction,
  onOpenEvent,
  api = adminApi,
}: {
  onQuickAction: (action: FlowAction) => void;
  onOpenEvent: (eventId: number) => void;
  api?: AdminApi;
}) {
  const [dashboardEvents, setDashboardEvents] = useState<EventDetail[]>([]);
  const [calendarError, setCalendarError] = useState("");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [dashboardDeadlines, setDashboardDeadlines] = useState<UpcomingDeadline[]>([]);
  const [deadlinesLoading, setDeadlinesLoading] = useState(true);
  const [deadlinesError, setDeadlinesError] = useState("");

  useEffect(() => {
    let active = true;
    api.listEvents()
      .then((events) => {
        if (active) setDashboardEvents(events);
      })
      .catch(() => {
        if (active) setCalendarError("Unable to load Events.");
      });
    api.getDashboardSummary()
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch(() => {
        if (active) setSummaryError("Unable to load dashboard summary.");
      });
    api.listUpcomingDeadlines()
      .then((items) => {
        if (active) setDashboardDeadlines(items);
      })
      .catch(() => {
        if (active) setDeadlinesError("Unable to load upcoming deadlines.");
      })
      .finally(() => {
        if (active) setDeadlinesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const dashboardKpis = summary ? [
    { label: "Upcoming Events", value: String(summary.upcoming_events), helper: "Scheduled from today" },
    { label: "Total Volunteers", value: String(summary.total_volunteers), helper: "Across all Events" },
    { label: "Pending Confirmations", value: String(summary.pending_volunteer_confirmations), helper: "Awaiting review" },
    { label: "Overdue Tasks", value: String(summary.overdue_tasks), helper: "Needs attention" },
    { label: "Tasks Due Soon", value: String(summary.tasks_due_soon), helper: "Within 14 days" },
  ] : [];

  return (
    <section className="dashboard-page">
      <div className="dashboard-shell">
        <header className="dashboard-hero">
          <p>Dashboard</p>
          <h1>Welcome back Sarah!</h1>
          <span>Here's what's happening across your events today.</span>
        </header>

        <div aria-label="Dashboard summary" className="kpi-grid dashboard-kpi-strip">
          {dashboardKpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
          {!summary && !summaryError && Array.from({ length: 5 }, (_, index) => <article aria-label="Loading metric" className="kpi-card dashboard-kpi-loading" key={index}><span>Loading…</span></article>)}
        </div>
        {summaryError && <p className="dashboard-data-error" role="alert">{summaryError}</p>}

        <div className="dashboard-main-grid">
          <div className="dashboard-card calendar-card">
            <EventCalendar events={dashboardEvents} onOpenWorkspace={onOpenEvent} />
            {calendarError && <p role="alert">{calendarError}</p>}
          </div>
          <aside className="dashboard-side">
            <div className="dashboard-card">
              <h2>Upcoming Deadlines</h2>
              <div className="deadline-list">
                {dashboardDeadlines.map((deadline) => (
                  <button aria-label={`${deadline.name} for ${deadline.event_name}`} className="deadline-item deadline-button" key={deadline.id} type="button" onClick={() => onOpenEvent(deadline.event_id)}>
                    <span><strong>{deadline.name}</strong><small>{deadline.event_name}</small></span>
                    <time dateTime={deadline.due_at}>{new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${deadline.due_at.slice(0, 10)}T00:00:00Z`))}</time>
                  </button>
                ))}
                {deadlinesLoading && <p role="status">Loading deadlines…</p>}
                {!deadlinesLoading && !deadlinesError && !dashboardDeadlines.length && <p>No Tasks due in the next 14 days.</p>}
                {deadlinesError && <p className="dashboard-data-error" role="alert">{deadlinesError}</p>}
              </div>
            </div>
            <div className="dashboard-card">
              <h2>Recent Activity Feed</h2>
              <div className="activity-list">
                {activities.map((activity) => (
                  <p key={activity}>{activity}</p>
                ))}
              </div>
            </div>
          </aside>
        </div>

        <div className="dashboard-card ai-card">
          <div>
            <p>AI Insights</p>
            <h2>Recommended next moves</h2>
          </div>
          <div className="insight-list">
            {insights.map((insight) => (
              <article key={insight.text}>
                <strong>{insight.icon}</strong>
                <span>{insight.text}</span>
              </article>
            ))}
          </div>
        </div>

        <section className="quick-actions">
          <h2>Quick Actions</h2>
          <div className="quick-action-grid">
            {quickActions.map((quickAction) => (
              <button
                key={quickAction.label}
                type="button"
                onClick={() => onQuickAction(quickAction.action)}
              >
                {quickAction.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function EventCard({
  event,
  isSelected,
  onSelect,
}: {
  event: (typeof events)[number];
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`event-card ${isSelected ? "selected" : ""}`}
      type="button"
      onClick={onSelect}
    >
      <div className="event-card-top">
        <div>
          <h2>{event.name}</h2>
          <p>{event.date}</p>
        </div>
        <span>{event.status}</span>
      </div>
      <dl className="event-meta">
        <div>
          <dt>Venue</dt>
          <dd>{event.venue}</dd>
        </div>
        <div>
          <dt>Volunteers</dt>
          <dd>{event.volunteers}</dd>
        </div>
        <div>
          <dt>Participants</dt>
          <dd>{event.participants}</dd>
        </div>
      </dl>
      <div className="event-progress">
        <div>
          <span>Progress</span>
          <strong>{event.progress}%</strong>
        </div>
        <i>
          <b style={{ width: `${event.progress}%` }} />
        </i>
      </div>
    </button>
  );
}

function EventsPage({ initialEventIndex }: { initialEventIndex: number | null }) {
  const prototype = new URLSearchParams(window.location.search).get("prototype");
  if (!prototype) {
    return <AdminEventsPage initialEventId={initialEventIndex} />;
  }
  if (prototype === "event-collection") {
    return <EventCollectionPrototype />;
  }

  const isCollectionPrototype = prototype === "event-collection";
  const isTaskPrototype =
    new URLSearchParams(window.location.search).get("prototype") ===
    "task-hierarchy";
  const isCreationPrototype =
    prototype === "event-creation";
  if (prototype === "operations") {
    return <EventOperationsMvp />;
  }
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    isTaskPrototype ? 0 : initialEventIndex,
  );
  const selectedEvent =
    selectedIndex === null ? null : events[selectedIndex];

  if (isCollectionPrototype) {
    return <EventCollectionPrototype />;
  }

  if (isCreationPrototype) {
    return <EventCreationPrototype />;
  }

  return (
    <section className="events-page">
      <div className="dashboard-shell">
        <header className="section-hero">
          <p>Events</p>
          <h1>Event Command Centre</h1>
          <span>
            Track every activity from planning and recruitment to day-of
            readiness.
          </span>
        </header>

        <section className="event-list-section">
          <div className="section-heading">
            <h2>Event List</h2>
            <span>{events.length} active events</span>
          </div>
          <div className="event-list">
            {events.map((event, index) => (
              <EventCard
                event={event}
                isSelected={false}
                key={event.name}
                onSelect={() => setSelectedIndex(index)}
              />
            ))}
          </div>
        </section>

        {selectedEvent && (
          <div
            className={`workspace-modal ${
              isTaskPrototype ? "prototype-workspace-modal" : ""
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-title"
          >
            <button
              className="workspace-backdrop"
              type="button"
              aria-label="Close event workspace"
              onClick={() => setSelectedIndex(null)}
            />
            <section className="event-workspace">
              <div className="workspace-header">
                <div>
                  <p>Event Workspace</p>
                  <h1 id="workspace-title">{selectedEvent.name}</h1>
                </div>
                <div className="workspace-actions">
                  <span className="status-badge">{selectedEvent.status}</span>
                  <button type="button" onClick={() => setSelectedIndex(null)}>
                    Close
                  </button>
                </div>
              </div>

              <div className="workspace-stats">
                <article>
                  <span>Event Date</span>
                  <strong>{selectedEvent.date}</strong>
                </article>
                <article>
                  <span>Venue</span>
                  <strong>{selectedEvent.venue}</strong>
                </article>
                <article>
                  <span>Readiness Score</span>
                  <strong>{selectedEvent.readiness}%</strong>
                </article>
                <article>
                  <span>Status Badge</span>
                  <strong>{selectedEvent.status}</strong>
                </article>
              </div>

              {isTaskPrototype ? (
                <EventTaskHierarchyPrototype />
              ) : (
                <div className="kanban-board">
                  {kanbanColumns.map((column) => (
                    <section className="kanban-column" key={column.title}>
                      <h2>{column.title}</h2>
                      <div>
                        {column.cards.map((card) => (
                          <article key={card}>{card}</article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

function VolunteerAvailabilityCalendar() {
  const availableDays = new Set([3, 4, 7, 10, 11, 17, 18, 24, 25, 31]);
  const cells = [
    ...Array.from({ length: 2 }, () => null),
    ...Array.from({ length: 31 }, (_, index) => index + 1),
  ];

  return (
    <div className="volunteer-calendar">
      <div className="calendar-top">
        <h3>August 2027</h3>
        <span>Availability Calendar</span>
      </div>
      <div className="calendar-grid calendar-days">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((day, index) => (
          <div
            className={`availability-cell ${
              day && availableDays.has(day) ? "available" : ""
            }`}
            key={`${day ?? "blank"}-${index}`}
          >
            {day}
          </div>
        ))}
      </div>
    </div>
  );
}

function VolunteersPage() {
  return (
    <section className="volunteers-page">
      <div className="dashboard-shell">
        <header className="section-hero">
          <p>Volunteers</p>
          <h1>Volunteer directory</h1>
          <span>
            Every volunteer in the database. Filter by event to see who is
            taking part.
          </span>
        </header>
        <VolunteerDirectory />
      </div>
    </section>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="placeholder-page">
      <h1>{title}</h1>
      <p>This page is ready to be built next.</p>
    </section>
  );
}

function AdminPanel() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const isAdminRoute = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  const [activePage, setActivePage] = useState<Page>(() => readInitialPage(location.pathname));
  const [openEventIndex, setOpenEventIndex] = useState<number | null>(null);
  const [openVolunteerIndex, setOpenVolunteerIndex] = useState<number | null>(
    null,
  );

  useEffect(() => {
    setActivePage(readInitialPage(location.pathname));
  }, [location.pathname]);

  function navigate(page: Page) {
    if (isAdminRoute && (page === "home" || page === "dashboard" || page === "events" || page === "volunteers" || page === "ai")) {
      routerNavigate(page === "home" ? "/admin" : `/admin/${page}`);
      if (page !== "events") setOpenEventIndex(null);
      if (page !== "volunteers") setOpenVolunteerIndex(null);
      return;
    }

    const publicRoutes: Partial<Record<Page, string>> = {
      home: "/admin",
      community: "/community",
      signup: "/signup",
      "volunteer-register": "/volunteer-register",
      "volunteer-login": "/volunteer-login",
      "volunteer-dashboard": "/volunteer-dashboard",
    };
    const route = publicRoutes[page];
    if (route) {
      routerNavigate(route);
      return;
    }

    setActivePage(page);
    if (page !== "events") setOpenEventIndex(null);
    if (page !== "volunteers") setOpenVolunteerIndex(null);
  }

  function navigateToSignup(eventId?: number) {
    const search = new URLSearchParams();
    if (eventId !== undefined) search.set("event", String(eventId));
    routerNavigate(`/signup${search.toString() ? `?${search}` : ""}`);
  }

  function navigateToVolunteerDashboard(eventId?: number) {
    const search = new URLSearchParams();
    if (eventId !== undefined) search.set("focusEvent", String(eventId));
    routerNavigate(`/volunteer-dashboard${search.toString() ? `?${search}` : ""}`);
  }

  function handleQuickAction(action: FlowAction) {
    if (action === "create-event") {
      setOpenEventIndex(0);
      navigate("events");
      return;
    }

    if (action === "invite-volunteers") {
      setOpenVolunteerIndex(0);
      navigate("volunteers");
      return;
    }

  }

  function openEventWorkspace(eventId: number) {
    setOpenEventIndex(eventId);
    navigate("events");
  }

  if (activePage === "signup") {
    return <VolunteerSignup />;
  }

  if (activePage === "volunteer-register") {
    return <VolunteerRegister onRegistered={() => navigateToVolunteerDashboard()} onLogin={() => navigate("volunteer-login")} />;
  }

  if (activePage === "volunteer-login") {
    return <VolunteerLogin onLoggedIn={() => navigateToVolunteerDashboard()} onRegister={() => navigate("volunteer-register")} />;
  }

  if (activePage === "volunteer-dashboard") {
    return <VolunteerDashboard onBack={() => navigate("community")} onSignIn={() => navigate("volunteer-login")} />;
  }

  if (activePage === "community") {
    return (
      <PublicEventsPortal
        onVolunteerSignup={() => navigate("volunteer-register")}
        onVolunteerDashboard={navigateToVolunteerDashboard}
        onEventSignup={navigateToSignup}
      />
    );
  }

  return (
    <main className={activePage === "home" ? "" : "product-app"}>
      <Navbar
        activePage={activePage}
        onNavigate={navigate}
      />
      {activePage === "home" && (
        <LandingPage onGetStarted={() => navigate("dashboard")} />
      )}
      {activePage !== "home" && (
        <div className="product-frame">
          <div className="product-page-content">
            {activePage === "dashboard" && (
              <DashboardPage onQuickAction={handleQuickAction} onOpenEvent={openEventWorkspace} />
            )}
            {activePage === "events" && (
              <EventsPage
                key={`events-${openEventIndex ?? "list"}`}
                initialEventIndex={openEventIndex}
              />
            )}
            {activePage === "volunteers" && <VolunteersPage />}
            {activePage === "ai" && <PlaceholderPage title="AI Copilot" />}
          </div>
          <AiCopilot activePage={activePage} />
        </div>
      )}
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LegacyRouteRedirect />} />
      <Route path="/admin" element={<AdminPanel />} />
      <Route path="/admin/*" element={<AdminPanel />} />
      <Route path="/community" element={<AdminPanel />} />
      <Route path="/signup" element={<AdminPanel />} />
      <Route path="/volunteer-register" element={<AdminPanel />} />
      <Route path="/volunteer-login" element={<AdminPanel />} />
      <Route path="/volunteer-dashboard" element={<AdminPanel />} />
      <Route path="*" element={<LegacyRouteRedirect />} />
    </Routes>
  );
}

function LegacyRouteRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const page = params.get("page");
  const routes: Record<string, string> = {
    dashboard: "/admin/dashboard",
    events: "/admin/events",
    volunteers: "/admin/volunteers",
    ai: "/admin/ai",
    community: "/community",
    signup: "/signup",
    "volunteer-register": "/volunteer-register",
    "volunteer-login": "/volunteer-login",
    "volunteer-dashboard": "/volunteer-dashboard",
  };
  const target = routes[page ?? ""] ?? "/admin";
  params.delete("page");
  const search = params.toString();
  return <Navigate to={`${target}${search ? `?${search}` : ""}`} replace />;
}
