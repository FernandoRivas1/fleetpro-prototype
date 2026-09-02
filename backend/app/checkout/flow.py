"""The middle of the checkout flow: vehicle selection through signature.

Each state-changing endpoint here broadcasts the matching WebSocket
message (app/checkout/ws.py) to the contract's station channel, mirroring
how POST /api/v1/checkout/start already broadcasts contract_started — so
both devices stay live-synced the same way for every step, not just the
first one. The two read-only GETs (upsell-suggestion, deposit) don't
broadcast anything; presenting an upsell or a deposit prompt to the
customer is a decision the executive makes on the tablet itself, over the
WebSocket channel directly (upsell_offered / upsell_responded), not a
side effect of fetching data.
"""
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.checkout.models import (
    DEPOSIT_AMOUNT_CLP,
    ContractExtra,
    Deposit,
    DigitalSignature,
    Driver,
    RentalContract,
    Reservation,
)
from app.checkout import tiers
from app.checkout.schemas import ContractExtraRead, DepositRead
from app.checkout.ws import CheckoutMessageType, manager
from app.database import get_db
from app.fleet.models import ACRISSCategory, Vehicle
from app.fleet.schemas import ACRISSCategoryRead, VehicleRead
from app.shared.enums import (
    ContractOrigin,
    ContractStatus,
    DepositMechanism,
    DepositStatus,
    SignatureType,
    VehicleStatus,
)
from app.shared.models import Branch, Extra
from app.shared.schemas import BranchRead

router = APIRouter(prefix="/api/v1/checkout", tags=["checkout"])


# --- rental-details ------------------------------------------------------
# Step 1 of the wizard (Tablet Rental Details design) — reviews and, until
# a vehicle is picked, lets the client edit the branch/dates/category this
# checkout is based on. Backed by the Reservation row for a
# from_reservation contract, or by RentalContract's own rental_details_*
# columns for a walk-in, which has no Reservation row — see models.py.


class RentalDetailsResponse(BaseModel):
    contract_id: uuid.UUID
    origin: ContractOrigin
    confirmed: bool
    # False once a vehicle has been selected — the category and branch a
    # candidate list was drawn from can't change out from under it.
    editable: bool
    reservation_code: str | None = None
    pickup_branch: BranchRead
    return_branch: BranchRead
    pickup_date: datetime
    return_date: datetime
    # Null only for a walk-in that hasn't picked a category yet.
    category: ACRISSCategoryRead | None = None


class RentalDetailsUpdateRequest(BaseModel):
    pickup_branch_id: uuid.UUID
    return_branch_id: uuid.UUID
    pickup_date: datetime
    return_date: datetime
    acriss_category_id: uuid.UUID

    @model_validator(mode="after")
    def _return_after_pickup(self) -> "RentalDetailsUpdateRequest":
        if self.return_date <= self.pickup_date:
            raise ValueError("Return must be after pickup.")
        return self


def _rental_details_response(db: Session, contract: RentalContract) -> RentalDetailsResponse:
    reservation = db.get(Reservation, contract.reservation_id) if contract.reservation_id else None
    if reservation is not None:
        pickup_branch_id = reservation.pickup_branch_id
        return_branch_id = reservation.return_branch_id or reservation.pickup_branch_id
        pickup_date = reservation.pickup_date
        return_date = reservation.return_date
        category_id: uuid.UUID | None = reservation.acriss_category_id
        reservation_code = reservation.code
    else:
        pickup_branch_id = contract.branch_id
        return_branch_id = contract.return_branch_id or contract.branch_id
        # Set at POST /start for every walk-in (checkout.py) — never null
        # in practice, but the column stays nullable since it means
        # nothing for a from_reservation contract.
        assert contract.pickup_date is not None and contract.return_date is not None
        pickup_date = contract.pickup_date
        return_date = contract.return_date
        category_id = contract.acriss_category_id
        reservation_code = None

    pickup_branch = db.get(Branch, pickup_branch_id)
    return_branch = db.get(Branch, return_branch_id)
    category = db.get(ACRISSCategory, category_id) if category_id is not None else None

    return RentalDetailsResponse(
        contract_id=contract.id,
        origin=contract.origin,
        confirmed=contract.rental_details_confirmed,
        editable=contract.vehicle_id is None,
        reservation_code=reservation_code,
        pickup_branch=BranchRead.model_validate(pickup_branch),
        return_branch=BranchRead.model_validate(return_branch),
        pickup_date=pickup_date,
        return_date=return_date,
        category=ACRISSCategoryRead.model_validate(category) if category is not None else None,
    )


