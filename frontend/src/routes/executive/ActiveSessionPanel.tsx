import { useEffect, useRef, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { getCheckoutStatus, type CheckoutStatusResponse } from '../../lib/api';
import type { CheckoutMessageType } from '../../pairing/types';
import { DocumentsCard } from './DocumentsCard';
import { VehiclesCard } from './VehiclesCard';
import { UpsellCard } from './UpsellCard';
import { TierBadge } from './TierBadge';

// Order per the Tablet *.dc.html designs: Rental details -> Vehicle ->
// Extras -> Documents -> Data -> Deposit -> Signature.
const STEP_LABELS = ['Rental details', 'Vehicle', 'Extras', 'Documents', 'Data', 'Deposit', 'Signature'];

// Backend CheckoutStep (persisted-state-derived, see checkout.py) mapped
// onto the design's 7-step UI — coarser than the live WS step stream since
// "Data" (client-side confirmation) isn't tracked server-side, and
// "Extras" vs "Deposit" can't be told apart from persisted state alone
// once a vehicle is picked (same limitation as before the reorder, just
// applied at a different point — see checkout.py's _infer_current_step).
const STEP_INDEX: Record<CheckoutStatusResponse['current_step'], number> = {
  rental_details: 0,
  vehicle_selection: 1,
  extras_and_deposit: 2,
  document_verification: 3,
  awaiting_signature: 6,
  awaiting_handover: 6,
  completed: 6,
};

// Re-fetch status.py's reload-safe snapshot whenever one of these arrives —
// simpler and more correct than hand-patching local state per message type.
const RESYNC_ON: CheckoutMessageType[] = [
  'rental_details_confirmed',
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
  // Same idea as candidatesSent — offering an upsell is a pure WS push
  // with no durable server-side state, so it's tracked here too (lifted
  // above UpsellCard) purely so the reset-session modal can report it.
  const [upsellOffered, setUpsellOffered] = useState(false);
  // documents_scanned carries the client's fresh OCR read — nothing
  // persists it until confirm-documents runs (see flow.py's docstring), so
  // this is the only place the executive sees it before typing it in.
  const [scannedData, setScannedData] = useState<Record<string, string | null> | null>(null);
  // Same message's photos map (slot key -> photo_url) — lets the executive
  // actually see what the client scanned instead of a plain placeholder,
  // same as scannedData above: never persisted, gone on reload.
  const [scannedPhotos, setScannedPhotos] = useState<Record<string, string | null> | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const endTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = () => {
    getCheckoutStatus(contractId)
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    setStatus(null);
    setScannedData(null);
    setScannedPhotos(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  useEffect(() => {
    return pairing.subscribe((message) => {
      if (RESYNC_ON.includes(message.type)) refresh();
      if (message.type === 'contract_signed') onSessionEnd();
      if (message.type === 'documents_scanned') {
        setScannedData((message.payload.ocr as Record<string, string | null>) ?? null);
        setScannedPhotos((message.payload.photos as Record<string, string | null>) ?? null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing, contractId]);

  useEffect(() => () => clearTimeout(endTimer.current), []);

  // Abandons the in-progress session: tells the tablet to drop back to
  // idle (session_reset, see ws.py) and returns the executive to search/
  // walk-in. Deliberately does NOT try to undo anything already persisted
  // server-side — a verified driver stays verified, the contract row
  // stays as-is — only the two purely-local, WS-only flags below (sent
  // shortlist, sent upsell) are actually lost, which is exactly what the
  // confirmation modal tells the executive before they commit to it.
  const confirmReset = () => {
    if (resetting) return;
    setResetting(true);
    pairing.send('session_reset', { contract_id: contractId });
    setResetOpen(false);
    setToast('Session reset · the tablet is back to the idle screen');
    // A beat to let the toast register before the panel unmounts.
    endTimer.current = setTimeout(onSessionEnd, 1100);
  };

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="session-header__name">
                {status.driver.first_name} {status.driver.last_name}
              </div>
              {status.driver.tier !== 'Standard' && <TierBadge tier={status.driver.tier} />}
            </div>
            <div className="session-header__meta">
              {contractLabel} {status.current_category ? `· ${status.current_category.code}` : ''}
            </div>
          </div>
          <div className="session-header__divider" />
          <div>
            <div className="session-header__step-label">Client is on</div>
            <div className="session-header__step-value">
              Step {stepIdx + 1} of {STEP_LABELS.length} — {STEP_LABELS[stepIdx]}
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
          <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => setResetOpen(true)}>
            Reset session
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

      {/* Reordered to match the client's own new order (Tablet Rental
          Details design): Vehicle -> Upsell -> ... -> Documents. Extras,
          Data, and Signature stay pure client self-service with no
          executive card, same as Data always was — only Deposit and
          Signature get a "built in a later stage" placeholder, matching
          the set that had one before this reorder too. */}
      <div className="session-body">
        <VehiclesCard status={status} onSent={() => setCandidatesSent(true)} />
        <UpsellCard status={status} locked={!candidatesSent} onOffered={() => setUpsellOffered(true)} />
        <DocumentsCard status={status} onConfirmed={refresh} scannedData={scannedData} scannedPhotos={scannedPhotos} />

        {['Deposit', 'Signature'].map((label, i) => (
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

      {resetOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal__head">
              <div className="modal__title">Reset the client session?</div>
              <div className="modal__subtitle">
                The tablet returns to its idle screen and anything only tracked for this session is discarded. The
                driver's already-verified documents and the reservation itself are not affected.
              </div>
            </div>
            <div className="reset-loses">
              <div className="reset-loses__row">
                <div className="reset-loses__dot" />
                <div>Vehicle shortlist sent to the tablet</div>
                <div style={{ flex: 1 }} />
                <div className={`mono ${candidatesSent ? 'reset-loses__value--lost' : ''}`}>
                  {candidatesSent ? 'discarded' : 'nothing yet'}
                </div>
              </div>
              <div className="reset-loses__row">
                <div className="reset-loses__dot" />
                <div>Upgrade offer sent to the tablet</div>
                <div style={{ flex: 1 }} />
                <div className={`mono ${upsellOffered ? 'reset-loses__value--lost' : ''}`}>
                  {upsellOffered ? 'discarded' : 'nothing yet'}
                </div>
              </div>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setResetOpen(false)}>
                Keep the session
              </button>
              <button type="button" className="btn btn--danger" disabled={resetting} onClick={confirmReset}>
                Reset session
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
