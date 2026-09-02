"""The checkout flow's entrypoint and reload-safe status snapshot.

POST /api/v1/checkout/start creates the RentalContract and pushes
contract_started to whichever devices are already connected on that
station's WebSocket channel (app/checkout/ws.py) — no new pairing
involved, the tablet is already listening.

GET /api/v1/checkout/{contract_id}/status lets either device "catch up"
after a reload. Per-step WebSocket messages (step_updated, candidates_sent,
upsell_offered, ...) are deliberately NOT persisted (see ws.py's
docstring), so `current_step` here is *inferred* from what IS persisted —
the contract, driver, and whatever's been attached to the contract so far.
It's a coarse, best-effort reconstruction, not a replay of every message
a reloading device missed.
"""
import enum
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.checkout.flow import _current_category
from app.checkout.models import DEPOSIT_AMOUNT_CLP, Deposit, Driver, RentalContract, Reservation, Station
from app.checkout.schemas import ContractExtraRead, DepositRead, DigitalSignatureRead
from app.checkout.ws import CheckoutMessageType, manager
from app.database import get_db
from app.fleet.models import Vehicle
from app.fleet.schemas import ACRISSCategoryRead, VehicleRead
from app.shared.enums import (
    ContractOrigin,
    ContractStatus,
    CustomerTier,
    DepositMechanism,
    DepositStatus,
    PrecheckinStatus,
    SignatureType,
)
from app.shared.models import Branch

router = APIRouter(prefix="/api/v1/checkout", tags=["checkout"])


# --- Schemas -----------------------------------------------------------


class CheckoutStartRequest(BaseModel):
    station_id: uuid.UUID
    reservation_id: uuid.UUID | None = None
    first_name: str | None = None
    last_name: str | None = None
    # Optional for a walk-in: the executive's "Guest" mode (see
    # Executive Main design) identifies nobody by email at all. When
    # omitted, start_checkout() synthesizes a placeholder to satisfy
    # Driver.email's NOT NULL UNIQUE constraint — never surfaced to the UI.
    email: str | None = None
    # Walk-in only (multi-branch switching, Executive Main design): which
    # branch's fleet this contract draws from, when the executive has
    # switched away from the station's own default. Ignored for a
    # reservation-based start — that contract's branch always follows the
    # reservation's own pickup_branch_id instead, see start_checkout below.
    branch_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "CheckoutStartRequest":
        has_reservation = self.reservation_id is not None
        has_walk_in = bool(self.first_name and self.last_name)
        if has_reservation == has_walk_in:  # neither given, or both given
            raise ValueError("Provide either `reservation_id`, or `first_name` + `last_name` for a walk-in.")
        return self


class CheckoutStartResponse(BaseModel):
    contract_id: uuid.UUID
    driver_id: uuid.UUID
    origin: ContractOrigin
    # True when this driver is already on file with verified documents and
    # an unexpired license — the executive UI can skip straight past
    # scanning to confirmation.
    skip_document_scan: bool
    # True when the originating reservation's Pre Check-in was confirmed
    # by the executive (and not "unskipped" back on) — the client tablet
    # can skip both Documents and Data and start at Vehicle. See
    # _skip_driver_data below and app/checkout/precheckin.py.
    skip_driver_data: bool


class CheckoutStep(str, enum.Enum):
    # Wizard order (Tablet Rental Details design): Rental details -> Vehicle
    # -> Extras -> Documents -> Data -> Deposit -> Signature. The four
    # values below are unchanged from before that reorder — see
    # _infer_current_step for how they now map onto the new order; this
    # is still a coarse, best-effort snapshot (module docstring), not a
    # 1:1 step enum.
    RENTAL_DETAILS = "rental_details"
    DOCUMENT_VERIFICATION = "document_verification"
    VEHICLE_SELECTION = "vehicle_selection"
    EXTRAS_AND_DEPOSIT = "extras_and_deposit"
    AWAITING_SIGNATURE = "awaiting_signature"
    AWAITING_HANDOVER = "awaiting_handover"
    COMPLETED = "completed"


class CheckoutDriverSummary(BaseModel):
    id: uuid.UUID
    first_name: str
    last_name: str
    email: str
    phone: str | None = None
    national_id_or_passport: str | None = None
    license_number: str | None = None
    documents_verified: bool
    license_expiration: date | None = None
    ready_for_checkout: bool
    tier: CustomerTier


class CheckoutStatusResponse(BaseModel):
    contract_id: uuid.UUID
    status: ContractStatus
    origin: ContractOrigin
    current_step: CheckoutStep
    station_id: uuid.UUID
    branch_id: uuid.UUID
    reservation_id: uuid.UUID | None = None
    opened_at: datetime | None = None
    driver: CheckoutDriverSummary
    vehicle: VehicleRead | None = None
    # The category to base vehicle candidates on: the selected vehicle's
    # category if one is chosen, else the originating reservation's — null
    # for a walk-in that hasn't picked a vehicle yet (see flow.py's
    # _current_category, reused here rather than duplicated).
    current_category: ACRISSCategoryRead | None = None
    extras: list[ContractExtraRead] = []
    deposit: DepositRead | None = None
    signatures: list[DigitalSignatureRead] = []
    skip_driver_data: bool = False
    rental_details_confirmed: bool = False