@router.get("/{contract_id}/rental-details", response_model=RentalDetailsResponse)
def get_rental_details(contract_id: uuid.UUID, db: Session = Depends(get_db)) -> RentalDetailsResponse:
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    return _rental_details_response(db, contract)


@router.post("/{contract_id}/rental-details", response_model=RentalDetailsResponse)
async def confirm_rental_details(
    contract_id: uuid.UUID, payload: RentalDetailsUpdateRequest, db: Session = Depends(get_db)
) -> RentalDetailsResponse:
    """The client's "Confirm details" step — save-and-confirm in one call,
    same shape as confirm-documents/confirm-driver-data below."""
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    if contract.vehicle_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rental details are locked once a vehicle has been selected.",
        )

    for branch_id in (payload.pickup_branch_id, payload.return_branch_id):
        if db.get(Branch, branch_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    if db.get(ACRISSCategory, payload.acriss_category_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if contract.reservation_id is not None:
        reservation = db.get(Reservation, contract.reservation_id)
        if reservation is None:  # pragma: no cover - FK guarantees this row exists
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")
        reservation.pickup_branch_id = payload.pickup_branch_id
        reservation.return_branch_id = payload.return_branch_id
        reservation.pickup_date = payload.pickup_date
        reservation.return_date = payload.return_date
        reservation.acriss_category_id = payload.acriss_category_id
    else:
        contract.return_branch_id = payload.return_branch_id
        contract.acriss_category_id = payload.acriss_category_id
        contract.pickup_date = payload.pickup_date
        contract.return_date = payload.return_date

    # The pickup branch always drives which fleet this contract draws
    # from (see select_vehicle's vehicle.branch_id == contract.branch_id
    # check below) — keep it in sync however it got here.
    contract.branch_id = payload.pickup_branch_id
    contract.rental_details_confirmed = True

    db.commit()
    db.refresh(contract)

    await manager.broadcast(
        contract.station_id,
        {
            "type": CheckoutMessageType.RENTAL_DETAILS_CONFIRMED.value,
            "payload": {"contract_id": str(contract_id)},
        },
    )

    return _rental_details_response(db, contract)


# --- confirm-documents -------------------------------------------------


class ConfirmDocumentsRequest(BaseModel):
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    national_id_or_passport: str = Field(min_length=1)
    license_number: str = Field(min_length=1)
    license_expiration: date


class ConfirmDocumentsResponse(BaseModel):
    contract_id: uuid.UUID
    driver_id: uuid.UUID
    documents_verified: bool
    license_expiration: date


@router.post("/{contract_id}/confirm-documents", response_model=ConfirmDocumentsResponse)
async def confirm_documents(
    contract_id: uuid.UUID, payload: ConfirmDocumentsRequest, db: Session = Depends(get_db)
) -> ConfirmDocumentsResponse:
    """The executive's "I confirm I physically verified the documents" step
    (Executive Session Panel design) — persists whatever they corrected off
    the OCR proposal (app/checkout/documents.py never writes these fields
    itself, see its module docstring) and flips the documents_verified gate
    from the "Critical business rules" in CLAUDE.md."""
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    driver = db.get(Driver, contract.driver_id)
    if driver is None:  # pragma: no cover - a contract always has a driver
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")

    today = datetime.now(timezone.utc).date()
    if payload.license_expiration < today:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"errors": ["Driver's license has expired — cannot confirm documents."]},
        )

    driver.first_name = payload.first_name
    driver.last_name = payload.last_name
    driver.national_id_or_passport = payload.national_id_or_passport
    driver.license_number = payload.license_number
    driver.license_expiration = payload.license_expiration
    driver.documents_verified = True

    db.commit()

    await manager.broadcast(
        contract.station_id,
        {
            "type": CheckoutMessageType.DOCUMENTS_CONFIRMED_BY_EXECUTIVE.value,
            "payload": {"contract_id": str(contract_id), "driver_id": str(driver.id)},
        },
    )

    return ConfirmDocumentsResponse(
        contract_id=contract_id,
        driver_id=driver.id,
        documents_verified=driver.documents_verified,
        license_expiration=driver.license_expiration,
    )


