"""OCR document scanning via the Anthropic API.

POST /api/v1/checkout/{contract_id}/scan-document takes a photo of an ID
or a driver's license, asks claude-sonnet-5 to extract structured fields
from it, and hands those back to the executive for on-screen confirmation.

Deliberately NOT written here: the extracted fields aren't saved onto the
Driver row. Confirmation is a distinct step (the documents_confirmed_by_
executive WebSocket message from app/checkout/ws.py) where the executive
has reviewed/corrected whatever Claude read — this endpoint only proposes
data. The one field it does persist is the photo itself, via
Driver.id_photo_url / license_photo_url, since there's nothing to review
about "a photo was uploaded."
"""
import base64
import enum
import json
import mimetypes
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import anthropic
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.checkout.models import Driver, RentalContract
from app.config import settings
from app.database import get_db

router = APIRouter(prefix="/api/v1/checkout", tags=["checkout", "documents"])

MODEL = "claude-sonnet-5"
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


class DocumentType(str, enum.Enum):
    ID = "id"
    LICENSE = "license"


# The exact fields to extract per document type, per the spec.
FIELD_SETS: dict[DocumentType, tuple[str, ...]] = {
    DocumentType.ID: ("first_name", "last_name", "national_id_or_passport", "birth_date"),
    DocumentType.LICENSE: ("license_number", "expiration_date"),
}

_PROMPTS: dict[DocumentType, str] = {
    DocumentType.ID: (
        "You are extracting data from a photo of an identity document (a "
        "national ID card or passport). Respond with ONLY a raw JSON "
        'object — no markdown, no code fences, no commentary — with '
        'exactly these keys: "first_name", "last_name", '
        '"national_id_or_passport", "birth_date". Format birth_date as '
        "YYYY-MM-DD. Use null for any field you can't read."
    ),
    DocumentType.LICENSE: (
        "You are extracting data from a photo of a driver's license. "
        "Respond with ONLY a raw JSON object — no markdown, no code "
        'fences, no commentary — with exactly these keys: '
        '"license_number", "expiration_date". Format expiration_date as '
        "YYYY-MM-DD. Use null for any field you can't read."
    ),
}


class DocumentScanError(Exception):
    """Anything that goes wrong calling Claude or parsing its response.

    Always caught in the route handler and turned into a
    `success: false` response — never a 500 — so the executive can fall
    back to typing the data in by hand, per the brief.
    """


class ScanDocumentResponse(BaseModel):
    success: bool
    document_type: DocumentType
    photo_url: str | None = None
    data: dict[str, str | None] | None = None
    valid: bool = False
    error: str | None = None


class DocumentScanModeResponse(BaseModel):
    skip_document_ocr: bool


@router.get("/document-scan-mode", response_model=DocumentScanModeResponse)
async def document_scan_mode() -> DocumentScanModeResponse:
    """Lets a document-capture UI (client tablet, precheckin portal) know
    whether OCR is currently mocked (see skip_document_ocr in
    app/config.py), so it can skip requiring an actual photo while this
    TEMPORARY testing switch is on. See DocumentsStep.tsx."""
    return DocumentScanModeResponse(skip_document_ocr=settings.skip_document_ocr)


@router.post("/{contract_id}/scan-document", response_model=ScanDocumentResponse)
async def scan_document(
    contract_id: uuid.UUID,
    type: DocumentType = Form(...),
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ScanDocumentResponse:
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

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

    photo_url = _save_image(contract_id, type, image.content_type, raw_bytes)

    driver = db.get(Driver, contract.driver_id)
    if driver is not None:
        if type is DocumentType.ID:
            driver.id_photo_url = photo_url
        else:
            driver.license_photo_url = photo_url
        db.commit()

    try:
        data = _extract_with_claude(type, raw_bytes, image.content_type)
    except DocumentScanError as exc:
        return ScanDocumentResponse(
            success=False,
            document_type=type,
            photo_url=photo_url,
            error=str(exc),
        )

    return ScanDocumentResponse(
        success=True,
        document_type=type,
        photo_url=photo_url,
        data=data,
        valid=_is_valid(type, data),
    )


# --- Storage ---------------------------------------------------------------


def _save_image(contract_id: uuid.UUID, document_type: DocumentType, content_type: str, raw_bytes: bytes) -> str:
    """Save locally under UPLOADS_DIR/{contract_id}/... — see main.py for
    the static mount that serves this back out as `photo_url`."""
    ext = mimetypes.guess_extension(content_type) or ".bin"
    contract_dir = Path(settings.uploads_dir) / str(contract_id)
    contract_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{document_type.value}_{uuid.uuid4().hex}{ext}"
    (contract_dir / filename).write_bytes(raw_bytes)

    return f"/uploads/{contract_id}/{filename}"


# --- Claude OCR --------------------------------------------------------


_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    """Constructed lazily (not at import time) so a missing API key
    surfaces as a per-request DocumentScanError, not an app-startup crash."""
    global _client
    if _client is None:
        if not settings.anthropic_api_key:
            raise DocumentScanError("ANTHROPIC_API_KEY is not configured")
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


_MOCK_DATA: dict[DocumentType, dict[str, str | None]] = {
    DocumentType.ID: {
        "first_name": "Test",
        "last_name": "Driver",
        "national_id_or_passport": "12.345.678-9",
        "birth_date": "1990-01-01",
    },
    DocumentType.LICENSE: {
        "license_number": "A1234567",
        # Always ~2 years out so _is_valid's expiration check keeps passing.
        "expiration_date": date(datetime.now(timezone.utc).year + 2, 1, 1).isoformat(),
    },
}


def _extract_with_claude(document_type: DocumentType, image_bytes: bytes, media_type: str) -> dict[str, str | None]:
    if settings.skip_document_ocr:
        # TEMPORARY — see the skip_document_ocr docstring in app/config.py.
        # No network call, no tokens spent; returns fixed data as if OCR
        # had read it perfectly.
        return dict(_MOCK_DATA[document_type])

    client = _get_client()
    encoded = base64.standard_b64encode(image_bytes).decode("ascii")

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": media_type, "data": encoded},
                        },
                        {"type": "text", "text": _PROMPTS[document_type]},
                    ],
                }
            ],
        )
    except anthropic.APIError as exc:
        raise DocumentScanError(f"Claude API call failed: {exc}") from exc
    except Exception as exc:
        # Catch-all: a client-side/SDK-internal failure (e.g. a response the
        # installed SDK version fails to parse) isn't an anthropic.APIError,
        # but per this module's docstring a scan must never surface as a
        # raw 500 — always degrade to success: false so the executive can
        # fall back to typing the data in by hand.
        raise DocumentScanError(f"Claude call failed unexpectedly: {exc}") from exc

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    text = _FENCE_RE.sub("", text).strip()

    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise DocumentScanError(f"Could not parse Claude's response as JSON: {exc}") from exc

    if not isinstance(raw, dict):
        raise DocumentScanError("Claude's response was valid JSON but not an object")

    fields = FIELD_SETS[document_type]
    return {field: raw.get(field) for field in fields}


def _is_valid(document_type: DocumentType, data: dict[str, str | None]) -> bool:
    """False if any expected field is missing, or — for a license — if
    expiration_date couldn't be parsed or is in the past."""
    if any(data.get(field) is None for field in FIELD_SETS[document_type]):
        return False

    if document_type is DocumentType.LICENSE:
        try:
            expiration = datetime.strptime(data["expiration_date"], "%Y-%m-%d").date()
        except (TypeError, ValueError):
            return False
        return expiration >= datetime.now(timezone.utc).date()

    return True
