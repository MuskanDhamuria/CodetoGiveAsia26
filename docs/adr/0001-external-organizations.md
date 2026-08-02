# ADR 0001: Unify outside partners as External Organizations

Status: accepted

## Context

Events currently store partner names in `event_partners`. Logistics introduces
suppliers, donors, transport providers, venue partners, government agencies,
dormitories, NGOs and education providers. A narrow Supplier table would create
duplicates when the same organization serves several roles and would leave
contact information scattered across orders and Events.

## Decision

Use one `external_organizations` record with reusable capability rows and
multiple historical contacts. Link organizations to Events through
`event_organizations`; Supplier Orders, Venues and Donation Batches reference
the same identity.

Migration 008 promotes distinct legacy `event_partners.name` values into
organizations and Event links. The legacy table remains populated as a
display/report snapshot so existing reports retain their output while clients
migrate to structured organization records.

## Consequences

- One organization can be both, for example, a donor and transport provider.
- Contacts can be made inactive without losing operational history.
- New Event links mirror the organization name to `event_partners` for report
  compatibility; structured organization IDs are the source of truth.
- Renaming an organization does not rewrite historical name snapshots.
