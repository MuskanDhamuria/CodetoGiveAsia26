import { useEffect, useMemo, useState } from "react"
import {
  logisticsApi,
  type DonationBatch,
  type ExternalOrganization,
  type InventoryItem,
  type InventoryLocation,
  type LogisticsApi,
  type StockMovement,
  type StockRow,
  type SupplierOrder,
  type Venue,
} from "./logistics-api"
import TableExportButtons from "./TableExportButtons"
import type { ExportRows } from "./table-export"
import "./InventoryLogistics.css"

type View = "stock" | "locations" | "orders" | "organizations" | "venues" | "donations" | "movements"
type Dialog = "item" | "location" | "adjust" | "transfer" | "organization" | "order" | "order-receive" | "order-return" | "order-complete" | "venue" | "donation" | "sort-donation" | "distribute-donation" | null
type LoadState<T> = { data: T; loading: boolean; error: string | null }

const empty = <T,>(data: T): LoadState<T> => ({ data, loading: true, error: null })
const views: Array<{ id: View; label: string; description: string }> = [
  { id: "stock", label: "Stock", description: "See what is currently in storage, what is reserved for Events, what remains available, and what is running low." },
  { id: "locations", label: "Storage Locations", description: "See every place where stock is stored, including temporary Event storage." },
  { id: "orders", label: "Orders & Deliveries", description: "Track goods and services requested from external Organizations, including delivery and collection dates." },
  { id: "organizations", label: "External Partners", description: "Manage external partners such as suppliers, donors, transport providers, and Venue contacts." },
  { id: "venues", label: "Venues", description: "Review bookable places and spaces, their capacities, managing Organizations, and existing bookings." },
  { id: "donations", label: "Donations", description: "Follow donated goods from collection and receipt through sorting and distribution." },
  { id: "movements", label: "Stock History", description: "Review the audit history of stock added, removed, transferred, returned, or corrected." },
]

function formatNumber(value: number) { return new Intl.NumberFormat("en-SG", { maximumFractionDigits: 3 }).format(value) }
function formatDateTime(value: string | null) { return value ? new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—" }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Unable to load this workspace." }

function exportRows(view: View, stock: StockRow[], locations: InventoryLocation[], orders: SupplierOrder[], organizations: ExternalOrganization[], venues: Venue[], donations: DonationBatch[], movements: StockMovement[]): ExportRows {
  if (view === "stock") return [["Item", "Item code", "Stock type", "Counting unit", "Storage location", "Total in storage", "Reserved for Events", "Available", "Expiring soon", "Stock status"], ...stock.map((row) => [row.item_name, row.sku, row.item_type === "consumable" ? "Consumable — used up or given away" : "Reusable — returned after use", row.unit, row.location_name, row.on_hand, row.reserved, row.available, row.expiring, row.reorder_status ? "Low stock" : "Enough stock"])]
  if (view === "locations") return [["Location", "Address", "Stocked Items", "Low-stock Items", "Type", "Status"], ...locations.map((row) => { const lines = stock.filter((item) => item.location_id === row.id); return [row.name, row.address, lines.length, lines.filter((line) => line.reorder_status).length, row.is_temporary ? "Temporary" : "Permanent", row.is_active ? "Active" : "Inactive"] })]
  if (view === "orders") return [["Order", "Organization", "Type", "Status", "Lines", "Delivery start", "Delivery end", "Collection start", "Destination"], ...orders.map((row) => [`#${row.id}`, row.organization_name, row.order_type, row.status, row.lines.length, row.delivery_start, row.delivery_end, row.collection_start, row.destination_location_name || row.destination_text])]
  if (view === "organizations") return [["Organization", "Capabilities", "Primary contact", "Phone", "Email", "Events", "Orders", "Status"], ...organizations.map((row) => { const primary = row.contacts.find((contact) => contact.is_primary) ?? row.contacts[0]; return [row.name, row.capabilities.join(", "), primary?.name, primary?.phone, primary?.email, row.event_count, row.order_count, row.is_active ? "Active" : "Inactive"] })]
  if (view === "venues") return [["Venue", "Address", "Spaces", "Capacities", "Managing organization", "Bookings"], ...venues.map((row) => [row.name, row.address, row.spaces.map((space) => space.name).join(", "), row.spaces.map((space) => space.pax_capacity).filter((value) => value !== null).join(", "), row.managing_organization_name, row.booking_count])]
  if (view === "donations") return [["Batch", "Event", "Source", "Containers", "Container unit", "Pending sort", "Available", "Distributed", "Status"], ...donations.map((row) => [`Batch #${row.id}`, row.event_name, row.source_organization_name, row.container_count, row.container_unit, row.quantities_by_condition.pending_sort || 0, row.quantities_by_condition.usable || 0, row.distributed_quantity || 0, row.status])]
  return [["When", "Item", "Movement", "Location", "Quantity", "Reason"], ...movements.map((row) => [row.created_at, row.item_name, row.movement_type, row.location_name, row.quantity_delta, row.reason])]
}

