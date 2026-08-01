import { useEffect, useState, type ChangeEvent } from "react";
import AiCopilot from "./AiCopilot";
import EventCollectionPrototype from "./EventCollectionPrototype";
import EventCreationPrototype from "./EventCreationPrototype";
import EventTaskHierarchyPrototype from "./EventTaskHierarchyPrototype";
import EventOperationsMvp from "./EventOperationsMvp";

export type Page =
  | "home"
  | "dashboard"
  | "events"
  | "volunteers"
  | "reports"
  | "ai";

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
  reports: "Reports",
  ai: "AI Copilot",
};

function readInitialPage(): Page {
  const page = new URLSearchParams(window.location.search).get("page");
  return page === "dashboard" ||
    page === "events" ||
    page === "volunteers" ||
    page === "reports" ||
    page === "ai"
    ? page
    : "home";
}

const heroImage =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260626_041422_4a459e05-abce-4150-9fb7-4ededc423cd1.png&w=1280&q=85";

const kpis = [
  { label: "Active Events", value: "6", helper: "Running this month" },
  { label: "Upcoming Events", value: "14", helper: "Next 30 days" },
  { label: "Total Volunteers", value: "312", helper: "Across all events" },
  { label: "Pending Volunteer Confirmations", value: "27", helper: "Awaiting replies" },
];

const calendarEvents: Record<number, string[]> = {
  3: ["Health Fair"],
  7: ["Beach Cleanup"],
  12: ["Food Drive"],
  15: ["Volunteer Training"],
  18: ["Health Fair"],
  22: ["Town Hall"],
  26: ["Orientation"],
  28: ["Impact Night"],
};

const deadlines = [
  { label: "Health Fair volunteer slots close", date: "Jul 3" },
  { label: "Beach Cleanup briefing pack due", date: "Jul 5" },
  { label: "Food Drive venue confirmation", date: "Jul 10" },
  { label: "Workshop registration closes", date: "Jul 13" },
];

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

const completedEvents = [
  {
    id: 101,
    name: "Community Health Fair 2026",
    date: "18 Jul 2026",
    venue: "Tampines Hub",
    reportStatus: "Incomplete",
    attendees: 620,
    volunteers: 86,
    fundsRaised: "$18,400",
    beneficiaries: 430,
    workshops: 12,
    partners: ["Tampines Hub", "CareWell Clinic", "SMU Volunteers"],
    photos: ["Registration", "Health screenings", "Volunteer teams"],
    quote:
      "The event made health checks feel accessible and friendly for everyone.",
    nextAction: "Generate publicity pack",
  },
  {
    id: 102,
    name: "Beach Cleanup Drive 2026",
    date: "4 Jul 2026",
    venue: "East Coast Park Area C",
    reportStatus: "Incomplete",
    attendees: 340,
    volunteers: 104,
    fundsRaised: "$6,250",
    beneficiaries: 900,
    workshops: 3,
    partners: ["NParks", "GreenSG", "Coastal Action Network"],
    photos: ["Opening briefing", "Cleanup zones", "Closing weigh-in"],
    quote:
      "Seeing everyone work together made environmental action feel possible.",
    nextAction: "Generate publicity pack",
  },
  {
    id: 103,
    name: "Food Donation Sortathon 2026",
    date: "21 Jun 2026",
    venue: "Central Warehouse",
    reportStatus: "Complete",
    attendees: 180,
    volunteers: 52,
    fundsRaised: "$9,800",
    beneficiaries: 760,
    workshops: 4,
    partners: ["Food From The Heart", "Central Warehouse", "Youth Corps"],
    photos: ["Sorting line", "Packing teams", "Distribution handover"],
    quote:
      "Every packed bundle felt like a practical expression of care.",
    nextAction: "Review generated pack",
  },
  {
    id: 104,
    name: "Volunteer Training Day 2026",
    date: "7 Jun 2026",
    venue: "SMU School of Accountancy",
    reportStatus: "Complete",
    attendees: 210,
    volunteers: 38,
    fundsRaised: "$3,100",
    beneficiaries: 210,
    workshops: 8,
    partners: ["SMU", "Community Leadership Circle"],
    photos: ["Workshop rooms", "Mentor circles", "Certificate moment"],
    quote:
      "The training gave me confidence to lead calmly on event day.",
    nextAction: "Review generated pack",
  },
] as const;

