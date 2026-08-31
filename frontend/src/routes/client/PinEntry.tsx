import { useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import './PinEntry.css';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'];

/** Design file: Tablet Shell States.dc.html (4a). The QR path is handled
 * automatically by the pairing hook's bootstrap — this is the manual
 * fallback for typing the code read off the counter screen. */
export function PinEntry() {
  const pairing = useStationPairing();
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<'idle' | 'error' | 'paired'>('idle');

  const set = (v: string) => {
    setPin(v.replace(/\D/g, '').slice(0, 4));
    setStatus('idle');
  };

  const submit = async () => {
    if (pin.length !== 4) return;
    try {
      await pairing.pairWithPin(pin);
      setStatus('paired');
    } catch {
      setStatus('error');
      setTimeout(() => {
        setPin('');
        setStatus('idle');
      }, 1800);
    }
  };

  const ready = pin.length === 4 && status !== 'paired';

  return (
    <div className="pin-page">
      <div className="pin-page__brand">
        <div className="pin-page__mark">F</div>
        <div className="pin-page__brand-text">Fleetpro</div>
      </div>
      <div className="pin-page__badge">TABLET NOT PAIRED</div>

      <div className="pin-page__card">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h1>Pair this tablet</h1>
          <p>Enter the code shown on the counter computer</p>
        </div>

        <div className="pin-cells">
          {[0, 1, 2, 3].map((i) => {
            const active = i === pin.length && status !== 'paired';
            return (
              <div
                key={i}
                className={`pin-cell ${active ? 'pin-cell--active' : ''} ${status === 'error' ? 'pin-cell--error' : ''}`}
              >
                {pin[i] ?? ''}
              </div>
            );
          })}
        </div>

        <div className={`pin-message ${status === 'error' ? 'pin-message--error' : status === 'paired' ? 'pin-message--ok' : ''}`}>
          {status === 'error' && 'Incorrect code. Ask the executive to read it again.'}
          {status === 'paired' && 'Paired ✓'}
        </div>

        <button type="button" className="pin-submit" disabled={!ready} onClick={submit}>
          Pair tablet
        </button>
      </div>

      <div className="pin-keypad">
        {KEYS.map((k) => (
          <button key={k} type="button" className="pin-key" onClick={() => (k === '⌫' ? set(pin.slice(0, -1)) : set(pin + k))}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
