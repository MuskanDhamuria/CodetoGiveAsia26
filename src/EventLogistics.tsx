import { useEffect, useMemo, useState } from "react"
import {
  logisticsApi,
  type ExternalOrganization,
  type InventoryItem,
  type InventoryLocation,
  type LogisticsApi,
  type LogisticsReadModel,
  type LogisticsRequirement,
  type Venue,
} from "./logistics-api"
import TableExportButtons from "./TableExportButtons"
import type { ExportRows } from "./table-export"
import "./InventoryLogistics.css"

function quantity(value: number, unit: string) { return `${new Intl.NumberFormat("en-SG", { maximumFractionDigits: 3 }).format(value)} ${unit}` }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(new Date(value)) }
function message(error: unknown) { return error instanceof Error ? error.message : "The logistics workspace could not be loaded." }

export default function EventLogistics({ eventId, eventStatus, api = logisticsApi }: { eventId: number; eventStatus: "open" | "closed"; api?: LogisticsApi }) {
  const [model, setModel] = useState<LogisticsReadModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [selected, setSelected] = useState<LogisticsRequirement | "new" | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [organizations, setOrganizations] = useState<ExternalOrganization[]>([])
  const [venues, setVenues] = useState<Venue[]>([])
  const [referenceError, setReferenceError] = useState("")
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({ requirement_type: "goods", priority: "normal" })
  const [reconciliationNotes, setReconciliationNotes] = useState("")
  const isClosed = eventStatus === "closed"

  async function loadModel() {
    setLoading(true); setError("")
    try { setModel(await api.getEventLogistics(eventId)) } catch (loadError) { setError(message(loadError)) } finally { setLoading(false) }
  }

  useEffect(() => {
    void loadModel()
    Promise.allSettled([api.listItems(), api.listLocations(), api.listOrganizations(), api.listVenues()]).then(([itemResult, locationResult, organizationResult, venueResult]) => {
      const failures: string[] = []
      if (itemResult.status === "fulfilled") setItems(itemResult.value.items); else failures.push("Inventory Items")
      if (locationResult.status === "fulfilled") setLocations(locationResult.value.items); else failures.push("Locations")
      if (organizationResult.status === "fulfilled") setOrganizations(organizationResult.value.items); else failures.push("Organizations")
      if (venueResult.status === "fulfilled") setVenues(venueResult.value.items); else failures.push("Venues")
      setReferenceError(failures.length ? `${failures.join(", ")} could not load. Main readiness data is still available.` : "")
    })
  }, [api, eventId])

  const summary = useMemo(() => {
    const requirements = model?.requirements ?? []
    return { uncovered: requirements.filter((item) => item.status === "uncovered").length, late: requirements.filter((item) => item.not_yet_on_site > 0 && Date.parse(item.needed_by) < Date.now()).length, ready: requirements.filter((item) => item.status === "on_site" || item.status === "fulfilled").length }
  }, [model])

  function openRequirement(requirement: LogisticsRequirement | "new") {
    setSelected(requirement); setFeedback("")
    setForm(requirement === "new" ? { requirement_type: "goods", priority: "normal", needed_by: new Date().toISOString().slice(0, 16) } : {
      required_quantity: String(requirement.required_quantity), needed_by: requirement.needed_by.slice(0, 16), priority: requirement.priority, notes: requirement.notes,
    })
  }
  function field(name: string, value: string) { setForm((current) => ({ ...current, [name]: value })) }
  async function refreshSelected(requirementId?: number) { const next = await api.getEventLogistics(eventId); setModel(next); if (requirementId) setSelected(next.requirements.find((item) => item.id === requirementId) ?? null) }

  async function saveRequirement() {
    if (!selected || isClosed) return
    setSaving(true); setFeedback("")
    try {
      if (selected === "new") {
        const type = form.requirement_type as "goods" | "service"
        const item = items.find((candidate) => candidate.id === Number(form.inventory_item_id))
        const created = await api.createEventRequirement(eventId, {
          requirement_type: type, inventory_item_id: type === "goods" ? Number(form.inventory_item_id) : null,
          service_name: type === "service" ? form.service_name : null, base_quantity: 0, quantity_per_person: 0,
          buffer_percentage: 0, required_quantity: Number(form.required_quantity), unit: type === "goods" ? item?.unit : form.unit,
          needed_by: form.needed_by, priority: form.priority, notes: form.notes || "",
        })
        await refreshSelected(created.id)
      } else {
        await api.updateEventRequirement(eventId, selected.id, { required_quantity: Number(form.required_quantity), needed_by: form.needed_by, priority: form.priority as LogisticsRequirement["priority"], notes: form.notes || "" })
        await refreshSelected(selected.id)
      }
      setFeedback("Requirement saved.")
    } catch (saveError) { setFeedback(message(saveError)) } finally { setSaving(false) }
  }

  async function reserve(requirement: LogisticsRequirement) {
    setSaving(true); setFeedback("")
    try { await api.reserveInventory(eventId, requirement.id, { location_id: Number(form.location_id), quantity: Number(form.reserve_quantity) }); await refreshSelected(requirement.id); setFeedback("Inventory reserved.") } catch (saveError) { setFeedback(message(saveError)) } finally { setSaving(false) }
  }
  async function allocationAction(requirement: LogisticsRequirement, allocationId: number, action: "release" | "issue") {
    setSaving(true); setFeedback("")
    try { await api.allocationAction(eventId, requirement.id, allocationId, action, { quantity: Number(form[`allocation_${allocationId}`] || 0) }); await refreshSelected(requirement.id) } catch (saveError) { setFeedback(message(saveError)) } finally { setSaving(false) }
  }
  async function reconcile(requirement: LogisticsRequirement, allocationId: number, issued: number) {
    setSaving(true); setFeedback("")
    try {
      const returned = Number(form[`returned_${allocationId}`] || 0), consumed = Number(form[`consumed_${allocationId}`] || 0), damaged = Number(form[`damaged_${allocationId}`] || 0), lost = Number(form[`lost_${allocationId}`] || 0), distributed = Number(form[`distributed_${allocationId}`] || 0)
      if (returned + consumed + damaged + lost + distributed !== issued) throw new Error(`Outcomes must total ${issued}.`)
      await api.reconcileAllocation(eventId, requirement.id, allocationId, { returned_quantity: returned, consumed_quantity: consumed, damaged_quantity: damaged, lost_quantity: lost, distributed_quantity: distributed, notes: reconciliationNotes })
      await refreshSelected(requirement.id)
    } catch (saveError) { setFeedback(message(saveError)) } finally { setSaving(false) }
  }
  async function sourceExternally(requirement: LogisticsRequirement) {
    setSaving(true); setFeedback("")
    try {
      const order = await api.createOrder({ organization_id: Number(form.organization_id), event_id: eventId, order_type: form.order_type || (requirement.requirement_type === "goods" ? "purchase" : "service"), destination_location_id: form.destination_location_id ? Number(form.destination_location_id) : null, delivery_start: form.delivery_start || null, delivery_end: form.delivery_end || null, notes: form.order_notes || "" })
      await api.addOrderLine(order.id, { requirement_id: requirement.id, inventory_item_id: requirement.requirement_type === "goods" && (form.order_type || "purchase") === "purchase" ? requirement.inventory_item_id : null, description: requirement.name, quantity: Number(form.order_quantity), unit: requirement.unit })
      await api.orderAction(order.id, "confirm")
      await refreshSelected(requirement.id); setFeedback(`Supplier Order #${order.id} confirmed.`)
    } catch (saveError) { setFeedback(message(saveError)) } finally { setSaving(false) }
  }
  async function addVenueBooking() {
    setSaving(true); setFeedback("")
    try { await api.createVenueBooking(eventId, { venue_space_id: Number(form.venue_space_id), is_primary: form.is_primary === "true", status: "confirmed", start_at: form.booking_start, end_at: form.booking_end }); await loadModel(); setFeedback("Venue Booking confirmed.") } catch (saveError) { setFeedback(message(saveError)) } finally { setSaving(false) }
  }
  async function finalize() { setSaving(true); setFeedback(""); try { await api.finalizeReconciliation(eventId, reconciliationNotes); await loadModel(); setFeedback("Logistics Reconciliation finalized.") } catch (saveError) { setFeedback(message(saveError)) } finally { setSaving(false) } }

  if (loading) return <p className="event-logistics-state" role="status">Loading Event Logistics…</p>
  if (error || !model) return <div className="event-logistics-state error" role="alert"><strong>Event Logistics could not load.</strong><span>{error}</span><button onClick={() => void loadModel()}>Try again</button></div>

  const requirementExportRows: ExportRows = [
    ["Requirement", "Priority", "Type", "Required", "Unit", "Inventory Reserved", "Inventory Issued", "Supplier Ordered", "On Site", "Still to Source", "Not Yet on Site", "Needed By", "Status", "Notes"],
    ...model.requirements.map((requirement) => [requirement.name, requirement.priority, requirement.requirement_type, requirement.required_quantity, requirement.unit, requirement.inventory_reserved, requirement.inventory_issued, requirement.supplier_ordered, requirement.on_site, requirement.still_to_source, requirement.not_yet_on_site, requirement.needed_by, requirement.status, requirement.notes]),
  ]

  return <section className="event-logistics-workspace">
    <div className="event-logistics-planning-strip"><div><span>Planned attendance</span><strong>{model.event.expected_attendance ?? "Not set"}</strong></div><div><span>Registrations</span><strong>{model.forecast.registrations}</strong></div><div><span>Historical suggestion</span><strong>{model.forecast.suggested_attendance ?? "Not enough history"}</strong><small>{model.forecast.historical_show_up_rate === null ? "Needs at least 2 comparable Events" : `${Math.round(model.forecast.historical_show_up_rate * 100)}% show-up · ${model.forecast.similar_event_sample_size} Events`}</small></div><div className={summary.uncovered ? "warning" : ""}><span>Shortages</span><strong>{summary.uncovered}</strong></div><div className={summary.late ? "danger" : ""}><span>Late / not on site</span><strong>{summary.late}</strong></div></div>
    {model.warnings.length > 0 && <div className="event-logistics-warnings" aria-label="Logistics warnings">{model.warnings.map((warning, index) => <button key={`${warning.type}-${index}`} onClick={() => { const requirement = model.requirements.find((item) => item.id === warning.requirement_id); if (requirement) openRequirement(requirement) }}><span>{warning.type.replaceAll("_", " ")}</span>{warning.message}</button>)}</div>}
    {referenceError && <p className="event-logistics-reference-error">{referenceError}</p>}
    <div className="event-logistics-heading"><div><h3>Requirements & readiness</h3><p>“Still to source” measures procurement coverage; “Not yet on site” measures delivery readiness.</p></div><div className="inventory-panel-actions"><TableExportButtons name="Event Requirements" rows={requirementExportRows} />{!isClosed && <button onClick={() => openRequirement("new")}>Add Requirement</button>}</div></div>
    <div className="inventory-table-scroll"><table className="event-logistics-table"><thead><tr><th>Requirement</th><th>Type</th><th>Required</th><th>Inventory Reserved</th><th>Supplier Ordered</th><th>On Site</th><th>Still to Source</th><th>Not Yet on Site</th><th>Needed By</th><th>Status</th></tr></thead><tbody>{model.requirements.map((requirement) => <tr key={requirement.id}><td><button aria-label={`Open ${requirement.name} logistics`} className="requirement-link" onClick={() => openRequirement(requirement)}><strong>{requirement.name}</strong><small>{requirement.priority} priority</small></button></td><td>{requirement.requirement_type}</td><td>{quantity(requirement.required_quantity, requirement.unit)}</td><td>{quantity(requirement.inventory_reserved, requirement.unit)}</td><td>{quantity(requirement.supplier_ordered, requirement.unit)}</td><td>{quantity(requirement.on_site, requirement.unit)}</td><td className={requirement.still_to_source > 0 ? "logistics-short" : ""}>{quantity(requirement.still_to_source, requirement.unit)}</td><td className={requirement.not_yet_on_site > 0 ? "logistics-late" : ""}>{quantity(requirement.not_yet_on_site, requirement.unit)}</td><td>{formatDate(requirement.needed_by)}</td><td><span className={`inventory-chip logistics-${requirement.status}`}>{requirement.status.replaceAll("_", " ")}</span></td></tr>)}</tbody></table>{!model.requirements.length && <p className="inventory-empty">No Logistics Requirements yet.</p>}</div>
    <section className="event-venue-summary"><div className="event-logistics-heading"><div><h3>Venue Bookings</h3><p>Structured bookings are optional; the primary booking supplies the Event’s display location.</p></div></div>{model.venue_bookings.length ? <div className="venue-booking-grid">{model.venue_bookings.map((booking) => <article key={booking.id}><div><span>{booking.is_primary ? "Primary" : "Additional"}</span><strong>{booking.venue_name} · {booking.space_name}</strong></div><p>{formatDate(booking.start_at)} – {formatDate(booking.end_at)}</p><small>{booking.pax_capacity ? `${booking.pax_capacity} pax` : "Capacity not recorded"} · {booking.status}</small></article>)}</div> : <p className="inventory-empty">No structured Venue Bookings. The legacy Event Venue remains visible.</p>}{!isClosed && venues.some((venue) => venue.spaces.length) && <div className="venue-booking-form"><select aria-label="Venue Space" value={form.venue_space_id || ""} onChange={(event) => field("venue_space_id", event.target.value)}><option value="">Choose Venue Space…</option>{venues.flatMap((venue) => venue.spaces.map((space) => <option key={space.id} value={space.id}>{venue.name} · {space.name} ({space.pax_capacity ?? "?"} pax)</option>))}</select><input aria-label="Booking start" type="datetime-local" value={form.booking_start || ""} onChange={(event) => field("booking_start", event.target.value)} /><input aria-label="Booking end" type="datetime-local" value={form.booking_end || ""} onChange={(event) => field("booking_end", event.target.value)} /><label><input type="checkbox" checked={form.is_primary === "true"} onChange={(event) => field("is_primary", String(event.target.checked))} /> Primary</label><button disabled={saving || !form.venue_space_id || !form.booking_start || !form.booking_end} onClick={() => void addVenueBooking()}>Confirm booking</button></div>}</section>
    {isClosed && <section className="event-reconciliation"><div><p>Post-Event</p><h3>Logistics Reconciliation</h3><span>Record every issued quantity and rental return before finalizing.</span></div><span className="inventory-chip">{model.reconciliation.status.replaceAll("_", " ")}</span><textarea aria-label="Reconciliation notes" placeholder="Outcome and handover notes" value={reconciliationNotes} onChange={(event) => setReconciliationNotes(event.target.value)} /><button disabled={saving || model.reconciliation.status === "completed"} onClick={() => void finalize()}>Finalize reconciliation</button></section>}
    {feedback && <p className="inventory-feedback" role="status">{feedback}</p>}

    {selected && <div className="logistics-drawer-backdrop" onClick={() => setSelected(null)}><aside aria-label={selected === "new" ? "New Requirement" : `${selected.name} logistics`} aria-modal="true" className="logistics-drawer" role="dialog" onClick={(event) => event.stopPropagation()}><header><div><p>{selected === "new" ? "Requirement planning" : selected.requirement_type}</p><h2>{selected === "new" ? "Add Requirement" : selected.name}</h2></div><button aria-label="Close logistics drawer" onClick={() => setSelected(null)}>×</button></header><div className="logistics-drawer-body">{selected === "new" ? <NewRequirementFields form={form} field={field} items={items} /> : <RequirementDetails requirement={selected} form={form} field={field} locations={locations} organizations={organizations} isClosed={isClosed} saving={saving} onReserve={() => void reserve(selected)} onAllocation={allocationAction} onReconcile={reconcile} onSource={() => void sourceExternally(selected)} reconciliationNotes={reconciliationNotes} setReconciliationNotes={setReconciliationNotes} />}{feedback && <p className="inventory-feedback">{feedback}</p>}</div><footer><button onClick={() => setSelected(null)}>Close</button>{!isClosed && <button disabled={saving} onClick={() => void saveRequirement()}>{saving ? "Saving…" : "Save Requirement"}</button>}</footer></aside></div>}
  </section>
}