# --- confirm-driver-data ----------------------------------------------


class ConfirmDriverDataRequest(BaseModel):
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    email: str = Field(min_length=1)
    phone: str = Field(min_length=1)


class ConfirmDriverDataResponse(BaseModel):
    contract_id: uuid.UUID
    driver_id: uuid.UUID
    email: str


@router.post("/{contract_id}/confirm-driver-data", response_model=ConfirmDriverDataResponse)
async def confirm_driver_data(
    contract_id: uuid.UUID, payload: ConfirmDriverDataRequest, db: Session = Depends(get_db)
) -> ConfirmDriverDataResponse:
    """The client's "Confirm your data" step (Tablet Driver Data design) —
    contact fields only. Identity/license fields and documents_verified
    are confirm-documents' job (above), which the client waits on before
    ever reaching this step. Typing a real email here is also how a guest
    walk-in (checkout.py's synthesized placeholder, see its docstring)
    becomes a properly identified driver."""
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    driver = db.get(Driver, contract.driver_id)
    if driver is None:  # pragma: no cover - a contract always has a driver
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")

    driver.first_name = payload.first_name
    driver.last_name = payload.last_name
    driver.email = payload.email
    driver.phone = payload.phone

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Another driver is already on file with that email"
        ) from exc

    await manager.broadcast(
        contract.station_id,
        {
            "type": CheckoutMessageType.DRIVER_DATA_CONFIRMED.value,
            "payload": {"contract_id": str(contract_id), "driver_id": str(driver.id)},
        },
    )

    return ConfirmDriverDataResponse(contract_id=contract_id, driver_id=driver.id, email=driver.email)


# --- select-vehicle ------------------------------------------------------


class SelectVehicleRequest(BaseModel):
    vehicle_id: uuid.UUID


class SelectVehicleResponse(BaseModel):
    contract_id: uuid.UUID
    vehicle_id: uuid.UUID
    status: ContractStatus


