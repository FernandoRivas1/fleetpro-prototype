"""Driver lookup by email — the walk-in tab's "check client" step (see
Executive Main.dc.html): an existing client keeps their on-file documents
and license status instead of starting from scratch.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.checkout.models import Driver
from app.checkout.schemas import DriverRead
from app.database import get_db

router = APIRouter(prefix="/api/v1/checkout/drivers", tags=["checkout", "drivers"])


@router.get("/by-email", response_model=DriverRead)
def get_driver_by_email(email: str, db: Session = Depends(get_db)) -> Driver:
    driver = db.query(Driver).filter(func.lower(Driver.email) == email.lower()).one_or_none()
    if driver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No driver on file with that email")
    return driver
