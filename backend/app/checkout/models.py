import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime
from sqlalchemy import ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.shared.enums import (
    ContractOrigin,
    ContractStatus,
    DepositMechanism,
    DepositStatus,
    ReservationStatus,
    SignatureType,
    TransmissionType,
    pg_enum,
)
from app.shared.models import TimestampMixin

# Fixed deposit amount, in CLP — see "Critical business rules" in CLAUDE.md.
DEPOSIT_AMOUNT_CLP = 500_000


class Driver(Base, TimestampMixin):
    __tablename__ = "drivers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    last_name: Mapped[str] = mapped_column(String(80), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    # These four are only known once documents are scanned (OCR) or entered
    # by the executive — a walk-in Driver row is created at
    # POST /api/v1/checkout/start with just name + email, before that
    # happens (see app/checkout/checkout.py), so they must be nullable.
    national_id_or_passport: Mapped[str | None] = mapped_column(String(40), unique=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    license_number: Mapped[str | None] = mapped_column(String(40))
    license_expiration: Mapped[date | None] = mapped_column(Date)
    id_photo_url: Mapped[str | None] = mapped_column(String(500))
    license_photo_url: Mapped[str | None] = mapped_column(String(500))
    # Must be True, and the license unexpired, before vehicle selection —
    # enforced in the backend, not just the UI (see CLAUDE.md).
    documents_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    preferred_color: Mapped[str | None] = mapped_column(String(40))
    preferred_transmission: Mapped[TransmissionType | None] = mapped_column(
        pg_enum(TransmissionType, "transmission_type")
    )
    last_visit_date: Mapped[date | None] = mapped_column(Date)

    rental_contracts: Mapped[list["RentalContract"]] = relationship(back_populates="driver")

    def is_ready_for_checkout(self, as_of: date | None = None) -> bool:
        """The "Critical business rules" gate from CLAUDE.md: documents
        verified by the executive, and the license not expired."""
        if not self.documents_verified or self.license_expiration is None:
            return False
        reference_date = as_of or datetime.now(timezone.utc).date()
        return self.license_expiration >= reference_date


class Reservation(Base, TimestampMixin):
    """Seeded with sample data; its creation flow is out of scope for this app.

    Driver identity is stored inline (first/last name + email) rather than
    as a driver_id FK, since a reservation can predate the driver having a
    Driver record at all (see seed.py's "walk-in" persona).
    """

    __tablename__ = "reservations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    driver_first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    driver_last_name: Mapped[str] = mapped_column(String(80), nullable=False)
    driver_email: Mapped[str] = mapped_column(String(255), nullable=False)
    pickup_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    return_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    pickup_branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), nullable=False)
    acriss_category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("acriss_categories.id"), nullable=False
    )
    deposit_done_online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[ReservationStatus] = mapped_column(
        pg_enum(ReservationStatus, "reservation_status"),
        nullable=False,
        default=ReservationStatus.CONFIRMED,
    )

    extras: Mapped[list["ReservationExtra"]] = relationship(
        back_populates="reservation", cascade="all, delete-orphan"
    )
    rental_contracts: Mapped[list["RentalContract"]] = relationship(back_populates="reservation")


class ReservationExtra(Base, TimestampMixin):
    __tablename__ = "reservation_extras"
    __table_args__ = (UniqueConstraint("reservation_id", "extra_id", name="uq_reservation_extra"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reservations.id"), nullable=False)
    extra_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("extras.id"), nullable=False)

    reservation: Mapped["Reservation"] = relationship(back_populates="extras")


class Station(Base, TimestampMixin):
    """A counter's executive computer + client tablet pairing.

    Paired once per counter (not per customer) — pairing_token is the
    secret only the paired tablet knows, persisted via localStorage on
    both devices for the life of the shift. active_contract_id points at
    whichever contract is currently being pushed to the paired tablet.
    """

    __tablename__ = "stations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), nullable=False)
    label: Mapped[str] = mapped_column(String(60), nullable=False)
    pairing_token: Mapped[str | None] = mapped_column(String(255))
    # Circular FK (rental_contracts.station_id points back here) — resolved
    # via use_alter, see the initial migration.
    active_contract_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("rental_contracts.id", use_alter=True, name="fk_station_active_contract")
    )
    paired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    rental_contracts: Mapped[list["RentalContract"]] = relationship(
        back_populates="station", foreign_keys="RentalContract.station_id"
    )


class RentalContract(Base, TimestampMixin):
    __tablename__ = "rental_contracts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reservations.id"))
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"), nullable=False)
    # Nullable: a contract is created (status=New) before a vehicle is
    # chosen — see POST /api/v1/checkout/start.
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vehicles.id"))
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), nullable=False)
    station_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stations.id"), nullable=False)
    origin: Mapped[ContractOrigin] = mapped_column(
        pg_enum(ContractOrigin, "contract_origin"), nullable=False
    )
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    departure_km: Mapped[int | None] = mapped_column(Integer)
    departure_fuel_level: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[ContractStatus] = mapped_column(
        pg_enum(ContractStatus, "contract_status"),
        nullable=False,
        default=ContractStatus.NEW,
    )

    driver: Mapped["Driver"] = relationship(back_populates="rental_contracts")
    reservation: Mapped["Reservation | None"] = relationship(back_populates="rental_contracts")
    station: Mapped["Station"] = relationship(
        back_populates="rental_contracts", foreign_keys=[station_id]
    )
    extras: Mapped[list["ContractExtra"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan"
    )
    deposit: Mapped["Deposit | None"] = relationship(
        back_populates="contract", uselist=False, cascade="all, delete-orphan"
    )
    signatures: Mapped[list["DigitalSignature"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan"
    )


class ContractExtra(Base, TimestampMixin):
    __tablename__ = "contract_extras"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rental_contracts.id"), nullable=False)
    extra_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("extras.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    applied_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    contract: Mapped["RentalContract"] = relationship(back_populates="extras")


class Deposit(Base, TimestampMixin):
    __tablename__ = "deposits"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rental_contracts.id"), unique=True, nullable=False
    )
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=DEPOSIT_AMOUNT_CLP)
    mechanism: Mapped[DepositMechanism] = mapped_column(
        pg_enum(DepositMechanism, "deposit_mechanism"), nullable=False
    )
    status: Mapped[DepositStatus] = mapped_column(
        pg_enum(DepositStatus, "deposit_status"),
        nullable=False,
        default=DepositStatus.PENDING,
    )
    authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    contract: Mapped["RentalContract"] = relationship(back_populates="deposit")


class DigitalSignature(Base, TimestampMixin):
    __tablename__ = "digital_signatures"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rental_contracts.id"), nullable=False)
    type: Mapped[SignatureType] = mapped_column(
        pg_enum(SignatureType, "signature_type"), nullable=False
    )
    image_base64: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    contract: Mapped["RentalContract"] = relationship(back_populates="signatures")