# --- Routes --------------------------------------------------------------


@router.post("/start", response_model=CheckoutStartResponse, status_code=status.HTTP_201_CREATED)
async def start_checkout(payload: CheckoutStartRequest, db: Session = Depends(get_db)) -> CheckoutStartResponse:
    station = db.get(Station, payload.station_id)
    if station is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")

    reservation: Reservation | None = None
    if payload.reservation_id is not None:
        reservation = db.get(Reservation, payload.reservation_id)
        if reservation is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")
        first_name = reservation.driver_first_name
        last_name = reservation.driver_last_name
        email = reservation.driver_email
        origin = ContractOrigin.FROM_RESERVATION
        # The reservation dictates the branch, not the station — the
        # executive may have switched to browsing a different branch's
        # reservations (multi-branch switching, Executive Main design)
        # than the one this station is physically paired to.
        contract_branch_id = reservation.pickup_branch_id
    else:
        first_name = payload.first_name
        last_name = payload.last_name
        email = payload.email
        origin = ContractOrigin.WALK_IN
        if payload.branch_id is not None:
            if db.get(Branch, payload.branch_id) is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
            contract_branch_id = payload.branch_id
        else:
            contract_branch_id = station.branch_id

    driver = db.query(Driver).filter(func.lower(Driver.email) == email.lower()).one_or_none() if email else None
    if driver is None:
        driver = Driver(
            id=uuid.uuid4(),
            first_name=first_name,
            last_name=last_name,
            email=email or f"guest-{uuid.uuid4().hex[:10]}@walkin.fleetpro.local",
            documents_verified=False,
        )
        db.add(driver)
        db.flush()  # surface any constraint violation before creating the contract

    # Pre Check-in (app/checkout/precheckin.py): a confirmed, non-unskipped
    # remote submission is as good as the executive having verified
    # documents and confirmed data in person, so copy it onto the driver
    # exactly like confirm-documents would — but only if this driver isn't
    # already ready some other way (a returning customer's own on-file
    # documents take precedence over a possibly-stale pre-check-in copy),
    # and never with an already-expired license. Also never with a
    # national_id_or_passport that collides with a *different* driver
    # (drivers.national_id_or_passport is unique) — same conflict
    # confirm-documents guards against below, just reached a different
    # way here: two people's pre-check-in submissions naming the same
    # document number. Rather than crash the whole check-out start, fall
    # back to skip_driver_data=False so the client goes through the
    # normal Documents/Data screens and the executive resolves it there.
    already_ready = driver.documents_verified
    precheckin_confirmed = reservation is not None and _reservation_precheckin_confirmed(reservation)
    copied_from_precheckin = False
    if precheckin_confirmed and not already_ready:
        pc = reservation.precheckin
        today = datetime.now(timezone.utc).date()
        national_id_taken = pc.national_id_or_passport is not None and (
            db.query(Driver)
            .filter(Driver.national_id_or_passport == pc.national_id_or_passport, Driver.id != driver.id)
            .first()
            is not None
        )
        if pc.license_expiration is not None and pc.license_expiration >= today and not national_id_taken:
            driver.national_id_or_passport = pc.national_id_or_passport
            driver.phone = pc.phone
            driver.license_number = pc.license_number
            driver.license_expiration = pc.license_expiration
            driver.id_photo_url = pc.id_photo_url
            driver.license_photo_url = pc.license_photo_url
            driver.documents_verified = True
            copied_from_precheckin = True

    skip_driver_data = already_ready or copied_from_precheckin

    skip_document_scan = driver.is_ready_for_checkout()

    # Rental Details step (Tablet Rental Details design): a walk-in has no
    # Reservation row to hold these, so seed sensible starting values
    # directly on the contract — "pickup" is right now, for one day,
    # returning to the same branch — which the client can then edit
    # before confirming. A from_reservation contract leaves these null:
    # it reads/writes the Reservation's own fields instead (see
    # rental_details.py's _rental_details_response).
    now = datetime.now(timezone.utc)

    contract = RentalContract(
        id=uuid.uuid4(),
        reservation_id=payload.reservation_id,
        driver_id=driver.id,
        vehicle_id=None,
        branch_id=contract_branch_id,
        station_id=station.id,
        origin=origin,
        status=ContractStatus.NEW,
        pickup_date=None if reservation is not None else now,
        return_date=None if reservation is not None else now + timedelta(days=1),
        return_branch_id=None if reservation is not None else contract_branch_id,
    )
    db.add(contract)
    # Station.active_contract_id has no ORM relationship() (see its
    # use_alter=True FK in models.py — that's a DDL-only hint), so
    # SQLAlchemy's unit-of-work has no dependency processor telling it the
    # contract row must exist before the station UPDATE below references
    # it. Without this flush, the two can be ordered UPDATE-before-INSERT
    # at commit time and the FK constraint rejects the UPDATE.
    db.flush()

    # A reservation with deposit_done_online=True already had its deposit
    # collected during online booking — inherit that as an authorized
    # Deposit on the contract, so GET /deposit and POST /sign see it
    # without asking the customer to pay again at the counter.
    if reservation is not None and reservation.deposit_done_online:
        db.add(
            Deposit(
                id=uuid.uuid4(),
                contract_id=contract.id,
                amount=DEPOSIT_AMOUNT_CLP,
                mechanism=DepositMechanism.ONLINE_IN_ADVANCE,
                status=DepositStatus.AUTHORIZED,
                authorized_at=now,
            )
        )

    station.active_contract_id = contract.id

    db.commit()
    db.refresh(contract)

    # The tablet (and any other device) already connected on this station's
    # channel is listening for exactly this — no separate pairing needed.
    await manager.broadcast(
        station.id,
        {
            "type": CheckoutMessageType.CONTRACT_STARTED.value,
            "payload": {"contract_id": str(contract.id)},
        },
    )

    return CheckoutStartResponse(
        contract_id=contract.id,
        driver_id=driver.id,
        origin=origin,
        skip_document_scan=skip_document_scan,
        skip_driver_data=skip_driver_data,
    )


