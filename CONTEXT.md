# Passion to Serve Operations Platform

This repository implements a centralized operations platform for Passion to Serve. The current organizer-facing scope covers Event planning, Tasks, Inventory, Logistics, sourcing, Venues, donations, and post-Event reconciliation. Volunteer registration and signup remain a separate feature area and must not be changed as part of organizer work.

## Current Product State

The organizer frontend currently provides:

- An API-backed Dashboard with Event KPIs, upcoming Task deadlines, and an interactive Event calendar.
- An Events workspace with Event lifecycle actions, Kanban Tasks, Subtasks, internal assignments, and Task progress.
- A top-level Inventory workspace for Stock, Locations, Orders and Deliveries, External Organizations, Venues, Donations, and Stock Movements.
- An Event-specific Logistics workspace for Requirements, Inventory allocations, external sourcing, delivery readiness, Venue Bookings, attendance planning, and post-Event reconciliation.

The FastAPI backend and SQLite database provide the organizer APIs used by these screens. Inventory and Logistics were introduced by migration `008_inventory_logistics.sql`. Seed data can be populated idempotently through `backend/seed.py`.

## Bounded Contexts

### Event Planning

Owns Event Templates, Events, Tasks, Subtasks, Team Member assignments, Event status, scheduling, and Dashboard summaries.

### Inventory

Owns Inventory Items, Inventory Locations, Inventory Lots, Stock Movements, reservations, transfers, and adjustments. It represents goods physically controlled by the organization.

### Event Logistics

Owns Event Requirements, allocations, sourcing progress, attendance planning, Venue Bookings, delivery readiness, and Logistics Reconciliation.

### External Fulfilment

Owns External Organizations, contacts, Supplier Orders, order lines, fulfilments, rentals, and services.

### Donations

Owns aggregate Donation Batches from collection through receipt, sorting, distribution, and closure. Sorted usable goods may become Inventory Lots.

### Volunteer Operations

Owns volunteer records, registrations, signups, and volunteer-facing screens. Organizer Task assignees are Team Members, never Volunteers. This context is outside the current Inventory and Logistics work.

## Ubiquitous Language

### Events and Work

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Event Template** | A reusable workflow containing Task definitions and optional Logistics Requirements whose dates are relative to an Event date. It may be built in or user-created. | Event type, flow |
| **Event** | A scheduled instance with its own name, date, venue display snapshot, expected attendance, generated Tasks, and Logistics Requirements. | Project |
| **Task** | A Kanban work item belonging to an Event, with a category, deadline, status, optional description, optional Team Member assignee, and optional Subtasks. | Activity, card, volunteer task |
| **Subtask** | A checklist item within a Task. It is not scheduled or assigned independently. | Independent Task |
| **Team Member** | An internal organizer who may be assigned responsibility for an Event Task. | Volunteer |
| **Volunteer** | A participant recruited to help execute an Event. A Volunteer is not automatically eligible for internal Task assignment. | Team Member, assignee |
| **Expected Attendance** | The organizer's editable planning estimate used to calculate quantity-based Logistics Requirements. | Registration count, actual attendance |
| **Registration Count** | The current number of registered participants or volunteers exposed by the attendance forecast. | Expected attendance, actual attendance |
| **Actual Attendance** | The recorded number of people who attended a completed Event, used as historical forecast evidence. | Registration count |

### Inventory and Requirements

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Event Requirement** | A physical good or service needed by an Event in a specified quantity or scope. A goods Requirement references an Inventory Item; a service Requirement does not affect stock. | Logistics item, Inventory need |
| **Inventory Item** | A physical good tracked in a fixed Unit of Measure and classified as consumable or reusable. Services and Venue Bookings are not Inventory Items. | Event Requirement, service |
| **Inventory Lot** | A quantity of one Inventory Item held at one Inventory Location, with a source, received date, optional expiry date, condition, and current quantity. | Inventory Item, allocation |
| **Inventory Location** | A place where organization-controlled stock is held and counted, including temporary Event-site storage. It is distinct from a Venue. | Venue, delivery address |
| **Inventory Allocation** | A quantity reserved from a specific Inventory Lot or Location for an Event Requirement. A reservation reduces Available Stock without changing On-hand Stock. | Supplier Order, Stock Movement |
| **Stock Movement** | An immutable ledger record for stock received, transferred, issued, returned, consumed, damaged, lost, distributed, disposed of, or adjusted. | Allocation, direct balance edit |
| **On-hand Stock** | The physical quantity recorded in usable, unexpired Inventory Lots before active reservations are deducted. | Available Stock |
| **Available Stock** | Usable, unexpired On-hand Stock minus active reserved quantities. | On-hand Stock |
| **Unit of Measure** | The fixed unit used for an Item or Requirement, such as piece, box, kilogram, litre, or metre. | Display unit, automatic conversion |
| **Adjustment** | A reasoned correction represented by a Stock Movement. Stock balances are never overwritten directly. | Direct quantity edit |

