import { useState } from 'react';
import { confirmDriverData, type CheckoutStatusResponse } from '../../lib/api';
import { dataStrings, type Lang } from './strings';
import type { WizardStep } from './ClientShell';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GUEST_EMAIL_SUFFIX = '@walkin.fleetpro.local';

export function DataStep({
  status,
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
  const t = dataStrings[lang];
  const { driver } = status;
  const isGuestPlaceholder = driver.email.endsWith(GUEST_EMAIL_SUFFIX);

  const [firstName, setFirstName] = useState(driver.first_name);
  const [lastName, setLastName] = useState(driver.last_name);
  const [email, setEmail] = useState(isGuestPlaceholder ? '' : driver.email);
  const [phone, setPhone] = useState(driver.phone ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailBad = !EMAIL_RE.test(email.trim());
  const phoneBad = phone.replace(/\D/g, '').length < 9;
  const ready = firstName.trim() && lastName.trim() && !emailBad && !phoneBad;

  const submit = async () => {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      await confirmDriverData(contractId, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      await refreshStatus();
      goTo('vehicle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="client-main">
      <div>
        <h1>{t.title}</h1>
        <p className="subtitle">{driver.ready_for_checkout ? t.subtitleOnFile : t.subtitle}</p>
      </div>

      <div className="data-readonly">
        <div className="data-readonly__item">
          <div className="data-readonly__label">{t.fNid}</div>
          <div className="data-readonly__value">{driver.national_id_or_passport ?? '—'}</div>
        </div>
        <div className="data-readonly__item">
          <div className="data-readonly__label">{t.fExpiry}</div>
          <div className="data-readonly__value">{driver.license_expiration ?? '—'}</div>
        </div>
      </div>

      <div className="data-fields">
        <label className="data-field">
          <div className="data-field__label-row">
            <div className="data-field__label">{t.fFirst}</div>
          </div>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <div className="data-field__note" />
        </label>
        <label className="data-field">
          <div className="data-field__label-row">
            <div className="data-field__label">{t.fLast}</div>
          </div>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <div className="data-field__note" />
        </label>
        <label className="data-field">
          <div className="data-field__label-row">
            <div className="data-field__label">{t.fEmail}</div>
            <div className="data-field__tag">Confirm</div>
          </div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.phEmail} />
          <div className="data-field__note">{email && emailBad ? t.badEmail : ''}</div>
        </label>
        <label className="data-field">
          <div className="data-field__label-row">
            <div className="data-field__label">{t.fPhone}</div>
            <div className="data-field__tag">Confirm</div>
          </div>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.phPhone} />
          <div className="data-field__note">{phone && phoneBad ? t.badPhone : ''}</div>
        </label>
      </div>

      {error && <div className="data-field__note">{error}</div>}

      <div style={{ flex: 1 }} />

      <footer className="client-footer">
        <button type="button" className="client-btn--ghost" onClick={() => goTo('data')}>
          {t.back}
        </button>
        <div className="client-status">{ready ? t.looksRight : t.hintField}</div>
        <button type="button" className="client-btn" disabled={!ready || submitting} onClick={submit}>
          {submitting ? '…' : t.confirmCta}
        </button>
      </footer>
    </main>
  );
}
