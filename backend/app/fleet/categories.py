"""Read-only ACRISS category directory.

Needed for the executive's walk-in vehicle-candidates step: a
`from_reservation` contract already has a category (the reservation's), but
a `walk_in` contract has none — CLAUDE.md doesn't address this, so the
executive picks one here before candidates can be ranked (fleet/ranking.py).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.fleet.models import ACRISSCategory
from app.fleet.schemas import ACRISSCategoryRead

router = APIRouter(prefix="/api/v1/fleet/categories", tags=["fleet"])


@router.get("", response_model=list[ACRISSCategoryRead])
def list_categories(db: Session = Depends(get_db)) -> list[ACRISSCategory]:
    return db.query(ACRISSCategory).order_by(ACRISSCategory.hierarchy_order.asc()).all()
