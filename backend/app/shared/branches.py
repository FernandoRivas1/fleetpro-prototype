"""Read-only branch directory.

Branch has no creation flow of its own (see shared/models.py — it's a
seeded catalog referenced by Vehicle/Reservation/Station/RentalContract),
so the only endpoint needed is a listing: the executive's Station Setup
screen needs it to pick a branch_id for POST /api/v1/stations, and the
branch switcher in the executive shell needs it to show branch names.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.shared.models import Branch
from app.shared.schemas import BranchRead

router = APIRouter(prefix="/api/v1/branches", tags=["branches"])


@router.get("", response_model=list[BranchRead])
def list_branches(db: Session = Depends(get_db)) -> list[Branch]:
    return db.query(Branch).order_by(Branch.name).all()
