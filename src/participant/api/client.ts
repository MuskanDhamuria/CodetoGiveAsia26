// Matches backend/API_ENDPOINTS.md's "Events" and "Participants and RSVPs"
// contract, implemented in backend/api/routes/{events,participants,public}.py.

export type EventStatus = "open" | "closed";

export type EventSummary = {
  id: number;
  name: string;
  venue: string;
  description: string | null;
  event_date: string;
  event_time: string | null;
  status: EventStatus;
  is_cancelled: boolean;
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

export type PublicSignupInput = {
  name: string;
  contact_number?: string | null;
  email?: string | null;
};

export type PublicSignupResult = {
  participant_id: number;
  participant_name: string;
  participant_contact_number: string | null;
  participant_email: string | null;
  // False whenever a phone number was given and hasn't been verified yet.
  // verify_token is the opaque, one-time credential the verify/resend-otp
  // calls need — participants have no login session, so this stands in for
  // one. See backend/api/routes/public.py.
  phone_verified: boolean;
  verify_token: string | null;
};

export type PublicOtpResult = {
  phone_verified: boolean;
  verify_token: string | null;
};

export type PublicRsvpResult = {
  participant_id: number;
  // The participant record actually matched/created by the backend — may
  // differ from what was submitted if this contact number/email already
  // belonged to an existing participant. Always prefer these over the
  // locally-typed form values. See docs/tickets.md TICKET-12/TICKET-15.
  participant_name: string;
  participant_contact_number: string | null;
  participant_email: string | null;
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

export function publicSignup(input: PublicSignupInput): Promise<PublicSignupResult> {
  return request(`/public/signup`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function verifyParticipantOtp(
  participantId: number,
  verifyToken: string,
  code: string,
): Promise<PublicOtpResult> {
  return request(`/public/participants/${participantId}/verify-otp`, {
    method: "POST",
    body: JSON.stringify({ verify_token: verifyToken, code }),
  });
}

export function resendParticipantOtp(
  participantId: number,
  verifyToken: string,
): Promise<PublicOtpResult> {
  return request(`/public/participants/${participantId}/resend-otp`, {
    method: "POST",
    body: JSON.stringify({ verify_token: verifyToken }),
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

// Signed token an admin's QR scanner reads back to mark this participant
// present at the event, without either side needing to type an id/phone
// number by hand.
export function getAttendanceQrToken(
  participantId: number,
  eventId: number,
): Promise<{ token: string }> {
  return request(`/participants/${participantId}/events/${eventId}/qr-token`);
}

export type ParticipantProfileUpdate = {
  name?: string;
  contact_number?: string | null;
  email?: string | null;
};

export function updateParticipant(
  participantId: number,
  input: ParticipantProfileUpdate,
): Promise<ParticipantRecord> {
  return request(`/participants/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// Throws ApiError(404) if no certificate has been issued for this
// participant/event yet — admin generates certificates in bulk per event,
// this doesn't create one.
export function getParticipantCertificate(
  participantId: number,
  eventId: number,
): Promise<{ link: string }> {
  return request(`/participants/${participantId}/events/${eventId}/certificate`);
}