export default function InventoryPage({ api = logisticsApi }: { api?: LogisticsApi }) {
  const [view, setView] = useState<View>("stock")
  const [dialog, setDialog] = useState<Dialog>(null)
  const [feedback, setFeedback] = useState("")
  const [saving, setSaving] = useState(false)
  const [stock, setStock] = useState(empty<StockRow[]>([]))
  const [items, setItems] = useState(empty<InventoryItem[]>([]))
  const [locations, setLocations] = useState(empty<InventoryLocation[]>([]))
  const [orders, setOrders] = useState(empty<SupplierOrder[]>([]))
  const [organizations, setOrganizations] = useState(empty<ExternalOrganization[]>([]))
  const [venues, setVenues] = useState(empty<Venue[]>([]))
  const [donations, setDonations] = useState(empty<DonationBatch[]>([]))
  const [movements, setMovements] = useState(empty<StockMovement[]>([]))
  const [form, setForm] = useState<Record<string, string>>({})

  async function loadAll() {
    const loads = [
      [api.listStock(), (value: { items: StockRow[] }) => setStock({ data: value.items, loading: false, error: null }), (message: string) => setStock({ data: [], loading: false, error: message })],
      [api.listItems(), (value: { items: InventoryItem[] }) => setItems({ data: value.items, loading: false, error: null }), (message: string) => setItems({ data: [], loading: false, error: message })],
      [api.listLocations(), (value: { items: InventoryLocation[] }) => setLocations({ data: value.items, loading: false, error: null }), (message: string) => setLocations({ data: [], loading: false, error: message })],
      [api.listOrders(), (value: { items: SupplierOrder[] }) => setOrders({ data: value.items, loading: false, error: null }), (message: string) => setOrders({ data: [], loading: false, error: message })],
      [api.listOrganizations(), (value: { items: ExternalOrganization[] }) => setOrganizations({ data: value.items, loading: false, error: null }), (message: string) => setOrganizations({ data: [], loading: false, error: message })],
      [api.listVenues(), (value: { items: Venue[] }) => setVenues({ data: value.items, loading: false, error: null }), (message: string) => setVenues({ data: [], loading: false, error: message })],
      [api.listDonations(), (value: { items: DonationBatch[] }) => setDonations({ data: value.items, loading: false, error: null }), (message: string) => setDonations({ data: [], loading: false, error: message })],
      [api.listMovements(), (value: { items: StockMovement[] }) => setMovements({ data: value.items, loading: false, error: null }), (message: string) => setMovements({ data: [], loading: false, error: message })],
    ] as const
    await Promise.all(loads.map(async ([promise, success, failure]) => { try { success(await promise as never) } catch (error) { failure(errorMessage(error)) } }))
  }

  useEffect(() => { void loadAll() }, [api])

  const totals = useMemo(() => ({
    activeItems: items.data.filter((item) => item.is_active).length,
    activeLocations: locations.data.filter((location) => location.is_active).length,
    reservedLines: stock.data.filter((row) => row.reserved > 0).length,
    reorder: stock.data.filter((row) => row.reorder_status).length,
  }), [items.data, locations.data, stock.data])
  const tabState = view === "stock" ? stock : view === "locations" ? locations : view === "orders" ? orders : view === "organizations" ? organizations : view === "venues" ? venues : view === "donations" ? donations : movements
  const currentExportRows = useMemo(() => exportRows(view, stock.data, locations.data, orders.data, organizations.data, venues.data, donations.data, movements.data), [view, stock.data, locations.data, orders.data, organizations.data, venues.data, donations.data, movements.data])
  const currentView = views.find((item) => item.id === view) ?? views[0]
  const currentViewLabel = currentView.label
  const itemUnit = form.unit === "custom" ? form.custom_unit : form.unit
  const itemSaveInvalid = dialog === "item" && (!form.name?.trim() || !itemUnit?.trim() || !form.item_type || (Number(form.starting_quantity || 0) > 0 && !form.starting_location_id))

  function openDialog(next: Dialog) {
    setDialog(next)
    setFeedback("")
    setForm({
      order_type: "purchase",
      item_type: "consumable",
      capabilities: "supplier",
      ...(next === "item" ? { unit: "piece", starting_quantity: "0", starting_location_id: String(locations.data.find((location) => location.is_active)?.id ?? "") } : {}),
    })
  }
  function field(name: string, value: string) { setForm((current) => ({ ...current, [name]: value })) }
  const number = (name: string) => Number(form[name] || 0)

  async function submit() {
    if (!dialog) return
    setSaving(true); setFeedback("")
    try {
      if (dialog === "item") {
        let itemId = number("created_item_id")
        if (!itemId) {
          const item = await api.createItem({ name: form.name, sku: form.sku || null, description: form.description || "", unit: form.unit === "custom" ? form.custom_unit : form.unit, item_type: form.item_type as "consumable" | "reusable", reorder_level: number("reorder_level") })
          itemId = item.id
          if (number("starting_quantity") > 0) setForm((current) => ({ ...current, created_item_id: String(item.id) }))
        }
        if (number("starting_quantity") > 0) await api.adjustStock({ item_id: itemId, location_id: number("starting_location_id"), quantity_delta: number("starting_quantity"), reason: "Opening balance when Item was created" })
      }
      if (dialog === "location") await api.createLocation({ name: form.name, address: form.address || "", is_temporary: form.is_temporary === "true" })
      if (dialog === "adjust") await api.adjustStock({ item_id: number("item_id"), location_id: number("location_id"), quantity_delta: number("quantity"), reason: form.reason, expiry_date: form.expiry_date || null })
      if (dialog === "transfer") await api.transferStock({ item_id: number("item_id"), source_location_id: number("source_location_id"), destination_location_id: number("destination_location_id"), quantity: number("quantity"), reason: form.reason })
      if (dialog === "organization") {
        const organization = await api.createOrganization({ name: form.name, notes: form.notes || "", capabilities: (form.capabilities || "").split(",").map((item) => item.trim()).filter(Boolean) })
        if (form.contact_name) await api.createContact(organization.id, { name: form.contact_name, email: form.email, phone: form.phone, is_primary: true })
      }
      if (dialog === "order") {
        const order = await api.createOrder({ organization_id: number("organization_id"), order_type: form.order_type, destination_location_id: form.destination_location_id ? number("destination_location_id") : null, delivery_start: form.delivery_start || null, delivery_end: form.delivery_end || null, notes: form.notes || "" })
        await api.addOrderLine(order.id, { inventory_item_id: form.inventory_item_id ? number("inventory_item_id") : null, description: form.description, quantity: number("quantity"), unit: form.unit, unit_cost_sgd_cents: form.unit_cost_sgd ? Math.round(Number(form.unit_cost_sgd) * 100) : null })
      }
      if (dialog === "order-receive") await api.orderAction(number("order_id"), "receive", { line_id: number("line_id"), quantity: number("quantity"), condition: form.condition || "usable", expiry_date: form.expiry_date || null, notes: form.notes || "" })
      if (dialog === "order-return") await api.orderAction(number("order_id"), "return", { line_id: number("line_id"), quantity: number("quantity"), notes: form.notes || "" })
      if (dialog === "order-complete") await api.orderAction(number("order_id"), "complete", { line_id: form.line_id ? number("line_id") : null, quantity: form.quantity ? number("quantity") : null, notes: form.notes || "" })
      if (dialog === "venue") {
        const venue = await api.createVenue({ name: form.name, address: form.address || "", managing_organization_id: form.managing_organization_id ? number("managing_organization_id") : null })
        if (form.space_name) await api.createVenueSpace(venue.id, { name: form.space_name, pax_capacity: form.pax_capacity ? number("pax_capacity") : null, accessibility_information: form.accessibility_information || "" })
      }
      if (dialog === "donation") await api.createDonation({ source_organization_id: form.source_organization_id ? number("source_organization_id") : null, container_count: form.container_count ? number("container_count") : null, container_unit: form.container_unit || null, notes: form.notes || "" })
      if (dialog === "sort-donation") await api.sortDonation(number("batch_id"), { item_id: number("item_id"), location_id: number("location_id"), quantity: number("quantity"), condition: form.condition || "usable", expiry_date: form.expiry_date || null })
      if (dialog === "distribute-donation") await api.distributeDonation(number("batch_id"), { item_id: number("item_id"), location_id: number("location_id"), quantity: number("quantity"), condition: "usable" })
      setDialog(null); setFeedback("Saved successfully."); await loadAll()
    } catch (error) { setFeedback(errorMessage(error)) } finally { setSaving(false) }
  }

  async function orderAction(order: SupplierOrder, action: "confirm" | "cancel") { try { await api.orderAction(order.id, action); await loadAll() } catch (error) { setFeedback(errorMessage(error)) } }
  function openOrderAction(order: SupplierOrder, action: "receive" | "return" | "complete") { openDialog(`order-${action}`); setForm((current) => ({ ...current, order_id: String(order.id), line_id: order.lines[0] ? String(order.lines[0].id) : "", condition: "usable" })) }
  async function donationAction(batch: DonationBatch, action: "collect" | "receive" | "sorting-complete" | "close") { try { await api.donationAction(batch.id, action); await loadAll() } catch (error) { setFeedback(errorMessage(error)) } }

  return <section className="inventory-workbench">
    <header className="inventory-header"><div><p>Operations workbench</p><h1>Inventory & Logistics</h1><span>Track what you have, where it is stored, what Events need, and what external partners are delivering.</span></div><div className="inventory-primary-actions"><button onClick={() => openDialog("adjust")}>Adjust stock</button><button onClick={() => openDialog("transfer")}>Transfer stock</button></div></header>
    <div className="inventory-kpi-strip" aria-label="Inventory summary"><div><span>Active Items</span><strong>{totals.activeItems}</strong><small>Available for planning</small></div><div><span>Storage Locations</span><strong>{totals.activeLocations}</strong><small>Permanent and temporary</small></div><div><span>Items reserved for Events</span><strong>{totals.reservedLines}</strong><small>Reserved, not yet issued</small></div><div className={totals.reorder ? "warning" : ""}><span>Low-stock alerts</span><strong>{totals.reorder}</strong><small>Below your chosen alert level</small></div></div>
    <div className="inventory-tabs" role="tablist">{views.map((tab) => <button aria-selected={view === tab.id} key={tab.id} onClick={() => setView(tab.id)} role="tab" title={tab.description}>{tab.label}</button>)}</div>
    {feedback && <p className="inventory-feedback" role="status">{feedback}</p>}
    <section className="inventory-panel">
      <div className="inventory-panel-heading"><div><h2>{currentViewLabel}</h2><p>{currentView.description}</p></div><div className="inventory-panel-actions"><TableExportButtons name={currentViewLabel} rows={currentExportRows} />{view === "stock" && <button onClick={() => openDialog("item")}>New Item</button>}{view === "locations" && <button onClick={() => openDialog("location")}>New Storage Location</button>}{view === "orders" && <button onClick={() => openDialog("order")}>New Order</button>}{view === "organizations" && <button onClick={() => openDialog("organization")}>New External Partner</button>}{view === "venues" && <button onClick={() => openDialog("venue")}>New Venue</button>}{view === "donations" && <button onClick={() => openDialog("donation")}>New Donation Batch</button>}</div></div>
      {tabState.loading && <p className="inventory-state" role="status">Loading {views.find((item) => item.id === view)?.label.toLowerCase()}…</p>}
      {tabState.error && <div className="inventory-state error" role="alert"><strong>This view could not load.</strong><span>{tabState.error}</span><button onClick={() => void loadAll()}>Try again</button></div>}
      {!tabState.loading && !tabState.error && <div className="inventory-table-scroll">{view === "stock" ? <StockTable rows={stock.data} /> : view === "locations" ? <LocationsTable rows={locations.data} stock={stock.data} /> : view === "orders" ? <OrdersTable rows={orders.data} onAction={orderAction} onFulfil={openOrderAction} /> : view === "organizations" ? <OrganizationsTable rows={organizations.data} /> : view === "venues" ? <VenuesTable rows={venues.data} /> : view === "donations" ? <DonationsTable rows={donations.data} onAction={donationAction} onSort={(batch) => { openDialog("sort-donation"); setForm((current) => ({ ...current, batch_id: String(batch.id), condition: "usable" })) }} onDistribute={(batch) => { openDialog("distribute-donation"); setForm((current) => ({ ...current, batch_id: String(batch.id) })) }} /> : <MovementsTable rows={movements.data} />}</div>}
    </section>
    {dialog && <div className="inventory-modal-backdrop"><section aria-modal="true" className="inventory-modal" role="dialog"><header><div><p>Inventory operation</p><h2>{dialogTitle(dialog)}</h2></div><button aria-label="Close" onClick={() => setDialog(null)}>×</button></header><div className="inventory-form">{dialogFields(dialog, form, field, items.data, locations.data, organizations.data, orders.data)}</div>{feedback && <p className="inventory-feedback">{feedback}</p>}<footer><button onClick={() => setDialog(null)}>Cancel</button><button disabled={saving || itemSaveInvalid} onClick={() => void submit()}>{saving ? "Saving…" : "Save"}</button></footer></section></div>}
  </section>
}

