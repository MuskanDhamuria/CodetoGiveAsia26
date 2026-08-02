export type ListEnvelope<T> = { items: T[]; total: number; limit: number; offset: number }
export type InventoryItem = { id: number; name: string; sku: string | null; description: string; unit: string; item_type: "consumable" | "reusable"; reorder_level: number; is_active: boolean }
export type InventoryLocation = { id: number; name: string; address: string; event_id: number | null; venue_space_id: number | null; is_temporary: boolean; is_active: boolean }
export type StockRow = { item_id: number; item_name: string; sku: string | null; item_type: string; unit: string; reorder_level: number; location_id: number; location_name: string; on_hand: number; reserved: number; available: number; expiring: number; reorder_status: boolean }
export type StockMovement = { id: number; item_id: number; item_name: string; location_id: number; location_name: string; destination_location_id: number | null; movement_type: string; quantity_delta: number; reason: string; created_at: string }
export type OrganizationContact = { id: number; organization_id: number; name: string; role: string; email: string | null; phone: string | null; is_primary: boolean; is_active: boolean }
export type ExternalOrganization = { id: number; name: string; notes: string; is_active: boolean; capabilities: string[]; contacts: OrganizationContact[]; event_count: number; order_count: number }
export type SupplierOrderLine = { id: number; supplier_order_id: number; requirement_id: number | null; inventory_item_id: number | null; description: string; quantity: number; unit: string; unit_cost_sgd_cents: number | null }
export type SupplierOrder = { id: number; organization_id: number; organization_name: string; contact_id: number | null; contact_name: string | null; event_id: number | null; order_type: "purchase" | "rental" | "service"; status: string; fees_sgd_cents: number | null; delivery_start: string | null; delivery_end: string | null; collection_start: string | null; collection_end: string | null; destination_location_id: number | null; destination_location_name: string | null; destination_text: string; notes: string; lines: SupplierOrderLine[]; fulfilments: Array<Record<string, unknown>> }
export type VenueSpace = { id: number; venue_id: number; name: string; pax_capacity: number | null; accessibility_information: string; is_active: boolean }
export type Venue = { id: number; name: string; address: string; managing_organization_id: number | null; managing_organization_name: string | null; notes: string; is_active: boolean; spaces: VenueSpace[]; booking_count: number }
export type DonationBatch = { id: number; event_id: number | null; event_name: string | null; source_organization_id: number | null; source_organization_name: string | null; status: string; container_count: number | null; container_unit: string | null; collection_at: string | null; received_at: string | null; sorting_completed_at: string | null; distribution_at: string | null; notes: string; quantities_by_condition: Record<string, number>; distributed_quantity: number }
export type LogisticsAllocation = { id: number; requirement_id: number; item_id: number; source_location_id: number; source_location_name: string; reserved_quantity: number; issued_quantity: number; returned_quantity: number; consumed_quantity: number; damaged_quantity: number; lost_quantity: number; distributed_quantity: number; status: string }
export type LogisticsRequirement = { id: number; event_id: number; requirement_type: "goods" | "service"; inventory_item_id: number | null; service_name: string | null; name: string; required_quantity: number; unit: string; needed_by: string; priority: "low" | "normal" | "high" | "critical"; notes: string; is_cancelled: boolean; allocations: LogisticsAllocation[]; inventory_reserved: number; inventory_issued: number; supplier_ordered: number; supplier_on_site: number; backfilled_on_site: number; on_site: number; still_to_source: number; not_yet_on_site: number; status: string }
export type AttendanceForecast = { registrations: number; historical_show_up_rate: number | null; similar_event_sample_size: number; suggested_attendance: number | null; calculation_basis: string }
export type VenueBooking = { id: number; event_id: number; venue_space_id: number; venue_name: string; space_name: string; pax_capacity: number | null; is_primary: boolean; status: string; start_at: string; end_at: string; capacity_warning?: boolean }
export type LogisticsWarning = { type: string; message: string; requirement_id?: number; booking_id?: number }
export type LogisticsReadModel = { event: { id: number; name: string; status: "open" | "closed"; expected_attendance: number | null }; forecast: AttendanceForecast; requirements: LogisticsRequirement[]; venue_bookings: VenueBooking[]; reconciliation: { event_id: number; status: "not_started" | "pending" | "completed"; completed_at: string | null; notes: string }; warnings: LogisticsWarning[] }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1"
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail ?? `Request failed with status ${response.status}`)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export interface LogisticsApi {
  listItems(): Promise<ListEnvelope<InventoryItem>>
  createItem(input: Omit<InventoryItem, "id" | "is_active"> & { is_active?: boolean }): Promise<InventoryItem>
  updateItem(id: number, input: Partial<InventoryItem>): Promise<InventoryItem>
  listLocations(): Promise<ListEnvelope<InventoryLocation>>
  createLocation(input: Partial<InventoryLocation> & Pick<InventoryLocation, "name">): Promise<InventoryLocation>
  listStock(): Promise<{ items: StockRow[]; total: number }>
  listMovements(): Promise<ListEnvelope<StockMovement>>
  adjustStock(input: { item_id: number; location_id: number; quantity_delta: number; reason: string; expiry_date?: string | null; condition?: string }): Promise<StockMovement>
  transferStock(input: { item_id: number; source_location_id: number; destination_location_id: number; quantity: number; reason: string }): Promise<Record<string, unknown>>
  listOrganizations(): Promise<ListEnvelope<ExternalOrganization>>
  createOrganization(input: { name: string; notes?: string; capabilities: string[] }): Promise<ExternalOrganization>
  createContact(organizationId: number, input: { name: string; role?: string; email?: string; phone?: string; is_primary?: boolean }): Promise<OrganizationContact>
  listOrders(): Promise<ListEnvelope<SupplierOrder>>
  createOrder(input: Record<string, unknown>): Promise<SupplierOrder>
  addOrderLine(orderId: number, input: Record<string, unknown>): Promise<SupplierOrderLine>
  orderAction(orderId: number, action: "confirm" | "receive" | "return" | "complete" | "cancel", input?: Record<string, unknown>): Promise<unknown>
  listVenues(): Promise<ListEnvelope<Venue>>
  createVenue(input: { name: string; address?: string; managing_organization_id?: number | null; notes?: string }): Promise<Venue>
  createVenueSpace(venueId: number, input: { name: string; pax_capacity?: number | null; accessibility_information?: string }): Promise<VenueSpace>
  createVenueBooking(eventId: number, input: Record<string, unknown>): Promise<VenueBooking>
  listDonations(): Promise<ListEnvelope<DonationBatch>>
  createDonation(input: Record<string, unknown>): Promise<DonationBatch>
  donationAction(batchId: number, action: "collect" | "receive" | "sorting-complete" | "close", input?: Record<string, unknown>): Promise<DonationBatch>
  sortDonation(batchId: number, input: Record<string, unknown>): Promise<Record<string, unknown>>
  distributeDonation(batchId: number, input: Record<string, unknown>): Promise<Record<string, unknown>>
  getEventLogistics(eventId: number): Promise<LogisticsReadModel>
  createEventRequirement(eventId: number, input: Record<string, unknown>): Promise<LogisticsRequirement>
  updateEventRequirement(eventId: number, requirementId: number, input: Partial<LogisticsRequirement>): Promise<LogisticsRequirement>
  cancelEventRequirement(eventId: number, requirementId: number): Promise<void>
  reserveInventory(eventId: number, requirementId: number, input: { location_id: number; quantity: number }): Promise<LogisticsAllocation>
  backfillRequirement(eventId: number, requirementId: number, input: { quantity: number; notes: string }): Promise<LogisticsRequirement>
  allocationAction(eventId: number, requirementId: number, allocationId: number, action: "release" | "issue", input: { quantity: number }): Promise<LogisticsAllocation>
  reconcileAllocation(eventId: number, requirementId: number, allocationId: number, input: Record<string, unknown>): Promise<LogisticsAllocation>
  finalizeReconciliation(eventId: number, notes: string): Promise<LogisticsReadModel["reconciliation"]>
}

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

