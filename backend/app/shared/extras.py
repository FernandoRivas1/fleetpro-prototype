"""Read-only extras catalog.

Extra has no creation flow of its own (seeded catalog, see shared/models.py)
— the only endpoint needed is a listing, for the tablet's Extras grid
(POST /api/v1/checkout/{id}/extras, in checkout/flow.py, only accepts
extra_id + quantity; it has no way to tell the client what's available).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.shared.models import Extra
from app.shared.schemas import ExtraRead

router = APIRouter(prefix="/api/v1/extras", tags=["extras"])


@router.get("", response_model=list[ExtraRead])
def list_extras(db: Session = Depends(get_db)) -> list[Extra]:
    return db.query(Extra).order_by(Extra.name).all()
