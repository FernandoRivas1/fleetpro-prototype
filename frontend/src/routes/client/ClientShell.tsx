import { useEffect, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { getCheckoutStatus, getStation, listBranches, type CheckoutStatusResponse, type VehicleRead, type ACRISSCategoryRead } from '../../lib/api';
import { IdleScreen } from './IdleScreen';
import { useLanguage } from './LanguageContext';
import { STEP_LABELS } from './strings';
import { DocumentsStep } from './DocumentsStep';
import { DataStep } from './DataStep';
import { VehicleStep } from './VehicleStep';
import { UpsellStep } from './UpsellStep';
import { ExtrasStep } from './ExtrasStep';
import { DepositStep } from './DepositStep';
import { SignatureStep } from './SignatureStep';
import { ResultStep } from './ResultStep';
import './client.css';

export type WizardStep = 'documents' | 'data' | 'vehicle' | 'upsell' | 'extras' | 'deposit' | 'signature' | 'result';

export interface UpsellOffer {
  category: ACRISSCategoryRead;
  vehicle: VehicleRead;
  daily_price_difference: number;
}

/** Best-effort starting step from the reload-safe status snapshot — same
 * coarse-mapping idea stage 2's ActiveSessionPanel uses, plus the
 * documents_verified/license shortcut the handoff calls out explicitly
 * ("skip straight to a short summary if the driver already has valid
 * documents on file"). Transient WS-only state (candidates, an upsell
 * offer) is simply unavailable on a fresh resume, same limitation already
 * accepted on the executive side. */
function deriveInitialStep(status: CheckoutStatusResponse): WizardStep {
  if (status.current_step === 'document_verification') {
    // A confirmed Pre Check-in (app/checkout/precheckin.py) already had
    // the executive review this driver's data and documents remotely —
    // skip both steps rather than just Documents, per the Executive Pre
    // Check-in design's "skip Documents and Data" toggle.
    if (status.skip_driver_data) return 'vehicle';
    return status.driver.ready_for_checkout ? 'data' : 'documents';
  }
  if (status.current_step === 'vehicle_selection') return 'vehicle';
  if (status.current_step === 'extras_and_deposit') return 'extras';
  if (status.current_step === 'awaiting_signature') return 'signature';
  return 'result'; // awaiting_handover | completed
}

export function ClientShell() {
  const pairing = useStationPairing();
  const { lang, setLang } = useLanguage();

  const [stationLabel, setStationLabel] = useState('');
  const [contractId, setContractId] = useState<string | null>(null);
  const [status, setStatus] = useState<CheckoutStatusResponse | null>(null);
  const [step, setStep] = useState<WizardStep>('documents');
  const [candidates, setCandidates] = useState<VehicleRead[] | null>(null);
  const [upsellOffer, setUpsellOffer] = useState<UpsellOffer | null>(null);

  // Resolve station label + any already-active contract (reload resume).
  useEffect(() => {
    if (!pairing.stationId) return;
    Promise.all([getStation(pairing.stationId), listBranches()])
      .then(([st, branches]) => {
        const branchName = branches.find((b) => b.id === st.branch_id)?.name ?? '';
        setStationLabel(`${st.label} · ${branchName}`.toUpperCase());
        if (st.active_contract_id) setContractId(st.active_contract_id);
      })
      .catch((err) => console.error('Failed to load station', err));
  }, [pairing.stationId]);

  const refreshStatus = async (id: string = contractId!) => {
    const s = await getCheckoutStatus(id);
    setStatus(s);
    return s;
  };

  // Fetch status + pick a starting step whenever we get a contract (fresh
  // start or resume).
  useEffect(() => {
    if (!contractId) {
      setStatus(null);
      return;
    }
    refreshStatus(contractId)
      .then((s) => setStep(deriveInitialStep(s)))
      .catch((err) => console.error('Failed to load checkout status', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  useEffect(() => {
    return pairing.subscribe((message) => {
      switch (message.type) {
        case 'contract_started': {
          const id = message.payload.contract_id as string;
          setCandidates(null);
          setUpsellOffer(null);
          setContractId(id);
          break;
        }
        case 'candidates_sent':
          setCandidates(message.payload.vehicles as VehicleRead[]);
          break;
        case 'upsell_offered':
          setUpsellOffer(message.payload as unknown as UpsellOffer);
          break;
        case 'documents_confirmed_by_executive':
          if (contractId) {
            refreshStatus(contractId)
              .then(() => setStep((s) => (s === 'documents' ? 'data' : s)))
              .catch((err) => console.error(err));
          }
          break;
        case 'session_reset':
          // The executive abandoned this session (Executive Session Panel
          // design's "Reset session") — nothing to confirm here, just
          // return to idle same as a fresh, unstarted tablet.
          setCandidates(null);
          setUpsellOffer(null);
          setContractId(null);
          break;
        default:
          break;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing, contractId]);

  if (!contractId || !status) {
    return <IdleScreen stationLabel={stationLabel} />;
  }

  const stepIndex: Record<WizardStep, number> = {
    documents: 0,
    data: 1,
    vehicle: 2,
    upsell: 2,
    extras: 3,
    deposit: 4,
    signature: 5,
    result: 5,
  };
  const labels = STEP_LABELS[lang];

  const common = {
    status,
    contractId,
    lang,
    refreshStatus: () => refreshStatus(contractId).then(() => undefined),
    goTo: setStep,
  };

  return (
    <div className="client-page">
      <header className="client-header">
        <div className="client-header__brand">
          <div className="client-header__mark">F</div>
          <div className="client-header__title">Fleetpro</div>
        </div>
        <div className="client-header__right">
          <div className="client-header__driver">
            {status.driver.first_name} {status.driver.last_name}
          </div>
          <div className="client-lang">
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>
              EN
            </button>
            <button type="button" className={lang === 'es' ? 'active' : ''} onClick={() => setLang('es')}>
              ES
            </button>
          </div>
        </div>
      </header>

      {step !== 'result' && (
        <nav className="client-nav">
          <div className="client-nav__grid">
            {labels.map((label, i) => (
              <div className="client-nav__item" key={label}>
                <div
                  className={`client-nav__bar ${i < stepIndex[step] ? 'client-nav__bar--done' : i === stepIndex[step] ? 'client-nav__bar--active' : ''}`}
                />
                <div
                  className={`client-nav__label ${i === stepIndex[step] ? 'client-nav__label--active' : i < stepIndex[step] ? 'client-nav__label--done' : ''}`}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        </nav>
      )}

      {/* key={contractId} on every step: without it, React reuses the same
          component instance across customers whenever a new contract's
          wizard lands on the same step slot (e.g. two guests in a row both
          starting at 'documents'), leaking local state — a scan-sent flag,
          a shortlist pick, ink on the signature pad — from one customer to
          the next. */}
      {step === 'documents' && <DocumentsStep key={contractId} {...common} />}
      {step === 'data' && <DataStep key={contractId} {...common} />}
      {step === 'vehicle' && (
        <VehicleStep key={contractId} {...common} candidates={candidates} hasUpsellOffer={!!upsellOffer} />
      )}
      {step === 'upsell' && upsellOffer && <UpsellStep key={contractId} {...common} offer={upsellOffer} />}
      {step === 'extras' && <ExtrasStep key={contractId} {...common} />}
      {step === 'deposit' && <DepositStep key={contractId} {...common} />}
      {step === 'signature' && <SignatureStep key={contractId} {...common} />}
      {step === 'result' && <ResultStep key={contractId} contractId={contractId} lang={lang} />}
    </div>
  );
}
