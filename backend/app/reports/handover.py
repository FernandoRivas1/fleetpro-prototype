"""The handover report: resolving which path a signed contract takes, and
the parking lot assistant's flow for producing the final PDF.

"Handover" here means delivery TO the customer at pickup — check-in /
return is explicitly out of scope (see CLAUDE.md) — so this is the last
step of the check-out flow, run right after POST /sign.

Mixes two URL prefixes (/api/v1/checkout/... and /api/v1/reports/...) in
one file since all three routes are one continuous handover lifecycle;
each route spells out its full path rather than using a router prefix
(same pattern as app/checkout/ws.py).

GET /api/v1/reports/new/{contract_id} and its /complete counterpart are,
like app/reports/pre_handover.py, unauthenticated (reached by link/QR
handed to the parking lot assistant).
STUB: no expiration or security token, add one before any real use.
"""
import base64
import io
import json
import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Image as RLImage
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from app.checkout.models import DigitalSignature, Driver, RentalContract
from app.config import settings
from app.database import get_db
from app.fleet.models import Vehicle
from app.fleet.schemas import VehicleRead
from app.reports.models import HandoverReport, PreHandoverReport
from app.reports.schemas import HandoverReportRead
from app.shared.enums import ContractStatus, HandoverReportStatus, SignatureType

router = APIRouter(tags=["reports"])

ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


# --- resolve-handover ------------------------------------------------------


class ResolveHandoverResponse(BaseModel):
    type: Literal["pre_report", "new_report"]
    url: str


@router.post("/api/v1/checkout/{contract_id}/resolve-handover", response_model=ResolveHandoverResponse)
def resolve_handover(contract_id: uuid.UUID, db: Session = Depends(get_db)) -> ResolveHandoverResponse:
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    if contract.status is not ContractStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Contract must be signed (Open) before resolving its handover",
        )
    if contract.vehicle_id is None:  # pragma: no cover - Open implies a vehicle was selected
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contract has no vehicle assigned")

    # Idempotent: if this was already resolved, hand back the same answer
    # instead of consuming a second pre-report or creating a duplicate
    # HandoverReport.
    existing = db.query(HandoverReport).filter(HandoverReport.contract_id == contract_id).one_or_none()
    if existing is not None:
        return ResolveHandoverResponse(type="new_report", url=f"{settings.app_url}/report/new/{contract_id}")

    pre_report = (
        db.query(PreHandoverReport)
        .filter(PreHandoverReport.vehicle_id == contract.vehicle_id, PreHandoverReport.consumed.is_(False))
        .order_by(PreHandoverReport.created_at.asc())
        .first()
    )
    if pre_report is not None:
        pre_report.consumed = True
        db.commit()
        return ResolveHandoverResponse(type="pre_report", url=f"{settings.app_url}/report/pre/{pre_report.id}")

    handover = HandoverReport(
        id=uuid.uuid4(),
        contract_id=contract_id,
        status=HandoverReportStatus.PENDING,
    )
    db.add(handover)
    db.commit()

    return ResolveHandoverResponse(type="new_report", url=f"{settings.app_url}/report/new/{contract_id}")


# --- the parking lot assistant's flow --------------------------------------


class NewHandoverReportView(BaseModel):
    contract_id: uuid.UUID
    handover_report: HandoverReportRead
    driver_name: str
    vehicle: VehicleRead | None = None


@router.get("/api/v1/reports/new/{contract_id}", response_model=NewHandoverReportView)
def get_new_handover_report(contract_id: uuid.UUID, db: Session = Depends(get_db)) -> NewHandoverReportView:
    # STUB: no expiration or security token, add one before any real use.
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    handover = db.query(HandoverReport).filter(HandoverReport.contract_id == contract_id).one_or_none()
    if handover is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No handover report exists for this contract yet — call resolve-handover first",
        )

    driver = db.get(Driver, contract.driver_id)
    vehicle = db.get(Vehicle, contract.vehicle_id) if contract.vehicle_id else None

    return NewHandoverReportView(
        contract_id=contract_id,
        handover_report=HandoverReportRead.model_validate(handover),
        driver_name=f"{driver.first_name} {driver.last_name}" if driver else "",
        vehicle=VehicleRead.model_validate(vehicle) if vehicle else None,
    )


class CompleteHandoverResponse(BaseModel):
    contract_id: uuid.UUID
    handover_report_id: uuid.UUID
    status: HandoverReportStatus
    pdf_url: str