function NewRequirementFields({ form, field, items }: { form: Record<string, string>; field: (name: string, value: string) => void; items: InventoryItem[] }) { const type = form.requirement_type || "goods"; return <div className="logistics-form"><label>Type<select value={type} onChange={(event) => field("requirement_type", event.target.value)}><option value="goods">Physical goods</option><option value="service">Service</option></select></label>{type === "goods" ? <label>Inventory Item<select value={form.inventory_item_id || ""} onChange={(event) => field("inventory_item_id", event.target.value)}><option value="">Choose Item…</option>{items.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></label> : <><label>Service name<input value={form.service_name || ""} onChange={(event) => field("service_name", event.target.value)} /></label><label>Unit<input placeholder="e.g. service, hour" value={form.unit || ""} onChange={(event) => field("unit", event.target.value)} /></label></>}<label>Required quantity<input min="0" step="0.001" type="number" value={form.required_quantity || ""} onChange={(event) => field("required_quantity", event.target.value)} /></label><label>Needed by<input type="datetime-local" value={form.needed_by || ""} onChange={(event) => field("needed_by", event.target.value)} /></label><label>Priority<select value={form.priority || "normal"} onChange={(event) => field("priority", event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Notes<textarea rows={3} value={form.notes || ""} onChange={(event) => field("notes", event.target.value)} /></label></div> }

function RequirementDetails({ requirement, form, field, locations, organizations, isClosed, saving, onReserve, onAllocation, onReconcile, onSource, reconciliationNotes, setReconciliationNotes }: { requirement: LogisticsRequirement; form: Record<string, string>; field: (name: string, value: string) => void; locations: InventoryLocation[]; organizations: ExternalOrganization[]; isClosed: boolean; saving: boolean; onReserve: () => void; onAllocation: (requirement: LogisticsRequirement, allocationId: number, action: "release" | "issue") => void; onReconcile: (requirement: LogisticsRequirement, allocationId: number, issued: number) => void; onSource: () => void; reconciliationNotes: string; setReconciliationNotes: (value: string) => void }) { return <>
  <section><h3>Requirement details</h3><div className="logistics-form"><label>Required quantity<input readOnly={isClosed} step="0.001" type="number" value={form.required_quantity || ""} onChange={(event) => field("required_quantity", event.target.value)} /></label><label>Needed by<input readOnly={isClosed} type="datetime-local" value={form.needed_by || ""} onChange={(event) => field("needed_by", event.target.value)} /></label><label>Priority<select disabled={isClosed} value={form.priority || "normal"} onChange={(event) => field("priority", event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Notes<textarea readOnly={isClosed} rows={3} value={form.notes || ""} onChange={(event) => field("notes", event.target.value)} /></label></div></section>
  <section><h3>Allocation & sourcing</h3><dl className="logistics-summary-grid"><div><dt>Inventory coverage</dt><dd>{quantity(requirement.inventory_reserved + requirement.inventory_issued, requirement.unit)}</dd></div><div><dt>External coverage</dt><dd>{quantity(requirement.supplier_ordered, requirement.unit)}</dd></div><div><dt>On site</dt><dd>{quantity(requirement.on_site, requirement.unit)}</dd></div><div><dt>Shortage</dt><dd>{quantity(requirement.still_to_source, requirement.unit)}</dd></div></dl>
    {requirement.allocations.map((allocation) => <article className="allocation-card" key={allocation.id}><header><strong>{allocation.source_location_name}</strong><span className="inventory-chip">{allocation.status}</span></header><p>{quantity(allocation.reserved_quantity, requirement.unit)} reserved · {quantity(allocation.issued_quantity, requirement.unit)} issued</p>{!isClosed && allocation.status !== "released" && <div><input aria-label={`Allocation quantity ${allocation.id}`} min="0" step="0.001" type="number" value={form[`allocation_${allocation.id}`] || ""} onChange={(event) => field(`allocation_${allocation.id}`, event.target.value)} /><button disabled={saving} onClick={() => onAllocation(requirement, allocation.id, "issue")}>Issue</button><button disabled={saving} onClick={() => onAllocation(requirement, allocation.id, "release")}>Release</button></div>}{isClosed && allocation.issued_quantity > 0 && allocation.status !== "reconciled" && <div className="allocation-reconcile"><p>Outcomes must total {quantity(allocation.issued_quantity, requirement.unit)}.</p>{["returned", "consumed", "damaged", "lost", "distributed"].map((outcome) => <label key={outcome}>{outcome}<input min="0" step="0.001" type="number" value={form[`${outcome}_${allocation.id}`] || ""} onChange={(event) => field(`${outcome}_${allocation.id}`, event.target.value)} /></label>)}<textarea aria-label="Allocation outcome notes" placeholder="Outcome notes" value={reconciliationNotes} onChange={(event) => setReconciliationNotes(event.target.value)} /><button disabled={saving} onClick={() => onReconcile(requirement, allocation.id, allocation.issued_quantity)}>Save outcomes</button></div>}</article>)}
    {!requirement.allocations.length && <p className="inventory-empty">No Inventory Allocations.</p>}
    {!isClosed && requirement.requirement_type === "goods" && <div className="logistics-inline-form"><select aria-label="Source Location" value={form.location_id || ""} onChange={(event) => field("location_id", event.target.value)}><option value="">Source Location…</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><input aria-label="Reserve quantity" min="0" step="0.001" type="number" value={form.reserve_quantity || ""} onChange={(event) => field("reserve_quantity", event.target.value)} /><button disabled={saving || !form.location_id || !form.reserve_quantity} onClick={onReserve}>Reserve</button></div>}
  </section>
  {!isClosed && <section><h3>Source externally</h3><div className="logistics-form"><label>Organization<select value={form.organization_id || ""} onChange={(event) => field("organization_id", event.target.value)}><option value="">Choose Organization…</option>{organizations.filter((organization) => organization.is_active).map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label><label>Order type<select value={form.order_type || (requirement.requirement_type === "goods" ? "purchase" : "service")} onChange={(event) => field("order_type", event.target.value)}>{requirement.requirement_type === "goods" && <><option value="purchase">Purchase</option><option value="rental">Rental</option></>}<option value="service">Service</option></select></label><label>Quantity<input min="0" step="0.001" type="number" value={form.order_quantity || ""} onChange={(event) => field("order_quantity", event.target.value)} /></label><label>Delivery start<input type="datetime-local" value={form.delivery_start || ""} onChange={(event) => field("delivery_start", event.target.value)} /></label><label>Delivery end<input type="datetime-local" value={form.delivery_end || ""} onChange={(event) => field("delivery_end", event.target.value)} /></label></div><button disabled={saving || !form.organization_id || !form.order_quantity} onClick={onSource}>Create & confirm Supplier Order</button></section>}
  <section><h3>Delivery & history</h3><ol className="logistics-history"><li>Requirement created · needed {formatDate(requirement.needed_by)}</li>{requirement.allocations.map((allocation) => <li key={allocation.id}>Allocation #{allocation.id} · {allocation.status} · {allocation.source_location_name}</li>)}{requirement.supplier_ordered > 0 && <li>{quantity(requirement.supplier_ordered, requirement.unit)} ordered externally</li>}{requirement.on_site > 0 && <li>{quantity(requirement.on_site, requirement.unit)} recorded on site</li>}</ol></section>
  </> }