function Empty({ children }: { children: string }) { return <p className="inventory-empty">{children}</p> }
function StockTable({ rows }: { rows: StockRow[] }) { if (!rows.length) return <Empty>No stock recorded yet. Add an Item with a starting quantity, or use Adjust stock.</Empty>; return <table><thead><tr><th>Item</th><th>Stock type</th><th>Storage location</th><th>Total in storage</th><th>Reserved for Events</th><th>Available</th><th>Expiring soon</th><th>Stock status</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.item_id}-${row.location_id}`}><td><strong>{row.item_name}</strong><small>{row.sku || "No item code"}</small></td><td><strong>{row.item_type === "consumable" ? "Consumable" : "Reusable"}</strong><small>{row.item_type === "consumable" ? "Used up or given away" : "Returned after use"}</small></td><td>{row.location_name}</td><td>{formatNumber(row.on_hand)} {row.unit}</td><td>{formatNumber(row.reserved)} {row.unit}</td><td><strong>{formatNumber(row.available)} {row.unit}</strong></td><td>{formatNumber(row.expiring)} {row.unit}</td><td><span className={`inventory-chip ${row.reorder_status ? "danger" : "good"}`}>{row.reorder_status ? "Low stock" : "Enough stock"}</span><small>{row.reorder_level > 0 ? `Alert below ${formatNumber(row.reorder_level)} ${row.unit}` : "No low-stock alert set"}</small></td></tr>)}</tbody></table> }
function LocationsTable({ rows, stock }: { rows: InventoryLocation[]; stock: StockRow[] }) { if (!rows.length) return <Empty>No storage locations yet. Add the places where your stock is kept.</Empty>; return <table><thead><tr><th>Storage Location</th><th>Address</th><th>Stocked Items</th><th>Low-stock Items</th><th>Type</th><th>Status</th></tr></thead><tbody>{rows.map((row) => { const lines = stock.filter((item) => item.location_id === row.id); return <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.address || "—"}</td><td>{lines.length}</td><td>{lines.filter((line) => line.reorder_status).length}</td><td>{row.is_temporary ? "Temporary" : "Permanent"}</td><td>{row.is_active ? "Active" : "Inactive"}</td></tr> })}</tbody></table> }
function OrdersTable({ rows, onAction, onFulfil }: { rows: SupplierOrder[]; onAction: (order: SupplierOrder, action: "confirm" | "cancel") => void; onFulfil: (order: SupplierOrder, action: "receive" | "return" | "complete") => void }) { if (!rows.length) return <Empty>No orders or deliveries yet.</Empty>; return <table><thead><tr><th>Order</th><th>External Partner</th><th>Type</th><th>Status</th><th>Delivery window</th><th>Collection</th><th>Destination</th><th>Action</th></tr></thead><tbody>{rows.map((row) => { const active = row.status === "confirmed" || row.status === "in_progress"; const overdue = active && !!row.delivery_end && Date.parse(row.delivery_end) < Date.now(); return <tr key={row.id}><td><strong>#{row.id}</strong><small>{row.lines.length} line(s)</small></td><td>{row.organization_name}</td><td>{row.order_type}</td><td><span className={`inventory-chip ${overdue ? "danger" : ""}`}>{overdue ? "overdue" : row.status.replace("_", " ")}</span></td><td>{formatDateTime(row.delivery_start)}<small>{row.delivery_end ? `to ${formatDateTime(row.delivery_end)}` : ""}</small></td><td>{formatDateTime(row.collection_start)}</td><td>{row.destination_location_name || row.destination_text || "—"}</td><td><div className="inventory-row-actions">{row.status === "draft" && <button onClick={() => onAction(row, "confirm")}>Confirm</button>}{active && row.order_type !== "service" && <button onClick={() => onFulfil(row, "receive")}>Receive</button>}{active && row.order_type === "rental" && <button onClick={() => onFulfil(row, "return")}>Return</button>}{active && <button onClick={() => onFulfil(row, "complete")}>Complete</button>}{row.status !== "completed" && row.status !== "cancelled" && <button className="text-danger" onClick={() => onAction(row, "cancel")}>Cancel</button>}</div></td></tr> })}</tbody></table> }
function OrganizationsTable({ rows }: { rows: ExternalOrganization[] }) { if (!rows.length) return <Empty>No External Partners yet.</Empty>; return <table><thead><tr><th>External Partner</th><th>How they help</th><th>Main contact</th><th>Events</th><th>Orders</th><th>Status</th></tr></thead><tbody>{rows.map((row) => { const primary = row.contacts.find((contact) => contact.is_primary) ?? row.contacts[0]; return <tr key={row.id}><td><strong>{row.name}</strong><small>{row.notes}</small></td><td><div className="inventory-chip-list">{row.capabilities.map((item) => <span className="inventory-chip" key={item}>{item.replaceAll("_", " ")}</span>)}</div></td><td>{primary?.name || "—"}<small>{primary?.phone || primary?.email || ""}</small></td><td>{row.event_count}</td><td>{row.order_count}</td><td>{row.is_active ? "Active" : "Inactive"}</td></tr> })}</tbody></table> }
function VenuesTable({ rows }: { rows: Venue[] }) { if (!rows.length) return <Empty>No Venues yet. Add places that can be booked for Events.</Empty>; return <table><thead><tr><th>Venue</th><th>Address</th><th>Spaces</th><th>Capacities</th><th>Managing partner</th><th>Bookings</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.address || "—"}</td><td>{row.spaces.map((space) => space.name).join(", ") || "—"}</td><td>{row.spaces.map((space) => space.pax_capacity ?? "—").join(", ")}</td><td>{row.managing_organization_name || "—"}</td><td>{row.booking_count}</td></tr>)}</tbody></table> }
function DonationsTable({ rows, onAction, onSort, onDistribute }: { rows: DonationBatch[]; onAction: (batch: DonationBatch, action: "collect" | "receive" | "sorting-complete" | "close") => void; onSort: (batch: DonationBatch) => void; onDistribute: (batch: DonationBatch) => void }) { if (!rows.length) return <Empty>No donation batches yet. Add a batch when donated goods are collected or expected.</Empty>; return <table><thead><tr><th>Batch</th><th>Source</th><th>Containers</th><th>Waiting to be sorted</th><th>Ready to use</th><th>Distributed</th><th>Status</th><th>Next action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>Batch #{row.id}</strong><small>{row.event_name || "General donation"}</small></td><td>{row.source_organization_name || "Unrecorded"}</td><td>{row.container_count ?? "—"} {row.container_unit || ""}</td><td>{formatNumber(row.quantities_by_condition.pending_sort || 0)}</td><td>{formatNumber(row.quantities_by_condition.usable || 0)}</td><td>{formatNumber(row.distributed_quantity || 0)}</td><td><span className="inventory-chip">{row.status}</span></td><td><div className="inventory-row-actions">{row.status === "planned" ? <button onClick={() => onAction(row, "collect")}>Mark collected</button> : row.status === "collected" ? <button onClick={() => onAction(row, "receive")}>Mark received</button> : row.status === "received" || row.status === "sorting" ? <><button onClick={() => onSort(row)}>Sort goods</button>{row.status === "sorting" && <button onClick={() => onAction(row, "sorting-complete")}>Finish sorting</button>}</> : row.status === "sorted" || row.status === "distributed" ? <><button onClick={() => onDistribute(row)}>Record distribution</button><button onClick={() => onAction(row, "close")}>Close</button></> : null}</div></td></tr>)}</tbody></table> }
function MovementsTable({ rows }: { rows: StockMovement[] }) { if (!rows.length) return <Empty>No stock changes recorded yet.</Empty>; return <table><thead><tr><th>When</th><th>Item</th><th>What changed</th><th>Storage Location</th><th>Quantity change</th><th>Why it changed</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDateTime(row.created_at)}</td><td><strong>{row.item_name}</strong></td><td><span className="inventory-chip">{row.movement_type.replaceAll("_", " ")}</span></td><td>{row.location_name}</td><td className={row.quantity_delta < 0 ? "quantity-out" : "quantity-in"}>{row.quantity_delta > 0 ? "+" : ""}{formatNumber(row.quantity_delta)}</td><td>{row.reason}</td></tr>)}</tbody></table> }

function dialogTitle(dialog: Exclude<Dialog, null>) { return ({ item: "Add Inventory Item", location: "Add Storage Location", adjust: "Adjust stock", transfer: "Transfer stock", organization: "Add External Partner", order: "Create Supplier Order", "order-receive": "Record receipt / delivery", "order-return": "Record rental return", "order-complete": "Complete Supplier Order", venue: "Add Venue", donation: "Create Donation Batch", "sort-donation": "Sort donated goods", "distribute-donation": "Record donated-goods distribution" })[dialog] }
function Input({ label, name, form, field, type = "text" }: { label: string; name: string; form: Record<string, string>; field: (name: string, value: string) => void; type?: string }) { return <label>{label}<input type={type} value={form[name] || ""} onChange={(event) => field(name, event.target.value)} /></label> }
function Select({ label, name, form, field, options }: { label: string; name: string; form: Record<string, string>; field: (name: string, value: string) => void; options: Array<[string, string]> }) { return <label>{label}<select value={form[name] || ""} onChange={(event) => field(name, event.target.value)}><option value="">Select…</option>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> }
function dialogFields(dialog: Exclude<Dialog, null>, form: Record<string, string>, field: (name: string, value: string) => void, items: InventoryItem[], locations: InventoryLocation[], organizations: ExternalOrganization[], orders: SupplierOrder[]) {
  const input = (label: string, name: string, type?: string) => <Input field={field} form={form} key={name} label={label} name={name} type={type} />
  const itemSelect = <Select field={field} form={form} label="Inventory Item" name="item_id" options={items.map((item) => [String(item.id), `${item.name} (${item.unit})`])} />
  const locationSelect = (name: string, label: string) => <Select field={field} form={form} label={label} name={name} options={locations.map((location) => [String(location.id), location.name])} />
  const organizationSelect = (name: string, label: string) => <Select field={field} form={form} label={label} name={name} options={organizations.map((organization) => [String(organization.id), organization.name])} />
  if (dialog === "item") return <>
    {input("Item name", "name")}
    {input("Item code (optional)", "sku")}
    {input("Description / size (optional)", "description")}
    <Select field={field} form={form} label="How do you count this item?" name="unit" options={[["piece", "Pieces"], ["bottle", "Bottles"], ["roll", "Rolls"], ["box", "Boxes"], ["pack", "Packs"], ["set", "Sets"], ["kilogram", "Kilograms (kg)"], ["litre", "Litres (L)"], ["metre", "Metres (m)"], ["custom", "Other…"]]} />
    {form.unit === "custom" && input("Custom counting unit", "custom_unit")}
    <p className="inventory-form-help">Example: for 10 one-litre bottles, name the Item “Water bottle (1 L)”, count it as Bottles, and enter 10 below. For bulk water, count it in Litres.</p>
    <Select field={field} form={form} label="What happens after use?" name="item_type" options={[["consumable", "Used up or given away"], ["reusable", "Returned and reused"]]} />
    {input("Alert me when stock falls below", "reorder_level", "number")}
    <h3>Starting stock (optional)</h3>
    {input("Starting quantity", "starting_quantity", "number")}
    {locationSelect("starting_location_id", "Store at")}
  </>
  if (dialog === "location") return <>{input("Location name", "name")}{input("Address", "address")}<label><input type="checkbox" checked={form.is_temporary === "true"} onChange={(event) => field("is_temporary", String(event.target.checked))} /> Temporary Event location</label></>
  if (dialog === "adjust") return <>{itemSelect}{locationSelect("location_id", "Location")}{input("Quantity change (+ or −)", "quantity", "number")}{input("Expiry date", "expiry_date", "date")}{input("Mandatory reason", "reason")}</>
  if (dialog === "transfer") return <>{itemSelect}{locationSelect("source_location_id", "Source Location")}{locationSelect("destination_location_id", "Destination Location")}{input("Quantity", "quantity", "number")}{input("Reason", "reason")}</>
  if (dialog === "organization") return <>{input("Organization name", "name")}{input("Capabilities (comma separated)", "capabilities")}{input("Notes", "notes")}<h3>Primary contact (optional)</h3>{input("Contact name", "contact_name")}{input("Email", "email", "email")}{input("Phone", "phone")}</>
  if (dialog === "order") return <>{organizationSelect("organization_id", "Organization")}<Select field={field} form={form} label="Order type" name="order_type" options={[["purchase", "Purchase"], ["rental", "Rental"], ["service", "Service"]]} />{locationSelect("destination_location_id", "Inventory destination (purchases)")}<h3>First order line</h3>{form.order_type === "purchase" && <Select field={field} form={form} label="Inventory Item" name="inventory_item_id" options={items.map((item) => [String(item.id), item.name])} />}{input("Description", "description")}{input("Quantity", "quantity", "number")}{input("Unit", "unit")}{input("Unit cost (SGD)", "unit_cost_sgd", "number")}{input("Delivery start", "delivery_start", "datetime-local")}{input("Delivery end", "delivery_end", "datetime-local")}{input("Notes", "notes")}</>
  if (dialog === "order-receive" || dialog === "order-return" || dialog === "order-complete") { const order = orders.find((candidate) => candidate.id === Number(form.order_id)); return <><Select field={field} form={form} label="Order line" name="line_id" options={(order?.lines || []).map((line) => [String(line.id), `${line.description} · ${line.quantity} ${line.unit}`])} />{input(dialog === "order-return" ? "Quantity returned" : dialog === "order-complete" && order?.order_type === "service" ? "Quantity completed (optional)" : "Quantity", "quantity", "number")}{dialog === "order-receive" && order?.order_type === "purchase" && <><Select field={field} form={form} label="Condition" name="condition" options={[["usable", "Usable"], ["damaged", "Damaged"], ["pending_sort", "Pending sort"]]} />{input("Expiry date", "expiry_date", "date")}</>}{input("Notes", "notes")}</> }
  if (dialog === "venue") return <>{input("Venue name", "name")}{input("Address", "address")}{organizationSelect("managing_organization_id", "Managing Organization")}<h3>First Venue Space (optional)</h3>{input("Room / area", "space_name")}{input("Pax capacity", "pax_capacity", "number")}{input("Accessibility information", "accessibility_information")}</>
  if (dialog === "sort-donation") return <>{itemSelect}{locationSelect("location_id", "Inventory Location")}{input("Quantity", "quantity", "number")}<Select field={field} form={form} label="Condition" name="condition" options={[["usable", "Usable"], ["pending_sort", "Still pending sort"], ["damaged", "Damaged"], ["discarded", "Discarded"]]} />{input("Expiry date", "expiry_date", "date")}</>
  if (dialog === "distribute-donation") return <>{itemSelect}{locationSelect("location_id", "Inventory Location")}{input("Quantity distributed", "quantity", "number")}</>
  return <>{organizationSelect("source_organization_id", "Source Organization")}{input("Container count", "container_count", "number")}{input("Container unit", "container_unit")}{input("Notes", "notes")}</>
}