@router.post("/{contract_id}/select-vehicle", response_model=SelectVehicleResponse)
async def select_vehicle(
    contract_id: uuid.UUID, payload: SelectVehicleRequest, db: Session = Depends(get_db)
) -> SelectVehicleResponse:
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    if contract.status is ContractStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Contract is already signed; the vehicle can't be changed"
        )
    if not contract.rental_details_confirmed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Confirm rental details (branch, dates, category) before selecting a vehicle.",
        )

    vehicle = db.get(Vehicle, payload.vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    if vehicle.branch_id != contract.branch_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Vehicle belongs to a different branch")
    if vehicle.status is not VehicleStatus.AVAILABLE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Vehicle is not available")

    # If a different vehicle was previously selected for this contract
    # (e.g. an upsell offer was accepted, or the executive changed their
    # mind before signing), release it back to the pool.
    if contract.vehicle_id is not None and contract.vehicle_id != vehicle.id:
        previous = db.get(Vehicle, contract.vehicle_id)
        if previous is not None:
            previous.status = VehicleStatus.AVAILABLE

    contract.vehicle_id = vehicle.id
    contract.status = ContractStatus.PRE_OPENED
    # Taken out of the pool immediately, not just at handover — otherwise
    # a second contract at another counter could select the same vehicle
    # before this one is signed.
    vehicle.status = VehicleStatus.RENTED

    # Gold-tier perk (app/checkout/tiers.py): the deposit is waived, so
    # there's no in-person or online step to wait for — authorize it,
    # for $0, the moment a vehicle exists to rent. Only when nothing's
    # been recorded yet, so an already-paid online-in-advance deposit
    # (checkout.py's start_checkout) is never silently replaced.
    driver = db.get(Driver, contract.driver_id)
    existing_deposit = db.query(Deposit).filter(Deposit.contract_id == contract.id).one_or_none()
    if driver is not None and existing_deposit is None:
        amount, forced_mechanism = tiers.deposit_terms(driver)
        if forced_mechanism is DepositMechanism.WAIVED:
            db.add(
                Deposit(
                    id=uuid.uuid4(),
                    contract_id=contract.id,
                    amount=amount,
                    mechanism=forced_mechanism,
                    status=DepositStatus.AUTHORIZED,
                    authorized_at=datetime.now(timezone.utc),
                )
            )

    db.commit()

    await manager.broadcast(
        contract.station_id,
        {
            "type": CheckoutMessageType.VEHICLE_SELECTED.value,
            "payload": {"contract_id": str(contract_id), "vehicle_id": str(vehicle.id)},
        },
    )

    return SelectVehicleResponse(contract_id=contract.id, vehicle_id=vehicle.id, status=contract.status)


# --- upsell-suggestion (read-only) ----------------------------------------


class UpsellSuggestionResponse(BaseModel):
    has_suggestion: bool
    reason: str | None = None
    current_category: ACRISSCategoryRead | None = None
    suggested_category: ACRISSCategoryRead | None = None
    vehicle: VehicleRead | None = None
    daily_price_difference: float | None = None


@router.get("/{contract_id}/upsell-suggestion", response_model=UpsellSuggestionResponse)
def get_upsell_suggestion(contract_id: uuid.UUID, db: Session = Depends(get_db)) -> UpsellSuggestionResponse:
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    current_category = _current_category(db, contract)
    if current_category is None:
        return UpsellSuggestionResponse(
            has_suggestion=False,
            reason="No vehicle or reservation category to base an upsell on yet.",
        )

    # hierarchy_order is unique (see fleet/models.py), so this is either
    # exactly one category or none — never an equal-or-lower category,
    # satisfying the "upsell can never be same-or-lower" rule structurally.
    next_category = (
        db.query(ACRISSCategory)
        .filter(ACRISSCategory.hierarchy_order == current_category.hierarchy_order + 1)
        .one_or_none()
    )
    if next_category is None:
        return UpsellSuggestionResponse(
            has_suggestion=False,
            reason=f"{current_category.name} is already the highest category — no upsell available.",
            current_category=ACRISSCategoryRead.model_validate(current_category),
        )

    # Lowest mileage in the next category, at the contract's branch, as the
    # one vehicle to offer.
    vehicle = (
        db.query(Vehicle)
        .filter(
            Vehicle.acriss_category_id == next_category.id,
            Vehicle.branch_id == contract.branch_id,
            Vehicle.status == VehicleStatus.AVAILABLE,
        )
        .order_by(Vehicle.current_km.asc())
        .first()
    )
    if vehicle is None:
        return UpsellSuggestionResponse(
            has_suggestion=False,
            reason=f"No available {next_category.code} vehicle at this branch right now.",
            current_category=ACRISSCategoryRead.model_validate(current_category),
            suggested_category=ACRISSCategoryRead.model_validate(next_category),
        )

    return UpsellSuggestionResponse(
        has_suggestion=True,
        current_category=ACRISSCategoryRead.model_validate(current_category),
        suggested_category=ACRISSCategoryRead.model_validate(next_category),
        vehicle=VehicleRead.model_validate(vehicle),
        daily_price_difference=float(next_category.base_daily_rate) - float(current_category.base_daily_rate),
    )


def _current_category(db: Session, contract: RentalContract) -> ACRISSCategory | None:
    """The category to browse/upsell *from*: the already-selected
    vehicle's category if there is one, else the originating
    reservation's, else — a walk-in's own — whatever was set on the
    Rental Details step (contract.acriss_category_id; see
    rental_details.py above)."""
    if contract.vehicle_id is not None:
        vehicle = db.get(Vehicle, contract.vehicle_id)
        if vehicle is not None:
            return db.get(ACRISSCategory, vehicle.acriss_category_id)
    if contract.reservation_id is not None:
        reservation = db.get(Reservation, contract.reservation_id)
        if reservation is not None:
            return db.get(ACRISSCategory, reservation.acriss_category_id)
    if contract.acriss_category_id is not None:
        return db.get(ACRISSCategory, contract.acriss_category_id)
    return None


# --- extras ----------------------------------------------------------------


class ExtraLineItem(BaseModel):
    extra_id: uuid.UUID
    quantity: int = Field(gt=0)


class SetExtrasRequest(BaseModel):
    extras: list[ExtraLineItem]


class SetExtrasResponse(BaseModel):
    contract_id: uuid.UUID
    extras: list[ContractExtraRead]
    total_amount: float


@router.post("/{contract_id}/extras", response_model=SetExtrasResponse)
async def set_extras(
    contract_id: uuid.UUID, payload: SetExtrasRequest, db: Session = Depends(get_db)
) -> SetExtrasResponse:
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    driver = db.get(Driver, contract.driver_id)
    free_extras = tiers.free_extra_names(driver) if driver is not None else frozenset()

    # Look up every Extra up front so a bad id fails the whole request
    # before anything is written.
    catalog: dict[uuid.UUID, Extra] = {}
    for item in payload.extras:
        if item.extra_id not in catalog:
            extra = db.get(Extra, item.extra_id)
            if extra is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail=f"Extra {item.extra_id} not found"
                )
            catalog[item.extra_id] = extra

    # Replace, not append — this is "confirm the current extras selection",
    # so calling it again (the executive edits the list before signing)
    # shouldn't pile up duplicate rows.
    db.query(ContractExtra).filter(ContractExtra.contract_id == contract_id).delete()

    created: list[ContractExtra] = []
    for item in payload.extras:
        extra = catalog[item.extra_id]
        # Tier perk (app/checkout/tiers.py): e.g. a Gold driver's
        # additional-driver and child-seat extras are free.
        price = 0 if extra.name in free_extras else extra.default_price
        row = ContractExtra(
            id=uuid.uuid4(),
            contract_id=contract_id,
            extra_id=item.extra_id,
            quantity=item.quantity,
            applied_price=price,
        )
        db.add(row)
        created.append(row)

    db.commit()
    for row in created:
        db.refresh(row)

    total_amount = sum(float(row.applied_price) * row.quantity for row in created)

    await manager.broadcast(
        contract.station_id,
        {
            "type": CheckoutMessageType.EXTRAS_CONFIRMED.value,
            "payload": {
                "contract_id": str(contract_id),
                "extras": [
                    {"extra_id": str(row.extra_id), "quantity": row.quantity} for row in created
                ],
            },
        },
    )

    return SetExtrasResponse(
        contract_id=contract_id,
        extras=[ContractExtraRead.model_validate(row) for row in created],
        total_amount=total_amount,
    )


