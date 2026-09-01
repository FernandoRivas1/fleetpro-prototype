import { useEffect, useState } from 'react';
import { confirmDocuments, type CheckoutStatusResponse } from '../../lib/api';

const EXPIRY_WARNING_WINDOW_DAYS = 60;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Design file: Executive Session Panel.dc.html (5a). Three tiers instead
 * of a plain valid/expired binary — an executive should see a license
 * that's about to lapse before it actually blocks anyone. Judges off
 * today's date only (the design's mock also checks against the rental's
 * own return date, which isn't in CheckoutStatusResponse — a reservation
 * lookup would be needed to add that). */
type ExpiryLevel = 'none' | 'valid' | 'warning' | 'expired';

function expiryLevel(iso: string): ExpiryLevel {
  if (!iso) return 'none';
  const today = todayIso();
  if (iso < today) return 'expired';
  const warnBy = new Date();
  warnBy.setDate(warnBy.getDate() + EXPIRY_WARNING_WINDOW_DAYS);
  return iso < warnBy.toISOString().slice(0, 10) ? 'warning' : 'valid';
}

const EXPIRY_TAG_LABEL: Record<ExpiryLevel, string> = {
  none: '',
  valid: 'Valid',
  warning: 'Expires soon',
  expired: 'Expired',
};

interface DocFields {
  firstName: string;
  lastName: string;
  nationalId: string;
  licenseNumber: string;
  licenseExpiration: string;
}

