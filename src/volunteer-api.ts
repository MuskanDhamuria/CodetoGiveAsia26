// Typed client for the volunteer-segment backend (FastAPI, /api/v1).
// Response shapes mirror backend/api/routes/*.py exactly.

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8000/api/v1"

export type ListEnvelope<T> = {
  items: T[]
  total: number
  limit: number
  offset: number
}

export type EventSummary = {
  id: number
  name: string
  venue: string
  event_date: string
  description: string
  start_time: string | null
  end_time: string | null
  status: string
  beneficiary_id: number | null
}

export type Beneficiary = {
  id: number
  name: string
}

export type VolunteerCounts = {
  events_signed_up: number
  events_approved: number
  events_attended: number
}

export type VolunteerListItem = {
  id: number
  name: string
  contact_number: string | null
  email: string | null
  signup_status: string
  skills: string[]
  counts: VolunteerCounts
}

export type VolunteerSkill = {
  id: number
  name: string
}

export type VolunteerRoleInterest = {
  role_id: number
  name: string
  is_lead: boolean
}

export type VolunteerDetail = {
  id: number
  name: string
  contact_number: string | null
  email: string | null
  signup_status: string
  skills: VolunteerSkill[]
  interests: VolunteerRoleInterest[]
  counts: VolunteerCounts
}

export type VolunteerEventHistory = {
  signup_id: number
  event_id: number
  event_name: string
  event_date: string
  status: string
  assigned_role_id: number | null
  assigned_role_name: string | null
  preferred_role_names: string[]
  is_leader: boolean
  attendance: boolean | null
}

export type Signup = {
  id: number
  event_id: number
  volunteer_id: number
  volunteer_name: string
  status: "requested" | "approved" | "rejected"
  assigned_role_id: number | null
  assigned_role_name: string | null
  is_leader: boolean
  attendance: boolean | null
}

export type Participation = {
  participant_id: number
  name: string
  contact_number: string | null
  email: string | null
  rsvp_status: boolean
  attendance: boolean | null
}

export type Role = {
  id: number
  name: string
  category: string
  is_required: boolean
}

export type VolunteerAccount = {
  id: number
  volunteer_id: number
  name: string
  contact_number: string | null
  email: string | null
}

export type VolunteerAuthResult = {
  access_token: string
  volunteer: VolunteerAccount
}

export type VolunteerDashboardEvent = {
  signup_id: number
  event_id: number
  event_name: string
  venue: string
  event_date: string
  event_status: string
  signup_status: string
  assigned_role_name: string | null
  attendance: boolean | null
}

export type VolunteerDashboard = {
  volunteer: VolunteerAccount
  active_events: VolunteerDashboardEvent[]
  past_events: VolunteerDashboardEvent[]
  has_approved_event: boolean
}

const VOLUNTEER_TOKEN_KEY = "pts_volunteer_access_token"

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body) => body.detail as string)
      .catch(() => response.statusText)
    throw new Error(detail || `Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function getJson<T>(path: string): Promise<T> {
  return fetch(`${API_BASE}${path}`).then((response) => handle<T>(response))
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((response) => handle<T>(response))
}

async function deleteRequest(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { method: "DELETE" })
  if (!response.ok) await handle<never>(response)
}

function authorizedHeaders() {
  const token = getVolunteerToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function authorizedGet<T>(path: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, { headers: authorizedHeaders() }).then((response) => handle<T>(response))
}

export function getVolunteerToken() {
  return window.localStorage.getItem(VOLUNTEER_TOKEN_KEY)
}

export function setVolunteerToken(token: string) {
  window.localStorage.setItem(VOLUNTEER_TOKEN_KEY, token)
}

export function clearVolunteerToken() {
  window.localStorage.removeItem(VOLUNTEER_TOKEN_KEY)
}

export function registerVolunteer(body: {
  name: string
  contact_number: string
  password: string
}): Promise<VolunteerAuthResult> {
  return postJson("/volunteer-auth/register", body)
}

export function loginVolunteer(body: {
  contact_number: string
  password: string
}): Promise<VolunteerAuthResult> {
  return postJson("/volunteer-auth/login", body)
}

export function getVolunteerMe(): Promise<VolunteerAccount> {
  return authorizedGet("/volunteer-auth/me")
}

export function getVolunteerDashboard(): Promise<VolunteerDashboard> {
  return authorizedGet("/volunteer-auth/dashboard")
}

export function listEvents(): Promise<ListEnvelope<EventSummary>> {
  return getJson("/events")
}

export function listBeneficiaries(): Promise<ListEnvelope<Beneficiary>> {
  return getJson("/beneficiaries")
}

export function listVolunteers(): Promise<ListEnvelope<VolunteerListItem>> {
  return getJson("/volunteers")
}

export function getVolunteer(volunteerId: number): Promise<VolunteerDetail> {
  return getJson(`/volunteers/${volunteerId}`)
}

export function listVolunteerEvents(
  volunteerId: number,
): Promise<ListEnvelope<VolunteerEventHistory>> {
  return getJson(`/volunteers/${volunteerId}/events`)
}

export function deleteVolunteer(volunteerId: number): Promise<void> {
  return deleteRequest(`/volunteers/${volunteerId}`)
}

export function listEventSignups(
  eventId: number,
  params: { status?: string } = {},
): Promise<ListEnvelope<Signup>> {
  const query = params.status ? `?status=${encodeURIComponent(params.status)}` : ""
  return getJson(`/events/${eventId}/volunteer-signups${query}`)
}

export function listEventParticipants(
  eventId: number,
): Promise<ListEnvelope<Participation>> {
  return getJson(`/events/${eventId}/participants`)
}

export function listEventRoles(eventId: number): Promise<Role[]> {
  return getJson(`/events/${eventId}/roles`)
}

export function addEventRole(eventId: number, name: string): Promise<Role> {
  return postJson(`/events/${eventId}/roles`, { name })
}

export function deleteEventRole(eventId: number, roleId: number): Promise<void> {
  return deleteRequest(`/events/${eventId}/roles/${roleId}`)
}

export function approveSignup(
  eventId: number,
  signupId: number,
  body: { assigned_role_id: number; is_leader?: boolean },
): Promise<Signup> {
  return postJson(`/events/${eventId}/volunteer-signups/${signupId}/approve`, body)
}

export function rejectSignup(eventId: number, signupId: number): Promise<Signup> {
  return postJson(`/events/${eventId}/volunteer-signups/${signupId}/reject`)
}

export function updateSignup(
  eventId: number,
  signupId: number,
  body: {
    status?: Signup["status"]
    assigned_role_id?: number | null
    is_leader?: boolean
    attendance?: boolean | null
  },
): Promise<Signup> {
  return fetch(`${API_BASE}/events/${eventId}/volunteer-signups/${signupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => handle<Signup>(response))
}

export type PublicSignupResult = {
  signup: Signup
  volunteer_created: boolean
}

export function publicSignup(
  eventId: number,
  body: { name: string; contact_number: string; email?: string; role_ids: number[] },
): Promise<PublicSignupResult> {
  return postJson(`/public/events/${eventId}/volunteer-signups`, body)
}
