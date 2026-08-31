import uuid

from sqlalchemy import ForeignKey, Integer, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.shared.enums import VehicleStatus, pg_enum
from app.shared.models import TimestampMixin


class ACRISSCategory(Base, TimestampMixin):
    """The 4-letter ACRISS code plus the feature set customers compare.

    hierarchy_order encodes the ECAR < CDAR < ICAR < FVAR ranking used by
    the upsell rule (an upsell can never be an equal or lower category).
    """

    __tablename__ = "acriss_categories"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(4), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    hierarchy_order: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    base_daily_rate: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    # { transmission, air_conditioning, bluetooth, passenger_capacity, trunk_capacity_l }
    features: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="acriss_category")


class Vehicle(Base, TimestampMixin):
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    plate: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    make: Mapped[str] = mapped_column(String(60), nullable=False)
    model: Mapped[str] = mapped_column(String(60), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    acriss_category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("acriss_categories.id"), nullable=False
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), nullable=False)
    status: Mapped[VehicleStatus] = mapped_column(
        pg_enum(VehicleStatus, "vehicle_status"),
        nullable=False,
        default=VehicleStatus.AVAILABLE,
    )
    current_km: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_service_km: Mapped[int] = mapped_column(Integer, nullable=False)
    damage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    main_photo_url: Mapped[str | None] = mapped_column(String(500))

    acriss_category: Mapped["ACRISSCategory"] = relationship(back_populates="vehicles")
