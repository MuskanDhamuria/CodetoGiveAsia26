// Matches backend/API_ENDPOINTS.md's "Events" and "Participants and RSVPs"
// contract, implemented in backend/api/routes/{events,participants,public}.py.

export type EventStatus = "open" | "closed";

export type EventSummary = {
  id: number;
  name: string;
  venue: string;
  description: string | null;
  event_date: string;
  status: EventStatus;
};

export type EventForParticipant = EventSummary & {
  rsvp_status: boolean;
  attendance: boolean | null;
};

export type ListResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type ParticipantRecord = {
  id: number;
  name: string;
  contact_number: string | null;
  email: string | null;
};

export type PublicRsvpInput = {
  name: string;
  contact_number?: string | null;
  email?: string | null;
};

export type PublicRsvpResult = {
  participant_id: number;
  event_id: number;
  rsvp_status: boolean;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body?.detail ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Unfiltered — the browse page buckets/groups upcoming vs. past client-side
// (see EventBrowseList) so both List and Calendar views work off one fetch.
export function getAllEvents(): Promise<ListResponse<EventSummary>> {
  return request(`/events?order=asc&limit=100`);
}

export function getEvent(eventId: number): Promise<EventSummary> {
  return request(`/events/${eventId}`);
}

export function publicRsvp(eventId: number, input: PublicRsvpInput): Promise<PublicRsvpResult> {
  return request(`/public/events/${eventId}/rsvp`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function registerForEvent(eventId: number, participantId: number): Promise<unknown> {
  return request(`/events/${eventId}/participants`, {
    method: "POST",
    body: JSON.stringify({ participant_id: participantId, rsvp_status: true }),
  });
}

export function cancelRegistration(eventId: number, participantId: number): Promise<unknown> {
  return request(`/events/${eventId}/participants/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify({ rsvp_status: false }),
  });
}

export function getMyEvents(participantId: number): Promise<ListResponse<EventForParticipant>> {
  return request(`/participants/${participantId}/events?limit=100`);
}

// Exact, side-effect-free lookup used to restore local identity ("sign in")
// without RSVPing to an event. Throws ApiError(404) if no participant has
// this contact number.
export function lookupParticipant(contactNumber: string): Promise<ParticipantRecord> {
  return request(`/participants/lookup?contact_number=${encodeURIComponent(contactNumber)}`);
}
