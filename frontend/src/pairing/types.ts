// Mirrors app/checkout/ws.py's CheckoutMessageType. Keep in sync with the
// backend enum — the server rejects any type value not in this list.
export type CheckoutMessageType =
  | 'contract_started'
  | 'step_updated'
  | 'documents_scanned'
  | 'documents_confirmed_by_executive'
  | 'driver_data_confirmed'
  | 'candidates_sent'
  | 'vehicle_selected'
  | 'upsell_offered'
  | 'upsell_responded'
  | 'extras_confirmed'
  | 'deposit_authorized'
  | 'contract_signed'
  | 'session_reset';

export interface CheckoutMessage {
  type: CheckoutMessageType;
  payload: Record<string, unknown>;
}

export type DeviceRole = 'executive' | 'tablet';

export type PairingStatus = 'checking' | 'not_paired' | 'connecting' | 'open' | 'reconnecting';

export interface StationPairing {
  status: PairingStatus;
  stationId: string | null;
  /** Registers `stationId`/`token` as this device's credentials, persists
   * them to localStorage, and opens the WebSocket. Shared entry point for
   * station creation (executive), a successful PIN pair, and the
   * `?pair=stationId.token` QR bootstrap (both tablet). */
  setCredentials: (stationId: string, token: string) => void;
  /** Resolves a PIN to station credentials via POST /stations/pair, then
   * calls setCredentials. Rejects on an invalid/expired PIN. */
  pairWithPin: (pin: string) => Promise<void>;
  /** POST /stations/{id}/unlink, then clears local credentials. */
  unlink: () => Promise<void>;
  /** Sends {type, payload} over the open socket. No-ops (and warns) if not
   * currently connected. */
  send: (type: CheckoutMessageType, payload?: Record<string, unknown>) => void;
  /** Registers a listener for every incoming message. Returns an
   * unsubscribe function. Multiple screens can each subscribe
   * independently — no message is consumed by one and hidden from another. */
  subscribe: (handler: (message: CheckoutMessage) => void) => () => void;
}
