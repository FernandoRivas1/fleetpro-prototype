"""Read-only reservation listing for the executive's "Search Reservation"
tab (see Executive Main.dc.html). Reservation creation is out of scope
(CLAUDE.md) — this only supports finding one to start a check-out against.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.checkout.models import Reservation
from app.checkout.schemas import ReservationRead
from app.database import get_db
from app.shared.enums import ReservationStatus
from app.shared.models import Branch

router = APIRouter(prefix="/api/v1/checkout/reservations", tags=["checkout", "reservations"])

# A cancelled/completed/no-show reservation has nothing left to check out —
# search/sort stays client-side (small seeded dataset), same as the design.
STARTABLE_STATUSES = (ReservationStatus.PENDING, ReservationStatus.CONFIRMED)


@router.get("", response_model=list[ReservationRead])
def list_reservations(branch_id: uuid.UUID, db: Session = Depends(get_db)) -> list[Reservation]:
    if db.get(Branch, branch_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")

    return (
        db.query(Reservation)
        .filter(Reservation.pickup_branch_id == branch_id, Reservation.status.in_(STARTABLE_STATUSES))
        .order_by(Reservation.pickup_date.asc())
        .all()
    )
