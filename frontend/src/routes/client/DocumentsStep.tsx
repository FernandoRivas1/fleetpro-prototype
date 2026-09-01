import { useEffect, useRef, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { getDocumentScanMode, scanDocument, type DocumentType } from '../../lib/api';
import { documentsStrings } from './strings';
import type { WizardStep } from './ClientShell';
import type { Lang } from './strings';

type SlotKey = 'idFront' | 'idBack' | 'passport' | 'licFront' | 'licBack';
type SlotState = 'empty' | 'reading' | 'done';

const SLOT_META: Record<SlotKey, keyof typeof documentsStrings.en.meta> = {
  idFront: 'idF',
  idBack: 'idB',
  passport: 'pp',
  licFront: 'licF',
  licBack: 'licB',
};

// TEMPORARY — a 1x1 transparent PNG stood in for a real photo while OCR is
// mocked server-side (skip_document_ocr, app/config.py), so testing this
// screen doesn't require a human to actually photograph a document. Goes
// away the same day skip_document_ocr is turned back off — see
// getDocumentScanMode() in lib/api.ts, which is what gates this.
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function placeholderDocumentFile(key: SlotKey): File {
  const bytes = Uint8Array.from(atob(PLACEHOLDER_PNG_BASE64), (c) => c.charCodeAt(0));
  return new File([bytes], `${key}.png`, { type: 'image/png' });
}

export function DocumentsStep({
  contractId,
  lang,
  goTo,
}: {
  status: unknown;
  contractId: string;
  lang: Lang;
  refreshStatus: () => Promise<void>;
  goTo: (step: WizardStep) => void;
}) {
  const pairing = useStationPairing();
  const t = documentsStrings[lang];
  const [docType, setDocType] = useState<'id' | 'passport'>('id');
  const [slots, setSlots] = useState<Partial<Record<SlotKey, { state: SlotState; photoUrl?: string }>>>({});
  const [ocr, setOcr] = useState<Record<string, string | null>>({});
  const [consent, setConsent] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipUpload, setSkipUpload] = useState(false);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    getDocumentScanMode()
      .then((res) => setSkipUpload(res.skip_document_ocr))
      .catch(() => {}); // default false — falls back to the real capture flow
  }, []);

  const idKeys: SlotKey[] = docType === 'passport' ? ['passport'] : ['idFront', 'idBack'];
  const licKeys: SlotKey[] = ['licFront', 'licBack'];
  const allKeys = [...idKeys, ...licKeys];

  const capture = async (key: SlotKey, file: File) => {
    setSlots((prev) => ({ ...prev, [key]: { state: 'reading' } }));
    setError(null);
    try {
      const backendType: DocumentType = key.startsWith('lic') ? 'license' : 'id';
      const res = await scanDocument(contractId, backendType, file);
      if (!res.success) {
        setError(res.error ?? 'Could not read that document — try again.');
        setSlots((prev) => ({ ...prev, [key]: { state: 'empty' } }));
        return;
      }
      // First non-null value per field wins, so a weak read on the second
      // side of a document can't clobber a good read from the first.
      setOcr((prev) => {
        const merged = { ...prev };
        for (const [field, value] of Object.entries(res.data ?? {})) {
          if (merged[field] == null && value != null) merged[field] = value;
        }
        return merged;
      });
      setSlots((prev) => ({ ...prev, [key]: { state: 'done', photoUrl: res.photo_url ?? undefined } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSlots((prev) => ({ ...prev, [key]: { state: 'empty' } }));
    }
  };

  const allDone = allKeys.every((k) => slots[k]?.state === 'done');
  const canContinue = allDone && consent;

  const submit = () => {
    if (!canContinue) return;
    pairing.send('documents_scanned', {
      contract_id: contractId,
      ocr,
      photos: Object.fromEntries(allKeys.map((k) => [k, slots[k]?.photoUrl ?? null])),
    });
    setSent(true);
  };

  if (sent) {
    return (
      <main className="client-main" style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div className="scan-slot__spinner" style={{ margin: '0 auto' }} />
        <h1 style={{ marginTop: 24 }}>{t.reading}</h1>
        <p className="subtitle">
          {lang === 'es' ? 'El ejecutivo está revisando sus documentos…' : 'The agent is reviewing your documents…'}
        </p>
      </main>
    );
  }

  const renderSlot = (key: SlotKey) => {
    const slot = slots[key] ?? { state: 'empty' as SlotState };
    const [title, hint] = t.meta[SLOT_META[key]];
    const label = slot.state === 'reading' ? t.reading : slot.state === 'done' ? t.captured : hint;
    return (
      <div
        key={key}
        className={`scan-slot ${slot.state === 'done' ? 'scan-slot--done' : ''} ${slot.state === 'reading' ? 'scan-slot--reading' : ''}`}
        onClick={() => {
          if (slot.state === 'reading') return;
          if (skipUpload) {
            void capture(key, placeholderDocumentFile(key));
          } else {
            fileInputs.current[key]?.click();
          }
        }}
      >
        <div className="scan-slot__thumb">
          {slot.state === 'reading' && <div className="scan-slot__spinner" />}
        </div>
        <div>
          <div className="scan-slot__title">{title}</div>
          <div className="scan-slot__status">{label}</div>
        </div>
        <div className="scan-slot__action">{slot.state === 'done' ? t.retake : slot.state === 'reading' ? '' : t.tapToScan}</div>
        <input
          ref={(el) => {
            fileInputs.current[key] = el;
          }}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) capture(key, file);
            e.target.value = '';
          }}
        />
      </div>
    );
  };

  return (
    <main className="client-main">
      <div>
        <h1>{t.title}</h1>
        <p className="subtitle">{t.subtitle}</p>
      </div>

      {error && <div className="data-field__note">{error}</div>}

      <div className="doc-panels">
        <div className="doc-panel">
          <div className="doc-panel__head">
            <h2>{t.idHeading}</h2>
            {idKeys.every((k) => slots[k]?.state === 'done') && <div className="doc-check">✓</div>}
          </div>
          <div className="doc-type-toggle">
            <button type="button" className={docType === 'id' ? 'active' : ''} onClick={() => setDocType('id')}>
              {t.typeId}
            </button>
            <button type="button" className={docType === 'passport' ? 'active' : ''} onClick={() => setDocType('passport')}>
              {t.typePassport}
            </button>
          </div>
          {idKeys.map(renderSlot)}
        </div>

        <div className="doc-panel">
          <div className="doc-panel__head">
            <h2>{t.licHeading}</h2>
            {licKeys.every((k) => slots[k]?.state === 'done') && <div className="doc-check">✓</div>}
          </div>
          <div style={{ height: 44, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: 11, background: 'var(--fp-surface-muted)', fontSize: 15, color: 'var(--fp-secondary)' }}>
            {t.licNote}
          </div>
          {licKeys.map(renderSlot)}
        </div>
      </div>

      <div className={`consent-row ${consent ? 'consent-row--checked' : ''}`} onClick={() => setConsent((v) => !v)}>
        <div className={`consent-box ${consent ? 'consent-box--checked' : ''}`}>{consent ? '✓' : ''}</div>
        <div>
          {t.consentPre}
          <span
            className="policy-link"
            onClick={(e) => {
              e.stopPropagation();
              setPolicyOpen(true);
            }}
          >
            {t.policyTitle}
          </span>
          {t.consentPost}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <footer className="client-footer">
        <button type="button" className="client-btn--ghost" onClick={() => goTo('documents')}>
          {t.back}
        </button>
        <div className="client-status">{canContinue ? t.allSet : allDone ? t.needPolicy : t.onePhotoLeft}</div>
        <button type="button" className="client-btn" disabled={!canContinue} onClick={submit}>
          {t.continue}
        </button>
      </footer>

      {policyOpen && (
        <div className="policy-modal" onClick={() => setPolicyOpen(false)}>
          <div className="policy-modal__card" onClick={(e) => e.stopPropagation()}>
            <div className="policy-modal__head">
              <div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{t.policyTitle}</div>
                <div style={{ fontFamily: 'var(--fp-font-mono)', fontSize: 12, color: 'var(--fp-text-muted)' }}>{t.policyVersion}</div>
              </div>
            </div>
            <div className="policy-modal__body">
              {t.policy.map(([h, b]) => (
                <div key={h}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{h}</div>
                  <div style={{ fontSize: 15, lineHeight: 1.5, color: '#55697a' }}>{b}</div>
                </div>
              ))}
            </div>
            <div className="policy-modal__foot">
              <div style={{ fontSize: 14, color: 'var(--fp-text-muted)' }}>{t.policyFoot}</div>
              <div style={{ flex: 1 }} />
              <button type="button" className="client-btn--ghost" onClick={() => setPolicyOpen(false)}>
                {t.close}
              </button>
              <button
                type="button"
                className="client-btn"
                onClick={() => {
                  setConsent(true);
                  setPolicyOpen(false);
                }}
              >
                {t.acceptContinue}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
