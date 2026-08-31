import { useEffect, useState } from 'react';
import { listExtras, setExtras, type CheckoutStatusResponse, type ExtraRead } from '../../lib/api';
import { extrasStrings, type Lang } from './strings';
import type { WizardStep } from './ClientShell';

const MAX_QTY = 3;

function clp(n: number): string {
  return `$${n.toLocaleString('de-DE')}`;
}

export function ExtrasStep({
  contractId,
  lang,
  refreshStatus,
  goTo,
}: {
  status: CheckoutStatusResponse;
  contractId: string;
  lang: Lang;
  refreshStatus: () => Promise<void>;
  goTo: (step: WizardStep) => void;
}) {
  const t = extrasStrings[lang];
  const [catalog, setCatalog] = useState<ExtraRead[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listExtras()
      .then(setCatalog)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const bump = (id: string, delta: number) => {
    setQty((prev) => {
      const next = Math.max(0, Math.min(MAX_QTY, (prev[id] ?? 0) + delta));
      return { ...prev, [id]: next };
    });
  };

  const perDay = catalog?.reduce((sum, x) => sum + (qty[x.id] ?? 0) * x.default_price, 0) ?? 0;
  const count = Object.values(qty).reduce((a, b) => a + b, 0);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const items = Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([extra_id, quantity]) => ({ extra_id, quantity }));
      await setExtras(contractId, items);
      await refreshStatus();
      goTo('deposit');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="client-main">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1>{t.extrasTitle}</h1>
        <div className="subtitle">{t.extrasNote}</div>
      </div>

      {error && <div className="data-field__note">{error}</div>}

      <div className="extras-grid">
        {catalog?.map((x) => {
          const q = qty[x.id] ?? 0;
          const active = q > 0;
          return (
            <div className={`extra-card ${active ? 'extra-card--active' : ''}`} key={x.id}>
              <div className="extra-card__name">{x.name}</div>
              <div className="extra-card__desc">{x.description}</div>
              <div className="extra-card__price">
                {clp(x.default_price)}
                {t.perDay}
              </div>
              <div className="extra-stepper">
                <button type="button" disabled={q === 0} onClick={() => bump(x.id, -1)}>
                  −
                </button>
                <div className="extra-stepper__qty">{q}</div>
                <button type="button" className={active ? 'active' : ''} disabled={q >= MAX_QTY} onClick={() => bump(x.id, 1)}>
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <footer className="client-footer">
        <button type="button" className="client-btn--ghost" onClick={() => goTo('extras')}>
          {t.back}
        </button>
        <div className="client-status">{count === 0 ? t.noExtras : `${clp(perDay)}${t.perDay}`}</div>
        <button type="button" className="client-btn" disabled={submitting} onClick={submit}>
          {t.continue}
        </button>
      </footer>
    </main>
  );
}
