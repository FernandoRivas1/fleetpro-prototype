import { useEffect, useState } from 'react';
import { authorizeDeposit, getDeposit, type CheckoutStatusResponse, type DepositStatusResponse } from '../../lib/api';
import { depositStrings, type Lang } from './strings';
import type { WizardStep } from './ClientShell';

export function DepositStep({
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
  const t = depositStrings[lang];
  const [deposit, setDeposit] = useState<DepositStatusResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDeposit(contractId)
      .then(setDeposit)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [contractId]);

  const authorize = async () => {
    setWorking(true);
    setError(null);
    try {
      // A brief pause matches the design's "follow the steps on the
      // terminal" beat — the backend's authorization itself is instant
      // (a simulated in-person mechanism, see flow.py's docstring).
      await new Promise((r) => setTimeout(r, 1200));
      await authorizeDeposit(contractId);
      const fresh = await getDeposit(contractId);
      setDeposit(fresh);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  };

  const authorized = deposit?.authorized ?? false;
  const prepaid = deposit?.deposit?.mechanism === 'online_in_advance';
  const waived = deposit?.deposit?.mechanism === 'waived';

  return (
    <main className="client-main">
      <div className="deposit-center">
        <div>
          <div className="doc-slot__label">{t.depKicker}</div>
          <h1 style={{ marginTop: 8 }}>{t.depTitleMain}</h1>
          <p className="subtitle" style={{ maxWidth: 640 }}>
            {t.depLede}
          </p>
        </div>

        {!authorized && (
          <div className="deposit-steps">
            <div className="deposit-step-card">
              <div className="deposit-step-card__num">1</div>
              <div style={{ fontWeight: 600 }}>{lang === 'es' ? 'Inserte su tarjeta' : 'Insert your card'}</div>
            </div>
            <div className="deposit-step-card">
              <div className="deposit-step-card__num">2</div>
              <div style={{ fontWeight: 600 }}>{lang === 'es' ? 'Confirme en el POS' : 'Confirm on the terminal'}</div>
            </div>
            <div className="deposit-step-card">
              <div className="deposit-step-card__num">3</div>
              <div style={{ fontWeight: 600 }}>{lang === 'es' ? 'Se libera al devolver' : 'Released on return'}</div>
            </div>
          </div>
        )}

        {authorized ? (
          <div className="deposit-authorized">
            <div className="deposit-authorized__icon">✓</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--fp-success)' }}>
                {waived ? t.depDoneWaived : prepaid ? t.depDonePrepaid : t.depDone}
              </div>
              <div style={{ fontSize: 16, color: '#3d8a68' }}>
                {waived ? t.depSubWaived : prepaid ? t.depSubPrepaid : t.depSubDone}
              </div>
            </div>
          </div>
        ) : working ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            <div className="scan-slot__spinner" style={{ width: 60, height: 60, borderWidth: 5 }} />
            <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--fp-accent)' }}>{t.authorizing}</div>
            <div className="subtitle">{t.keepCard}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            <button type="button" className="client-btn" style={{ height: 88, fontSize: 24, padding: '0 60px' }} onClick={authorize}>
              {t.sendToReader}
            </button>
            <div className="subtitle">{t.readerHint}</div>
          </div>
        )}
      </div>

      {error && <div className="data-field__note">{error}</div>}

      <footer className="client-footer">
        <button type="button" className="client-btn--ghost" onClick={() => goTo('deposit')}>
          {t.back}
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="client-btn" disabled={!authorized} onClick={() => goTo('signature')}>
          {t.continue}
        </button>
      </footer>
    </main>
  );
}
