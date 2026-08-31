"""Cross-domain entities.

Branch and Extra aren't listed as their own bullet in the Fleetpro data
model (section 3 of CLAUDE.md), but both Vehicle/Reservation/Station/
RentalContract (branch_id) and ReservationExtra/ContractExtra (extra_id)
reference them as catalogs, so they live here rather than inside a single
domain package.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TimestampMixin:
    """created_at / updated_at audit columns, mixed into every model."""

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Branch(Base, TimestampMixin):
    __tablename__ = "branches"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    address: Mapped[str | None] = mapped_column(String(255))


class Extra(Base, TimestampMixin):
    __tablename__ = "extras"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
    default_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
