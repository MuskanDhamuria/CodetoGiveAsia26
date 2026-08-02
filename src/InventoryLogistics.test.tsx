// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import InventoryPage from "./InventoryPage"
import EventLogistics from "./EventLogistics"
import type { LogisticsApi } from "./logistics-api"

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe("Inventory and Event Logistics", () => {
  it("keeps the Ask Passion AI button behind modal overlays", () => {
    const styles = readFileSync("src/index.css", "utf8")
    const fabZIndex = Number(
      styles.match(/\.copilot-fab\s*\{[^}]*z-index:\s*(\d+)/s)?.[1],
    )
    const modalZIndex = Number(
      readFileSync("src/InventoryLogistics.css", "utf8").match(
        /\.inventory-modal-backdrop, \.logistics-drawer-backdrop\s*\{[^}]*z-index:\s*(\d+)/s,
      )?.[1],
    )

    expect(fabZIndex).toBeLessThan(modalZIndex)
    expect(styles).toMatch(
      /\.product-app:has\(\.inventory-modal-backdrop, \.logistics-drawer-backdrop\) \.copilot-fab\s*\{[^}]*display:\s*none/s,
    )
  })

  it("keeps the inventory header below the fixed navigation on mobile", () => {
    const styles = readFileSync("src/InventoryLogistics.css", "utf8")

    expect(styles).toMatch(/\.inventory-workbench\s*\{[^}]*padding:\s*96px/)
    expect(styles).toMatch(/@media\s*\(max-width:\s*700px\)[\s\S]*\.inventory-workbench\s*\{[^}]*padding:\s*150px/)
  })

  it("constrains the Event Logistics workspace and scrolls wide tables inside it", () => {
    const styles = readFileSync("src/InventoryLogistics.css", "utf8")

    expect(styles).toMatch(/\.event-logistics-workspace\s*\{[^}]*max-width:\s*100%/)
    expect(styles).toMatch(/\.inventory-workbench\s*\{[^}]*padding:\s*96px[^}]*128px/)
    expect(styles).toMatch(/\.event-logistics-workspace\s*\{[^}]*padding-bottom:\s*128px/)
    expect(styles).toMatch(/\.event-logistics-workspace\s+\.inventory-table-scroll\s*\{[^}]*overflow-x:\s*auto/)
    expect(styles).toMatch(/\.product-app\s+\.logistics-drawer-backdrop\s*\{[^}]*right:\s*var\(--copilot-sidebar-width\)/)
  })

  it("renders stock balances and switches independent workbench views", async () => {
    const api = {
      listStock: vi.fn().mockResolvedValue({ items: [{ item_id: 1, item_name: "Drinking water", sku: "WATER", item_type: "consumable", unit: "litre", reorder_level: 20, location_id: 2, location_name: "Main store", on_hand: 100, reserved: 25, available: 75, expiring: 5, reorder_status: false }], total: 1 }),
      listItems: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listLocations: vi.fn().mockResolvedValue({ items: [{ id: 2, name: "Main store", address: "", event_id: null, venue_space_id: null, is_temporary: false, is_active: true }], total: 1, limit: 100, offset: 0 }),
      listOrders: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listOrganizations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listVenues: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listDonations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listMovements: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      createItem: vi.fn().mockResolvedValue({ id: 3, name: "Packing tape (50 m)", sku: null, description: "", unit: "roll", item_type: "consumable", reorder_level: 0, is_active: true }),
      adjustStock: vi.fn().mockResolvedValue({ id: 9 }),
    } as unknown as LogisticsApi
    const user = userEvent.setup()

    render(<main className="product-app"><InventoryPage api={api} /></main>)
    expect(await screen.findByText("Drinking water")).toBeTruthy()
    expect(screen.getByText("75 litre")).toBeTruthy()
    expect(screen.getByText("Items reserved for Events")).toBeTruthy()
    expect(screen.getByText("Low-stock alerts")).toBeTruthy()
    for (const heading of ["Stock type", "Storage location", "Total in storage", "Reserved for Events", "Available", "Stock status"]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeTruthy()
    }
    expect(screen.getByText("Enough stock")).toBeTruthy()
    expect(screen.getByText("Alert below 20 litre")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Export Stock as CSV" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Export Stock as Excel" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "New Item" }))
    const inventoryDialog = screen.getByRole("dialog")
    expect(inventoryDialog.getAttribute("aria-modal")).toBe("true")
    expect(screen.getByLabelText("How do you count this item?")).toBeTruthy()
    expect(screen.getByLabelText("Starting quantity")).toBeTruthy()
    expect(screen.getByLabelText("Store at")).toBeTruthy()
    expect(screen.getByLabelText("Item code (optional)")).toBeTruthy()
    expect(screen.getByText(/10 one-litre bottles/)).toBeTruthy()
    await user.type(screen.getByLabelText("Item name"), "Packing tape (50 m)")
    await user.selectOptions(screen.getByLabelText("How do you count this item?"), "roll")
    await user.clear(screen.getByLabelText("Starting quantity"))
    await user.type(screen.getByLabelText("Starting quantity"), "10")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(api.createItem).toHaveBeenCalledWith({ name: "Packing tape (50 m)", sku: null, description: "", unit: "roll", item_type: "consumable", reorder_level: 0 })
    expect(api.adjustStock).toHaveBeenCalledWith({ item_id: 3, location_id: 2, quantity_delta: 10, reason: "Opening balance when Item was created" })
    await user.click(screen.getByRole("tab", { name: "Orders & Deliveries" }))
    expect(await screen.findByText("No orders or deliveries yet.")).toBeTruthy()
    expect(screen.getByText(/Track goods and services requested from external Organizations/)).toBeTruthy()
    await user.click(screen.getByRole("tab", { name: "External Partners" }))
    expect(screen.getByText(/suppliers, donors, transport providers, and Venue contacts/)).toBeTruthy()
    await user.click(screen.getByRole("tab", { name: "Storage Locations" }))
    expect(screen.getByText(/every place where stock is stored/)).toBeTruthy()
    await user.click(screen.getByRole("tab", { name: "Stock History" }))
    expect(screen.getByText(/audit history of stock added, removed, transferred/)).toBeTruthy()
  })

  it("updates stock and closes the adjustment dialog after saving", async () => {
    const initialStock = { item_id: 1, item_name: "Drinking water", sku: "WATER", item_type: "consumable", unit: "litre", reorder_level: 20, location_id: 2, location_name: "Main store", on_hand: 100, reserved: 25, available: 75, expiring: 5, reorder_status: false }
    const updatedStock = { ...initialStock, on_hand: 110, available: 85 }
    const api = {
      listStock: vi.fn().mockResolvedValueOnce({ items: [initialStock], total: 1 }).mockResolvedValue({ items: [updatedStock], total: 1 }),
      listItems: vi.fn().mockResolvedValue({ items: [{ id: 1, name: "Drinking water", sku: "WATER", description: "", unit: "litre", item_type: "consumable", reorder_level: 20, is_active: true }], total: 1, limit: 100, offset: 0 }),
      listLocations: vi.fn().mockResolvedValue({ items: [{ id: 2, name: "Main store", address: "", event_id: null, venue_space_id: null, is_temporary: false, is_active: true }], total: 1, limit: 100, offset: 0 }),
      listOrders: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listOrganizations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listVenues: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listDonations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listMovements: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      adjustStock: vi.fn().mockResolvedValue({ id: 9 }),
    } as unknown as LogisticsApi
    const user = userEvent.setup()

    render(<main className="product-app"><InventoryPage api={api} /></main>)
    expect(await screen.findByText("Drinking water")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Adjust stock" }))
    await user.selectOptions(screen.getByLabelText("Inventory Item"), "1")
    await user.selectOptions(screen.getByLabelText("Location"), "2")
    await user.type(screen.getByLabelText("Quantity change (+ or −)"), "10")
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText("Mandatory reason"), "Received delivery")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(api.adjustStock).toHaveBeenCalledWith({ item_id: 1, location_id: 2, quantity_delta: 10, reason: "Received delivery", expiry_date: null })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(await screen.findByText("110 litre")).toBeTruthy()
  })

  it("keeps the refreshed stock row when an older load finishes afterward", async () => {
    let releaseInitialStock!: (value: { items: never[]; total: number }) => void
    const initialStock = new Promise<{ items: never[]; total: number }>((resolve) => { releaseInitialStock = resolve })
    const newStock = { item_id: 3, item_name: "Packing tape", sku: null, item_type: "consumable", unit: "roll", reorder_level: 0, location_id: 2, location_name: "Main store", on_hand: 10, reserved: 0, available: 10, expiring: 0, reorder_status: false }
    const api = {
      listStock: vi.fn().mockReturnValueOnce(initialStock).mockResolvedValue({ items: [newStock], total: 1 }),
      listItems: vi.fn().mockResolvedValue({ items: [{ id: 3, name: "Packing tape", sku: null, description: "", unit: "roll", item_type: "consumable", reorder_level: 0, is_active: true }], total: 1, limit: 100, offset: 0 }),
      listLocations: vi.fn().mockResolvedValue({ items: [{ id: 2, name: "Main store", address: "", event_id: null, venue_space_id: null, is_temporary: false, is_active: true }], total: 1, limit: 100, offset: 0 }),
      listOrders: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listOrganizations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listVenues: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listDonations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listMovements: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      createItem: vi.fn().mockResolvedValue({ id: 3, name: "Packing tape", sku: null, description: "", unit: "roll", item_type: "consumable", reorder_level: 0, is_active: true }),
      adjustStock: vi.fn().mockResolvedValue({ id: 9 }),
    } as unknown as LogisticsApi
    const user = userEvent.setup()

    render(<main className="product-app"><InventoryPage api={api} /></main>)
    await user.click(screen.getByRole("button", { name: "New Item" }))
    await user.type(screen.getByLabelText("Item name"), "Packing tape")
    await user.selectOptions(screen.getByLabelText("How do you count this item?"), "roll")
    await user.clear(screen.getByLabelText("Starting quantity"))
    await user.type(screen.getByLabelText("Starting quantity"), "10")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Packing tape")).toBeTruthy()
    releaseInitialStock({ items: [], total: 0 })
    await waitFor(() => expect(screen.getByText("Packing tape")).toBeTruthy())
  })

  it("shows an active item with no stock as a zero-stock row", async () => {
    const api = {
      listStock: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listItems: vi.fn().mockResolvedValue({ items: [{ id: 3, name: "Tables", sku: null, description: "", unit: "piece", item_type: "reusable", reorder_level: 0, is_active: true }], total: 1, limit: 100, offset: 0 }),
      listLocations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listOrders: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listOrganizations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listVenues: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listDonations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listMovements: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
    } as unknown as LogisticsApi

    render(<main className="product-app"><InventoryPage api={api} /></main>)
    expect(await screen.findByText("Tables")).toBeTruthy()
    expect(screen.getByText("No stock recorded")).toBeTruthy()
    expect(screen.getAllByText("0 piece").length).toBeGreaterThan(0)
  })

  it("shows independent shortage and on-site readiness and opens a detail drawer", async () => {
    const api = {
      getEventLogistics: vi.fn().mockResolvedValue({
        event: { id: 4, name: "Community Day", status: "open", expected_attendance: 120 },
        forecast: { registrations: 150, historical_show_up_rate: 0.7, similar_event_sample_size: 3, suggested_attendance: 105, calculation_basis: "same_event_template" },
        requirements: [{ id: 8, event_id: 4, requirement_type: "goods", inventory_item_id: 1, service_name: null, name: "Drinking water", required_quantity: 120, unit: "litre", needed_by: "2026-09-20T08:00:00", priority: "critical", notes: "", is_cancelled: false, allocations: [], inventory_reserved: 40, inventory_issued: 10, supplier_ordered: 50, supplier_on_site: 20, on_site: 30, still_to_source: 20, not_yet_on_site: 90, status: "uncovered" }],
        venue_bookings: [], reconciliation: { event_id: 4, status: "not_started", completed_at: null, notes: "" },
        warnings: [{ type: "shortage", requirement_id: 8, message: "Water is short" }],
      }),
      listLocations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listItems: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listOrganizations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listVenues: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      cancelEventRequirement: vi.fn().mockResolvedValue(undefined),
    } as unknown as LogisticsApi
    const user = userEvent.setup()

    render(<EventLogistics eventId={4} eventStatus="open" api={api} />)
    expect(await screen.findByText("20 litre")).toBeTruthy()
    expect(screen.getByText("90 litre")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Export Event Requirements as CSV" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Export Event Requirements as Excel" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: /Open Drinking water logistics/ }))
    expect(screen.getByRole("dialog", { name: "Drinking water logistics" })).toBeTruthy()
    expect(screen.getByText("Allocation & sourcing")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Cancel Requirement" })).toBeTruthy()
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await user.click(screen.getByRole("button", { name: "Cancel Requirement" }))
    expect(api.cancelEventRequirement).toHaveBeenCalledWith(4, 8)
  })
})
