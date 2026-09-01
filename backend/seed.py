"""Populate the database with sample data for local development / demos.

Re-runnable: it clears the rows it owns (in FK-safe order) before
re-inserting, so `python seed.py` always leaves the DB in the same state.
Run `alembic upgrade head` first so the tables exist.

Seeds, per the Fleetpro prototype spec:
  - 4 ACRISS categories with a hierarchy and features (ECAR < CDAR < ICAR < FVAR)
  - 12 vehicles, all Available, with deliberately varied mileage / next-service
    data so a "needs service soon" ranking is visibly meaningful
  - 3 drivers: one on file with valid, verified documents; one with an
    expired license; and one that intentionally has NO Driver row, to
    simulate a first-time walk-in the executive will register from scratch
    (see WALK_IN_* below — only referenced by name/email in reservations)
  - 3 reservations (one with deposit_done_online=True)
  - 2 pre-handover reports, for 2 of the 12 vehicles, not consumed
  - 5 extras

Branches aren't their own bullet in the spec but are a required FK on
Vehicle/Reservation/Station/RentalContract, so two are seeded as
prerequisite data.
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.checkout.models import Driver, Reservation
from app.database import SessionLocal
from app.fleet.models import ACRISSCategory, Vehicle
from app.models_registry import Base  # noqa: F401 — ensures every model is registered
from app.reports.models import PreHandoverReport
from app.shared.enums import CustomerTier, ReservationStatus, TransmissionType, VehicleStatus
from app.shared.models import Branch, Extra

# The third "driver" persona: intentionally has no Driver row. A reservation
# references these directly (Reservation stores driver name/email inline,
# not a driver_id FK) so the check-out flow can be exercised against a
# customer who hasn't been registered yet.
WALK_IN_FIRST_NAME = "Camila"
WALK_IN_LAST_NAME = "Rojas"
WALK_IN_EMAIL = "camila.rojas@example.com"


def clear_seeded_tables(db) -> None:
    """Delete rows this script owns, children before parents."""
    db.query(PreHandoverReport).delete()
    db.query(Reservation).delete()
    db.query(Vehicle).delete()
    db.query(Driver).delete()
    db.query(ACRISSCategory).delete()
    db.query(Extra).delete()
    db.query(Branch).delete()
    db.commit()


def seed_branches(db) -> dict[str, Branch]:
    branches = [
        Branch(
            id=uuid.uuid4(),
            code="SCL-CTR",
            name="Sucursal Centro",
            address="Av. Providencia 1234, Santiago",
        ),
        Branch(
            id=uuid.uuid4(),
            code="SCL-APT",
            name="Sucursal Aeropuerto",
            address="Aeropuerto AMB, Terminal Rent a Car",
        ),
    ]
    db.add_all(branches)
    db.flush()
    return {b.code: b for b in branches}


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

    # (plate, make, model, year, category_code, branch_id, current_km, next_service_km, damage_count)
    rows = [
        ("RJKL-11", "Chevrolet", "Sail", 2023, "ECAR", centro, 8_500, 10_000, 0),
        ("RJKL-12", "Chevrolet", "Sail", 2022, "ECAR", centro, 52_000, 55_000, 1),
        ("RJKL-13", "Suzuki", "Alto", 2023, "ECAR", aeropuerto, 15_000, 20_000, 0),
        ("HZRT-21", "Toyota", "Yaris", 2023, "CDAR", centro, 12_000, 15_000, 0),
        ("HZRT-22", "Toyota", "Yaris", 2021, "CDAR", aeropuerto, 78_000, 80_000, 2),
        ("HZRT-23", "Hyundai", "Accent", 2022, "CDAR", centro, 34_000, 40_000, 0),
        ("LMNB-31", "Toyota", "Corolla", 2023, "ICAR", aeropuerto, 6_000, 10_000, 0),
        ("LMNB-32", "Nissan", "Sentra", 2022, "ICAR", centro, 41_000, 45_000, 0),
        ("LMNB-33", "Toyota", "Corolla", 2020, "ICAR", aeropuerto, 95_000, 100_000, 3),
        ("PWQX-41", "Chevrolet", "Suburban", 2023, "FVAR", centro, 9_000, 15_000, 0),
        ("PWQX-42", "Toyota", "Highlander", 2022, "FVAR", aeropuerto, 28_000, 30_000, 0),
        ("PWQX-43", "Kia", "Sorento", 2021, "FVAR", centro, 61_000, 65_000, 1),
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
            status=VehicleStatus.AVAILABLE,
            current_km=current_km,
            next_service_km=next_service_km,
            damage_count=damage_count,
            main_photo_url=f"https://picsum.photos/seed/{plate}/640/400",
        )
        for plate, make, model, year, category_code, branch_id, current_km, next_service_km, damage_count in rows
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
        # Third persona (walk-in) is deliberately NOT created here — see
        # WALK_IN_* constants above.
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
    ]
    db.add_all(reservations)


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
        print(f"  drivers: {len(drivers)} (+ 1 unregistered walk-in persona)")
        print("  reservations: 3")
        print("  pre_handover_reports: 2")
        print("  extras: 5")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