# --- deposit ---------------------------------------------------------------


class DepositStatusResponse(BaseModel):
    authorized: bool
    requires_in_person_authorization: bool
    deposit: DepositRead | None = None
    message: str | None = None


@router.get("/{contract_id}/deposit", response_model=DepositStatusResponse)
def get_deposit(contract_id: uuid.UUID, db: Session = Depends(get_db)) -> DepositStatusResponse:
    if db.get(RentalContract, contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    deposit = db.query(Deposit).filter(Deposit.contract_id == contract_id).one_or_none()

    if deposit is not None and deposit.status is DepositStatus.AUTHORIZED:
        return DepositStatusResponse(
            authorized=True,
            requires_in_person_authorization=False,
            deposit=DepositRead.model_validate(deposit),
        )

    return DepositStatusResponse(
        authorized=False,
        requires_in_person_authorization=True,
        deposit=DepositRead.model_validate(deposit) if deposit else None,
        message="In-person deposit authorization is required before the contract can be signed.",
    )


@router.post("/{contract_id}/deposit/authorize", response_model=DepositRead)
async def authorize_deposit(contract_id: uuid.UUID, db: Session = Depends(get_db)) -> DepositRead:
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    # The "Critical business rules" gate from CLAUDE.md — verified
    # documents, unexpired license — now that Vehicle comes before
    # Documents in the wizard (Tablet Rental Details design), it can no
    # longer live at vehicle-selection time; it blocks here and at
    # sign_contract below instead, both real backend checks either way.
    driver = db.get(Driver, contract.driver_id)
    if driver is None or not driver.is_ready_for_checkout():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Driver's documents must be verified, with an unexpired license, before the deposit can be authorized.",
        )

    deposit = db.query(Deposit).filter(Deposit.contract_id == contract_id).one_or_none()

    # Already waived (Gold — see select_vehicle) or already paid online in
    # advance: this in-person step has nothing left to do. Idempotent
    # no-op rather than silently replacing it with a full in-person one.
    if deposit is not None and deposit.mechanism in (DepositMechanism.WAIVED, DepositMechanism.ONLINE_IN_ADVANCE):
        return DepositRead.model_validate(deposit)

    # Tier perk (app/checkout/tiers.py): e.g. a Silver driver's in-person
    # deposit is half the standard amount. forced_mechanism is ignored
    # here — Gold never reaches this branch, see the guard above.
    amount = tiers.deposit_terms(driver)[0] if driver is not None else DEPOSIT_AMOUNT_CLP
    now = datetime.now(timezone.utc)

    # STUB: replace with a real payment gateway integration.
    if deposit is None:
        deposit = Deposit(
            id=uuid.uuid4(),
            contract_id=contract_id,
            amount=amount,
            mechanism=DepositMechanism.IN_PERSON,
            status=DepositStatus.AUTHORIZED,
            authorized_at=now,
        )
        db.add(deposit)
    else:
        deposit.mechanism = DepositMechanism.IN_PERSON
        deposit.amount = amount
        deposit.status = DepositStatus.AUTHORIZED
        deposit.authorized_at = now

    db.commit()
    db.refresh(deposit)

    await manager.broadcast(
        contract.station_id,
        {
            "type": CheckoutMessageType.DEPOSIT_AUTHORIZED.value,
            "payload": {"contract_id": str(contract_id), "amount": float(deposit.amount)},
        },
    )

    return DepositRead.model_validate(deposit)


