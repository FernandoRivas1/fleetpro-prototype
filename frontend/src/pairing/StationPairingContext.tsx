import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  pairStationWithCredentials,
  pairStationWithPin,
  unlinkStation,
  WS_BASE_URL,
} from '../lib/api';
import type { CheckoutMessage, CheckoutMessageType, DeviceRole, PairingStatus, StationPairing } from './types';

// Close codes the backend uses to signal "this credential is no longer
// valid" — see WS_CLOSE_INVALID_TOKEN / WS_CLOSE_STATION_NOT_FOUND in
// app/checkout/ws.py. Any other close is treated as a transient drop.
const WS_CLOSE_STATION_NOT_FOUND = 4404;
const WS_CLOSE_INVALID_TOKEN = 4401;

const MAX_BACKOFF_MS = 15_000;

interface Credentials {
  stationId: string;
  token: string;
}

const StationPairingCtx = createContext<StationPairing | null>(null);

function storageKey(deviceRole: DeviceRole): string {
  return `fleetpro:pairing:${deviceRole}`;
}

function readStoredCredentials(deviceRole: DeviceRole): Credentials | null {
  try {
    const raw = localStorage.getItem(storageKey(deviceRole));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.stationId === 'string' && typeof parsed?.token === 'string') {
      return parsed;
    }
  } catch {
    // ignore malformed storage — treated as "not paired"
  }
  return null;
}

/** Parses the `?pair=stationId.token` query param the QR code encodes (see
 * qr_url in POST /api/v1/stations' response). Station ids are UUIDs (no
 * dots), so splitting on the first dot cleanly separates the two parts. */
function parsePairParam(search: string): Credentials | null {
  const raw = new URLSearchParams(search).get('pair');
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  return { stationId: raw.slice(0, dot), token: raw.slice(dot + 1) };
}

export function StationPairingProvider({
  deviceRole,
  children,
}: {
  deviceRole: DeviceRole;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<PairingStatus>('checking');
  const [credentials, setCredentialsState] = useState<Credentials | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef(new Set<(message: CheckoutMessage) => void>());

  const persistAndSetCredentials = (stationId: string, token: string) => {
    localStorage.setItem(storageKey(deviceRole), JSON.stringify({ stationId, token }));
    // Functional update returning the *same* object when nothing actually
    // changed keeps referential equality, so React bails out of the state
    // update (no re-render, no effect re-run) — important because the
    // bootstrap effect below can call this twice under StrictMode with
    // identical values, and that must not tear down/reopen a healthy socket.
    setCredentialsState((prev) =>
      prev && prev.stationId === stationId && prev.token === token ? prev : { stationId, token },
    );
  };

  const clearCredentials = () => {
    localStorage.removeItem(storageKey(deviceRole));
    setCredentialsState(null);
    setStatus('not_paired');
  };

  // --- Bootstrap: localStorage -> (tablet only) ?pair= param -> not_paired.
  useEffect(() => {
    const stored = readStoredCredentials(deviceRole);
    if (stored) {
      persistAndSetCredentials(stored.stationId, stored.token);
      return;
    }

    if (deviceRole === 'tablet') {
      const fromQuery = parsePairParam(window.location.search);
      if (fromQuery) {
        pairStationWithCredentials(fromQuery.stationId, fromQuery.token)
          .then((res) => {
            persistAndSetCredentials(res.station_id, res.pairing_token);
            const url = new URL(window.location.href);
            url.searchParams.delete('pair');
            window.history.replaceState({}, '', url);
          })
          .catch((err) => {
            console.error('Failed to pair from QR/link credentials', err);
            setStatus('not_paired');
          });
        return;
      }
    }

    setStatus('not_paired');
    // Bootstrap should only ever run once per mounted provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceRole]);

  // --- Connection lifecycle: open/reconnect the socket whenever we have
  // credentials; tear it down cleanly on unmount or credential change.
  useEffect(() => {
    if (!credentials) return;

    // Scoped to this one effect invocation (i.e. this one credentials-driven
    // connection session), NOT component-lifetime refs. That matters: a ref
    // shared across effect re-invocations races with a torn-down socket's
    // *async* onclose event — e.g. under StrictMode's dev-only double-invoke,
    // the old socket's onclose can fire after a new invocation has already
    // reset a shared "was this intentional" flag, misreading a clean
    // teardown as a drop and spinning up a spurious extra reconnect.
    let closedByUs = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      setStatus(reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

      const url = `${WS_BASE_URL}/api/v1/checkout/ws/${credentials.stationId}?token=${encodeURIComponent(
        credentials.token,
      )}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
        setStatus('open');
      };

      ws.onmessage = (event) => {
        let message: CheckoutMessage;
        try {
          const parsed = JSON.parse(event.data);
          if (typeof parsed?.type !== 'string') return;
          message = { type: parsed.type, payload: parsed.payload ?? {} };
        } catch {
          return;
        }
        for (const handler of subscribersRef.current) handler(message);
      };

      ws.onclose = (event) => {
        if (wsRef.current === ws) wsRef.current = null;
        if (closedByUs) return;

        if (event.code === WS_CLOSE_INVALID_TOKEN || event.code === WS_CLOSE_STATION_NOT_FOUND) {
          clearCredentials();
          return;
        }

        const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_BACKOFF_MS);
        reconnectAttempt += 1;
        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [credentials]);

  const value: StationPairing = {
    status,
    stationId: credentials?.stationId ?? null,

    setCredentials: persistAndSetCredentials,

    pairWithPin: async (pin: string) => {
      const res = await pairStationWithPin(pin);
      persistAndSetCredentials(res.station_id, res.pairing_token);
    },

    unlink: async () => {
      const stationId = credentials?.stationId;
      if (stationId) {
        try {
          await unlinkStation(stationId);
        } catch (err) {
          // The station may already be gone/unreachable — clear locally
          // regardless, since the point of unlink is "log this device out."
          console.warn('unlink request failed, clearing local pairing anyway', err);
        }
      }
      clearCredentials();
    },

    send: (type: CheckoutMessageType, payload: Record<string, unknown> = {}) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(`Cannot send "${type}" — socket is not open`);
        return;
      }
      ws.send(JSON.stringify({ type, payload }));
    },

    subscribe: (handler) => {
      subscribersRef.current.add(handler);
      return () => subscribersRef.current.delete(handler);
    },
  };

  return <StationPairingCtx.Provider value={value}>{children}</StationPairingCtx.Provider>;
}

export function useStationPairing(): StationPairing {
  const ctx = useContext(StationPairingCtx);
  if (!ctx) {
    throw new Error('useStationPairing must be used within a StationPairingProvider');
  }
  return ctx;
}
