import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.shared.enums import (
    ContractOrigin,
    ContractStatus,
    CustomerTier,
    DepositMechanism,
    DepositStatus,
    ReservationStatus,
    SignatureType,
    TransmissionType,
)


class DriverRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    first_name: str
    last_name: str
    email: str
    national_id_or_passport: str | None = None
    phone: str | None = None
    license_number: str | None = None
    license_expiration: date | None = None
    id_photo_url: str | None = None
    license_photo_url: str | None = None
    documents_verified: bool
    preferred_color: str | None = None
    preferred_transmission: TransmissionType | None = None
    last_visit_date: date | None = None
    tier: CustomerTier


class ReservationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    driver_first_name: str
    driver_last_name: str
    driver_email: str
    pickup_date: datetime
    return_date: datetime
    pickup_branch_id: uuid.UUID
    acriss_category_id: uuid.UUID
    deposit_done_online: bool
    status: ReservationStatus
    # Not a Reservation column — Reservation stores driver identity inline
    # (no driver_id FK, see models.py), so this is populated by a
    # separate lookup-by-email in the endpoints that return this schema
    # (reservations.py, precheckin.py), null if no Driver row exists yet
    # for this email (Executive Main design's tier chip on each row).
    driver_tier: CustomerTier | None = None


class ReservationExtraRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reservation_id: uuid.UUID
    extra_id: uuid.UUID


class StationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    branch_id: uuid.UUID
    label: str
    active_contract_id: uuid.UUID | None = None
    paired_at: datetime | None = None
    last_seen_at: datetime | None = None


class RentalContractRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reservation_id: uuid.UUID | None = None
    driver_id: uuid.UUID
    vehicle_id: uuid.UUID | None = None
    branch_id: uuid.UUID
    station_id: uuid.UUID
    origin: ContractOrigin
    opened_at: datetime | None = None
    departure_km: int | None = None
    departure_fuel_level: str | None = None
    status: ContractStatus


class ContractExtraRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    contract_id: uuid.UUID
    extra_id: uuid.UUID
    quantity: int
    applied_price: float


class DepositRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    contract_id: uuid.UUID
    amount: float
    mechanism: DepositMechanism
    status: DepositStatus
    authorized_at: datetime | None = None


class DigitalSignatureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    contract_id: uuid.UUID
    type: SignatureType
    timestamp: datetime
