"""Read-only reservation listing for the executive's "Search Reservation"
tab (see Executive Main.dc.html). Reservation creation is out of scope
(CLAUDE.md) — this only supports finding one to start a check-out against.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.checkout.models import Driver, Reservation
from app.checkout.schemas import ReservationRead
from app.database import get_db
from app.shared.enums import ReservationStatus
from app.shared.models import Branch

router = APIRouter(prefix="/api/v1/checkout/reservations", tags=["checkout", "reservations"])

# A cancelled/completed/no-show reservation has nothing left to check out —
# search/sort stays client-side (small seeded dataset), same as the design.
STARTABLE_STATUSES = (ReservationStatus.PENDING, ReservationStatus.CONFIRMED)


def _with_driver_tiers(db: Session, reservations: list[Reservation]) -> list[ReservationRead]:
    """Attaches each reservation's driver_tier (see schemas.py) via a
    single batched lookup-by-email — Reservation has no driver_id FK to
    join on directly."""
    emails = {r.driver_email.lower() for r in reservations}
    tier_by_email = {
        d.email.lower(): d.tier
        for d in (db.query(Driver).filter(func.lower(Driver.email).in_(emails)).all() if emails else [])
    }
    return [
        ReservationRead.model_validate(r).model_copy(
            update={"driver_tier": tier_by_email.get(r.driver_email.lower())}
        )
        for r in reservations
    ]


@router.get("", response_model=list[ReservationRead])
def list_reservations(branch_id: uuid.UUID, db: Session = Depends(get_db)) -> list[ReservationRead]:
    if db.get(Branch, branch_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")

    reservations = (
        db.query(Reservation)
        .filter(Reservation.pickup_branch_id == branch_id, Reservation.status.in_(STARTABLE_STATUSES))
        .order_by(Reservation.pickup_date.asc())
        .all()
    )
    return _with_driver_tiers(db, reservations)
