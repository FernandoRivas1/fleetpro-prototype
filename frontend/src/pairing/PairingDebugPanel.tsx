import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStationPairing } from './StationPairingContext';
import type { CheckoutMessage } from './types';
import './PairingDebugPanel.css';

const STATUS_LABEL: Record<string, string> = {
  checking: 'Checking for a stored pairing…',
  not_paired: 'Not paired',
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
};

const STATUS_TONE: Record<string, string> = {
  checking: 'muted',
  not_paired: 'danger',
  connecting: 'muted',
  open: 'success',
  reconnecting: 'warning',
};

/** Stage-1 placeholder UI: proves pairing, reconnect, and cross-device
 * message relay work end to end. Not the final design — see stages 2/3 for
 * the real Executive/Client screens. `notPairedContent` renders whatever
 * this device role needs to get paired (Station Setup vs. PIN entry). */
export function PairingDebugPanel({
  title,
  notPairedContent,
}: {
  title: string;
  notPairedContent: ReactNode;
}) {
  const pairing = useStationPairing();
  const [log, setLog] = useState<Array<{ at: string; message: CheckoutMessage }>>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return pairing.subscribe((message) => {
      setLog((prev) => [...prev.slice(-49), { at: new Date().toLocaleTimeString(), message }]);
    });
  }, [pairing]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log]);

  const isPaired = pairing.status !== 'checking' && pairing.status !== 'not_paired';

  return (
    <div className="debug-panel">
      <header className="debug-panel__header">
        <h1>{title}</h1>
        <span className={`debug-panel__status debug-panel__status--${STATUS_TONE[pairing.status]}`}>
          {STATUS_LABEL[pairing.status]}
        </span>
      </header>

      {pairing.stationId && (
        <div className="debug-panel__row">
          <span className="debug-panel__label">Station</span>
          <code>{pairing.stationId}</code>
        </div>
      )}

      {!isPaired && <div className="debug-panel__section">{notPairedContent}</div>}

      {isPaired && (
        <div className="debug-panel__section">
          <div className="debug-panel__actions">
            <button
              type="button"
              onClick={() => pairing.send('step_updated', { note: 'test message', from: title })}
            >
              Send test message
            </button>
            <button type="button" className="debug-panel__button--ghost" onClick={() => void pairing.unlink()}>
              Unlink
            </button>
          </div>

          <div className="debug-panel__log">
            <div className="debug-panel__label">Message log ({log.length})</div>
            {log.length === 0 && <p className="debug-panel__muted">No messages yet.</p>}
            {log.map((entry, i) => (
              <div key={i} className="debug-panel__log-row">
                <span className="mono debug-panel__muted">{entry.at}</span>
                <span className="mono">{entry.message.type}</span>
                <span className="mono debug-panel__muted">{JSON.stringify(entry.message.payload)}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
