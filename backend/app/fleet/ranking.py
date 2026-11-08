"""Vehicle candidate ranking for the executive's vehicle-selection screen.

GET /api/v1/fleet/candidates scores every offerable vehicle in a given
ACRISS category + branch against one driver's preferences, so the
executive can present ranked options instead of a plain list. The
checkout's own vehicle-options endpoint (app/checkout/flow.py) ranks
through rank_category() below too, once per category it shows.

Offerable means Available (prepared, ready to hand over) or InPrep (being
cleaned/fuelled, ready shortly) — the client sees which, so a nicer car
that's a few minutes out is still on the table. A car pre-assigned to
another open reservation (Reservation.assigned_vehicle_id), or already
chosen in another unsigned checkout, is never offered to anyone else;
see held_vehicle_ids.

Scoring (see CLAUDE.md's ACRISSCategory.features and Vehicle fields):
  +30  category's transmission matches Driver.preferred_transmission
  +25  (max) low mileage, relative to the *average* current_km among the
       candidates themselves — a vehicle at the average scores 0 on this
       criterion, further-below-average scores higher, at-or-above-average
       scores 0 (never negative)
  +15  (max) headroom until next service (next_service_km - current_km),
       min-max normalized across the candidates (least headroom -> 0,
       most headroom -> 15)
   -5  per registered damage (damage_count)

match_pct re-expresses the score as a "compatibility" figure for the UI,
from MATCH_FLOOR_PCT to 100: every car offered already meets the booking
(right category or better, right branch), so even the lowest-ranked one
is a reasonable match, and the ranking spreads the cars above that floor.
The spread is the score as a share of the most this driver *could* score
(the transmission points only count toward that maximum when the driver
has a preference at all), so a driver with no stated preference isn't
marked down on every car for want of 30 points nobody could earn.

Vehicle.color was never added (see CLAUDE.md's data model and seed.py), so
the color-match criterion from the brief is dropped, as instructed.

The final score is floored at 0 overall (a vehicle never displays as
"worse than nothing"), but each criterion's raw contribution is shown in
`score_breakdown` for a UI tooltip — in practice this only differs from
the floored total for a vehicle with an implausibly high damage_count,
since damage_count tops out well below what the positive criteria can
offset.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.checkout.models import Driver, RentalContract, Reservation
from app.database import get_db
from app.fleet.models import ACRISSCategory, Vehicle
from app.fleet.schemas import VehicleRead
from app.shared.enums import ContractStatus, ReservationStatus, VehicleStatus
from app.shared.models import Branch

router = APIRouter(prefix="/api/v1/fleet", tags=["fleet"])

TRANSMISSION_MATCH_POINTS = 30.0
MAX_MILEAGE_POINTS = 25.0
MAX_SERVICE_HEADROOM_POINTS = 15.0
DAMAGE_PENALTY_PER_UNIT = 5.0
MATCH_FLOOR_PCT = 60

# What can be offered to a client: prepared, or being prepared right now.
OFFERABLE_STATUSES = (VehicleStatus.AVAILABLE, VehicleStatus.IN_PREP)
# Reservations still waiting to be checked out — their pre-assigned cars
# are held for them.
OPEN_RESERVATION_STATUSES = (ReservationStatus.PENDING, ReservationStatus.CONFIRMED)


class ScoreBreakdown(BaseModel):
    transmission_match: float
    low_mileage: float
    service_headroom: float
    damage_penalty: float


class CandidateVehicle(BaseModel):
    model_config = ConfigDict(from_attributes=False)

    vehicle: VehicleRead
    score: float
    score_breakdown: ScoreBreakdown
    # MATCH_FLOOR_PCT-100, see the module docstring.
    match_pct: int
    # False only for InPrep: being prepared, ready shortly.
    ready: bool


class CandidatesResponse(BaseModel):
    category_id: uuid.UUID
    branch_id: uuid.UUID
    driver_id: uuid.UUID
    candidates: list[CandidateVehicle]


@router.get("/candidates", response_model=CandidatesResponse)
def get_candidates(
    category_id: uuid.UUID,
    branch_id: uuid.UUID,
    driver_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> CandidatesResponse:
    category = db.get(ACRISSCategory, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ACRISS category not found")

    if db.get(Branch, branch_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")

    driver = db.get(Driver, driver_id)
    if driver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")

    return CandidatesResponse(
        category_id=category_id,
        branch_id=branch_id,
        driver_id=driver_id,
        candidates=rank_category(db, category, branch_id, driver),
    )


def held_vehicle_ids(db: Session, except_reservation_id: uuid.UUID | None = None) -> set[uuid.UUID]:
    """Cars off limits to everyone else: pre-assigned to an open
    reservation other than `except_reservation_id`, or chosen in a
    checkout that hasn't been signed yet. (An Available car chosen that
    way is already marked Rented; this is what holds an InPrep one, which
    keeps its InPrep status until the contract is signed so the client
    still sees it's being prepared — see flow.py's select_vehicle.)"""
    reserved = db.query(Reservation.assigned_vehicle_id).filter(
        Reservation.assigned_vehicle_id.is_not(None),
        Reservation.status.in_(OPEN_RESERVATION_STATUSES),
    )
    if except_reservation_id is not None:
        reserved = reserved.filter(Reservation.id != except_reservation_id)
    chosen = db.query(RentalContract.vehicle_id).filter(
        RentalContract.vehicle_id.is_not(None),
        RentalContract.status.in_((ContractStatus.NEW, ContractStatus.PRE_OPENED)),
    )
    return {vehicle_id for (vehicle_id,) in reserved} | {vehicle_id for (vehicle_id,) in chosen}


def rank_category(
    db: Session,
    category: ACRISSCategory,
    branch_id: uuid.UUID,
    driver: Driver,
    *,
    for_reservation_id: uuid.UUID | None = None,
    also_include_id: uuid.UUID | None = None,
) -> list[CandidateVehicle]:
    """Every offerable car of `category` at `branch_id`, best match first.

    `for_reservation_id` lets that reservation's own pre-assigned car
    through the hold filter. `also_include_id` keeps one car in the list
    whatever its status — the checkout's already-selected vehicle, which
    select-vehicle has marked Rented, so the client's current choice
    doesn't vanish from the screen.
    """
    held = held_vehicle_ids(db, except_reservation_id=for_reservation_id)
    vehicles = [
        v
        for v in db.query(Vehicle).filter(
            Vehicle.acriss_category_id == category.id,
            Vehicle.branch_id == branch_id,
        )
        if (v.status in OFFERABLE_STATUSES and v.id not in held) or v.id == also_include_id
    ]
    return _rank_vehicles(vehicles, category, driver)


def _rank_vehicles(
    vehicles: list[Vehicle], category: ACRISSCategory, driver: Driver
) -> list[CandidateVehicle]:
    transmission_score = _transmission_score(category, driver)
    mileage_scores = _mileage_scores(vehicles)
    headroom_scores = _service_headroom_scores(vehicles)
    max_possible = (
        (TRANSMISSION_MATCH_POINTS if driver.preferred_transmission is not None else 0.0)
        + MAX_MILEAGE_POINTS
        + MAX_SERVICE_HEADROOM_POINTS
    )

    candidates = []
    for vehicle in vehicles:
        # Written as 0.0 - x rather than -x so an undamaged vehicle (x=0)
        # comes out as 0.0, not the cosmetically ugly IEEE-754 -0.0.
        damage_penalty = 0.0 - DAMAGE_PENALTY_PER_UNIT * vehicle.damage_count
        breakdown = ScoreBreakdown(
            transmission_match=transmission_score,
            low_mileage=round(mileage_scores[vehicle.id], 1),
            service_headroom=round(headroom_scores[vehicle.id], 1),
            damage_penalty=round(damage_penalty, 1),
        )
        total = max(transmission_score + mileage_scores[vehicle.id] + headroom_scores[vehicle.id] + damage_penalty, 0.0)
        candidates.append(
            CandidateVehicle(
                vehicle=VehicleRead.model_validate(vehicle),
                score=round(total, 1),
                score_breakdown=breakdown,
                match_pct=round(MATCH_FLOOR_PCT + (100 - MATCH_FLOOR_PCT) * total / max_possible),
                ready=vehicle.status is not VehicleStatus.IN_PREP,
            )
        )

    # Highest score first; break ties on plate for a stable, reproducible order.
    candidates.sort(key=lambda c: (-c.score, c.vehicle.plate))
    return candidates


def _transmission_score(category: ACRISSCategory, driver: Driver) -> float:
    if driver.preferred_transmission is None:
        return 0.0
    category_transmission = (category.features or {}).get("transmission")
    return TRANSMISSION_MATCH_POINTS if category_transmission == driver.preferred_transmission.value else 0.0


def _mileage_scores(vehicles: list[Vehicle]) -> dict[uuid.UUID, float]:
    """Below-average mileage scores up toward MAX_MILEAGE_POINTS; at or
    above the candidates' average mileage scores 0 (never negative)."""
    if not vehicles:
        return {}

    average_km = sum(v.current_km for v in vehicles) / len(vehicles)
    if average_km <= 0:
        # Every candidate is already at rock-bottom mileage — nothing to
        # differentiate on, so nobody is penalized.
        return {v.id: MAX_MILEAGE_POINTS for v in vehicles}

    return {
        v.id: _clamp(MAX_MILEAGE_POINTS * (average_km - v.current_km) / average_km, 0.0, MAX_MILEAGE_POINTS)
        for v in vehicles
    }


def _service_headroom_scores(vehicles: list[Vehicle]) -> dict[uuid.UUID, float]:
    """Min-max normalized across the candidates: most headroom until the
    next service scores MAX_SERVICE_HEADROOM_POINTS, least scores 0."""
    if not vehicles:
        return {}

    headrooms = {v.id: max(v.next_service_km - v.current_km, 0) for v in vehicles}
    lowest, highest = min(headrooms.values()), max(headrooms.values())
    if highest == lowest:
        # Every candidate has the same headroom — don't penalize any of them.
        return {vid: MAX_SERVICE_HEADROOM_POINTS for vid in headrooms}

    return {
        vid: MAX_SERVICE_HEADROOM_POINTS * (headroom - lowest) / (highest - lowest)
        for vid, headroom in headrooms.items()
    }


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))