### Organizations, Orders, Venues, and Donations

| Term | Meaning | Avoid |
| --- | --- | --- |
| **External Organization** | A reusable outside organization with one or more capabilities: supplier, donor, transport provider, Venue partner, NGO, government agency, dormitory, or education provider. | Supplier as an entity type, free-text partner |
| **Organization Contact** | A named contact belonging to an External Organization. An organization may retain multiple active or inactive contacts and one primary contact. | Team Member |
| **Supplier Order** | A commitment for an External Organization to provide purchased goods, rented goods, or services, with delivery or collection details and optional Event linkage. | Inventory Allocation, partner note |
| **Order Fulfilment** | A partial or complete receipt, delivery, rental return, or service-completion record against a Supplier Order. | Order line |
| **Venue** | A named physical place managed optionally by an External Organization and containing one or more Venue Spaces. | Inventory Location, supplier |
| **Venue Space** | A bookable room or area within a Venue with its own pax capacity and accessibility information. | Venue, Inventory Location |
| **Venue Booking** | A reservation of a Venue Space for an Event over a start and end time. One booking may be the Event's primary public location. | Event venue string, booking duration |
| **Donation Batch** | An aggregate collection of donated goods tracked through collection, receipt, sorting, distribution, and closure. | Individual donor item, Inventory Item |
| **Logistics Reconciliation** | The post-Event process of recording consumed, returned, damaged, lost, or remaining goods and resolving rental returns. | Event closure, stocktake only |

## Core Domain Rules

### Event lifecycle

- An open Event permits editing, Task changes, allocations, sourcing, and Venue Booking changes.
- A closed Event is read-only except for Logistics Reconciliation actions.
- Reopening an Event restores organizer editing controls.
- Closing an Event creates or updates its Logistics Reconciliation to `pending`.
- Event deletion is permanent and cascades to its dependent Tasks and operational records according to database relationships.
- Rescheduling may shift Task deadlines and Logistics Requirement needed-by dates when the organizer enables deadline shifting.

### Template snapshots and attendance planning

- Creating an Event from a Template copies Task and Logistics Requirement definitions into Event-owned snapshots.
- A Template goods Requirement must reference an Inventory Item. A service Requirement uses a service name and never changes stock.
- The initial required quantity is calculated as:

  `ceil((base_quantity + quantity_per_person × expected_attendance) × (1 + buffer_percentage / 100))`

- The calculated result is stored on the Event Requirement and remains editable.
- Registration changes never silently recalculate a saved Requirement.
- The attendance forecast is deterministic and advisory. It uses closed Events with recorded attendance from the same Event Template, then falls back to the same beneficiary group.
- A historical suggestion requires sufficient comparable history; otherwise the API returns no suggestion.
- Expected Attendance, Registration Count, and Actual Attendance are separate values and must not be presented as interchangeable.

### Requirement readiness

- Requirement status is derived as `uncovered`, `sourced`, `on_site`, `fulfilled`, or `cancelled`.
- `Still to Source` and `Not Yet on Site` answer different questions and are calculated independently.
- Inventory reservations, issued stock, Supplier Order quantities, and fulfilments contribute to readiness without being collapsed into one balance.
- Cancelling a Requirement excludes it from active sourcing and fulfilment work without deleting its history.

### Stock integrity

- Quantities support up to three decimal places.
- Each Inventory Item has one fixed Unit of Measure; the system performs no automatic unit conversions.
- Only usable, unexpired Inventory Lots are available for reservation.
- Lots marked `pending_sort`, `damaged`, `expired`, or `discarded` are unavailable.
- A reservation cannot exceed Available Stock. Over-allocation returns `409 Conflict`.
- Issuing, consuming, transferring, returning, damaging, losing, distributing, disposing of, or adjusting stock must create Stock Movements.
- Stock must never become negative.
- Adjustments require a reason and must not overwrite a Lot balance directly.

### Supplier Orders

- Each Supplier Order has exactly one type: `purchase`, `rental`, or `service`.
- The normal lifecycle is `draft → confirmed → in_progress → completed`.
- An Order may be cancelled before completion.
- Partial fulfilments are supported.
- Receiving purchased goods creates Inventory Lots and receipt movements.
- Rentals never enter organizational Inventory and require return or collection resolution.
- Services complete through an explicit fulfilment record and never affect stock.
- Costs are optional, SGD-only, and stored as integer cents.

### Venues

- Confirmed bookings for the same Venue Space must not overlap.
- Exceeding Venue Space capacity produces a warning rather than blocking the booking.
- Structured Venue Bookings are optional for legacy Events.
- The primary Venue Booking updates `events.venue` as a compatibility and display snapshot.

