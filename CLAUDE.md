# Fleetpro — Product Context (prototype, RAC Check-out flow)

## What this is
The rental car check-out flow: from contract creation (with or without a
prior reservation) to the signed vehicle handover report. It involves two
devices synced live: the counter executive's computer and a tablet used by
the client.

## Brand palette
- primary / GRAY LEASING — #415364 — navigation, headers
- accent / DEEP PURPLE — #6538e5 — CTAs, selected states
- secondary / MID GRAY — #637b8f — secondary text, borders
- Backgrounds: #FFFFFF or #F4F5F7
- Vehicle status colors: green = available, deep purple = rented,
  yellow = in prep, mid gray = inactive

## Two distinct visual experiences
- Executive view: medium-high information density, mouse/keyboard-driven,
  "control panel" feel.
- Client view (tablet): very few elements per screen, large text, generous
  touch targets, landscape orientation. This is the view the client
  directly sees and touches — it should feel premium, not administrative
  (think Orange/SIXT counter experience).

## Pairing model
The executive computer and the client tablet are paired ONCE per counter
(a "Station"), not once per customer. Pairing persists across every
contract of the shift via credentials stored in localStorage on both
devices. A new contract is pushed to the already-paired tablet over the
same open channel — no new PIN/QR per customer. Re-pairing only happens on
explicit unlink or when setting up a new tablet.

Station.branch_id is only the *default* working branch, not a hard
constraint — the executive can switch which branch's reservations/fleet
they're browsing or starting a walk-in for (multi-branch switching,
Executive Main design: a counter serving several nearby branches, an
airport counter being the canonical case) without re-pairing. A
reservation-based contract always takes its branch from the reservation's
own pickup_branch_id, not the station. The switch is UI-only state — it
resets to the station's own branch on reload.

## Data model
Driver
  id, first_name, last_name, email
  national_id_or_passport, phone, license_number, license_expiration
  id_photo_url, license_photo_url
  documents_verified (bool)
  preferred_color, preferred_transmission
  last_visit_date
  tier (Standard | Silver | Gold | Corporate) — assigned by the business
    (seed data only; no loyalty-program management UI). See "Customer
    loyalty tiers" below and app/checkout/tiers.py for what each tier
    actually changes.

Reservation  (seeded with sample data; its creation flow is out of scope)
  id, driver_first_name, driver_last_name, driver_email
  pickup_date, return_date, pickup_branch_id, acriss_category_id
  deposit_done_online (bool)
  status

ReservationExtra
  reservation_id, extra_id

ACRISSCategory
  id, code, name, hierarchy_order, base_daily_rate
  features: { transmission, air_conditioning, bluetooth,
              passenger_capacity, trunk_capacity_l }

Vehicle
  id, plate, make, model, year, acriss_category_id, branch_id
  status (Available | Rented | InPrep | Inactive)
  current_km, next_service_km, damage_count
  main_photo_url

Station
  id, branch_id, label (e.g. "Counter 3")
  pairing_token (secret, known only to the paired tablet)
  active_contract_id (nullable, FK to the contract currently being handled)
  paired_at, last_seen_at

RentalContract
  id, reservation_id (nullable), driver_id, vehicle_id, branch_id, station_id
  origin (from_reservation | walk_in)
  opened_at, departure_km, departure_fuel_level
  status (New | PreOpened | Open)

ContractExtra
  contract_id, extra_id, quantity, applied_price

Deposit
  id, contract_id, amount (500000 base, tier-adjusted — see below)
  mechanism (online_in_advance | in_person | waived), status (pending | authorized)
  authorized_at

DigitalSignature
  id, contract_id, type (contract | handover_report), image_base64, timestamp

PreHandoverReport
  id, vehicle_id, photos[], damage_diagram (json), created_at, consumed (bool)

HandoverReport
  id, contract_id, pre_handover_report_id (nullable)
  photos[], damage_diagram (json), delivery_km, delivery_fuel_level
  signature_id, pdf_url, status (pending | completed), date

## Customer loyalty tiers
Standard / Silver / Gold / Corporate — assigned by the business ahead of
time (seed data), never set by an executive or a driver through this app
(no loyalty-program management UI, same "out of scope" spirit as below).
A tier changes:
- The security deposit: waived for Gold, halved for Silver, full for
  Standard/Corporate (see the critical business rule below).
- Certain extras become free (e.g. Additional Driver, Child Seat, Full
  Insurance, depending on tier) when the executive sets the contract's
  extras.
- A discount percentage shown to the executive as a commercial-conditions
  line item. This is informational only — there's no quoting/pricing
  engine in this app (see "Out of scope") to actually deduct it from a
  charge.

A tier is never a shortcut past the license/documents-verified gate below.

## Critical business rules (enforce in the backend, not just the UI)
- Cannot proceed to vehicle selection if the driver's license is expired or
  documents haven't been verified by the executive.
- The deposit is $500,000 CLP by default; the contract cannot be signed
  without the deposit in "authorized" status. A Gold-tier driver's deposit
  is waived (authorized automatically at $0); a Silver-tier driver's is
  half price ($250,000). See "Customer loyalty tiers" above.
- The upsell can never be an equal or lower category than the original.

## Out of scope
Quoting, Reservation Planner, check-in, settlement, LOP, workshops,
Finance/e-invoicing, used cars, real payment gateway, real scanning
hardware.

## Stack
Frontend: React + Vite, Vercel. Backend: FastAPI, Render. DB: Neon
(Postgres). Real-time sync: native FastAPI WebSocket. Document OCR:
Claude API (claude-sonnet-5 model) via the Python SDK.