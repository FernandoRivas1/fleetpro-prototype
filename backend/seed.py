"""Populate the database with sample data for local development / demos.

Re-runnable: it clears the rows it owns (in FK-safe order) before
re-inserting, so `python seed.py` always leaves the DB in the same state.
Run `alembic upgrade head` first so the tables exist.

Seeds, per the Fleetpro prototype spec (plus later additions, noted below):
  - 4 ACRISS categories with a hierarchy and features (ECAR < CDAR < ICAR < FVAR)
  - 17 vehicles, mostly Available with deliberately varied mileage / next-service
    data so a "needs service soon" ranking is visibly meaningful, plus one
    each of Rented / InPrep / Inactive so the fleet view's status colors
    (CLAUDE.md) all have something to render
  - 4 drivers, one per loyalty tier (app/checkout/tiers.py): a Gold driver
    with valid, verified documents; a Corporate driver with an EXPIRED
    license (tier is never a shortcut past that gate — CLAUDE.md); a
    Standard and a Silver driver, both clear to check out; plus two
    personas that intentionally have NO Driver row, to simulate first-time
    walk-ins the executive will register from scratch (see WALK_IN_* below
    — only referenced by name/email in reservations)
  - 7 reservations (one with deposit_done_online=True), spread across all
    three branches
  - 3 reservation pre-check-ins (app/checkout/precheckin.py), one per
    non-terminal PrecheckinStatus (requested / loaded / confirmed), so the
    executive's Pre Check-in queue has something at every stage
  - 2 pre-handover reports, for 2 of the vehicles, not consumed
  - 5 extras

Branches aren't their own bullet in the spec but are a required FK on
Vehicle/Reservation/Station/RentalContract, so three are seeded as
prerequisite data (a third added alongside multi-branch switching, so
there's more than two to switch between).
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.checkout.models import (
    ContractExtra,
    Deposit,
    DigitalSignature,
    Driver,
    RentalContract,
    Reservation,
    ReservationPrecheckin,
    Station,
)
from app.database import SessionLocal
from app.fleet.models import ACRISSCategory, Vehicle
from app.models_registry import Base  # noqa: F401 — ensures every model is registered
from app.reports.models import HandoverReport, PreHandoverReport
from app.shared.enums import CustomerTier, PrecheckinStatus, ReservationStatus, TransmissionType, VehicleStatus
from app.shared.models import Branch, Extra

# Two "driver" personas that intentionally have no Driver row. A reservation
# references these directly (Reservation stores driver name/email inline,
# not a driver_id FK) so the check-out flow can be exercised against a
# customer who hasn't been registered yet — one at each of the first two
# branches.
WALK_IN_FIRST_NAME = "Camila"
WALK_IN_LAST_NAME = "Rojas"
WALK_IN_EMAIL = "camila.rojas@example.com"

WALK_IN_2_FIRST_NAME = "Diego"
WALK_IN_2_LAST_NAME = "Fernandez"
WALK_IN_2_EMAIL = "diego.fernandez@example.com"


def clear_seeded_tables(db) -> None:
    """Delete rows this script owns, children before parents.

    Also sweeps rental_contracts and everything that hangs off them
    (contract extras, deposits, signatures, handover reports) even though
    seed.py doesn't create those itself — they're checkout-flow test
    artifacts that pile up on top of seeded reservations/vehicles/drivers
    as the app gets used, and would otherwise block the deletes below with
    FK violations. Stations themselves are left alone (paired through the
    app, not seeded) — only their active_contract_id pointer is cleared
    first, since it FKs into the rental_contracts row being deleted.
    """
    db.query(Station).update({Station.active_contract_id: None})
    db.query(HandoverReport).delete()
    db.query(ContractExtra).delete()
    db.query(Deposit).delete()
    db.query(DigitalSignature).delete()
    db.query(RentalContract).delete()
    db.query(PreHandoverReport).delete()
    db.query(ReservationPrecheckin).delete()
    db.query(Reservation).delete()
    db.query(Vehicle).delete()
    db.query(Driver).delete()
    db.query(ACRISSCategory).delete()
    db.query(Extra).delete()
    # Branch is deliberately NOT cleared here — see seed_branches, which
    # upserts by code instead. Station.branch_id is a real FK held by
    # devices paired through actual app usage (not reseeded here), so
    # branch ids have to stay stable across reseeds or every paired
    # station would dangle.
    db.commit()


def seed_branches(db) -> dict[str, Branch]:
    """Upsert by code rather than delete-and-recreate — see the note in
    clear_seeded_tables: Station.branch_id outlives a reseed, so existing
    branch ids must be preserved, not replaced with fresh ones."""
    rows = [
        ("SCL-CTR", "Sucursal Centro", "Av. Providencia 1234, Santiago"),
        ("SCL-APT", "Sucursal Aeropuerto", "Aeropuerto AMB, Terminal Rent a Car"),
        ("SCL-NUN", "Sucursal Ñuñoa", "Av. Irarrázaval 3400, Santiago"),
    ]
    existing = {b.code: b for b in db.query(Branch).all()}
    branches: dict[str, Branch] = {}
    for code, name, address in rows:
        branch = existing.get(code)
        if branch is None:
            branch = Branch(id=uuid.uuid4(), code=code, name=name, address=address)
            db.add(branch)
        else:
            branch.name = name
            branch.address = address
        branches[code] = branch
    db.flush()
    return branches


def seed_categories(db) -> dict[str, ACRISSCategory]:
    categories = [
        ACRISSCategory(
            id=uuid.uuid4(),
            code="ECAR",
            name="Economy Car",
            hierarchy_order=1,
            base_daily_rate=25000,
            features={
                "transmission": TransmissionType.MANUAL.value,
                "air_conditioning": True,
                "bluetooth": False,
                "passenger_capacity": 4,
                "trunk_capacity_l": 280,
            },
        ),
        ACRISSCategory(
            id=uuid.uuid4(),
            code="CDAR",
            name="Compact Car",
            hierarchy_order=2,
            base_daily_rate=32000,
            features={
                "transmission": TransmissionType.MANUAL.value,
                "air_conditioning": True,
                "bluetooth": True,
                "passenger_capacity": 5,
                "trunk_capacity_l": 380,
            },
        ),
        ACRISSCategory(
            id=uuid.uuid4(),
            code="ICAR",
            name="Intermediate Car",
            hierarchy_order=3,
            base_daily_rate=42000,
            features={
                "transmission": TransmissionType.AUTOMATIC.value,
                "air_conditioning": True,
                "bluetooth": True,
                "passenger_capacity": 5,
                "trunk_capacity_l": 450,
            },
        ),
        ACRISSCategory(
            id=uuid.uuid4(),
            code="FVAR",
            name="Full-size Van/SUV",
            hierarchy_order=4,
            base_daily_rate=58000,
            features={
                "transmission": TransmissionType.AUTOMATIC.value,
                "air_conditioning": True,
                "bluetooth": True,
                "passenger_capacity": 7,
                "trunk_capacity_l": 600,
            },
        ),
    ]
    db.add_all(categories)
    db.flush()
    return {c.code: c for c in categories}


def seed_vehicles(
    db, categories: dict[str, ACRISSCategory], branches: dict[str, Branch]
) -> dict[str, Vehicle]:
    centro = branches["SCL-CTR"].id
    aeropuerto = branches["SCL-APT"].id
    nunoa = branches["SCL-NUN"].id

    # (plate, make, model, year, category_code, branch_id, current_km, next_service_km, damage_count, status)
    rows = [
        ("RJKL-11", "Chevrolet", "Sail", 2023, "ECAR", centro, 8_500, 10_000, 0, VehicleStatus.AVAILABLE),
        ("RJKL-12", "Chevrolet", "Sail", 2022, "ECAR", centro, 52_000, 55_000, 1, VehicleStatus.AVAILABLE),
        ("RJKL-13", "Suzuki", "Alto", 2023, "ECAR", aeropuerto, 15_000, 20_000, 0, VehicleStatus.AVAILABLE),
        ("HZRT-21", "Toyota", "Yaris", 2023, "CDAR", centro, 12_000, 15_000, 0, VehicleStatus.AVAILABLE),
        ("HZRT-22", "Toyota", "Yaris", 2021, "CDAR", aeropuerto, 78_000, 80_000, 2, VehicleStatus.AVAILABLE),
        ("HZRT-23", "Hyundai", "Accent", 2022, "CDAR", centro, 34_000, 40_000, 0, VehicleStatus.AVAILABLE),
        ("LMNB-31", "Toyota", "Corolla", 2023, "ICAR", aeropuerto, 6_000, 10_000, 0, VehicleStatus.AVAILABLE),
        ("LMNB-32", "Nissan", "Sentra", 2022, "ICAR", centro, 41_000, 45_000, 0, VehicleStatus.AVAILABLE),
        ("LMNB-33", "Toyota", "Corolla", 2020, "ICAR", aeropuerto, 95_000, 100_000, 3, VehicleStatus.AVAILABLE),
        ("PWQX-41", "Chevrolet", "Suburban", 2023, "FVAR", centro, 9_000, 15_000, 0, VehicleStatus.AVAILABLE),
        ("PWQX-42", "Toyota", "Highlander", 2022, "FVAR", aeropuerto, 28_000, 30_000, 0, VehicleStatus.AVAILABLE),
        ("PWQX-43", "Kia", "Sorento", 2021, "FVAR", centro, 61_000, 65_000, 1, VehicleStatus.AVAILABLE),
        # Give the new branch its own available inventory.
        ("RJKL-14", "Chevrolet", "Sail", 2023, "ECAR", nunoa, 5_000, 10_000, 0, VehicleStatus.AVAILABLE),
        ("HZRT-24", "Toyota", "Yaris", 2023, "CDAR", nunoa, 3_000, 15_000, 0, VehicleStatus.AVAILABLE),
        # One of each non-Available status, so the fleet view's status
        # colors (green/deep purple/yellow/mid gray, CLAUDE.md) all have
        # something to render.
        ("LMNB-34", "Nissan", "Sentra", 2021, "ICAR", aeropuerto, 44_000, 45_000, 0, VehicleStatus.RENTED),
        ("PWQX-44", "Kia", "Sorento", 2022, "FVAR", centro, 20_000, 30_000, 0, VehicleStatus.IN_PREP),
        ("RJKL-15", "Suzuki", "Alto", 2021, "ECAR", centro, 110_000, 100_000, 1, VehicleStatus.INACTIVE),
    ]

    vehicles = [
        Vehicle(
            id=uuid.uuid4(),
            plate=plate,
            make=make,
            model=model,
            year=year,
            acriss_category_id=categories[category_code].id,
            branch_id=branch_id,
            status=status,
            current_km=current_km,
            next_service_km=next_service_km,
            damage_count=damage_count,
            main_photo_url=f"https://picsum.photos/seed/{plate}/640/400",
        )
        for plate, make, model, year, category_code, branch_id, current_km, next_service_km, damage_count, status in rows
    ]
    db.add_all(vehicles)
    db.flush()
    return {v.plate: v for v in vehicles}


def seed_drivers(db) -> dict[str, Driver]:
    now = datetime.now(timezone.utc)
    drivers = [
        # On file, documents verified, license valid — clear to check out.
        Driver(
            id=uuid.uuid4(),
            first_name="Maria",
            last_name="Gonzalez",
            email="maria.gonzalez@example.com",
            national_id_or_passport="12.345.678-9",
            phone="+56 9 1234 5678",
            license_number="LIC-000123",
            license_expiration=(now + timedelta(days=700)).date(),
            id_photo_url="https://picsum.photos/seed/maria-id/400/260",
            license_photo_url="https://picsum.photos/seed/maria-lic/400/260",
            documents_verified=True,
            preferred_color="Gris",
            preferred_transmission=TransmissionType.AUTOMATIC,
            last_visit_date=(now - timedelta(days=76)).date(),
            # Loyalty tier demo persona: fully verified + Gold, so the
            # deposit-waiver and free-extras perks (app/checkout/tiers.py)
            # are visible the moment a check-out starts.
            tier=CustomerTier.GOLD,
        ),
        # On file, documents verified, but license EXPIRED — must block
        # vehicle selection per the "Critical business rules" in CLAUDE.md.
        Driver(
            id=uuid.uuid4(),
            first_name="Jorge",
            last_name="Alvarez",
            email="jorge.alvarez@example.com",
            national_id_or_passport="9.876.543-2",
            phone="+56 9 8765 4321",
            license_number="LIC-000456",
            license_expiration=(now - timedelta(days=597)).date(),
            id_photo_url="https://picsum.photos/seed/jorge-id/400/260",
            license_photo_url="https://picsum.photos/seed/jorge-lic/400/260",
            documents_verified=True,
            preferred_color=None,
            preferred_transmission=TransmissionType.MANUAL,
            last_visit_date=(now - timedelta(days=666)).date(),
            # Loyalty tier demo persona: Corporate tier but still blocked
            # by the expired license above — a tier is never a shortcut
            # past the "Critical business rules" gate in CLAUDE.md.
            tier=CustomerTier.CORPORATE,
        ),
        # On file, documents verified, license valid — the tier that gets
        # no perks (app/checkout/tiers.py), useful as a control case
        # against the Gold/Silver/Corporate personas above/below.
        Driver(
            id=uuid.uuid4(),
            first_name="Felipe",
            last_name="Soto",
            email="felipe.soto@example.com",
            national_id_or_passport="15.222.333-4",
            phone="+56 9 2345 6789",
            license_number="LIC-000789",
            license_expiration=(now + timedelta(days=450)).date(),
            id_photo_url="https://picsum.photos/seed/felipe-id/400/260",
            license_photo_url="https://picsum.photos/seed/felipe-lic/400/260",
            documents_verified=True,
            preferred_color="Blanco",
            preferred_transmission=TransmissionType.MANUAL,
            last_visit_date=(now - timedelta(days=20)).date(),
            tier=CustomerTier.STANDARD,
        ),
        # On file, documents verified, license valid — Silver tier (half
        # the deposit, some free extras; see app/checkout/tiers.py).
        Driver(
            id=uuid.uuid4(),
            first_name="Valentina",
            last_name="Muñoz",
            email="valentina.munoz@example.com",
            national_id_or_passport="16.111.222-3",
            phone="+56 9 3456 7890",
            license_number="LIC-000999",
            license_expiration=(now + timedelta(days=900)).date(),
            id_photo_url="https://picsum.photos/seed/valentina-id/400/260",
            license_photo_url="https://picsum.photos/seed/valentina-lic/400/260",
            documents_verified=True,
            preferred_color="Negro",
            preferred_transmission=TransmissionType.AUTOMATIC,
            last_visit_date=(now - timedelta(days=140)).date(),
            tier=CustomerTier.SILVER,
        ),
        # Two more personas (walk-ins) are deliberately NOT created here —
        # see WALK_IN_* / WALK_IN_2_* constants above.
    ]
    db.add_all(drivers)
    db.flush()
    return {d.email: d for d in drivers}


def seed_reservations(
    db, categories: dict[str, ACRISSCategory], branches: dict[str, Branch], drivers: dict[str, Driver]
) -> None:
    now = datetime.now(timezone.utc)
    maria = drivers["maria.gonzalez@example.com"]
    jorge = drivers["jorge.alvarez@example.com"]
    felipe = drivers["felipe.soto@example.com"]
    valentina = drivers["valentina.munoz@example.com"]

    # Ids captured up front so the pre-check-ins below (one per
    # non-terminal PrecheckinStatus, to populate the executive's queue at
    # every stage) can reference them.
    felipe_res_id = uuid.uuid4()
    valentina_res_id = uuid.uuid4()
    maria_2nd_res_id = uuid.uuid4()

    reservations = [
        # Deposit already paid online ahead of arrival.
        Reservation(
            id=uuid.uuid4(),
            driver_first_name=maria.first_name,
            driver_last_name=maria.last_name,
            driver_email=maria.email,
            pickup_date=now + timedelta(days=2),
            return_date=now + timedelta(days=5),
            pickup_branch_id=branches["SCL-CTR"].id,
            acriss_category_id=categories["ICAR"].id,
            deposit_done_online=True,
            status=ReservationStatus.CONFIRMED,
        ),
        # Deposit will be collected in person; note the driver's license is
        # expired, so this reservation can't proceed to a contract yet.
        Reservation(
            id=uuid.uuid4(),
            driver_first_name=jorge.first_name,
            driver_last_name=jorge.last_name,
            driver_email=jorge.email,
            pickup_date=now + timedelta(days=1),
            return_date=now + timedelta(days=3),
            pickup_branch_id=branches["SCL-APT"].id,
            acriss_category_id=categories["CDAR"].id,
            deposit_done_online=False,
            status=ReservationStatus.CONFIRMED,
        ),
        # Booked online by the not-yet-registered walk-in persona.
        Reservation(
            id=uuid.uuid4(),
            driver_first_name=WALK_IN_FIRST_NAME,
            driver_last_name=WALK_IN_LAST_NAME,
            driver_email=WALK_IN_EMAIL,
            pickup_date=now,
            return_date=now + timedelta(days=2),
            pickup_branch_id=branches["SCL-CTR"].id,
            acriss_category_id=categories["ECAR"].id,
            deposit_done_online=False,
            status=ReservationStatus.CONFIRMED,
        ),
        # Second not-yet-registered walk-in persona, at the airport branch
        # this time — same "no Driver row yet" path, at a second branch.
        Reservation(
            id=uuid.uuid4(),
            driver_first_name=WALK_IN_2_FIRST_NAME,
            driver_last_name=WALK_IN_2_LAST_NAME,
            driver_email=WALK_IN_2_EMAIL,
            pickup_date=now + timedelta(hours=6),
            return_date=now + timedelta(days=4),
            pickup_branch_id=branches["SCL-APT"].id,
            acriss_category_id=categories["ECAR"].id,
            deposit_done_online=False,
            status=ReservationStatus.CONFIRMED,
        ),
        # Standard-tier driver — pre-check-in link just sent (REQUESTED),
        # nothing submitted yet.
        Reservation(
            id=felipe_res_id,
            driver_first_name=felipe.first_name,
            driver_last_name=felipe.last_name,
            driver_email=felipe.email,
            pickup_date=now + timedelta(days=3),
            return_date=now + timedelta(days=6),
            pickup_branch_id=branches["SCL-APT"].id,
            acriss_category_id=categories["ICAR"].id,
            deposit_done_online=False,
            status=ReservationStatus.CONFIRMED,
        ),
        # Silver-tier driver — submitted their data/documents (LOADED),
        # awaiting the executive's review.
        Reservation(
            id=valentina_res_id,
            driver_first_name=valentina.first_name,
            driver_last_name=valentina.last_name,
            driver_email=valentina.email,
            pickup_date=now + timedelta(days=4),
            return_date=now + timedelta(days=7),
            pickup_branch_id=branches["SCL-NUN"].id,
            acriss_category_id=categories["CDAR"].id,
            deposit_done_online=False,
            status=ReservationStatus.CONFIRMED,
        ),
        # Maria's second reservation, at the new branch — pre-check-in
        # already CONFIRMED, so this one should skip straight to Vehicle
        # at the counter.
        Reservation(
            id=maria_2nd_res_id,
            driver_first_name=maria.first_name,
            driver_last_name=maria.last_name,
            driver_email=maria.email,
            pickup_date=now + timedelta(days=6),
            return_date=now + timedelta(days=9),
            pickup_branch_id=branches["SCL-NUN"].id,
            acriss_category_id=categories["FVAR"].id,
            deposit_done_online=False,
            status=ReservationStatus.CONFIRMED,
        ),
    ]
    db.add_all(reservations)
    db.flush()

    precheckins = [
        ReservationPrecheckin(
            id=uuid.uuid4(),
            reservation_id=felipe_res_id,
            status=PrecheckinStatus.REQUESTED,
            contact_email=felipe.email,
            requested_at=now - timedelta(hours=20),
            reminder_count=1,
        ),
        ReservationPrecheckin(
            id=uuid.uuid4(),
            reservation_id=valentina_res_id,
            status=PrecheckinStatus.LOADED,
            contact_email=valentina.email,
            requested_at=now - timedelta(days=2),
            loaded_at=now - timedelta(hours=5),
            national_id_or_passport=valentina.national_id_or_passport,
            phone=valentina.phone,
            license_number=valentina.license_number,
            license_expiration=valentina.license_expiration,
            id_photo_url="https://picsum.photos/seed/valentina-precheckin-id/400/260",
            license_photo_url="https://picsum.photos/seed/valentina-precheckin-lic/400/260",
        ),
        ReservationPrecheckin(
            id=uuid.uuid4(),
            reservation_id=maria_2nd_res_id,
            status=PrecheckinStatus.CONFIRMED,
            contact_email=maria.email,
            requested_at=now - timedelta(days=3),
            loaded_at=now - timedelta(days=2),
            confirmed_at=now - timedelta(days=1),
            national_id_or_passport=maria.national_id_or_passport,
            phone=maria.phone,
            license_number=maria.license_number,
            license_expiration=maria.license_expiration,
            id_photo_url=maria.id_photo_url,
            license_photo_url=maria.license_photo_url,
        ),
    ]
    db.add_all(precheckins)


def seed_pre_handover_reports(db, vehicles: dict[str, Vehicle]) -> None:
    reports = [
        PreHandoverReport(
            id=uuid.uuid4(),
            vehicle_id=vehicles["RJKL-11"].id,
            photos=[
                "https://picsum.photos/seed/RJKL-11-front/640/400",
                "https://picsum.photos/seed/RJKL-11-rear/640/400",
            ],
            damage_diagram={"scratches": [], "dents": [], "notes": "No damage found."},
            consumed=False,
        ),
        PreHandoverReport(
            id=uuid.uuid4(),
            vehicle_id=vehicles["LMNB-31"].id,
            photos=[
                "https://picsum.photos/seed/LMNB-31-front/640/400",
                "https://picsum.photos/seed/LMNB-31-rear/640/400",
            ],
            damage_diagram={
                "scratches": [{"panel": "rear_bumper", "severity": "minor"}],
                "dents": [],
                "notes": "Minor scratch on rear bumper, already logged.",
            },
            consumed=False,
        ),
    ]
    db.add_all(reports)


def seed_extras(db) -> None:
    extras = [
        Extra(id=uuid.uuid4(), name="GPS Navigator", description="Standalone GPS unit", default_price=5_000),
        Extra(id=uuid.uuid4(), name="Child Seat", description="Forward-facing child seat", default_price=8_000),
        Extra(
            id=uuid.uuid4(),
            name="Additional Driver",
            description="Adds a second authorized driver to the contract",
            default_price=12_000,
        ),
        Extra(
            id=uuid.uuid4(),
            name="Full Insurance",
            description="Zero-deductible damage waiver",
            default_price=15_000,
        ),
        Extra(
            id=uuid.uuid4(),
            name="Portable WiFi Hotspot",
            description="4G hotspot device, unlimited data",
            default_price=6_000,
        ),
    ]
    db.add_all(extras)


def run() -> None:
    db = SessionLocal()
    try:
        clear_seeded_tables(db)

        branches = seed_branches(db)
        categories = seed_categories(db)
        vehicles = seed_vehicles(db, categories, branches)
        drivers = seed_drivers(db)
        seed_reservations(db, categories, branches, drivers)
        seed_pre_handover_reports(db, vehicles)
        seed_extras(db)

        db.commit()
        print("Seed complete:")
        print(f"  branches: {len(branches)}")
        print(f"  acriss_categories: {len(categories)}")
        print(f"  vehicles: {len(vehicles)}")
        print(f"  drivers: {len(drivers)} (+ 2 unregistered walk-in personas)")
        print("  reservations: 7")
        print("  reservation_precheckins: 3 (requested / loaded / confirmed)")
        print("  pre_handover_reports: 2")
        print("  extras: 5")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
