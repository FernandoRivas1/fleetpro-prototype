import { useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { selectVehicle, type CheckoutStatusResponse, type VehicleRead } from '../../lib/api';
import { vehicleStrings, type Lang } from './strings';
import type { WizardStep } from './ClientShell';

export function VehicleStep({
  status,
  contractId,
  lang,
  refreshStatus,
  goTo,
  candidates,
  hasUpsellOffer,
}: {
  status: CheckoutStatusResponse;
  contractId: string;
  lang: Lang;
  refreshStatus: () => Promise<void>;
  goTo: (step: WizardStep) => void;
  candidates: VehicleRead[] | null;
  hasUpsellOffer: boolean;
}) {
  const pairing = useStationPairing();
  const t = vehicleStrings[lang];
  const [pick, setPick] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = candidates?.find((c) => c.id === pick) ?? null;

  const submit = async () => {
    if (!pick) return;
    setSubmitting(true);
    setError(null);
    try {
      await selectVehicle(contractId, pick);
      pairing.send('vehicle_selected', { contract_id: contractId, vehicle_id: pick });
      await refreshStatus();
      goTo(hasUpsellOffer ? 'upsell' : 'extras');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="client-main">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1>{t.title}</h1>
        {status.current_category && <span className="res-table__acriss">{status.current_category.code}</span>}
      </div>

      {candidates === null ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fp-text-muted)', fontSize: 20 }}>
          {t.waiting}
        </div>
      ) : (
        <div className="car-grid">
          {candidates.map((v) => {
            const isPicked = v.id === pick;
            return (
              <div
                key={v.id}
                className={`car-card ${isPicked ? 'car-card--chosen' : ''}`}
                onClick={() => setPick(v.id)}
              >
                {isPicked && <div className="car-card__check">✓</div>}
                <div className="car-card__photo" style={v.main_photo_url ? { backgroundImage: `url(${v.main_photo_url})` } : undefined} />
                <div className="car-card__body">
                  <div className="car-card__model">
                    {v.make} {v.model}
                  </div>
                  <div className="car-card__plate-row">
                    <span className="car-card__plate">{v.plate}</span>
                    <span style={{ color: 'var(--fp-secondary)' }}>{v.year}</span>
                  </div>
                  <button type="button" className="car-card__btn" onClick={() => setPick(v.id)}>
                    {isPicked ? t.chosen : t.choose}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <div className="data-field__note">{error}</div>}

      <div style={{ flex: 1 }} />

      <footer className="client-footer">
        <button type="button" className="client-btn--ghost" onClick={() => goTo('vehicle')}>
          {t.back}
        </button>
        <div className="client-status">{chosen ? t.youChose(`${chosen.make} ${chosen.model}`, chosen.plate) : t.tapToChoose}</div>
        <button type="button" className="client-btn" disabled={!pick || submitting} onClick={submit}>
          {t.continue}
        </button>
      </footer>
    </main>
  );
}
