import { useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { selectVehicle, type CheckoutStatusResponse } from '../../lib/api';
import { upsellStrings, type Lang } from './strings';
import type { UpsellOffer, WizardStep } from './ClientShell';

function clp(n: number): string {
  return `$${n.toLocaleString('de-DE')}`;
}

export function UpsellStep({
  status,
  contractId,
  lang,
  refreshStatus,
  goTo,
  offer,
}: {
  status: CheckoutStatusResponse;
  contractId: string;
  lang: Lang;
  refreshStatus: () => Promise<void>;
  goTo: (step: WizardStep) => void;
  offer: UpsellOffer;
}) {
  const pairing = useStationPairing();
  const t = upsellStrings[lang];
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keep = () => {
    pairing.send('upsell_responded', { contract_id: contractId, decision: 'keep' });
    goTo('extras');
  };

  const upgrade = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await selectVehicle(contractId, offer.vehicle.id);
      pairing.send('upsell_responded', { contract_id: contractId, decision: 'upgrade', vehicle_id: offer.vehicle.id });
      await refreshStatus();
      goTo('extras');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const current = status.vehicle;

  return (
    <main className="client-main">
      <div className="upsell-columns">
        <div className="upsell-col">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="upsell-col__title">{t.yourVehicle}</div>
            {status.current_category && <span className="res-table__acriss">{status.current_category.code}</span>}
          </div>
          <div className="upsell-col__photo" style={current?.main_photo_url ? { backgroundImage: `url(${current.main_photo_url})` } : undefined} />
          {current && (
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>
                {current.make} {current.model}
              </div>
            </div>
          )}
        </div>

        <div className="upsell-halo">
          <div className="upsell-halo__circle">
            <div style={{ fontSize: 13, opacity: 0.85 }}>{t.forJust}</div>
            <div style={{ fontFamily: 'var(--fp-font-mono)', fontSize: 27, fontWeight: 600 }}>
              +{clp(offer.daily_price_difference)}
            </div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>{t.morePerDay}</div>
          </div>
        </div>

        <div className="upsell-col upsell-col--offer">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="upsell-col__title" style={{ color: 'var(--fp-accent)' }}>
              {t.upgradeTitle}
            </div>
            <span className="res-table__acriss">{offer.category.code}</span>
          </div>
          <div className="upsell-col__photo" style={offer.vehicle.main_photo_url ? { backgroundImage: `url(${offer.vehicle.main_photo_url})` } : undefined} />
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {offer.vehicle.make} {offer.vehicle.model}
          </div>
        </div>
      </div>

      {error && <div className="data-field__note">{error}</div>}

      <footer className="client-footer">
        <button type="button" className="client-btn--ghost" onClick={keep} style={{ flex: 'none' }}>
          {t.keep}
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="client-btn" disabled={submitting} onClick={upgrade}>
          {submitting ? '…' : t.upgrade}
        </button>
      </footer>
    </main>
  );
}