export const logisticsApi: LogisticsApi = {
  listItems: () => request("/inventory/items?limit=100"),
  createItem: (input) => request("/inventory/items", json("POST", input)),
  updateItem: (id, input) => request(`/inventory/items/${id}`, json("PATCH", input)),
  listLocations: () => request("/inventory/locations?limit=100"),
  createLocation: (input) => request("/inventory/locations", json("POST", input)),
  listStock: () => request("/inventory/stock"),
  listMovements: () => request("/inventory/movements?limit=100"),
  adjustStock: (input) => request("/inventory/adjustments", json("POST", input)),
  transferStock: (input) => request("/inventory/transfers", json("POST", input)),
  listOrganizations: () => request("/external-organizations?limit=100"),
  createOrganization: (input) => request("/external-organizations", json("POST", input)),
  createContact: (organizationId, input) => request(`/external-organizations/${organizationId}/contacts`, json("POST", input)),
  listOrders: () => request("/supplier-orders?limit=100"),
  createOrder: (input) => request("/supplier-orders", json("POST", input)),
  addOrderLine: (orderId, input) => request(`/supplier-orders/${orderId}/lines`, json("POST", input)),
  orderAction: (orderId, action, input) => request(`/supplier-orders/${orderId}/${action}`, json("POST", input)),
  listVenues: () => request("/venues?limit=100"),
  createVenue: (input) => request("/venues", json("POST", input)),
  createVenueSpace: (venueId, input) => request(`/venues/${venueId}/spaces`, json("POST", input)),
  createVenueBooking: (eventId, input) => request(`/events/${eventId}/venue-bookings`, json("POST", input)),
  listDonations: () => request("/donation-batches?limit=100"),
  createDonation: (input) => request("/donation-batches", json("POST", input)),
  donationAction: (batchId, action, input) => request(`/donation-batches/${batchId}/${action}`, json("POST", input)),
  sortDonation: (batchId, input) => request(`/donation-batches/${batchId}/sort`, json("POST", input)),
  distributeDonation: (batchId, input) => request(`/donation-batches/${batchId}/distribute`, json("POST", input)),
  getEventLogistics: (eventId) => request(`/events/${eventId}/logistics`),
  createEventRequirement: (eventId, input) => request(`/events/${eventId}/logistics-requirements`, json("POST", input)),
  updateEventRequirement: (eventId, requirementId, input) => request(`/events/${eventId}/logistics-requirements/${requirementId}`, json("PATCH", input)),
  cancelEventRequirement: (eventId, requirementId) => request(`/events/${eventId}/logistics-requirements/${requirementId}`, json("DELETE")),
  reserveInventory: (eventId, requirementId, input) => request(`/events/${eventId}/logistics-requirements/${requirementId}/reserve`, json("POST", input)),
  backfillRequirement: (eventId, requirementId, input) => request(`/events/${eventId}/logistics-requirements/${requirementId}/backfill`, json("POST", input)),
  allocationAction: (eventId, requirementId, allocationId, action, input) => request(`/events/${eventId}/logistics-requirements/${requirementId}/allocations/${allocationId}/${action}`, json("POST", input)),
  reconcileAllocation: (eventId, requirementId, allocationId, input) => request(`/events/${eventId}/logistics-requirements/${requirementId}/allocations/${allocationId}/reconcile`, json("POST", input)),
  finalizeReconciliation: (eventId, notes) => request(`/events/${eventId}/logistics/reconciliation/finalize`, json("POST", { notes })),
}