# --- sign --------------------------------------------------------------


class SignContractRequest(BaseModel):
    signature_image_base64: str = Field(min_length=1)


class SignContractResponse(BaseModel):
    contract_id: uuid.UUID
    status: ContractStatus
    opened_at: datetime
    signature_id: uuid.UUID


@router.post("/{contract_id}/sign", response_model=SignContractResponse)
async def sign_contract(
    contract_id: uuid.UUID, payload: SignContractRequest, db: Session = Depends(get_db)
) -> SignContractResponse:
    contract = db.get(RentalContract, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    driver = db.get(Driver, contract.driver_id)
    deposit = db.query(Deposit).filter(Deposit.contract_id == contract_id).one_or_none()
    today = datetime.now(timezone.utc).date()

    errors: list[str] = []
    if contract.vehicle_id is None:
        errors.append("No vehicle has been selected for this contract.")
    if driver is None or not driver.documents_verified:
        errors.append("Driver's documents have not been verified.")
    if driver is not None:
        if driver.license_expiration is None:
            errors.append("Driver's license expiration date is unknown.")
        elif driver.license_expiration < today:
            errors.append("Driver's license has expired.")
    if deposit is None or deposit.status is not DepositStatus.AUTHORIZED:
        errors.append("Deposit has not been authorized.")

    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})

    signature = DigitalSignature(
        id=uuid.uuid4(),
        contract_id=contract_id,
        type=SignatureType.CONTRACT,
        image_base64=payload.signature_image_base64,
    )
    db.add(signature)

    now = datetime.now(timezone.utc)
    contract.status = ContractStatus.OPEN
    contract.opened_at = now

    db.commit()
    db.refresh(contract)
    db.refresh(signature)

    await manager.broadcast(
        contract.station_id,
        {
            "type": CheckoutMessageType.CONTRACT_SIGNED.value,
            "payload": {"contract_id": str(contract_id)},
        },
    )

    return SignContractResponse(
        contract_id=contract.id,
        status=contract.status,
        opened_at=contract.opened_at,
        signature_id=signature.id,
    )