export function DocumentsCard({
  status,
  onConfirmed,
  scannedData,
}: {
  status: CheckoutStatusResponse;
  onConfirmed: () => void;
  /** The client's fresh OCR read (documents_scanned), if any has arrived
   * yet this session — see ActiveSessionPanel. Takes priority over the
   * (still-empty) persisted driver fields, since nothing persists this
   * until confirm-documents runs below. */
  scannedData: Record<string, string | null> | null;
}) {
  const { driver } = status;
  // The combined business-rule gate (documents verified AND license not
  // expired — see CLAUDE.md and Driver.is_ready_for_checkout in the
  // backend). documents_verified alone isn't "done": a driver can be
  // verified-on-file with a since-expired license, which must still show
  // as blocked, not as a green checkmark.
  const readyForCheckout = driver.ready_for_checkout;

  const prefill = (field: string, fallback: string) => scannedData?.[field] ?? fallback;
  const buildFields = (): DocFields => ({
    firstName: prefill('first_name', driver.first_name),
    lastName: prefill('last_name', driver.last_name),
    nationalId: prefill('national_id_or_passport', driver.national_id_or_passport ?? ''),
    licenseNumber: prefill('license_number', driver.license_number ?? ''),
    licenseExpiration: prefill('expiration_date', driver.license_expiration ?? ''),
  });

  const [fields, setFields] = useState<DocFields>(buildFields);
  // The as-scanned/as-on-file values, kept alongside the editable copy so
  // a hand-typed correction can be flagged and, if needed, undone (design's
  // "Corrected" tag + "Reset to scanned values").
  const [original, setOriginal] = useState<DocFields>(buildFields);
  const [expiryReviewed, setExpiryReviewed] = useState(false);
  const [physicallyVerified, setPhysicallyVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync whenever a fresh status snapshot arrives, or the client's OCR
  // read comes in — scannedData wins over the (still-empty at this point)
  // persisted driver fields.
  useEffect(() => {
    const next = buildFields();
    setFields(next);
    setOriginal(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.id, driver.documents_verified, driver.license_expiration, scannedData]);

  const setField = (key: keyof DocFields, value: string) => setFields((f) => ({ ...f, [key]: value }));
  const isEdited = (key: keyof DocFields) => fields[key] !== original[key];
  const anyEdited = (Object.keys(fields) as (keyof DocFields)[]).some(isEdited);
  const resetToScanned = () => setFields(original);

  const licenseLevel = expiryLevel(fields.licenseExpiration);
  const expired = licenseLevel === 'expired';
  const hasAllFields =
    fields.firstName.trim() && fields.lastName.trim() && fields.nationalId.trim() && fields.licenseNumber.trim() && fields.licenseExpiration;
  const canConfirm = !!hasAllFields && !expired && expiryReviewed && physicallyVerified;

  const submit = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      await confirmDocuments(status.contract_id, {
        first_name: fields.firstName.trim(),
        last_name: fields.lastName.trim(),
        national_id_or_passport: fields.nationalId.trim(),
        license_number: fields.licenseNumber.trim(),
        license_expiration: fields.licenseExpiration,
      });
      onConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const sourceNote = readyForCheckout
    ? 'On file · reviewed by the executive'
    : scannedData
      ? "Extracted by OCR from the client's scans · review before confirming"
      : 'Enter manually, or wait for the client to scan their documents';

  const fieldRow = (
    key: keyof DocFields,
    label: string,
    opts?: { type?: string; tag?: { level: ExpiryLevel } },
  ) => (
    <label className="doc-field">
      <div className="doc-field__label-row">
        <div className="doc-slot__label">{label}</div>
        {opts?.tag && opts.tag.level !== 'none' && (
          <div className={`doc-field__tag doc-field__tag--${opts.tag.level}`}>{EXPIRY_TAG_LABEL[opts.tag.level]}</div>
        )}
        {!readyForCheckout && isEdited(key) && <div className="doc-field__tag doc-field__tag--corrected">Corrected</div>}
      </div>
      <input
        type={opts?.type ?? 'text'}
        value={fields[key]}
        onChange={(e) => setField(key, e.target.value)}
        disabled={readyForCheckout}
        className={opts?.tag && opts.tag.level !== 'valid' && opts.tag.level !== 'none' ? opts.tag.level : ''}
      />
    </label>
  );

  return (
    <div className="session-card">
      <div className="session-card__head">
        <div className={`session-card__badge ${readyForCheckout ? 'session-card__badge--done' : expired ? 'session-card__badge--alarm' : 'session-card__badge--active'}`}>
          {readyForCheckout ? '✓' : '1'}
        </div>
        <div className="session-card__title">Documents</div>
        <div className={`session-card__state ${readyForCheckout ? 'session-card__state--done' : expired ? 'session-card__state--alarm' : 'session-card__state--active'}`}>
          {readyForCheckout ? 'Verified' : expired ? 'Expiry alarm' : scannedData ? 'Scans received' : 'Awaiting client scans'}
        </div>
      </div>

      <div className="session-card__body">
        {expired && !readyForCheckout && (
          <div className="alarm-banner">
            <div className="alarm-banner__icon">!</div>
            <div>
              <div className="alarm-banner__title">Driver's license has expired</div>
              <div className="alarm-banner__hint">
                Check-out cannot be confirmed. Ask the client for a valid document or escalate to the branch
                manager.
              </div>
            </div>
          </div>
        )}

        <div className="doc-grid">
          <div className="doc-slots">
            <div>
              <div className="doc-slot__label-row">
                <div className="doc-slot__label">Identity document</div>
                <div className="doc-slot__state">{fields.nationalId ? 'On file' : 'Waiting'}</div>
              </div>
              <div className="doc-slot__thumb">{fields.nationalId ? 'ID on file' : 'Client is scanning…'}</div>
            </div>
            <div>
              <div className="doc-slot__label-row">
                <div className="doc-slot__label">Driver's licence</div>
                <div className="doc-slot__state">{fields.licenseNumber ? 'On file' : 'Waiting'}</div>
              </div>
              <div className="doc-slot__thumb">{fields.licenseNumber ? 'Licence on file' : 'Client is scanning…'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="doc-fields">
              {fieldRow('firstName', 'Full name')}
              {fieldRow('lastName', 'Last name')}
              {fieldRow('nationalId', 'National ID / passport')}
              {fieldRow('licenseNumber', 'Licence no.')}
              {fieldRow('licenseExpiration', 'Licence expiry', { type: 'date', tag: { level: licenseLevel } })}
            </div>

            <div className="doc-source-row">
              <div className="doc-source-row__dot" />
              <div className="doc-source-row__note">{sourceNote}</div>
              <div style={{ flex: 1 }} />
              {!readyForCheckout && anyEdited && (
                <div className="doc-source-row__reset" onClick={resetToScanned}>
                  Reset to scanned values
                </div>
              )}
            </div>

            {!readyForCheckout && (
              <>
                <div className="confirm-buttons">
                  <div className="confirm-row" onClick={() => setExpiryReviewed((v) => !v)}>
                    <div className={`confirm-row__box ${expiryReviewed ? 'confirm-row__box--checked' : ''}`}>
                      {expiryReviewed ? '✓' : ''}
                    </div>
                    <div>Expiry dates reviewed — both documents valid</div>
                  </div>
                  <div className="confirm-row" onClick={() => setPhysicallyVerified((v) => !v)}>
                    <div className={`confirm-row__box ${physicallyVerified ? 'confirm-row__box--checked' : ''}`}>
                      {physicallyVerified ? '✓' : ''}
                    </div>
                    <div>I confirm I physically verified the documents</div>
                  </div>
                </div>

                {error && <div className="field__error">{error}</div>}

                <button type="button" className="confirm-btn" disabled={!canConfirm || submitting} onClick={submit}>
                  {submitting ? 'Confirming…' : 'Confirm documents'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
