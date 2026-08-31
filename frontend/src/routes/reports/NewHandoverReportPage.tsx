import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { completeHandoverReport, getNewHandoverReport, type NewHandoverReportView } from '../../lib/api';
import { SignaturePad, type SignaturePadHandle } from '../../components/SignaturePad';
import './reports.css';

const FUEL_LEVELS = ['Full', '3/4', '1/2', '1/4', 'Empty'];
const PANELS = ['front_bumper', 'rear_bumper', 'hood', 'roof', 'left_door', 'right_door', 'trunk', 'windshield'];

interface DamageEntry {
  type: 'scratch' | 'dent';
  panel: string;
  severity: 'minor' | 'major';
}

/** Public, unauthenticated — reached by the parking-lot assistant's own
 * link/QR (see app/reports/handover.py's docstring). No design file exists
 * for this screen. Reuses SignaturePad, per the handoff. */
export function NewHandoverReportPage() {
  const { contractId } = useParams();
  const [view, setView] = useState<NewHandoverReportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [damage, setDamage] = useState<DamageEntry[]>([]);
  const [notes, setNotes] = useState('');
  const [deliveryKm, setDeliveryKm] = useState('');
  const [fuelLevel, setFuelLevel] = useState('Full');
  const [hasInk, setHasInk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ pdf_url: string } | null>(null);

  const padRef = useRef<SignaturePadHandle>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!contractId) return;
    getNewHandoverReport(contractId)
      .then(setView)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [contractId]);

  // Object URLs are only created when the photo list actually changes, and
  // revoked on the way out — creating one per render (e.g. from typing in
  // the notes textarea) would otherwise leak a blob URL every keystroke.
  useEffect(() => {
    const urls = photos.map((p) => URL.createObjectURL(p));
    setPhotoPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  const addDamage = () => setDamage((prev) => [...prev, { type: 'scratch', panel: PANELS[0], severity: 'minor' }]);
  const removeDamage = (i: number) => setDamage((prev) => prev.filter((_, idx) => idx !== i));
  const updateDamage = (i: number, patch: Partial<DamageEntry>) =>
    setDamage((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const ready = photos.length > 0 && deliveryKm.trim() !== '' && !Number.isNaN(Number(deliveryKm)) && hasInk;

  const submit = async () => {
    if (!contractId || !ready || !padRef.current) return;
    setSubmitting(true);
    setError(null);
    try {
      const dataUrl = padRef.current.toDataURL();
      const base64 = dataUrl.split(',')[1] ?? dataUrl;
      const damageDiagram = {
        scratches: damage.filter((d) => d.type === 'scratch').map(({ panel, severity }) => ({ panel, severity })),
        dents: damage.filter((d) => d.type === 'dent').map(({ panel, severity }) => ({ panel, severity })),
        notes: notes.trim() || undefined,
      };
      const res = await completeHandoverReport(contractId, {
        deliveryKm: Number(deliveryKm),
        deliveryFuelLevel: fuelLevel,
        signatureImageBase64: base64,
        damageDiagram,
        photos,
      });
      setResult({ pdf_url: res.pdf_url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="report-page">
        <div className="report-container">
          <div className="report-card">
            <div className="rp-error">{loadError}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="report-page">
        <div className="report-container">Loading…</div>
      </div>
    );
  }

  const alreadyCompleted = view.handover_report.status === 'completed';

  return (
    <div className="report-page">
      <div className="report-container">
        <div className="report-header">
          <div className="report-header__mark">F</div>
          <div className="report-header__title">Vehicle handover report</div>
        </div>

        <div className="report-card">
          <div className="report-vehicle">
            <div
              className="report-vehicle__photo"
              style={view.vehicle?.main_photo_url ? { backgroundImage: `url(${view.vehicle.main_photo_url})` } : undefined}
            />
            <div>
              <div className="report-vehicle__name">
                {view.vehicle ? `${view.vehicle.make} ${view.vehicle.model}` : '—'}
              </div>
              <div className="report-vehicle__plate">
                {view.vehicle?.plate} · {view.driver_name}
              </div>
            </div>
          </div>
        </div>

        {(alreadyCompleted || result) && (
          <div className="report-card">
            <div className="rp-success">
              <div className="rp-success__check">✓</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Handover report completed</div>
              {(result?.pdf_url ?? view.handover_report.pdf_url) && (
                <a
                  className="rp-btn"
                  href={result?.pdf_url ?? view.handover_report.pdf_url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  View PDF
                </a>
              )}
            </div>
          </div>
        )}

        {!alreadyCompleted && !result && (
          <>
            <div className="report-card">
              <h2>Photos</h2>
              <div className="report-photo-grid">
                {photos.map((_, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <div className="report-photo" style={{ backgroundImage: `url(${photoPreviews[i]})` }} />
                    <button
                      type="button"
                      className="rp-remove"
                      style={{ position: 'absolute', top: 4, right: 4 }}
                      onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {/* No capture="environment" here: it forces straight to the
                  camera for a single shot, which doesn't combine sensibly
                  with multi-select — this way mobile browsers show their
                  normal chooser (gallery multi-select, with a camera
                  shortcut still available in it). */}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  setPhotos((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
              <div style={{ fontSize: 12, color: 'var(--fp-text-muted)' }}>At least one photo is required.</div>
            </div>

            <div className="report-card">
              <h2>Damage diagram</h2>
              {damage.map((d, i) => (
                <div className="rp-damage-entry" key={i}>
                  <select value={d.type} onChange={(e) => updateDamage(i, { type: e.target.value as 'scratch' | 'dent' })}>
                    <option value="scratch">Scratch</option>
                    <option value="dent">Dent</option>
                  </select>
                  <select value={d.panel} onChange={(e) => updateDamage(i, { panel: e.target.value })}>
                    {PANELS.map((p) => (
                      <option key={p} value={p}>
                        {p.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <select value={d.severity} onChange={(e) => updateDamage(i, { severity: e.target.value as 'minor' | 'major' })}>
                    <option value="minor">Minor</option>
                    <option value="major">Major</option>
                  </select>
                  <button type="button" className="rp-remove" onClick={() => removeDamage(i)}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="rp-btn rp-btn--ghost" onClick={addDamage}>
                + Add damage
              </button>
              <div className="rp-field">
                <label htmlFor="notes">Notes</label>
                <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any other observations…" />
              </div>
            </div>

            <div className="report-card">
              <h2>Delivery details</h2>
              <div className="rp-row">
                <div className="rp-field">
                  <label htmlFor="km">Delivery mileage (km)</label>
                  <input id="km" type="number" min="0" value={deliveryKm} onChange={(e) => setDeliveryKm(e.target.value)} />
                </div>
                <div className="rp-field">
                  <label htmlFor="fuel">Fuel level</label>
                  <select id="fuel" value={fuelLevel} onChange={(e) => setFuelLevel(e.target.value)}>
                    {FUEL_LEVELS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="report-card">
              <h2>Customer signature</h2>
              <SignaturePad ref={padRef} onInkChange={setHasInk} />
            </div>

            {error && <div className="rp-error">{error}</div>}

            <button type="button" className="rp-btn" disabled={!ready || submitting} onClick={submit}>
              {submitting ? 'Completing…' : 'Complete handover report'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
