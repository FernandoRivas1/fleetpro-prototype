import { useEffect, useRef, useState } from 'react';
import { ApiError, listExtras, signContract, type CheckoutStatusResponse, type ExtraRead } from '../../lib/api';
import { SignaturePad, type SignaturePadHandle } from '../../components/SignaturePad';
import { signatureStrings, type Lang } from './strings';
import type { WizardStep } from './ClientShell';

function clp(n: number): string {
  return `$${n.toLocaleString('de-DE')}`;
}

export function SignatureStep({
  status,
  contractId,
  lang,
  goTo,
}: {
  status: CheckoutStatusResponse;
  contractId: string;
  lang: Lang;
  refreshStatus: () => Promise<void>;
  goTo: (step: WizardStep) => void;
}) {
  const t = signatureStrings[lang];
  const padRef = useRef<SignaturePadHandle>(null);
  const [hasInk, setHasInk] = useState(false);
  const [extrasCatalog, setExtrasCatalog] = useState<ExtraRead[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    listExtras().then(setExtrasCatalog).catch(console.error);
  }, []);

  const submit = async () => {
    if (!padRef.current || padRef.current.isEmpty()) return;
    setSubmitting(true);
    setErrors([]);
    try {
      const dataUrl = padRef.current.toDataURL();
      const base64 = dataUrl.split(',')[1] ?? dataUrl;
      await signContract(contractId, base64);
      goTo('result');
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const detail = err.detail as { errors?: string[] } | undefined;
        setErrors(detail?.errors ?? [err.message]);
      } else {
        setErrors([err instanceof Error ? err.message : String(err)]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const extraName = (id: string) => extrasCatalog.find((e) => e.id === id)?.name ?? id;

  return (
    <main className="client-main">
      <div className="summary-bar">
        <div className="summary-bar__item">
          <div className="summary-bar__label">{t.kVehicle}</div>
          <div style={{ fontWeight: 600 }}>
            {status.vehicle ? `${status.vehicle.make} ${status.vehicle.model}` : '—'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--fp-text-muted)' }}>
            {status.vehicle?.plate} {status.current_category ? `· ${status.current_category.code}` : ''}
          </div>
        </div>
        <div className="summary-bar__item">
          <div className="summary-bar__label">{t.kExtras}</div>
          <div style={{ fontWeight: 600 }}>
            {status.extras.length === 0 ? '—' : status.extras.map((e) => `${extraName(e.extra_id)} ×${e.quantity}`).join(', ')}
          </div>
        </div>
        <div className="summary-bar__item">
          <div className="summary-bar__label">{t.kDeposit}</div>
          <div style={{ fontWeight: 600, color: 'var(--fp-success)' }}>
            {status.deposit ? clp(status.deposit.amount) : '—'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22 }}>{t.signTitle}</h1>
      </div>

      <div className="sign-pad-flex">
        <SignaturePad ref={padRef} hintText={t.padHint} onInkChange={setHasInk} />
      </div>

      {errors.length > 0 && (
        <div className="data-field__note">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <footer className="client-footer">
        <button type="button" className="client-btn--ghost" onClick={() => padRef.current?.clear()}>
          {t.clear}
        </button>
        <div className={`client-status ${hasInk ? 'client-status--ok' : ''}`}>{hasInk ? t.statusInk : t.statusIdle}</div>
        <button type="button" className="client-btn" disabled={!hasInk || submitting} onClick={submit}>
          {submitting ? '…' : t.confirm}
        </button>
      </footer>
    </main>
  );
}
