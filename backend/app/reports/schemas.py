import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.shared.enums import HandoverReportStatus


class PreHandoverReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vehicle_id: uuid.UUID
    photos: list[str]
    damage_diagram: dict
    consumed: bool
    created_at: datetime


class HandoverReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    contract_id: uuid.UUID
    pre_handover_report_id: uuid.UUID | None = None
    photos: list[str]
    damage_diagram: dict
    delivery_km: int | None = None
    delivery_fuel_level: str | None = None
    signature_id: uuid.UUID | None = None
    pdf_url: str | None = None
    status: HandoverReportStatus
    date: datetime
