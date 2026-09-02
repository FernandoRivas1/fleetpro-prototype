"""Real-time sync channel between the executive console and the paired
client tablet — see "Two devices synced live" in CLAUDE.md.

Every station gets one broadcast channel: WS /api/v1/checkout/ws/{station_id}
Any message a client sends is relayed verbatim to every *other* client on
the same station_id. Nothing here is persisted — this is transport, not a
source of truth — with the single exception of Station.active_contract_id,
kept up to date so a device that reconnects mid-flow knows which contract
is currently open.
"""
import enum
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.checkout.models import Station
from app.database import get_db

router = APIRouter()

# Custom close codes (4000-4999 is the private-use range per RFC 6455).
# The frontend keys off WS_CLOSE_INVALID_TOKEN to know "I've been
# unlinked" vs. any other disconnect reason.
WS_CLOSE_STATION_NOT_FOUND = 4404
WS_CLOSE_INVALID_TOKEN = 4401


class CheckoutMessageType(str, enum.Enum):
    CONTRACT_STARTED = "contract_started"
    STEP_UPDATED = "step_updated"
    RENTAL_DETAILS_CONFIRMED = "rental_details_confirmed"
    DOCUMENTS_SCANNED = "documents_scanned"
    DOCUMENTS_CONFIRMED_BY_EXECUTIVE = "documents_confirmed_by_executive"
    DRIVER_DATA_CONFIRMED = "driver_data_confirmed"
    CANDIDATES_SENT = "candidates_sent"
    VEHICLE_SELECTED = "vehicle_selected"
    UPSELL_OFFERED = "upsell_offered"
    UPSELL_RESPONDED = "upsell_responded"
    EXTRAS_CONFIRMED = "extras_confirmed"
    DEPOSIT_AUTHORIZED = "deposit_authorized"
    CONTRACT_SIGNED = "contract_signed"
    # The executive abandoned the in-progress session (Executive Session
    # Panel design's "Reset session") — purely a transport signal, same as
    # every other message here: nothing is undone server-side (a driver's
    # documents_verified, once set, stays set), this just tells the tablet
    # to stop wherever it is and return to idle.
    SESSION_RESET = "session_reset"


class CheckoutMessage(BaseModel):
    type: CheckoutMessageType
    payload: dict = {}


class ConnectionManager:
    """In-memory registry of live sockets, keyed by station_id.

    Single-process only, which is fine for this prototype's single FastAPI
    instance — a multi-instance deployment would need a shared pub/sub
    (e.g. Redis) instead of a plain dict.
    """

    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, list[WebSocket]] = {}

    def connect(self, station_id: uuid.UUID, websocket: WebSocket) -> None:
        self._connections.setdefault(station_id, []).append(websocket)

    def disconnect(self, station_id: uuid.UUID, websocket: WebSocket) -> None:
        conns = self._connections.get(station_id)
        if not conns:
            return
        if websocket in conns:
            conns.remove(websocket)
        if not conns:
            self._connections.pop(station_id, None)

    async def broadcast(
        self, station_id: uuid.UUID, message: dict, sender: WebSocket | None = None
    ) -> None:
        """Relay `message` to every connection on station_id except `sender`.

        `sender` is None for server-initiated broadcasts (e.g. contract
        creation via POST /api/v1/checkout/start) that didn't originate
        from a client message — those go to every connected device.
        """
        for ws in list(self._connections.get(station_id, [])):
            if ws is sender:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                # A dead socket here will hit WebSocketDisconnect on its own
                # receive loop and clean itself up via disconnect().
                pass

    async def disconnect_all(self, station_id: uuid.UUID, code: int, reason: str) -> None:
        """Forcibly close every connection on a station (used on unlink)."""
        for ws in self._connections.pop(station_id, []):
            try:
                await ws.close(code=code, reason=reason)
            except Exception:
                pass


manager = ConnectionManager()


@router.websocket("/api/v1/checkout/ws/{station_id}")
async def checkout_ws(
    websocket: WebSocket,
    station_id: uuid.UUID,
    token: str | None = None,
    db: Session = Depends(get_db),
) -> None:
    station = db.get(Station, station_id)

    # A WebSocket Close frame can only carry an application close code
    # (4000-4999) *after* the opening handshake completes, so we accept
    # first and close immediately when validation fails.
    await websocket.accept()

    if station is None:
        await websocket.close(code=WS_CLOSE_STATION_NOT_FOUND, reason="station not found")
        return
    if not token or not secrets.compare_digest(station.pairing_token or "", token):
        await websocket.close(code=WS_CLOSE_INVALID_TOKEN, reason="invalid or stale pairing token")
        return

    station.last_seen_at = datetime.now(timezone.utc)
    db.commit()

    manager.connect(station_id, websocket)
    try:
        while True:
            raw = await websocket.receive_json()
            try:
                message = CheckoutMessage.model_validate(raw)
            except ValidationError as exc:
                # Malformed frame — tell the sender, don't crash the channel
                # or bother the other side with it.
                await websocket.send_json({"type": "error", "payload": {"message": str(exc)}})
                continue

            if message.type is CheckoutMessageType.CONTRACT_STARTED:
                _update_active_contract(db, station, message.payload.get("contract_id"))
            elif message.type is CheckoutMessageType.SESSION_RESET:
                # Mirrors CONTRACT_STARTED above: keep active_contract_id
                # current so a reload doesn't resurrect the session either
                # device just walked away from.
                station.active_contract_id = None
                db.commit()

            await manager.broadcast(station_id, message.model_dump(mode="json"), sender=websocket)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(station_id, websocket)


def _update_active_contract(db: Session, station: Station, raw_contract_id: object) -> None:
    """Keep Station.active_contract_id current so a reconnecting device
    (page reload, tablet Wi-Fi blip, ...) knows which contract is open."""
    if raw_contract_id is None:
        return
    try:
        contract_id = uuid.UUID(str(raw_contract_id))
    except (ValueError, TypeError):
        return
    station.active_contract_id = contract_id
    db.commit()
