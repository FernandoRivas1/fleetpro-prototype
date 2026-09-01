"""Pre Check-in: pre-arrival driver self-service, reviewed by the
executive before the counter session starts (Executive Pre Check-in
design).

Two audiences share this module:
  - `public_router` (prefix /api/v1/precheckin) — unauthenticated
    endpoints the driver's own phone/laptop calls, reached via the code
    the executive hands them (see ReservationPrecheckin's docstring for
    the auth shortcut this takes).
  - `admin_router` (prefix /api/v1/checkout/precheckin) — the executive's
    review queue: request data, remind, confirm, and toggle "unskip".

Nothing here sends a real email — no mail provider is configured for this
prototype (see CLAUDE.md's stack). /request and /remind just persist
state and hand back a portal_url the executive copies and sends however
they like; app/checkout/checkout.py is what actually acts on a confirmed
pre-check-in once a contract is started from the reservation.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.checkout.documents import (
    ALLOWED_IMAGE_MIME_TYPES,
    MAX_IMAGE_BYTES,
    DocumentScanError,
    DocumentType,
    ScanDocumentResponse,
    _extract_with_claude,
    _is_valid,
    _save_image,
)
from app.checkout.models import Reservation, ReservationPrecheckin
from app.checkout.reservations import STARTABLE_STATUSES
from app.checkout.schemas import ReservationRead
from app.config import settings
from app.database import get_db
from app.shared.enums import PrecheckinStatus

public_router = APIRouter(prefix="/api/v1/precheckin", tags=["precheckin"])
admin_router = APIRouter(prefix="/api/v1/checkout/precheckin", tags=["checkout", "precheckin"])


# --- Schemas -------------------------------------------------------------


class PrecheckinRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: PrecheckinStatus
    contact_email: str
    requested_at: datetime | None = None
    reminder_count: int
    loaded_at: datetime | None = None
    confirmed_at: datetime | None = None
    national_id_or_passport: str | None = None
    phone: str | None = None
    license_number: str | None = None
    license_expiration: date | None = None
    id_photo_url: str | None = None
    license_photo_url: str | None = None
    unskip: bool


class PrecheckinQueueItem(BaseModel):
    reservation: ReservationRead
    # None means "not requested yet" — see PrecheckinStatus.
    precheckin: PrecheckinRead | None = None


class PrecheckinRequestRequest(BaseModel):
    email: str = Field(min_length=1)


class PrecheckinRequestResponse(BaseModel):
    reservation_id: uuid.UUID
    precheckin: PrecheckinRead
    portal_url: str


class SetUnskipRequest(BaseModel):
    unskip: bool


class PrecheckinLoginRequest(BaseModel):
    code: str
    last_name: str


class PrecheckinLookupResponse(BaseModel):
    reservation_id: uuid.UUID
    code: str
    driver_first_name: str
    driver_last_name: str
    pickup_date: datetime
    return_date: datetime
    acriss_category_id: uuid.UUID
    # None means nothing has been submitted for this reservation yet.
    status: PrecheckinStatus | None = None
    # Pre-fills the form on a second visit (fixing a typo, say) instead of
    # making the driver start over.
    national_id_or_passport: str | None = None
    phone: str | None = None
    license_number: str | None = None
    license_expiration: date | None = None


class PrecheckinSubmitRequest(BaseModel):
    code: str
    last_name: str
    national_id_or_passport: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    license_number: str = Field(min_length=1)
    license_expiration: date


def _portal_url(reservation: Reservation) -> str:
    return f"{settings.app_url}/precheckin?code={reservation.code}"


def _authenticate(db: Session, code: str, last_name: str) -> Reservation:
    """STUB matching credential check — see ReservationPrecheckin's
    docstring; this is a prototype shortcut, not real access control.

    Reservation.code is a computed property (not a DB column), so this
    has to walk the (small, seeded) set of startable reservations in
    Python rather than filtering in SQL.
    """
    normalized_code = code.strip().upper()
    normalized_last_name = last_name.strip().lower()
    reservations = db.query(Reservation).filter(Reservation.status.in_(STARTABLE_STATUSES)).all()
    for reservation in reservations:
        if reservation.code == normalized_code and reservation.driver_last_name.strip().lower() == normalized_last_name:
            return reservation
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No reservation matches that code and last name.")


# --- Public portal ---------------------------------------------------------


@public_router.post("/lookup", response_model=PrecheckinLookupResponse)
def lookup_precheckin(payload: PrecheckinLoginRequest, db: Session = Depends(get_db)) -> PrecheckinLookupResponse:
    reservation = _authenticate(db, payload.code, payload.last_name)
    pc = reservation.precheckin
    return PrecheckinLookupResponse(
        reservation_id=reservation.id,
        code=reservation.code,
        driver_first_name=reservation.driver_first_name,
        driver_last_name=reservation.driver_last_name,
        pickup_date=reservation.pickup_date,
        return_date=reservation.return_date,
        acriss_category_id=reservation.acriss_category_id,
        status=pc.status if pc else None,
        national_id_or_passport=pc.national_id_or_passport if pc else None,
        phone=pc.phone if pc else None,
        license_number=pc.license_number if pc else None,
        license_expiration=pc.license_expiration if pc else None,
    )


@public_router.post("/{reservation_id}/submit", response_model=PrecheckinRead)
def submit_precheckin(
    reservation_id: uuid.UUID, payload: PrecheckinSubmitRequest, db: Session = Depends(get_db)
) -> PrecheckinRead:
    reservation = _authenticate(db, payload.code, payload.last_name)
    if reservation.id != reservation_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No reservation matches that code and last name.")

    pc = reservation.precheckin
    if pc is not None and pc.status is PrecheckinStatus.CONFIRMED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This reservation has already been confirmed by the branch."
        )
    if pc is None:
        pc = ReservationPrecheckin(
            id=uuid.uuid4(),
            reservation_id=reservation.id,
            status=PrecheckinStatus.LOADED,
            contact_email=reservation.driver_email,
            reminder_count=0,
        )
        db.add(pc)
    else:
        pc.status = PrecheckinStatus.LOADED

    pc.national_id_or_passport = payload.national_id_or_passport.strip()
    pc.phone = payload.phone.strip()
    pc.license_number = payload.license_number.strip()
    pc.license_expiration = payload.license_expiration
    pc.loaded_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(pc)
    return PrecheckinRead.model_validate(pc)


@public_router.post("/{reservation_id}/scan-document", response_model=ScanDocumentResponse)
async def scan_precheckin_document(
    reservation_id: uuid.UUID,
    code: str = Form(...),
    last_name: str = Form(...),
    type: DocumentType = Form(...),
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ScanDocumentResponse:
    """Same OCR proposal as app/checkout/documents.py's scan-document, just
    keyed on a reservation instead of a contract — there's no contract yet
    at pre-arrival time. Saves the photo immediately; the driver still
    reviews/corrects the extracted fields before /submit persists them."""
    reservation = _authenticate(db, code, last_name)
    if reservation.id != reservation_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No reservation matches that code and last name.")

    if image.content_type not in ALLOWED_IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported image type: {image.content_type}",
        )

    raw_bytes = await image.read()
    if not raw_bytes:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Empty image upload")
    if len(raw_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image too large (max 10 MB)"
        )

    # _save_image only ever uses its first argument to namespace the file
    # path (see documents.py) — a reservation id serves exactly as well as
    # a contract id there.
    photo_url = _save_image(reservation.id, type, image.content_type, raw_bytes)

    pc = reservation.precheckin
    if pc is None:
        pc = ReservationPrecheckin(
            id=uuid.uuid4(),
            reservation_id=reservation.id,
            status=PrecheckinStatus.REQUESTED,
            contact_email=reservation.driver_email,
            reminder_count=0,
        )
        db.add(pc)
    if type is DocumentType.ID:
        pc.id_photo_url = photo_url
    else:
        pc.license_photo_url = photo_url
    db.commit()

    try:
        data = _extract_with_claude(type, raw_bytes, image.content_type)
    except DocumentScanError as exc:
        return ScanDocumentResponse(success=False, document_type=type, photo_url=photo_url, error=str(exc))

    return ScanDocumentResponse(
        success=True, document_type=type, photo_url=photo_url, data=data, valid=_is_valid(type, data)
    )


# --- Executive review queue --------------------------------------------


@admin_router.get("", response_model=list[PrecheckinQueueItem])
def list_precheckin_queue(
    branch_id: uuid.UUID, within_hours: int | None = None, db: Session = Depends(get_db)
) -> list[PrecheckinQueueItem]:
    query = db.query(Reservation).filter(
        Reservation.pickup_branch_id == branch_id, Reservation.status.in_(STARTABLE_STATUSES)
    )
    if within_hours is not None:
        cutoff = datetime.now(timezone.utc) + timedelta(hours=within_hours)
        query = query.filter(Reservation.pickup_date <= cutoff)

    reservations = query.order_by(Reservation.pickup_date.asc()).all()
    return [
        PrecheckinQueueItem(
            reservation=ReservationRead.model_validate(r),
            precheckin=PrecheckinRead.model_validate(r.precheckin) if r.precheckin else None,
        )
        for r in reservations
    ]


def _get_precheckin_or_404(db: Session, reservation_id: uuid.UUID) -> ReservationPrecheckin:
    reservation = db.get(Reservation, reservation_id)
    if reservation is None or reservation.precheckin is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No pre-check-in request on file for this reservation")
    return reservation.precheckin


@admin_router.post("/{reservation_id}/request", response_model=PrecheckinRequestResponse)
def request_precheckin(
    reservation_id: uuid.UUID, payload: PrecheckinRequestRequest, db: Session = Depends(get_db)
) -> PrecheckinRequestResponse:
    reservation = db.get(Reservation, reservation_id)
    if reservation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

    pc = reservation.precheckin
    if pc is not None and pc.status is not PrecheckinStatus.REQUESTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Driver's data has already been submitted for this reservation.",
        )

    now = datetime.now(timezone.utc)
    if pc is None:
        pc = ReservationPrecheckin(
            id=uuid.uuid4(),
            reservation_id=reservation.id,
            status=PrecheckinStatus.REQUESTED,
            contact_email=payload.email,
            requested_at=now,
            reminder_count=0,
        )
        db.add(pc)
    else:
        # Re-sending, or "Change email" (Executive Pre Check-in design) —
        # restart the wait from now, against whichever address is current.
        pc.contact_email = payload.email
        pc.requested_at = now
        pc.reminder_count = 0

    db.commit()
    db.refresh(pc)
    return PrecheckinRequestResponse(
        reservation_id=reservation.id, precheckin=PrecheckinRead.model_validate(pc), portal_url=_portal_url(reservation)
    )


@admin_router.post("/{reservation_id}/remind", response_model=PrecheckinRead)
def remind_precheckin(reservation_id: uuid.UUID, db: Session = Depends(get_db)) -> PrecheckinRead:
    pc = _get_precheckin_or_404(db, reservation_id)
    if pc.status is not PrecheckinStatus.REQUESTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A reminder only makes sense while still waiting on the driver."
        )
    pc.reminder_count += 1
    db.commit()
    db.refresh(pc)
    return PrecheckinRead.model_validate(pc)


@admin_router.post("/{reservation_id}/confirm", response_model=PrecheckinRead)
def confirm_precheckin(reservation_id: uuid.UUID, db: Session = Depends(get_db)) -> PrecheckinRead:
    """Toggles, matching the design: confirming an already-confirmed
    pre-check-in reverts it to "loaded" (undo), since there's no
    RentalContract yet for this to conflict with."""
    pc = _get_precheckin_or_404(db, reservation_id)
    if pc.status is PrecheckinStatus.CONFIRMED:
        pc.status = PrecheckinStatus.LOADED
        pc.confirmed_at = None
    elif pc.status is PrecheckinStatus.LOADED:
        pc.status = PrecheckinStatus.CONFIRMED
        pc.confirmed_at = datetime.now(timezone.utc)
    else:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Driver hasn't submitted their data yet.")
    db.commit()
    db.refresh(pc)
    return PrecheckinRead.model_validate(pc)


@admin_router.post("/{reservation_id}/unskip", response_model=PrecheckinRead)
def set_precheckin_unskip(
    reservation_id: uuid.UUID, payload: SetUnskipRequest, db: Session = Depends(get_db)
) -> PrecheckinRead:
    pc = _get_precheckin_or_404(db, reservation_id)
    pc.unskip = payload.unskip
    db.commit()
    db.refresh(pc)
    return PrecheckinRead.model_validate(pc)
