"""Populate the database with sample data for local development / demos.

Re-runnable: it clears the rows it owns (in FK-safe order) before
re-inserting, so `python seed.py` always leaves the DB in the same state.
Run `alembic upgrade head` first so the tables exist.

Seeds, per the Rental Software prototype spec (plus later additions, noted below):
  - 4 ACRISS categories with a hierarchy and features (ECAR < CDAR < ICAR < FVAR)
  - 55 vehicles: at least three Available cars of every category at every
    branch (five at the airport), with deliberately varied mileage /
    next-service / damage data so the ranking is visibly meaningful, plus
    a few Rented / InPrep / Inactive cars so the fleet view's status
    colors (CLAUDE.md) all have something to render. Photos are the
    illustrations in frontend/public/vehicles/.
  - 7 drivers covering every loyalty tier (app/checkout/tiers.py): a Gold
    driver with valid, verified documents; a Corporate driver with an
    EXPIRED license (tier is never a shortcut past that gate — CLAUDE.md)
    and one with a valid license; Standard and Silver drivers, all clear to
    check out; plus five personas that intentionally have NO Driver row, to
    simulate first-time walk-ins the executive will register from scratch
    (see WALK_IN_* and EXTRA_ARRIVALS below — only referenced by
    name/email in reservations)
  - 13 reservations (one with deposit_done_online=True), four or five per
    branch, with pickups from now through the next few days
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

# Everyday arrivals on top of the scenario reservations in
# seed_reservations, so every counter has a realistic queue in every
# category. Benjamín, Antonia and Matías are further walk-ins with no
# Driver row; the rest are registered drivers from seed_drivers.
# (first_name, last_name, email, branch, category, pickup in hours, rental days)
EXTRA_ARRIVALS = [
    ("Isidora", "Paredes", "isidora.paredes@example.com", "SCL-APT", "FVAR", 1, 5),
    ("Benjamín", "Castro", "benjamin.castro@example.com", "SCL-APT", "CDAR", 2, 3),
    ("Sofía", "Herrera", "sofia.herrera@example.com", "SCL-CTR", "CDAR", 3, 4),
    ("Matías", "Contreras", "matias.contreras@example.com", "SCL-NUN", "ECAR", 4, 2),
    ("Antonia", "Reyes", "antonia.reyes@example.com", "SCL-CTR", "FVAR", 26, 6),
    ("Tomás", "Vidal", "tomas.vidal@example.com", "SCL-NUN", "ICAR", 28, 3),
]


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


# Models a Chilean rental fleet actually runs in each category, with the
# body style used to pick the illustration in frontend/public/vehicles/.
MODELS_BY_CATEGORY = {
    "ECAR": [("Suzuki", "Swift"), ("Kia", "Morning"), ("Hyundai", "Grand i10"), ("Chevrolet", "Spark"), ("Suzuki", "Baleno")],
    "CDAR": [("Toyota", "Yaris Sedan"), ("Hyundai", "Accent"), ("Kia", "Soluto"), ("Chevrolet", "Sail"), ("Nissan", "Versa")],
    "ICAR": [("Toyota", "Corolla"), ("Nissan", "Sentra"), ("Hyundai", "Elantra"), ("Kia", "Cerato"), ("Mazda", "3 Sedan")],
    "FVAR": [("Kia", "Sorento"), ("Hyundai", "Santa Fe"), ("Toyota", "Fortuner"), ("Mitsubishi", "Montero Sport"), ("Chevrolet", "Traverse")],
}
BODY_BY_CATEGORY = {"ECAR": "hatchback", "CDAR": "sedan", "ICAR": "sedan", "FVAR": "suv"}
PAINT_COLORS = ["white", "silver", "gray", "black", "red", "blue"]

# (year, current_km, km left until next service, damage_count). Cycled
# through each branch's cars so the executive's ranking always has
# something to separate: a nearly new car, one due for service, one with
# registered damage, and so on.
CONDITION_PROFILES = [
    (2025, 4_200, 5_800, 0),
    (2024, 18_500, 1_500, 0),
    (2023, 36_000, 4_000, 1),
    (2025, 9_800, 300, 0),
    (2022, 58_000, 2_000, 2),
]

# Available cars per category at each branch. Every branch has at least
# three of every category, so any reservation (and any upsell) always has
# real options to show the client; the airport counter is the busiest.
AVAILABLE_PER_CATEGORY = {"SCL-APT": 5, "SCL-CTR": 4, "SCL-NUN": 3}

# Cars that are on the books but not available right now, so the fleet
# view's status colors (green/deep purple/yellow/mid gray, CLAUDE.md) all
# have something to render. (branch, category, status)
UNAVAILABLE_CARS = [
    ("SCL-APT", "ICAR", VehicleStatus.RENTED),
    ("SCL-APT", "ECAR", VehicleStatus.RENTED),
    ("SCL-APT", "FVAR", VehicleStatus.IN_PREP),
    ("SCL-CTR", "CDAR", VehicleStatus.RENTED),
    ("SCL-CTR", "FVAR", VehicleStatus.IN_PREP),
    ("SCL-CTR", "ECAR", VehicleStatus.INACTIVE),
    ("SCL-NUN", "ICAR", VehicleStatus.RENTED),
]

# Chilean plates are four consonants and two digits (e.g. "RJKL-11").
PLATE_PREFIXES = {"SCL-APT": "RJ", "SCL-CTR": "HZ", "SCL-NUN": "LP"}
PLATE_SERIES = {"ECAR": "BC", "CDAR": "DF", "ICAR": "GK", "FVAR": "TW"}


def vehicle_photo_url(category_code: str, color: str) -> str:
    """Served by the frontend itself, so it resolves on whichever origin the
    executive console and the tablet are loaded from."""
    return f"/vehicles/{BODY_BY_CATEGORY[category_code]}-{color}.svg"


def seed_vehicles(
    db, categories: dict[str, ACRISSCategory], branches: dict[str, Branch]
) -> dict[str, Vehicle]:
    rows: list[tuple[str, str, VehicleStatus]] = [
        (branch_code, category_code, VehicleStatus.AVAILABLE)
        for branch_code, count in AVAILABLE_PER_CATEGORY.items()
        for category_code in MODELS_BY_CATEGORY
        for _ in range(count)
    ]
    rows += UNAVAILABLE_CARS

    vehicles = []
    serial: dict[tuple[str, str], int] = {}
    for branch_code, category_code, vehicle_status in rows:
        n = serial[(branch_code, category_code)] = serial.get((branch_code, category_code), 0) + 1
        make, model = MODELS_BY_CATEGORY[category_code][(n - 1) % 5]
        branch_offset = list(AVAILABLE_PER_CATEGORY).index(branch_code)
        year, current_km, headroom_km, damage_count = CONDITION_PROFILES[(n - 1 + branch_offset) % len(CONDITION_PROFILES)]
        if vehicle_status == VehicleStatus.INACTIVE:
            # Pulled from service: overdue for maintenance.
            year, current_km, headroom_km, damage_count = 2020, 112_000, -4_000, 1
        color = PAINT_COLORS[(len(vehicles) * 5) % len(PAINT_COLORS)]
        vehicles.append(
            Vehicle(
                id=uuid.uuid4(),
                plate=f"{PLATE_PREFIXES[branch_code]}{PLATE_SERIES[category_code]}-{10 + n}",
                make=make,
                model=model,
                year=year,
                acriss_category_id=categories[category_code].id,
                branch_id=branches[branch_code].id,
                status=vehicle_status,
                current_km=current_km,
                next_service_km=current_km + headroom_km,
                damage_count=damage_count,
                main_photo_url=vehicle_photo_url(category_code, color),
            )
        )
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
        # Three more registered regulars, so each counter's arrivals list
        # looks like a real day rather than one row per demo scenario.
        Driver(
            id=uuid.uuid4(),
            first_name="Sofía",
            last_name="Herrera",
            email="sofia.herrera@example.com",
            national_id_or_passport="17.444.555-6",
            phone="+56 9 4567 8901",
            license_number="LIC-001204",
            license_expiration=(now + timedelta(days=1_200)).date(),
            id_photo_url="https://picsum.photos/seed/sofia-id/400/260",
            license_photo_url="https://picsum.photos/seed/sofia-lic/400/260",
            documents_verified=True,
            preferred_color="Rojo",
            preferred_transmission=TransmissionType.MANUAL,
            last_visit_date=(now - timedelta(days=45)).date(),
            tier=CustomerTier.SILVER,
        ),
        # Corporate with a valid license — the Corporate tier's happy path,
        # next to Jorge's blocked one.
        Driver(
            id=uuid.uuid4(),
            first_name="Isidora",
            last_name="Paredes",
            email="isidora.paredes@example.com",
            national_id_or_passport="14.333.222-1",
            phone="+56 9 5678 9012",
            license_number="LIC-000871",
            license_expiration=(now + timedelta(days=520)).date(),
            id_photo_url="https://picsum.photos/seed/isidora-id/400/260",
            license_photo_url="https://picsum.photos/seed/isidora-lic/400/260",
            documents_verified=True,
            preferred_color="Blanco",
            preferred_transmission=TransmissionType.AUTOMATIC,
            last_visit_date=(now - timedelta(days=12)).date(),
            tier=CustomerTier.CORPORATE,
        ),
        Driver(
            id=uuid.uuid4(),
            first_name="Tomás",
            last_name="Vidal",
            email="tomas.vidal@example.com",
            national_id_or_passport="18.765.432-K",
            phone="+56 9 6789 0123",
            license_number="LIC-001377",
            license_expiration=(now + timedelta(days=310)).date(),
            id_photo_url="https://picsum.photos/seed/tomas-id/400/260",
            license_photo_url="https://picsum.photos/seed/tomas-lic/400/260",
            documents_verified=True,
            preferred_color="Gris",
            preferred_transmission=TransmissionType.AUTOMATIC,
            last_visit_date=(now - timedelta(days=210)).date(),
            tier=CustomerTier.STANDARD,
        ),
        # The walk-in personas are deliberately NOT created here — see
        # WALK_IN_* / WALK_IN_2_* above and EXTRA_ARRIVALS below.
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
    reservations += [
        Reservation(
            id=uuid.uuid4(),
            driver_first_name=first_name,
            driver_last_name=last_name,
            driver_email=email,
            pickup_date=now + timedelta(hours=pickup_in_hours),
            return_date=now + timedelta(hours=pickup_in_hours, days=rental_days),
            pickup_branch_id=branches[branch_code].id,
            acriss_category_id=categories[category_code].id,
            deposit_done_online=False,
            status=ReservationStatus.CONFIRMED,
        )
        for first_name, last_name, email, branch_code, category_code, pickup_in_hours, rental_days in EXTRA_ARRIVALS
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
    # The first Economy car at Centro and the first Intermediate car at the
    # airport (see seed_vehicles' plate scheme).
    clean, scratched = vehicles["HZBC-11"], vehicles["RJGK-11"]
    reports = [
        PreHandoverReport(
            id=uuid.uuid4(),
            vehicle_id=clean.id,
            photos=[clean.main_photo_url],
            damage_diagram={"scratches": [], "dents": [], "notes": "No damage found."},
            consumed=False,
        ),
        PreHandoverReport(
            id=uuid.uuid4(),
            vehicle_id=scratched.id,
            photos=[scratched.main_photo_url],
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
        print(f"  drivers: {len(drivers)} (+ 5 unregistered walk-in personas)")
        print(f"  reservations: {db.query(Reservation).count()}")
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