@router.get("/{contract_id}/status", response_model=CheckoutStatusResponse)
def get_checkout_status(contract_id: uuid.UUID, db: Session = Depends(get_db)) -> CheckoutStatusResponse:
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    driver = db.get(Driver, contract.driver_id)
    vehicle = db.get(Vehicle, contract.vehicle_id) if contract.vehicle_id else None

    return CheckoutStatusResponse(
        contract_id=contract.id,
        status=contract.status,
        origin=contract.origin,
        current_step=_infer_current_step(contract, driver),
        station_id=contract.station_id,
        branch_id=contract.branch_id,
        reservation_id=contract.reservation_id,
        opened_at=contract.opened_at,
        driver=CheckoutDriverSummary(
            id=driver.id,
            first_name=driver.first_name,
            last_name=driver.last_name,
            email=driver.email,
            phone=driver.phone,
            national_id_or_passport=driver.national_id_or_passport,
            license_number=driver.license_number,
            documents_verified=driver.documents_verified,
            license_expiration=driver.license_expiration,
            ready_for_checkout=driver.is_ready_for_checkout(),
            tier=driver.tier,
        ),
        vehicle=VehicleRead.model_validate(vehicle) if vehicle else None,
        current_category=(
            ACRISSCategoryRead.model_validate(category)
            if (category := _current_category(db, contract)) is not None
            else None
        ),
        extras=[ContractExtraRead.model_validate(e) for e in contract.extras],
        deposit=DepositRead.model_validate(contract.deposit) if contract.deposit else None,
        signatures=[DigitalSignatureRead.model_validate(s) for s in contract.signatures],
        skip_driver_data=contract.reservation is not None and _reservation_precheckin_confirmed(contract.reservation),
        rental_details_confirmed=contract.rental_details_confirmed,
    )


def _reservation_precheckin_confirmed(reservation: Reservation) -> bool:
    """True when this reservation's Pre Check-in was reviewed and
    confirmed by the executive, and they haven't toggled "unskip" back on
    (see app/checkout/precheckin.py) — read live off the relationship
    rather than a stored flag, same "infer from what's persisted" spirit
    as _infer_current_step below."""
    pc = reservation.precheckin
    return pc is not None and pc.status is PrecheckinStatus.CONFIRMED and not pc.unskip


def _infer_current_step(contract: RentalContract, driver: Driver) -> CheckoutStep:
    """Best-effort step derived from persisted state only (see module
    docstring) — coarser than the live WebSocket step_updated stream.

    Reordered wizard (Tablet Rental Details design): Rental details ->
    Vehicle -> Extras -> Documents -> Data -> Deposit -> Signature. Vehicle
    selection no longer implies documents are verified (that gate moved to
    deposit-authorize/sign — see flow.py), so DOCUMENT_VERIFICATION is
    checked *after* vehicle_id here, not before — it only means "vehicle
    picked, but still can't reach deposit" now, never "hasn't started."
    """
    if contract.status is ContractStatus.OPEN:
        return CheckoutStep.COMPLETED
    if any(sig.type is SignatureType.CONTRACT for sig in contract.signatures):
        return CheckoutStep.AWAITING_HANDOVER
    if contract.deposit is not None and contract.deposit.status is DepositStatus.AUTHORIZED:
        return CheckoutStep.AWAITING_SIGNATURE
    if contract.vehicle_id is not None:
        if not driver.is_ready_for_checkout():
            return CheckoutStep.DOCUMENT_VERIFICATION
        return CheckoutStep.EXTRAS_AND_DEPOSIT
    if not contract.rental_details_confirmed:
        return CheckoutStep.RENTAL_DETAILS
    return CheckoutStep.VEHICLE_SELECTION