@router.post("/api/v1/reports/new/{contract_id}/complete", response_model=CompleteHandoverResponse)
async def complete_handover_report(
    contract_id: uuid.UUID,
    delivery_km: int = Form(...),
    delivery_fuel_level: str = Form(...),
    signature_image_base64: str = Form(...),
    damage_diagram_json: str | None = Form(None),
    photos: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> CompleteHandoverResponse:
    # STUB: no expiration or security token, add one before any real use.
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    handover = db.query(HandoverReport).filter(HandoverReport.contract_id == contract_id).one_or_none()
    if handover is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No handover report exists for this contract yet — call resolve-handover first",
        )
    if handover.status is HandoverReportStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This handover report is already completed")

    uploaded = [p for p in photos if p.filename]
    if not uploaded:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one photo is required")

    photo_urls: list[str] = []
    photo_disk_paths: list[str] = []
    for photo in uploaded:
        if photo.content_type not in ALLOWED_IMAGE_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unsupported image type: {photo.content_type}",
            )
        raw = await photo.read()
        if not raw:
            continue
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image too large (max 10 MB)"
            )
        url, disk_path = _save_handover_photo(contract_id, photo.content_type, raw)
        photo_urls.append(url)
        photo_disk_paths.append(disk_path)

    damage_diagram: dict = {}
    if damage_diagram_json:
        try:
            parsed = json.loads(damage_diagram_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid damage_diagram_json: {exc}"
            ) from exc
        if not isinstance(parsed, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="damage_diagram_json must be a JSON object"
            )
        damage_diagram = parsed

    try:
        # binascii.Error (raised by validate=True on bad padding/characters)
        # is itself a ValueError subclass, so this one except covers both.
        signature_bytes = base64.b64decode(signature_image_base64, validate=True)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid signature_image_base64: {exc}"
        ) from exc

    signature = DigitalSignature(
        id=uuid.uuid4(),
        contract_id=contract_id,
        type=SignatureType.HANDOVER_REPORT,
        image_base64=signature_image_base64,
    )
    db.add(signature)
    db.flush()

    now = datetime.now(timezone.utc)
    handover.photos = photo_urls
    handover.damage_diagram = damage_diagram
    handover.delivery_km = delivery_km
    handover.delivery_fuel_level = delivery_fuel_level
    handover.signature_id = signature.id
    handover.status = HandoverReportStatus.COMPLETED
    handover.date = now

    # RentalContract.departure_km/departure_fuel_level represent the same
    # real-world moment (the vehicle leaving with the customer) — keep them
    # in sync rather than leaving them null forever.
    contract.departure_km = delivery_km
    contract.departure_fuel_level = delivery_fuel_level

    driver = db.get(Driver, contract.driver_id)
    vehicle = db.get(Vehicle, contract.vehicle_id) if contract.vehicle_id else None

    pdf_bytes = _generate_handover_pdf(
        handover=handover,
        contract=contract,
        driver=driver,
        vehicle=vehicle,
        photo_disk_paths=photo_disk_paths,
        signature_bytes=signature_bytes,
    )
    handover.pdf_url = _save_pdf(contract_id, pdf_bytes)

    db.commit()
    db.refresh(handover)

    return CompleteHandoverResponse(
        contract_id=contract_id,
        handover_report_id=handover.id,
        status=handover.status,
        pdf_url=handover.pdf_url,
    )


# --- storage -----------------------------------------------------------


def _save_handover_photo(contract_id: uuid.UUID, content_type: str, raw_bytes: bytes) -> tuple[str, str]:
    ext = mimetypes.guess_extension(content_type) or ".bin"
    directory = Path(settings.uploads_dir) / "handover-reports" / str(contract_id)
    directory.mkdir(parents=True, exist_ok=True)

    filename = f"photo_{uuid.uuid4().hex}{ext}"
    disk_path = directory / filename
    disk_path.write_bytes(raw_bytes)

    return f"/uploads/handover-reports/{contract_id}/{filename}", str(disk_path)


def _save_pdf(contract_id: uuid.UUID, pdf_bytes: bytes) -> str:
    directory = Path(settings.uploads_dir) / "handover-reports" / str(contract_id)
    directory.mkdir(parents=True, exist_ok=True)

    filename = "handover_report.pdf"
    (directory / filename).write_bytes(pdf_bytes)

    return f"/uploads/handover-reports/{contract_id}/{filename}"


# --- PDF generation (reportlab — pure Python, no system libraries needed;
# weasyprint needs Pango/cairo/GDK-Pixbuf, which is painful to get running
# on Windows dev machines) ---------------------------------------------


def _generate_handover_pdf(
    handover: HandoverReport,
    contract: RentalContract,
    driver: Driver | None,
    vehicle: Vehicle | None,
    photo_disk_paths: list[str],
    signature_bytes: bytes,
) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, title="Vehicle Handover Report")
    styles = getSampleStyleSheet()
    story = [Paragraph("Vehicle Handover Report", styles["Title"]), Spacer(1, 12)]

    info_rows = [
        ["Contract ID", str(contract.id)],
        ["Date", handover.date.strftime("%Y-%m-%d %H:%M UTC") if handover.date else "-"],
        ["Driver", f"{driver.first_name} {driver.last_name}" if driver else "-"],
        ["Vehicle", f"{vehicle.make} {vehicle.model} ({vehicle.plate})" if vehicle else "-"],
        ["Delivery mileage", f"{handover.delivery_km} km" if handover.delivery_km is not None else "-"],
        ["Fuel level at delivery", handover.delivery_fuel_level or "-"],
    ]
    table = Table(info_rows, colWidths=[5 * cm, 10 * cm])
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
            ]
        )
    )
    story.extend([table, Spacer(1, 16)])

    if handover.damage_diagram:
        story.append(Paragraph("Damage notes", styles["Heading2"]))
        story.append(Paragraph(json.dumps(handover.damage_diagram), styles["BodyText"]))
        story.append(Spacer(1, 12))

    if photo_disk_paths:
        story.append(Paragraph("Photos", styles["Heading2"]))
        for path in photo_disk_paths:
            try:
                story.append(RLImage(path, width=8 * cm, height=6 * cm))
                story.append(Spacer(1, 8))
            except Exception:  # noqa: BLE001 - a bad/corrupt photo shouldn't fail the whole PDF
                continue

    story.append(Paragraph("Customer signature", styles["Heading2"]))
    try:
        story.append(RLImage(io.BytesIO(signature_bytes), width=6 * cm, height=3 * cm))
    except Exception:  # noqa: BLE001
        story.append(Paragraph("(signature image unavailable)", styles["BodyText"]))

    doc.build(story)
    return buffer.getvalue()
