import { useEffect, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import {
  getCandidates,
  listAcrissCategories,
  type ACRISSCategoryRead,
  type CandidateVehicle,
  type CheckoutStatusResponse,
} from '../../lib/api';

const MAX_SHORTLIST = 3;

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--fp-status-available)';
  if (score >= 70) return 'var(--fp-status-inprep)';
  return 'var(--fp-secondary)';
}

export function VehiclesCard({
  status,
  onSent,
}: {
  status: CheckoutStatusResponse;
  onSent: () => void;
}) {
  const pairing = useStationPairing();
  // ready_for_checkout is the combined gate from CLAUDE.md's business rule
  // (documents verified AND license not expired) — documents_verified
  // alone isn't enough: a driver can be verified-on-file with a since-
  // expired license (see Driver.is_ready_for_checkout in the backend).
  const locked = !status.driver.ready_for_checkout;

  const [categories, setCategories] = useState<ACRISSCategoryRead[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(status.current_category?.id ?? null);
  const [candidates, setCandidates] = useState<CandidateVehicle[] | null>(null);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Walk-ins have no reservation category — offer a picker (see the
  // "Adaptations from the mock" note in the stage-2 plan).
  const needsCategoryPicker = !status.current_category;
  useEffect(() => {
    if (needsCategoryPicker) listAcrissCategories().then(setCategories).catch(console.error);
  }, [needsCategoryPicker]);

  useEffect(() => {
    if (locked || !categoryId) return;
    setCandidates(null);
    setPicks(new Set());
    setSent(false);
    getCandidates(categoryId, status.branch_id, status.driver.id)
      .then((res) => setCandidates(res.candidates))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [locked, categoryId, status.branch_id, status.driver.id]);

  const togglePick = (vehicleId: string) => {
    setSent(false);
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(vehicleId)) next.delete(vehicleId);
      else if (next.size < MAX_SHORTLIST) next.add(vehicleId);
      return next;
    });
  };

  const send = () => {
    if (!candidates || picks.size === 0) return;
    const vehicles = candidates.filter((c) => picks.has(c.vehicle.id)).map((c) => c.vehicle);
    pairing.send('candidates_sent', { contract_id: status.contract_id, vehicles });
    setSent(true);
    onSent();
  };

  return (
    <div className={`session-card ${locked ? 'session-card--locked' : ''}`}>
      <div className="session-card__head">
        <div className={`session-card__badge ${!locked ? (sent ? 'session-card__badge--done' : 'session-card__badge--active') : ''}`}>
          2
        </div>
        <div className="session-card__title">Candidate Vehicles</div>
        <div className={`session-card__state ${sent ? 'session-card__state--done' : ''}`}>
          {locked ? 'Locked' : sent ? 'Sent to tablet' : `Shortlist up to ${MAX_SHORTLIST}`}
        </div>
        <div className="session-card__spacer" />
        {!locked && candidates && (
          <>
            <div className="locked-hint">{picks.size} of {MAX_SHORTLIST} selected</div>
            <button type="button" className="btn btn--sm" disabled={picks.size === 0} onClick={send}>
              {sent ? 'Options on tablet ✓' : 'Send options to client'}
            </button>
          </>
        )}
      </div>

      {!locked && (
        <div className="session-card__body">
          {needsCategoryPicker && (
            <div className="category-picker">
              <div className="doc-slot__label">Category</div>
              <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)}>
                <option value="">Select a category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <div className="field__error">{error}</div>}
          {categoryId && candidates === null && !error && <div className="locked-hint">Loading candidates…</div>}
          {categoryId && candidates?.length === 0 && (
            <div className="locked-hint">No available vehicles in this category at this branch right now.</div>
          )}

          {candidates?.map((c) => {
            const picked = picks.has(c.vehicle.id);
            return (
              <div
                key={c.vehicle.id}
                className={`vehicle-row ${picked ? 'vehicle-row--picked' : ''}`}
                onClick={() => togglePick(c.vehicle.id)}
              >
                <div className={`vehicle-row__box ${picked ? 'vehicle-row__box--picked' : ''}`}>{picked ? '✓' : ''}</div>
                <div
                  className="vehicle-row__photo"
                  style={c.vehicle.main_photo_url ? { backgroundImage: `url(${c.vehicle.main_photo_url})` } : undefined}
                />
                <div>
                  <div className="vehicle-row__model">
                    {c.vehicle.make} {c.vehicle.model}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3 }}>
                    <span className="vehicle-row__plate">{c.vehicle.plate}</span>
                    <span className="vehicle-row__sub">{c.vehicle.year}</span>
                  </div>
                </div>
                <div>
                  <div>{c.vehicle.current_km.toLocaleString('de-DE')} km</div>
                  <div className="vehicle-row__sub">current mileage</div>
                </div>
                <div>
                  <div>{Math.max(c.vehicle.next_service_km - c.vehicle.current_km, 0).toLocaleString('de-DE')} km</div>
                  <div className="vehicle-row__sub">to next service</div>
                </div>
                <div className="score-bar">
                  <div className="score-bar__track">
                    <div className="score-bar__fill" style={{ width: `${c.score}%`, background: scoreColor(c.score) }} />
                  </div>
                  <div className="score-bar__value" style={{ color: scoreColor(c.score) }}>
                    {c.score}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
