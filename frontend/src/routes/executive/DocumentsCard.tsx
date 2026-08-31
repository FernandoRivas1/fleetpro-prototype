import { useEffect, useState } from 'react';
import { confirmDocuments, type CheckoutStatusResponse } from '../../lib/api';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

  const [firstName, setFirstName] = useState(driver.first_name);
  const [lastName, setLastName] = useState(driver.last_name);
  const [nationalId, setNationalId] = useState(driver.national_id_or_passport ?? '');
  const [licenseNumber, setLicenseNumber] = useState(driver.license_number ?? '');
  const [licenseExpiration, setLicenseExpiration] = useState(driver.license_expiration ?? '');
  const [expiryReviewed, setExpiryReviewed] = useState(false);
  const [physicallyVerified, setPhysicallyVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync whenever a fresh status snapshot arrives, or the client's OCR
  // read comes in — scannedData wins over the (still-empty at this point)
  // persisted driver fields.
  useEffect(() => {
    setFirstName(prefill('first_name', driver.first_name));
    setLastName(prefill('last_name', driver.last_name));
    setNationalId(prefill('national_id_or_passport', driver.national_id_or_passport ?? ''));
    setLicenseNumber(prefill('license_number', driver.license_number ?? ''));
    setLicenseExpiration(prefill('expiration_date', driver.license_expiration ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.id, driver.documents_verified, driver.license_expiration, scannedData]);

  const expired = licenseExpiration !== '' && licenseExpiration < todayIso();
  const hasAllFields = firstName.trim() && lastName.trim() && nationalId.trim() && licenseNumber.trim() && licenseExpiration;
  const canConfirm = !!hasAllFields && !expired && expiryReviewed && physicallyVerified;

  const submit = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      await confirmDocuments(status.contract_id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        national_id_or_passport: nationalId.trim(),
        license_number: licenseNumber.trim(),
        license_expiration: licenseExpiration,
      });
      onConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

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
                <div className="doc-slot__state">{nationalId ? 'On file' : 'Waiting'}</div>
              </div>
              <div className="doc-slot__thumb">{nationalId ? 'ID on file' : 'Client is scanning…'}</div>
            </div>
            <div>
              <div className="doc-slot__label-row">
                <div className="doc-slot__label">Driver's licence</div>
                <div className="doc-slot__state">{licenseNumber ? 'On file' : 'Waiting'}</div>
              </div>
              <div className="doc-slot__thumb">{licenseNumber ? 'Licence on file' : 'Client is scanning…'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="doc-fields">
              <label className="doc-field">
                <div className="doc-field__label-row">
                  <div className="doc-slot__label">Full name</div>
                </div>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={readyForCheckout} />
              </label>
              <label className="doc-field">
                <div className="doc-field__label-row">
                  <div className="doc-slot__label">Last name</div>
                </div>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={readyForCheckout} />
              </label>
              <label className="doc-field">
                <div className="doc-field__label-row">
                  <div className="doc-slot__label">National ID / passport</div>
                </div>
                <input value={nationalId} onChange={(e) => setNationalId(e.target.value)} disabled={readyForCheckout} />
              </label>
              <label className="doc-field">
                <div className="doc-field__label-row">
                  <div className="doc-slot__label">Licence no.</div>
                </div>
                <input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} disabled={readyForCheckout} />
              </label>
              <label className="doc-field">
                <div className="doc-field__label-row">
                  <div className="doc-slot__label">Licence expiry</div>
                  <div className={`doc-field__tag ${expired ? 'doc-field__tag--expired' : 'doc-field__tag--valid'}`}>
                    {licenseExpiration ? (expired ? 'Expired' : 'Valid') : ''}
                  </div>
                </div>
                <input
                  type="date"
                  value={licenseExpiration}
                  onChange={(e) => setLicenseExpiration(e.target.value)}
                  disabled={readyForCheckout}
                  className={expired ? 'expired' : ''}
                />
              </label>
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