### Donations

- Donation tracking is aggregate and quantity-based.
- Unsorted goods remain `pending_sort` and unavailable.
- Sorting creates Inventory Lots; only quantities classified as usable become Available Stock.
- Individual donor-to-beneficiary item selection is outside the current model.

### Reconciliation

- Logistics Reconciliation has the states `not_started`, `pending`, and `completed`.
- Closing an Event does not mean reconciliation is complete.
- Reconciliation remains editable after Event closure.
- Finalization is blocked while issued goods or rented quantities remain unresolved.

## Key Relationships

- An Event Template has many Task definitions and Template Logistics Requirements.
- An Event may originate from one Event Template and owns many Tasks, Event Requirements, Venue Bookings, Supplier Orders, and linked External Organizations.
- A Task belongs to one Event, may have many Subtasks, and may be assigned to one Team Member.
- An Inventory Item has many Inventory Lots; each Lot belongs to one Inventory Location.
- An Event Requirement may have many Inventory Allocations and Supplier Order Lines.
- An External Organization has many Contacts and may be linked to many Events, Supplier Orders, Venues, and Donation Batches.
- A Venue has many Venue Spaces; a Venue Space has many non-overlapping confirmed Venue Bookings.
- A Donation Batch may create multiple Inventory Lots during sorting.
- An Event has at most one Logistics Reconciliation record.

## Implementation Map

### Backend

- Database migration: `backend/migrations/008_inventory_logistics.sql`
- Organizer API contract: `backend/API_ENDPOINTS.md`
- Inventory router and schemas: `backend/routers/inventory.py`, `backend/schema/inventory.py`
- Event Logistics router and schemas: `backend/routers/logistics.py`, `backend/schema/logistics.py`
- External Organization and Supplier Order router and schemas: `backend/routers/organizations.py`, `backend/schema/organizations.py`
- Venue and Donation router and schemas: `backend/routers/venues.py`, `backend/schema/venues.py`
- External Organization compatibility decision: `docs/adr/0001-external-organizations.md`

### Frontend

- The top-level `Inventory` navigation item exposes Stock, Locations, Orders and Deliveries, Organizations, Venues, Donations, and Movements.
- The Event workspace exposes `Tasks | Logistics` navigation.
- Logistics uses a primary Requirement table and a detail drawer for allocation, sourcing, delivery, and history.
- Dashboard sections load independently so one API failure does not blank the whole page.

## Compatibility and Naming Notes

- `events.venue` is a legacy display snapshot; Venue, Venue Space, and Venue Booking are the structured model.
- Legacy `event_partners` names are preserved through migration into External Organizations and Event links. New work should not create name-only partners.
- A supplier is an External Organization with the `supplier` capability, not a separate entity type.
- “Location” is ambiguous. Use **Inventory Location**, **Venue**, or **Venue Space** explicitly.
- “Partner” is ambiguous. Use **External Organization** and name its capability.
- “Stock” is ambiguous. Use **On-hand Stock**, **Reserved Stock**, or **Available Stock**.
- “Attendance” is ambiguous. Use **Expected Attendance**, **Registration Count**, or **Actual Attendance**.
- “Complete” is ambiguous. Specify whether an Event, Task, Supplier Order, Requirement, or Logistics Reconciliation is complete.

## Deferred and Out-of-Scope Work

- Changes to volunteer registration, signup endpoints, and volunteer-facing screens.
- Direct WhatsApp, push notification, SMS, or email delivery.
- AI-based attendance estimation; the current forecast is deterministic.
- Serialized asset tracking and maintenance history.
- Automatic Unit of Measure conversions.
- Individual donation selection and beneficiary-level distribution records.
- Authentication and authorization; Stock Movement actor fields remain nullable.
- Team Member management screens, admin Event-time support, and smaller organizer gaps scheduled after Inventory and Logistics.

## Example Domain Dialogue

> **Organizer:** We expect 120 attendees. What do we still need for this Event?
>
> **System:** The Event Requirements have been calculated and saved. Forty meal boxes are Still to Source, while 80 are reserved from the main Inventory Location. The saved quantity will not change automatically if registrations change.

> **Organizer:** Reserve another 20 litres of water from the warehouse.
>
> **System:** The warehouse has only 12 litres of Available Stock. The reservation is rejected to prevent over-allocation; On-hand Stock remains unchanged.

> **Organizer:** The supplier delivered half of our purchase today.
>
> **System:** Record a partial Order Fulfilment. The received purchased goods create an Inventory Lot and receipt Stock Movement; the remaining order quantity stays open.

> **Organizer:** Close the Event now and settle the leftovers tomorrow.
>
> **System:** The Event is closed and read-only, while Logistics Reconciliation is pending. Reconciliation actions remain available until issued goods and rentals are resolved.
