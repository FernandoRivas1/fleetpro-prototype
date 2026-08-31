import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { createStation, getStation, listBranches, type BranchRead, type StationCreateResponse } from '../../lib/api';
import './StationSetup.css';

const POLL_INTERVAL_MS = 1500;

/** Design file: Station Setup.dc.html (2a). Form -> pairing -> (handled by
 * the parent once paired_at flips, see ExecutiveApp). Doesn't open this
 * device's own socket until the tablet has actually paired — see the
 * stage-1 plan for why polling GET /stations/{id} beats a WS-message
 * signal here. */
export function StationSetup() {
  const pairing = useStationPairing();
  const [branches, setBranches] = useState<BranchRead[] | null>(null);
  const [branchId, setBranchId] = useState('');
  const [label, setLabel] = useState('Counter 1');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<StationCreateResponse | null>(null);
  const [tabletPaired, setTabletPaired] = useState(false);

  useEffect(() => {
    listBranches()
      .then((res) => {
        setBranches(res);
        if (res.length > 0) setBranchId(res[0].id);
      })
      .catch((err) => setError(`Could not load branches: ${err.message}`));
  }, []);

  useEffect(() => {
    if (!pending || tabletPaired) return;
    const interval = setInterval(async () => {
      try {
        const station = await getStation(pending.station_id);
        if (station.paired_at) {
          setTabletPaired(true);
          pairing.setCredentials(pending.station_id, pending.pairing_token);
        }
      } catch (err) {
        console.error('Polling station status failed', err);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pending, tabletPaired, pairing]);

  const ready = branchId !== '' && label.trim() !== '';

  const create = async () => {
    if (!ready) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createStation(branchId, label.trim());
      setPending(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  if (pending && !tabletPaired) {
    const branchName = branches?.find((b) => b.id === branchId)?.name ?? '';
    return (
      <div className="station-setup__pairing">
        <div className="station-setup__pairing-head">
          <div className="station-setup__kicker">
            {label} · {branchName}
          </div>
          <h1>Pair the counter tablet</h1>
          <p>Scan this code on the counter tablet, or enter the PIN manually, to pair it to this station.</p>
        </div>

        <div className="station-setup__panels">
          <div className="station-setup__panel">
            <div className="station-setup__panel-label">Pairing PIN</div>
            <div className="station-setup__pin-cells">
              {pending.pin.split('').map((digit, i) => (
                <div className="station-setup__pin-cell" key={i}>
                  {digit}
                </div>
              ))}
            </div>
            <div className="field__hint">Expires in {Math.floor(pending.pin_expires_in_seconds / 60)}:00</div>
          </div>

          <div className="station-setup__panel">
            <div className="station-setup__panel-label">Scan to pair</div>
            <div className="station-setup__qr-box">
              <QRCodeSVG value={pending.qr_url} size={160} />
            </div>
            <div className="field__hint">{pending.qr_url}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
          <div className="station-setup__status">
            <div className="station-setup__status-dot" />
            <div className="station-setup__status-text">Waiting for tablet…</div>
          </div>
          <button
            type="button"
            className="station-setup__cancel"
            onClick={() => {
              setPending(null);
              setTabletPaired(false);
            }}
          >
            Cancel setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="station-setup">
      <header className="station-setup__header">
        <div className="station-setup__brand">
          <div className="station-setup__mark">F</div>
          <div className="station-setup__title">Fleetpro</div>
        </div>
        <div className="exec-chip">
          <div className="exec-chip__dot" style={{ background: 'var(--fp-border-input)' }} />
          NO STATION
        </div>
      </header>

      <div className="station-setup__form-wrap">
        <div className="station-setup__card">
          <div>
            <div className="station-setup__kicker">First-time setup</div>
            <h1>Station Setup</h1>
            <p>Register this computer as a counter station. The tablet paired to it stays paired for the whole shift.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="field">
              <label htmlFor="branch">Branch</label>
              <select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches === null && <option>Loading…</option>}
                {branches?.length === 0 && <option>No branches seeded</option>}
                {branches?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="label">Station label</label>
              <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Counter 3" />
              <div className="field__hint">Shown on the tablet and on every contract opened here.</div>
            </div>
          </div>

          {error && <div className="field__error">{error}</div>}
          <button type="button" className="btn" disabled={!ready || creating} onClick={create}>
            {creating ? 'Creating…' : 'Create Station'}
          </button>
        </div>
      </div>
    </div>
  );
}
