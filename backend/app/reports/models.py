import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime
from sqlalchemy import ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.shared.enums import HandoverReportStatus, pg_enum
from app.shared.models import TimestampMixin


class PreHandoverReport(Base, TimestampMixin):
    """A vehicle inspection captured before it's assigned to a contract.

    consumed=False means it's still available to be attached to the next
    HandoverReport for this vehicle instead of redoing the inspection.
    """

    __tablename__ = "pre_handover_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"), nullable=False)
    photos: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    damage_diagram: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    consumed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    handover_reports: Mapped[list["HandoverReport"]] = relationship(
        back_populates="pre_handover_report"
    )


class HandoverReport(Base, TimestampMixin):
    __tablename__ = "handover_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rental_contracts.id"), nullable=False)
    pre_handover_report_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("pre_handover_reports.id")
    )
    photos: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    damage_diagram: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Nullable: a HandoverReport is created in "pending" status (see
    # POST /api/v1/checkout/{contract_id}/resolve-handover) before the
    # parking lot assistant has actually recorded these at
    # POST /api/v1/reports/new/{contract_id}/complete.
    delivery_km: Mapped[int | None] = mapped_column(Integer)
    delivery_fuel_level: Mapped[str | None] = mapped_column(String(20))
    signature_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("digital_signatures.id"))
    pdf_url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[HandoverReportStatus] = mapped_column(
        pg_enum(HandoverReportStatus, "handover_report_status"),
        nullable=False,
        default=HandoverReportStatus.PENDING,
    )
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    pre_handover_report: Mapped["PreHandoverReport | None"] = relationship(
        back_populates="handover_reports"
    )
