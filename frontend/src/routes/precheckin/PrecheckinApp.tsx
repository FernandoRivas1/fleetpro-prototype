import { useState } from 'react';
import {
  lookupPrecheckin,
  scanPrecheckinDocument,
  submitPrecheckin,
  type PrecheckinLookupResponse,
} from '../../lib/api';
import './precheckin.css';

/** Public, unauthenticated driver self-service ahead of a counter session
 * (Executive Pre Check-in design) — reached via the link the executive
 * generates and sends however they like (see app/checkout/precheckin.py's
 * module docstring: no mail provider is wired up for this prototype).
 *
 * No design file covers this screen itself (the mockup only shows the
 * executive's compose modal); built to match the rest of the app's brand
 * tokens/voice, same as routes/reports's public pages. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${iso.slice(11, 16)}`;
}

type DocSlotState = 'empty' | 'scanning' | 'done' | 'error';

export function PrecheckinApp() {
  const initialCode = new URLSearchParams(window.location.search).get('code') ?? '';

  const [code, setCode] = useState(initialCode);
  const [lastName, setLastName] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [reservation, setReservation] = useState<PrecheckinLookupResponse | null>(null);

  const [nationalId, setNationalId] = useState('');
  const [phone, setPhone] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiration, setLicenseExpiration] = useState('');
  const [idSlot, setIdSlot] = useState<DocSlotState>('empty');
  const [licenseSlot, setLicenseSlot] = useState<DocSlotState>('empty');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const login = async () => {
    if (!code.trim() || !lastName.trim()) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await lookupPrecheckin(code.trim(), lastName.trim());
      setReservation(res);
      setNationalId(res.national_id_or_passport ?? '');
      setPhone(res.phone ?? '');
      setLicenseNumber(res.license_number ?? '');
      setLicenseExpiration(res.license_expiration ?? '');
      if (res.status === 'confirmed') setDone(true);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoggingIn(false);
    }
  };

  const scan = async (type: 'id' | 'license', file: File) => {
    if (!reservation) return;
    const setSlot = type === 'id' ? setIdSlot : setLicenseSlot;
    setSlot('scanning');
    try {
      const res = await scanPrecheckinDocument(reservation.reservation_id, code.trim(), lastName.trim(), type, file);
      setSlot(res.success ? 'done' : 'error');
      if (res.data) {
        if (type === 'id' && res.data.national_id_or_passport && !nationalId) {
          setNationalId(res.data.national_id_or_passport);
        }
        if (type === 'license') {
          if (res.data.license_number && !licenseNumber) setLicenseNumber(res.data.license_number);
          if (res.data.expiration_date && !licenseExpiration) setLicenseExpiration(res.data.expiration_date);
        }
      }
    } catch {
      setSlot('error');
    }
  };

  const ready = nationalId.trim() && phone.trim() && licenseNumber.trim() && licenseExpiration;

  const submit = async () => {
    if (!reservation || !ready) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitPrecheckin(reservation.reservation_id, {
        code: code.trim(),
        last_name: lastName.trim(),
        national_id_or_passport: nationalId.trim(),
        phone: phone.trim(),
        license_number: licenseNumber.trim(),
        license_expiration: licenseExpiration,
      });
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="report-page">
      <div className="report-container">
        <div className="report-header">
          <div className="report-header__mark">F</div>
          <div className="report-header__title">Fleetpro pre check-in</div>
        </div>

        {!reservation && (
          <div className="report-card">
            <h2>Find your reservation</h2>
            <div className="rp-field">
              <label htmlFor="pc-code">Reservation number</label>
              <input id="pc-code" type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="FP-XXXXX" />
            </div>
            <div className="rp-field">
              <label htmlFor="pc-lastname">Last name</label>
              <input
                id="pc-lastname"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="As it appears on your reservation"
              />
            </div>
            {loginError && <div className="rp-error">{loginError}</div>}
            <button type="button" className="rp-btn" disabled={loggingIn || !code.trim() || !lastName.trim()} onClick={login}>
              {loggingIn ? 'Checking…' : 'Continue'}
            </button>
          </div>
        )}

        {reservation && done && (
          <div className="report-card">
            <div className="rp-success">
              <div className="rp-success__check">✓</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>You&apos;re all set</div>
              <div style={{ color: 'var(--fp-secondary)' }}>
                {reservation.driver_first_name}, your data has been sent to the branch. At the counter you&apos;ll
                only need to confirm it and sign — see you {fmt(reservation.pickup_date)}.
              </div>
            </div>
          </div>
        )}

        {reservation && !done && (
          <>
            <div className="report-card">
              <h2>{reservation.driver_first_name} {reservation.driver_last_name}</h2>
              <div style={{ fontFamily: 'var(--fp-font-mono)', fontSize: 13, color: 'var(--fp-text-muted)' }}>
                {reservation.code} · Pick-up {fmt(reservation.pickup_date)} → Return {fmt(reservation.return_date)}
              </div>
            </div>

            <div className="report-card">
              <h2>Your documents</h2>
              <div style={{ fontSize: 13, color: 'var(--fp-secondary)' }}>
                Upload a photo of your ID (or passport) and your driver&apos;s licence — we&apos;ll try to read the
                details automatically, but you can always correct them below.
              </div>
              <div className="rp-row">
                <DocSlot label="ID or passport" state={idSlot} onFile={(f) => void scan('id', f)} />
                <DocSlot label="Driver's licence" state={licenseSlot} onFile={(f) => void scan('license', f)} />
              </div>
            </div>

            <div className="report-card">
              <h2>Your data</h2>
              <div className="rp-row">
                <div className="rp-field">
                  <label htmlFor="pc-nid">National ID / passport no.</label>
                  <input id="pc-nid" type="text" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
                </div>
                <div className="rp-field">
                  <label htmlFor="pc-phone">Phone</label>
                  <input id="pc-phone" type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              <div className="rp-row">
                <div className="rp-field">
                  <label htmlFor="pc-licno">Licence no.</label>
                  <input id="pc-licno" type="text" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
                </div>
                <div className="rp-field">
                  <label htmlFor="pc-licexp">Licence expiry</label>
                  <input
                    id="pc-licexp"
                    type="date"
                    value={licenseExpiration}
                    onChange={(e) => setLicenseExpiration(e.target.value)}
                  />
                </div>
              </div>

              {submitError && <div className="rp-error">{submitError}</div>}
              <button type="button" className="rp-btn" disabled={!ready || submitting} onClick={submit}>
                {submitting ? 'Sending…' : 'Send to the branch'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DocSlot({
  label,
  state,
  onFile,
}: {
  label: string;
  state: DocSlotState;
  onFile: (file: File) => void;
}) {
  const stateText = { empty: 'Tap to upload', scanning: 'Reading…', done: 'Uploaded ✓', error: 'Could not read — try again' }[
    state
  ];
  return (
    <label className={`pc-doc-slot pc-doc-slot--${state}`}>
      <div className="pc-doc-slot__label">{label}</div>
      <div className="pc-doc-slot__state">{stateText}</div>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}
