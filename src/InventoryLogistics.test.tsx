// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import InventoryPage from "./InventoryPage"
import EventLogistics from "./EventLogistics"
import type { LogisticsApi } from "./logistics-api"

afterEach(cleanup)

describe("Inventory and Event Logistics", () => {
  it("renders stock balances and switches independent workbench views", async () => {
    const api = {
      listStock: vi.fn().mockResolvedValue({ items: [{ item_id: 1, item_name: "Drinking water", sku: "WATER", item_type: "consumable", unit: "litre", reorder_level: 20, location_id: 2, location_name: "Main store", on_hand: 100, reserved: 25, available: 75, expiring: 5, reorder_status: false }], total: 1 }),
      listItems: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listLocations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listOrders: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listOrganizations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listVenues: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listDonations: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
      listMovements: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
    } as unknown as LogisticsApi
    const user = userEvent.setup()

    render(<InventoryPage api={api} />)
    expect(await screen.findByText("Drinking water")).toBeTruthy()
    expect(screen.getByText("75 litre")).toBeTruthy()
    await user.click(screen.getByRole("tab", { name: "Orders & Deliveries" }))
    expect(await screen.findByText("No Supplier Orders yet.")).toBeTruthy()
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
    } as unknown as LogisticsApi
    const user = userEvent.setup()

    render(<EventLogistics eventId={4} eventStatus="open" api={api} />)
    expect(await screen.findByText("20 litre")).toBeTruthy()
    expect(screen.getByText("90 litre")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: /Open Drinking water logistics/ }))
    expect(screen.getByRole("dialog", { name: "Drinking water logistics" })).toBeTruthy()
    expect(screen.getByText("Allocation & sourcing")).toBeTruthy()
  })
})