type CompletedEvent = {
  id: number;
  name: string;
  date: string;
  venue: string;
  reportStatus: "Complete" | "Incomplete";
  attendees: number;
  volunteers: number;
  fundsRaised?: string;
  beneficiaries?: number;
  workshops?: number;
  partners: string[];
  photos: string[];
  quote?: string;
  nextAction: string;
  generatedCaption?: string;
};

type CompletedEventReportResponse = {
  id: number;
  name: string;
  date: string;
  venue: string;
  report_status: "Complete" | "Incomplete";
  attendees: number;
  volunteers: number;
  partners: string[];
  generated_caption: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";

type UploadedPhoto = {
  id: string;
  name: string;
  mimeType: string;
  src: string;
};

type PhotoCaptionResult = {
  caption: string;
  altText: string;
};

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
  reports: [
    {
      scope: "Publicity Pack",
      summary:
        "Two completed events still need social media and donor-facing copy.",
      action: "Generate Drafts",
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

function Calendar() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const leadingBlanks = 1;
  const cells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: 31 }, (_, index) => index + 1),
  ];

  return (
    <div className="calendar">
      <div className="calendar-top">
        <h3>July 2026</h3>
        <span>Monthly Calendar</span>
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
                {calendarEvents[day]?.map((event) => (
                  <span key={event}>{event}</span>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardPage({
  onQuickAction,
}: {
  onQuickAction: (action: FlowAction) => void;
}) {
  return (
    <section className="dashboard-page">
      <div className="dashboard-shell">
        <header className="dashboard-hero">
          <p>Dashboard</p>
          <h1>Welcome back Sarah!</h1>
          <span>Here's what's happening across your events today.</span>
        </header>

        <div className="kpi-grid">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </div>

        <div className="dashboard-main-grid">
          <div className="dashboard-card calendar-card">
            <Calendar />
          </div>
          <aside className="dashboard-side">
            <div className="dashboard-card">
              <h2>Upcoming Deadlines</h2>
              <div className="deadline-list">
                {deadlines.map((deadline) => (
                  <div className="deadline-item" key={deadline.label}>
                    <span>{deadline.label}</span>
                    <strong>{deadline.date}</strong>
                  </div>
                ))}
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
    return <EventOperationsMvp />;
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

function PublicityPack({
  event,
  isReportComplete,
  onMarkComplete,
}: {
  event: CompletedEvent;
  isReportComplete: boolean;
  onMarkComplete: () => void;
}) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhoto[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [photoCaptions, setPhotoCaptions] = useState<
    Record<string, PhotoCaptionResult>
  >({});
  const [isGeneratingPhotoCaption, setIsGeneratingPhotoCaption] =
    useState(false);
  const hashtagSource = event.partners
    .map((partner) => partner.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .slice(0, 2);
  const hashtags = [
    "#PassionToServe",
    "#VolunteerSG",
    ...hashtagSource.map((tag) => `#${tag}`),
  ];
  const caption =
    event.generatedCaption ||
    `${event.name} welcomed ${event.attendees} attendees with the support of ${event.volunteers} volunteers and partners ${event.partners.join(", ")}. Thank you to everyone who helped create a meaningful day of service and community connection. ${hashtags.join(" ")}`;
  const selectedPhoto =
    uploadedPhotos.find((photo) => photo.id === selectedPhotoId) ??
    uploadedPhotos[0] ??
    null;
  const fallbackPhotoCaption = selectedPhoto
    ? `AI photo description is unavailable right now. Uploaded photo ${selectedPhoto.name} is attached to ${event.name}; retry when the backend is connected to generate a scene-specific caption.`
    : "";
  const fallbackPhotoAltText = selectedPhoto
    ? `Uploaded event photo file: ${selectedPhoto.name}.`
    : "";
  const selectedPhotoCaption = selectedPhoto
    ? photoCaptions[selectedPhoto.id]?.caption ?? fallbackPhotoCaption
    : "";
  const selectedPhotoAltText = selectedPhoto
    ? photoCaptions[selectedPhoto.id]?.altText ?? fallbackPhotoAltText
    : "";

  useEffect(() => {
    setUploadedPhotos([]);
    setSelectedPhotoId(null);
    setPhotoCaptions({});
  }, [event.name]);

  function handlePhotoUpload(uploadEvent: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(uploadEvent.target.files ?? []);
    if (files.length === 0) return;

    Promise.all(
      files.map(
        (file) =>
          new Promise<UploadedPhoto>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: `${file.name}-${file.lastModified}-${file.size}`,
                name: file.name,
                mimeType: file.type || "image/jpeg",
                src: String(reader.result),
              });
            reader.readAsDataURL(file);
          }),
      ),
    ).then((photos) => {
      setUploadedPhotos((current) => [...current, ...photos]);
      setSelectedPhotoId((current) => current ?? photos[0]?.id ?? null);
    });

    uploadEvent.target.value = "";
  }

  function removeUploadedPhoto(photoId: string) {
    setUploadedPhotos((current) => {
      const next = current.filter((photo) => photo.id !== photoId);
      setSelectedPhotoId((currentSelectedPhotoId) => {
        if (currentSelectedPhotoId !== photoId) return currentSelectedPhotoId;
        return next[0]?.id ?? null;
      });
      return next;
    });
  }

  useEffect(() => {
    if (!selectedPhoto || photoCaptions[selectedPhoto.id]) return;
    const imageData = selectedPhoto.src.split(",")[1] ?? selectedPhoto.src;

    setIsGeneratingPhotoCaption(true);
    fetch(`${API_BASE_URL}/reports/${event.id}/photo-caption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name: selectedPhoto.name,
        mime_type: selectedPhoto.mimeType,
        image_data: imageData,
        event_name: event.name,
        venue: event.venue,
        attendees: event.attendees,
        volunteers: event.volunteers,
        partners: event.partners,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to generate photo caption");
        }
        return response.json() as Promise<{
          caption: string;
          alt_text: string;
        }>;
      })
      .then((result) => {
        setPhotoCaptions((current) => ({
          ...current,
          [selectedPhoto.id]: {
            caption: result.caption,
            altText: result.alt_text,
          },
        }));
      })
      .catch(() => {
        setPhotoCaptions((current) => ({
          ...current,
          [selectedPhoto.id]: {
            caption: fallbackPhotoCaption,
            altText: fallbackPhotoAltText,
          },
        }));
      })
      .finally(() => setIsGeneratingPhotoCaption(false));
  }, [
    event.id,
    fallbackPhotoAltText,
    fallbackPhotoCaption,
    photoCaptions,
    selectedPhoto,
  ]);

  async function copyContent(label: string, copy: string) {
    await navigator.clipboard?.writeText(copy);
    setCopiedLabel(label);
    window.setTimeout(() => setCopiedLabel(null), 1600);
  }

  return (
    <section
      className="publicity-pack"
      aria-label={`${event.name} publicity pack`}
    >
      <div className="pack-header">
        <div>
          <p>AI publicity material generator</p>
          <h2>{event.name}</h2>
          <span>
            Event report details with one ready-to-review caption and
            photo-based caption support.
          </span>
        </div>
        <button
          type="button"
          disabled={isReportComplete}
          onClick={onMarkComplete}
        >
          {isReportComplete ? "Report Complete" : "Mark Report Complete"}
        </button>
      </div>

      <div className="impact-summary-grid">
        {[
          ["Attendees", event.attendees],
          ["Volunteers", event.volunteers],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <section className="partner-panel">
        <h3>Partners</h3>
        <div>
          {event.partners.map((partner) => (
            <span key={partner}>{partner}</span>
          ))}
        </div>
      </section>

      <article className="caption-card">
        <div>
          <h3>Generated Caption</h3>
          <p>{caption}</p>
        </div>
        <button
          type="button"
          onClick={() => void copyContent("Generated Caption", caption)}
        >
          {copiedLabel === "Generated Caption" ? "Copied" : "Copy"}
        </button>
      </article>

      <section className="photo-assistant">
        <div className="photo-assistant-header">
          <div>
            <h3>Photo-based caption assistant</h3>
            <p>Upload or select event photos to generate captions and alt text.</p>
          </div>
          <label>
            <span>Upload Photos</span>
            <input
              multiple
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
            />
          </label>
        </div>

        {uploadedPhotos.length > 0 ? (
          <div className="photo-selection-grid">
            {uploadedPhotos.map((photo) => (
              <article className="photo-upload-card" key={photo.id}>
                <button
                  className={`photo-select-button ${
                    selectedPhoto?.id === photo.id ? "selected" : ""
                  }`}
                  type="button"
                  onClick={() => setSelectedPhotoId(photo.id)}
                >
                  <img src={photo.src} alt="" />
                  <span>{photo.name}</span>
                </button>
                <button
                  className="remove-photo-button"
                  aria-label={`Remove ${photo.name}`}
                  type="button"
                  onClick={() => removeUploadedPhoto(photo.id)}
                >
                  x
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="photo-upload-empty">
            Upload one or more event photos to generate a caption and alt text.
          </div>
        )}

        <div className="photo-output-grid">
          <article>
            <h4>Caption</h4>
            <p>
              {isGeneratingPhotoCaption
                ? "Generating AI caption..."
                : selectedPhoto
                  ? selectedPhotoCaption
                : "Your photo caption will appear here after upload."}
            </p>
          </article>
          <article>
            <h4>Alt Text</h4>
            <p>
              {isGeneratingPhotoCaption
                ? "Generating alt text..."
                : selectedPhoto
                  ? selectedPhotoAltText
                : "Alt text will appear here after upload."}
            </p>
          </article>
        </div>
      </section>
    </section>
  );
}

function ReportEventCard({
  event,
  isReportComplete,
  isSelected,
  onSelect,
}: {
  event: CompletedEvent;
  isReportComplete: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`report-event-card ${isSelected ? "selected" : ""}`}
      type="button"
      onClick={onSelect}
    >
      <div>
        <h3>{event.name}</h3>
        <p>
          {event.date} - {event.venue}
        </p>
      </div>
      <dl>
        <div>
          <dt>Attendees</dt>
          <dd>{event.attendees}</dd>
        </div>
        <div>
          <dt>Volunteers</dt>
          <dd>{event.volunteers}</dd>
        </div>
      </dl>
      <span>
        {isReportComplete ? "Review generated pack" : event.nextAction}
      </span>
    </button>
  );
}

function ReportsPage() {
  const [reportEvents, setReportEvents] = useState<CompletedEvent[]>(
    completedEvents.map((event) => ({ ...event })),
  );
  const [isLoadingReports, setIsLoadingReports] = useState(true);
  const [reportsSource, setReportsSource] = useState<"database" | "demo">(
    "demo",
  );
  const [completeReportNames, setCompleteReportNames] = useState(
    () =>
      new Set(
        completedEvents
          .filter((event) => event.reportStatus === "Complete")
          .map((event) => event.name),
      ),
  );
  const incompleteEvents = reportEvents.filter(
    (event) => !completeReportNames.has(event.name),
  );
  const completeEvents = reportEvents.filter(
    (event) => completeReportNames.has(event.name),
  );
  const [selectedEventName, setSelectedEventName] = useState(
    incompleteEvents[0]?.name ?? completedEvents[0].name,
  );
  const selectedEvent =
    reportEvents.find((event) => event.name === selectedEventName) ??
    reportEvents[0];

  useEffect(() => {
    fetch(`${API_BASE_URL}/reports/completed`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load completed reports");
        }
        return response.json() as Promise<CompletedEventReportResponse[]>;
      })
      .then((reports) => {
        if (reports.length === 0) {
          setReportsSource("demo");
          return;
        }

        const eventsFromDatabase = reports.map((report) => ({
          id: report.id,
          name: report.name,
          date: report.date,
          venue: report.venue,
          reportStatus: report.report_status,
          attendees: report.attendees,
          volunteers: report.volunteers,
          partners: report.partners,
          photos: ["Uploaded event photo"],
          nextAction: "Generate publicity caption",
          generatedCaption: report.generated_caption,
        }));
        setReportEvents(eventsFromDatabase);
        setCompleteReportNames(
          new Set(
            eventsFromDatabase
              .filter((event) => event.reportStatus === "Complete")
              .map((event) => event.name),
          ),
        );
        setSelectedEventName(eventsFromDatabase[0].name);
        setReportsSource("database");
      })
      .catch(() => {
        setReportsSource("demo");
      })
      .finally(() => setIsLoadingReports(false));
  }, []);

  function markSelectedReportComplete() {
    setCompleteReportNames((current) => {
      const next = new Set(current);
      next.add(selectedEvent.name);
      return next;
    });
    setReportEvents((current) =>
      current.map((event) =>
        event.id === selectedEvent.id
          ? { ...event, reportStatus: "Complete" }
          : event,
      ),
    );

    fetch(`${API_BASE_URL}/reports/${selectedEvent.id}/complete`, {
      method: "PUT",
    }).catch(() => undefined);
  }

  return (
    <section className="reports-page">
      <div className="dashboard-shell">
        <header className="section-hero">
          <p>Reports</p>
          <h1>Post-event publicity</h1>
          <span>
            Select a completed event to generate review-ready social media and
            impact material.
          </span>
          <small>
            {isLoadingReports
              ? "Loading completed events from database..."
              : reportsSource === "database"
                ? "Connected to database"
                : "Using demo report data until the API has completed events"}
          </small>
        </header>

        <div className="reports-layout">
          <aside className="report-event-list" aria-label="Completed events">
            <section>
              <div className="section-heading compact">
                <h2>Report Incomplete</h2>
                <span>{incompleteEvents.length} events</span>
              </div>
              <div className="report-event-stack">
                {incompleteEvents.map((event) => (
                  <ReportEventCard
                    event={event}
                    isReportComplete={completeReportNames.has(event.name)}
                    isSelected={selectedEvent.name === event.name}
                    key={event.name}
                    onSelect={() => setSelectedEventName(event.name)}
                  />
                ))}
              </div>
            </section>

            <section>
              <div className="section-heading compact">
                <h2>Report Complete</h2>
                <span>{completeEvents.length} events</span>
              </div>
              <div className="report-event-stack">
                {completeEvents.map((event) => (
                  <ReportEventCard
                    event={event}
                    isReportComplete={completeReportNames.has(event.name)}
                    isSelected={selectedEvent.name === event.name}
                    key={event.name}
                    onSelect={() => setSelectedEventName(event.name)}
                  />
                ))}
              </div>
            </section>
          </aside>

          <PublicityPack
            event={selectedEvent}
            isReportComplete={completeReportNames.has(selectedEvent.name)}
            onMarkComplete={markSelectedReportComplete}
          />
        </div>
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

function VolunteersPage({
  initialVolunteerIndex,
  onInviteToEvent,
  onMessageVolunteer,
}: {
  initialVolunteerIndex: number | null;
  onInviteToEvent: () => void;
  onMessageVolunteer: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    initialVolunteerIndex,
  );
  const selectedVolunteer =
    selectedIndex === null ? null : volunteers[selectedIndex];
  const filteredVolunteers = volunteers.filter((volunteer) =>
    volunteer.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section className="volunteers-page">
      <div className="dashboard-shell">
        <header className="section-hero">
          <p>Volunteers</p>
          <h1>Volunteer CRM</h1>
          <span>
            Search, segment and match volunteers to the right roles for every
            event.
          </span>
        </header>

        <section className="crm-toolbar" aria-label="Volunteer controls">
          <label className="search-field">
            <span>Search</span>
            <input
              placeholder="Search volunteers"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="filter-grid">
            {["Skills", "Languages", "Availability", "Experience"].map(
              (filter) => (
                <label key={filter}>
                  <span>{filter}</span>
                  <select defaultValue="All">
                    <option>All</option>
                    <option>High Match</option>
                    <option>Available</option>
                  </select>
                </label>
              ),
            )}
          </div>
        </section>

        <section className="volunteer-table-card">
          <div className="section-heading">
            <h2>Volunteer Table</h2>
            <span>{filteredVolunteers.length} volunteers</span>
          </div>
          <div className="volunteer-table-wrap">
            <table className="volunteer-table">
              <thead>
                <tr>
                  <th>Volunteer</th>
                  <th>Skills</th>
                  <th>Availability</th>
                  <th>Previous Events</th>
                  <th>Volunteer Hours</th>
                  <th>Status</th>
                  <th>AI Match Score</th>
                </tr>
              </thead>
              <tbody>
                {filteredVolunteers.map((volunteer) => {
                  const originalIndex = volunteers.findIndex(
                    (item) => item.name === volunteer.name,
                  );

                  return (
                    <tr
                      key={volunteer.name}
                      onClick={() => setSelectedIndex(originalIndex)}
                    >
                      <td>
                        <div className="volunteer-name">
                          <img src={volunteer.photo} alt="" />
                          <span>{volunteer.name}</span>
                        </div>
                      </td>
                      <td>{volunteer.skills.slice(0, 2).join(", ")}</td>
                      <td>{volunteer.availability}</td>
                      <td>{volunteer.previousEvents}</td>
                      <td>{volunteer.hours}</td>
                      <td>
                        <span className="table-status">{volunteer.status}</span>
                      </td>
                      <td>
                        <strong>{volunteer.matchScore}%</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {selectedVolunteer && (
          <div
            className="workspace-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="volunteer-profile-title"
          >
            <button
              className="workspace-backdrop"
              type="button"
              aria-label="Close volunteer profile"
              onClick={() => setSelectedIndex(null)}
            />
            <section className="volunteer-profile">
              <div className="profile-header">
                <div className="profile-identity">
                  <img src={selectedVolunteer.photo} alt="" />
                  <div>
                    <p>Volunteer Profile</p>
                    <h1 id="volunteer-profile-title">
                      {selectedVolunteer.name}
                    </h1>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedIndex(null)}>
                  Close
                </button>
              </div>

              <div className="profile-grid">
                <section className="profile-panel">
                  <h2>Contact Details</h2>
                  <dl className="profile-details">
                    <div>
                      <dt>Email</dt>
                      <dd>{selectedVolunteer.email}</dd>
                    </div>
                    <div>
                      <dt>Phone</dt>
                      <dd>{selectedVolunteer.phone}</dd>
                    </div>
                    <div>
                      <dt>Emergency Contact</dt>
                      <dd>{selectedVolunteer.emergency}</dd>
                    </div>
                    <div>
                      <dt>Languages</dt>
                      <dd>{selectedVolunteer.languages.join(", ")}</dd>
                    </div>
                  </dl>
                </section>

                <section className="profile-panel">
                  <h2>Skills</h2>
                  <div className="skill-list">
                    {[
                      "First Aid",
                      "Registration",
                      "Photography",
                      "Logistics",
                      "Crowd Control",
                    ].map((skill) => (
                      <span
                        className={
                          selectedVolunteer.skills.includes(skill)
                            ? "matched"
                            : ""
                        }
                        key={skill}
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </section>

                <section className="profile-panel">
                  <h2>Volunteer History</h2>
                  <div className="history-grid">
                    {selectedVolunteer.history.map((event) => (
                      <article key={event}>
                        <strong>{event}</strong>
                        <span>Completed</span>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="profile-panel">
                  <VolunteerAvailabilityCalendar />
                </section>
              </div>

              <section className="profile-panel recommendations-panel">
                <div>
                  <p>AI Recommendations</p>
                  <h2>Perfect for</h2>
                </div>
                <div className="recommendation-list">
                  {volunteerRecommendations.map((recommendation) => (
                    <span key={recommendation}>{recommendation}</span>
                  ))}
                </div>
                <div className="profile-actions">
                  <button type="button" onClick={onInviteToEvent}>
                    Invite to Event
                  </button>
                  <button type="button" onClick={onMessageVolunteer}>
                    Message Volunteer
                  </button>
                </div>
              </section>
            </section>
          </div>
        )}
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

export default function App() {
  const [activePage, setActivePage] = useState<Page>(readInitialPage);
  const [openEventIndex, setOpenEventIndex] = useState<number | null>(null);
  const [openVolunteerIndex, setOpenVolunteerIndex] = useState<number | null>(
    null,
  );

  function navigate(page: Page) {
    setActivePage(page);
    const url = new URL(window.location.href);
    if (page === "home") url.searchParams.delete("page");
    else url.searchParams.set("page", page);
    window.history.replaceState({}, "", url);
    if (page !== "events") setOpenEventIndex(null);
    if (page !== "volunteers") setOpenVolunteerIndex(null);
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

    if (action === "generate-report") {
      navigate("reports");
      return;
    }

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
              <DashboardPage onQuickAction={handleQuickAction} />
            )}
            {activePage === "events" && (
              <EventsPage
                key={`events-${openEventIndex ?? "list"}`}
                initialEventIndex={openEventIndex}
              />
            )}
            {activePage === "volunteers" && (
              <VolunteersPage
                key={`volunteers-${openVolunteerIndex ?? "list"}`}
                initialVolunteerIndex={openVolunteerIndex}
                onInviteToEvent={() => {
                  setOpenEventIndex(0);
                  navigate("events");
                }}
                onMessageVolunteer={() => undefined}
              />
            )}
            {activePage === "reports" && <ReportsPage />}
            {activePage === "ai" && <PlaceholderPage title="AI Copilot" />}
          </div>
          <AiCopilot activePage={activePage} />
        </div>
      )}
    </main>
  );
}
