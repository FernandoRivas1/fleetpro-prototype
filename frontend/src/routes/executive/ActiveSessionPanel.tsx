import { useEffect, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { getCheckoutStatus, type CheckoutStatusResponse } from '../../lib/api';
import type { CheckoutMessageType } from '../../pairing/types';
import { DocumentsCard } from './DocumentsCard';
import { VehiclesCard } from './VehiclesCard';
import { UpsellCard } from './UpsellCard';

const STEP_LABELS = ['Documents', 'Data', 'Vehicle', 'Extras', 'Deposit', 'Signature'];

// Backend CheckoutStep (persisted-state-derived, see checkout.py) mapped
// onto the design's 6-step UI — coarser than the live WS step stream since
// "Data" (client-side confirmation, stage 3) isn't tracked server-side.
const STEP_INDEX: Record<CheckoutStatusResponse['current_step'], number> = {
  document_verification: 0,
  vehicle_selection: 2,
  extras_and_deposit: 3,
  awaiting_signature: 5,
  awaiting_handover: 5,
  completed: 5,
};

// Re-fetch status.py's reload-safe snapshot whenever one of these arrives —
// simpler and more correct than hand-patching local state per message type.
const RESYNC_ON: CheckoutMessageType[] = [
  'documents_confirmed_by_executive',
  'driver_data_confirmed',
  'vehicle_selected',
  'upsell_responded',
  'extras_confirmed',
  'deposit_authorized',
  'contract_signed',
];

export function ActiveSessionPanel({
  contractId,
  onSessionEnd,
}: {
  contractId: string;
  onSessionEnd: () => void;
}) {
  const pairing = useStationPairing();
  const [status, setStatus] = useState<CheckoutStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // candidates_sent has no durable server-side state (see the stage-2 plan:
  // it's a pure WS push, and a sender never gets its own broadcast echoed
  // back) — tracked here, lifted above both cards, and lost on reload same
  // as the tablet's own in-memory shortlist would be.
  const [candidatesSent, setCandidatesSent] = useState(false);
  // documents_scanned carries the client's fresh OCR read — nothing
  // persists it until confirm-documents runs (see flow.py's docstring), so
  // this is the only place the executive sees it before typing it in.
  const [scannedData, setScannedData] = useState<Record<string, string | null> | null>(null);

  const refresh = () => {
    getCheckoutStatus(contractId)
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    setStatus(null);
    setScannedData(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  useEffect(() => {
    return pairing.subscribe((message) => {
      if (RESYNC_ON.includes(message.type)) refresh();
      if (message.type === 'contract_signed') onSessionEnd();
      if (message.type === 'documents_scanned') {
        setScannedData((message.payload.ocr as Record<string, string | null>) ?? null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing, contractId]);

  if (error) return <div className="centered-empty">{error}</div>;
  if (!status) return <div className="centered-empty">Loading…</div>;

  const stepIdx = STEP_INDEX[status.current_step];
  const contractLabel = `CT-${contractId.slice(0, 8).toUpperCase()}`;
  const linked = pairing.status === 'open';

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="session-header">
        <div className="session-header__top">
          <div>
            <div className="session-header__name">
              {status.driver.first_name} {status.driver.last_name}
            </div>
            <div className="session-header__meta">
              {contractLabel} {status.current_category ? `· ${status.current_category.code}` : ''}
            </div>
          </div>
          <div className="session-header__divider" />
          <div>
            <div className="session-header__step-label">Client is on</div>
            <div className="session-header__step-value">
              Step {stepIdx + 1} of 6 — {STEP_LABELS[stepIdx]}
            </div>
          </div>
          <div className="live-badge">
            <div className="live-badge__dot" />
            <div className="live-badge__text">LIVE</div>
          </div>
          <div style={{ flex: 1 }} />
          <div className={`exec-chip ${linked ? 'exec-chip--success' : 'exec-chip--danger'}`}>
            <div className="exec-chip__dot" />
            {linked ? 'Tablet connected' : 'Tablet not connected'}
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onSessionEnd}>
            New customer
          </button>
        </div>

        <div className="step-track">
          {STEP_LABELS.map((label, i) => (
            <div className="step-track__item" key={label}>
              <div
                className={`step-track__bar ${i < stepIdx ? 'step-track__bar--done' : i === stepIdx ? 'step-track__bar--active' : ''}`}
              />
              <div
                className={`step-track__label ${i === stepIdx ? 'step-track__label--active' : i < stepIdx ? 'step-track__label--done' : ''}`}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="session-body">
        <DocumentsCard status={status} onConfirmed={refresh} scannedData={scannedData} />
        <VehiclesCard status={status} onSent={() => setCandidatesSent(true)} />
        <UpsellCard status={status} locked={!candidatesSent} />

        {['Extras', 'Deposit', 'Signature'].map((label, i) => (
          <div className="session-card session-card--future" key={label}>
            <div className="session-card__badge">{i + 4}</div>
            <div className="session-card__title" style={{ color: '#a9b4bd' }}>
              {label}
            </div>
            <div className="session-card__state">Locked</div>
            <div className="session-card__spacer" />
            <div className="locked-hint">Built in a later stage</div>
          </div>
        ))}
      </div>
    </div>
  );
}
