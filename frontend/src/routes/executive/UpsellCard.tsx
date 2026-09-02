import { useEffect, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { getUpsellSuggestion, type CheckoutStatusResponse, type UpsellSuggestionResponse } from '../../lib/api';

function clp(n: number): string {
  return `$${n.toLocaleString('de-DE')}`;
}

export function UpsellCard({
  status,
  locked,
  onOffered,
}: {
  status: CheckoutStatusResponse;
  locked: boolean;
  onOffered: () => void;
}) {
  const pairing = useStationPairing();
  const [suggestion, setSuggestion] = useState<UpsellSuggestionResponse | null>(null);
  const [offered, setOffered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (locked) return;
    getUpsellSuggestion(status.contract_id)
      .then(setSuggestion)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [locked, status.contract_id]);

  const offer = () => {
    if (!suggestion?.has_suggestion) return;
    pairing.send('upsell_offered', {
      contract_id: status.contract_id,
      category: suggestion.suggested_category,
      vehicle: suggestion.vehicle,
      daily_price_difference: suggestion.daily_price_difference,
    });
    setOffered(true);
    onOffered();
  };

  return (
    <div className={`session-card ${locked ? 'session-card--locked' : ''}`}>
      <div className="session-card__head">
        <div className={`session-card__badge ${!locked ? (offered ? 'session-card__badge--done' : 'session-card__badge--active') : ''}`}>
          2
        </div>
        <div className="session-card__title">Upselling</div>
        <div className={`session-card__state ${offered ? 'session-card__state--done' : ''}`}>
          {locked ? 'Locked' : offered ? 'Offer sent' : 'Optional'}
        </div>
      </div>

      {!locked && (
        <div className="session-card__body">
          {error && <div className="field__error">{error}</div>}
          {!suggestion && !error && <div className="locked-hint">Checking for an upsell…</div>}
          {suggestion && !suggestion.has_suggestion && <div className="locked-hint">{suggestion.reason}</div>}

          {suggestion?.has_suggestion && suggestion.vehicle && suggestion.suggested_category && (
            <div style={{ display: 'flex', gap: 20 }}>
              <div className="upsell-row" style={{ flex: 1 }}>
                <div
                  className="upsell-row__photo"
                  style={suggestion.vehicle.main_photo_url ? { backgroundImage: `url(${suggestion.vehicle.main_photo_url})` } : undefined}
                />
                <div>
                  <div className="vehicle-row__model">
                    {suggestion.vehicle.make} {suggestion.vehicle.model}
                  </div>
                  <div className="vehicle-row__sub">
                    {suggestion.suggested_category.code} · {suggestion.suggested_category.name}
                  </div>
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fp-accent)' }}>
                  +{clp(suggestion.daily_price_difference ?? 0)}/day
                </div>
              </div>

              <div className="upsell-calc">
                <div className="doc-slot__label">Price difference</div>
                <div className="upsell-calc__row">
                  <div>Current: {status.current_category?.code}</div>
                  <div className="mono">{clp(status.current_category?.base_daily_rate ?? 0)}/day</div>
                </div>
                <div className="upsell-calc__row">
                  <div>Offered: {suggestion.suggested_category.code}</div>
                  <div className="mono">{clp(suggestion.suggested_category.base_daily_rate)}/day</div>
                </div>
                <div style={{ height: 1, background: 'var(--fp-border-strong)' }} />
                <div className="upsell-calc__row" style={{ alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 600 }}>Extra / day</div>
                  <div className="upsell-calc__total">+{clp(suggestion.daily_price_difference ?? 0)}</div>
                </div>
                <button type="button" className="btn" disabled={offered} onClick={offer}>
                  {offered ? 'Offer on tablet ✓' : 'Offer to client'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
