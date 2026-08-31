"""Public, unauthenticated pages for a pre-handover inspection report.

Reached by the customer scanning a QR/following a link handed to them at
resolve-handover time (app/reports/handover.py) — there's no login for a
walk-up customer, so these two endpoints intentionally require nothing but
the report's id.

STUB: no expiration or security token on these ids — anyone who guesses
or intercepts a pre_report_id can view (and comment on) that report.
Add a signed/expiring token before any real use.
"""
import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.fleet.models import Vehicle
from app.reports.models import PreHandoverReport

router = APIRouter(prefix="/api/v1/reports/pre", tags=["reports"])

ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


class PublicVehicleSummary(BaseModel):
    """Deliberately NOT the full VehicleRead — this page has no auth, so it
    shouldn't leak fleet-management fields (branch, category, damage
    count, service schedule) to whoever has the link."""

    model_config = ConfigDict(from_attributes=True)

    plate: str
    make: str
    model: str
    year: int
    main_photo_url: str | None = None


class PreHandoverReportPublicView(BaseModel):
    id: uuid.UUID
    vehicle: PublicVehicleSummary | None = None
    photos: list[str]
    damage_diagram: dict
    created_at: datetime


class AddCommentResponse(BaseModel):
    id: uuid.UUID
    note: str | None = None
    photo_url: str | None = None
    created_at: datetime


@router.get("/{pre_report_id}", response_model=PreHandoverReportPublicView)
def get_pre_handover_report(pre_report_id: uuid.UUID, db: Session = Depends(get_db)) -> PreHandoverReportPublicView:
    # STUB: no expiration or security token, add one before any real use.
    report = db.get(PreHandoverReport, pre_report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pre-handover report not found")

    vehicle = db.get(Vehicle, report.vehicle_id)

    return PreHandoverReportPublicView(
        id=report.id,
        vehicle=PublicVehicleSummary.model_validate(vehicle) if vehicle else None,
        photos=report.photos,
        damage_diagram=report.damage_diagram,
        created_at=report.created_at,
    )


@router.post("/{pre_report_id}/comment", response_model=AddCommentResponse)
async def add_pre_handover_comment(
    pre_report_id: uuid.UUID,
    note: str | None = Form(None),
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
) -> AddCommentResponse:
    # STUB: no expiration or security token, add one before any real use.
    report = db.get(PreHandoverReport, pre_report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pre-handover report not found")

    clean_note = note.strip() if note and note.strip() else None

    photo_url = None
    if photo is not None and photo.filename:
        if photo.content_type not in ALLOWED_IMAGE_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unsupported image type: {photo.content_type}",
            )
        raw = await photo.read()
        if raw:
            if len(raw) > MAX_IMAGE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image too large (max 10 MB)"
                )
            photo_url = _save_comment_photo(pre_report_id, photo.content_type, raw)

    if not clean_note and not photo_url:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Provide a note, a photo, or both")

    # There's no dedicated comments table in the data model (see
    # CLAUDE.md section 3) — damage_diagram is already a free-form JSON
    # blob on this exact record, so client feedback is appended there
    # under its own key rather than introducing a new table for this.
    comment = {
        "id": str(uuid.uuid4()),
        "note": clean_note,
        "photo_url": photo_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    updated_diagram = dict(report.damage_diagram or {})
    updated_diagram["client_comments"] = [*updated_diagram.get("client_comments", []), comment]
    report.damage_diagram = updated_diagram  # reassignment, not in-place mutation -> ORM sees the change

    db.commit()

    return AddCommentResponse(
        id=uuid.UUID(comment["id"]),
        note=comment["note"],
        photo_url=comment["photo_url"],
        created_at=datetime.fromisoformat(comment["created_at"]),
    )


def _save_comment_photo(pre_report_id: uuid.UUID, content_type: str, raw_bytes: bytes) -> str:
    ext = mimetypes.guess_extension(content_type) or ".bin"
    directory = Path(settings.uploads_dir) / "pre-handover-comments" / str(pre_report_id)
    directory.mkdir(parents=True, exist_ok=True)

    filename = f"comment_{uuid.uuid4().hex}{ext}"
    (directory / filename).write_bytes(raw_bytes)

    return f"/uploads/pre-handover-comments/{pre_report_id}/{filename}"
