"""Station pairing: creating a counter, and pairing/unlinking its tablet.

Pairing happens once per counter (a Station), not once per customer — see
"Pairing model" in CLAUDE.md. `pairing_token` is the durable credential
both devices persist (in localStorage) for the life of the shift; the PIN
is only a convenience input method for typing instead of scanning the QR,
so it lives in memory with a short TTL and is never itself the credential
that authorizes the WebSocket channel (app/checkout/ws.py).
"""
import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.checkout.models import Station
from app.checkout.schemas import StationRead
from app.config import settings
from app.database import get_db
from app.shared.models import Branch

router = APIRouter(prefix="/api/v1/stations", tags=["stations"])


# --- In-memory PIN store --------------------------------------------------
#
# A pairing PIN is a convenience alias for {station_id, pairing_token} that
# a person can type by hand. It's deliberately NOT persisted: it's
# short-lived, single-use, and only this process needs to know it.


@dataclass
class _PinEntry:
    station_id: uuid.UUID
    expires_at: float  # time.monotonic() timestamp


class PinStore:
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl_seconds = ttl_seconds
        self._entries: dict[str, _PinEntry] = {}
        self._lock = threading.Lock()

    def issue(self, station_id: uuid.UUID) -> str:
        with self._lock:
            self._purge_expired_locked()
            for _ in range(20):
                pin = f"{secrets.randbelow(10_000):04d}"
                if pin not in self._entries:
                    break
            else:  # pragma: no cover - only reachable if the store is nearly full
                raise RuntimeError("could not allocate a free pairing PIN")
            self._entries[pin] = _PinEntry(
                station_id=station_id, expires_at=time.monotonic() + self._ttl_seconds
            )
            return pin

    def resolve(self, pin: str) -> uuid.UUID | None:
        """Look up and consume (single-use) a PIN. None if unknown/expired."""
        with self._lock:
            self._purge_expired_locked()
            entry = self._entries.pop(pin, None)
            return entry.station_id if entry else None

    def invalidate_station(self, station_id: uuid.UUID) -> None:
        """Drop every outstanding PIN for a station — called on unlink, so a
        PIN issued before the unlink can't be used to fetch the new token."""
        with self._lock:
            for pin in [p for p, e in self._entries.items() if e.station_id == station_id]:
                del self._entries[pin]

    def _purge_expired_locked(self) -> None:
        now = time.monotonic()
        for pin in [p for p, e in self._entries.items() if e.expires_at <= now]:
            del self._entries[pin]


pin_store = PinStore(ttl_seconds=settings.station_pin_ttl_seconds)


# --- Schemas ---------------------------------------------------------------


class StationCreateRequest(BaseModel):
    branch_id: uuid.UUID
    label: str = Field(min_length=1, max_length=60)


class StationCreateResponse(BaseModel):
    station_id: uuid.UUID
    pairing_token: str
    pin: str
    pin_expires_in_seconds: int
    qr_url: str


class StationPairRequest(BaseModel):
    pin: str | None = None
    station_id: uuid.UUID | None = None
    pairing_token: str | None = None

    @model_validator(mode="after")
    def _exactly_one_method(self) -> "StationPairRequest":
        by_pin = bool(self.pin)
        by_credentials = bool(self.station_id and self.pairing_token)
        if by_pin == by_credentials:  # neither given, or both given
            raise ValueError("Provide either `pin`, or both `station_id` and `pairing_token`.")
        return self


class StationPairResponse(BaseModel):
    station_id: uuid.UUID
    pairing_token: str


class StationUnlinkResponse(BaseModel):
    station_id: uuid.UUID
    pairing_token: str


# --- Routes ------------------------------------------------------------


@router.post("", response_model=StationCreateResponse, status_code=status.HTTP_201_CREATED)
def create_station(payload: StationCreateRequest, db: Session = Depends(get_db)) -> StationCreateResponse:
    if db.get(Branch, payload.branch_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")

    station = Station(
        id=uuid.uuid4(),
        branch_id=payload.branch_id,
        label=payload.label,
        pairing_token=secrets.token_urlsafe(32),
    )
    db.add(station)
    db.commit()
    db.refresh(station)

    pin = pin_store.issue(station.id)

    return StationCreateResponse(
        station_id=station.id,
        pairing_token=station.pairing_token,
        pin=pin,
        pin_expires_in_seconds=settings.station_pin_ttl_seconds,
        qr_url=f"{settings.app_url}/client?pair={station.id}.{station.pairing_token}",
    )


@router.get("/{station_id}", response_model=StationRead)
def get_station(station_id: uuid.UUID, db: Session = Depends(get_db)) -> Station:
    """Read-only status check — notably `paired_at`, which flips from null
    to set exactly once, when the tablet calls POST /pair. The executive's
    Station Setup screen polls this while waiting, instead of relying on a
    WebSocket message that could race a not-yet-subscribed listener."""
    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    return station


@router.post("/pair", response_model=StationPairResponse)
def pair_station(payload: StationPairRequest, db: Session = Depends(get_db)) -> StationPairResponse:
    if payload.pin:
        station_id = pin_store.resolve(payload.pin)
        if station_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired PIN")
        station = db.get(Station, station_id)
        if station is None:  # pragma: no cover - station deleted after PIN issued
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    else:
        station = db.get(Station, payload.station_id)
        if station is None or not secrets.compare_digest(
            station.pairing_token or "", payload.pairing_token or ""
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid station_id/pairing_token"
            )

    now = datetime.now(timezone.utc)
    station.paired_at = now
    station.last_seen_at = now
    db.commit()

    return StationPairResponse(station_id=station.id, pairing_token=station.pairing_token)


@router.post("/{station_id}/unlink", response_model=StationUnlinkResponse)
async def unlink_station(station_id: uuid.UUID, db: Session = Depends(get_db)) -> StationUnlinkResponse:
    # Imported lazily to avoid a module-level import cycle with ws.py (which
    # doesn't need anything from this module).
    from app.checkout.ws import WS_CLOSE_INVALID_TOKEN, manager

    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")

    station.pairing_token = secrets.token_urlsafe(32)
    station.paired_at = None
    db.commit()

    # A PIN issued before the unlink must not be usable to fetch the new
    # token (pair_station() resolves the *current* token off the DB row).
    pin_store.invalidate_station(station.id)

    # Cut off anyone already connected with the old token now, rather than
    # waiting for their next reconnect attempt.
    await manager.disconnect_all(station.id, code=WS_CLOSE_INVALID_TOKEN, reason="station unlinked")

    return StationUnlinkResponse(station_id=station.id, pairing_token=station.pairing_token)
