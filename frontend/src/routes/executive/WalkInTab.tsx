import { useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { getDriverByEmail, startWalkInCheckout, type DriverRead } from '../../lib/api';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function licenseStatus(driver: DriverRead): { text: string; ok: boolean } {
  if (!driver.license_expiration) return { text: 'No license on file', ok: false };
  const expired = new Date(driver.license_expiration) < new Date();
  return {
    text: expired ? `Expired ${driver.license_expiration}` : `Valid · exp. ${driver.license_expiration}`,
    ok: !expired,
  };
}

export function WalkInTab({ onSessionStart }: { onSessionStart: (contractId: string) => void }) {
  const pairing = useStationPairing();
  const [mode, setMode] = useState<'email' | 'guest'>('email');
  const [email, setEmail] = useState('');
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookup, setLookup] = useState<DriverRead | 'new' | null>(null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doLookup = async () => {
    const clean = email.trim();
    if (!EMAIL_RE.test(clean)) {
      setEmailHint('Enter a valid email address to check the client record.');
      setLookup(null);
      return;
    }
    setEmailHint(null);
    setLookingUp(true);
    try {
      const driver = await getDriverByEmail(clean);
      setLookup(driver ?? 'new');
      if (driver) {
        setFirst(driver.first_name);
        setLast(driver.last_name);
      }
    } finally {
      setLookingUp(false);
    }
  };

  const client = lookup && lookup !== 'new' ? lookup : null;
  const isNewClient = lookup === 'new';
  const showNames = mode === 'guest' || lookup !== null;
  const ready = first.trim() !== '' && last.trim() !== '';

  const start = async () => {
    if (!ready || !pairing.stationId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await startWalkInCheckout(
        pairing.stationId,
        first.trim(),
        last.trim(),
        mode === 'email' ? email.trim() : undefined,
      );
      onSessionStart(res.contract_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
      <div className="walkin-card">
        <div>
          <h2>New walk-in</h2>
          <p>
            Identification is optional. Start the contract now and identify the driver at any point — their
            documents can be confirmed once they're on file.
          </p>
        </div>

        <div className="walkin-mode">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Driver</div>
            <div style={{ flex: 1 }} />
            <div className="walkin-mode__toggle">
              <button
                type="button"
                className={mode === 'email' ? 'active' : ''}
                onClick={() => {
                  setMode('email');
                  setLookup(null);
                }}
              >
                Identify by email
              </button>
              <button
                type="button"
                className={mode === 'guest' ? 'active' : ''}
                onClick={() => {
                  setMode('guest');
                  setLookup(null);
                  setEmailHint(null);
                }}
              >
                Guest
              </button>
            </div>
          </div>

          {mode === 'email' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="walkin-lookup-row">
                <input
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setLookup(null);
                    setEmailHint(null);
                  }}
                  placeholder="name@example.com"
                />
                <button type="button" className="btn btn--dark" disabled={lookingUp} onClick={doLookup}>
                  {lookingUp ? 'Checking…' : 'Check client'}
                </button>
              </div>
              <div className="field__hint">Check the email first — an existing client's documents may already be on file.</div>
              {emailHint && <div className="field__error">{emailHint}</div>}
            </div>
          )}
        </div>

        {mode === 'guest' && (
          <div className="walkin-note">Guest contract — the driver can be identified later once documents are confirmed.</div>
        )}

        {isNewClient && (
          <div className="walkin-note">No client record for this email. A new profile will be created.</div>
        )}

        {client && (
          <div className="walkin-client-card">
            <div className="walkin-client-card__name">
              {client.first_name} {client.last_name}
            </div>
            <div className="walkin-client-card__meta">{client.email}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="field__hint">Last visit</div>
                <div>{client.last_visit_date ?? '—'}</div>
              </div>
              <div>
                <div className="field__hint">License</div>
                <div style={{ color: licenseStatus(client).ok ? 'var(--fp-success)' : 'var(--fp-danger)' }}>
                  {licenseStatus(client).text}
                </div>
              </div>
            </div>
          </div>
        )}

        {showNames && (
          <div className="walkin-names">
            <div className="field">
              <label>First name</label>
              <input value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div className="field">
              <label>Last name</label>
              <input value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
        )}

        {error && <div className="field__error">{error}</div>}

        <button type="button" className="btn" disabled={!ready || starting} onClick={start}>
          {starting ? 'Creating…' : 'Create Contract and Start'}
        </button>
      </div>
    </div>
  );
}
