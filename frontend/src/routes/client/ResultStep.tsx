import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { resolveHandover, type ResolveHandoverResponse } from '../../lib/api';
import { signatureStrings, resultStrings, type Lang } from './strings';

export function ResultStep({ contractId, lang }: { contractId: string; lang: Lang }) {
  const t = signatureStrings[lang];
  const r = resultStrings[lang];
  const [result, setResult] = useState<ResolveHandoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    resolveHandover(contractId)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [contractId]);

  return (
    <main className="client-main" style={{ padding: 0 }}>
      <div className="result-done">
        <div className="result-done__check">✓</div>
        <div>
          <h1 style={{ fontSize: 40 }}>{t.doneTitle}</h1>
        </div>

        <div className="result-contract">
          <div className="doc-slot__label">{t.contractLabel}</div>
          <div style={{ fontFamily: 'var(--fp-font-mono)', fontSize: 40, fontWeight: 600 }}>
            CT-{contractId.slice(0, 8).toUpperCase()}
          </div>
        </div>

        {error && <div className="data-field__note">{error}</div>}

        {result?.type === 'pre_report' && (
          <>
            <div className="subtitle" style={{ fontSize: 19 }}>{r.preReportTitle}</div>
            <div className="result-qr">
              <QRCodeSVG value={result.url} size={160} />
            </div>
            <div className="subtitle">{r.preReportHint}</div>
          </>
        )}

        {result?.type === 'new_report' && (
          <>
            <div className="subtitle" style={{ fontSize: 19 }}>{r.parkingLotTitle}</div>
            <div className="subtitle">{r.parkingLotHint}</div>
          </>
        )}

        <div className="subtitle">{t.doneKeys}</div>
      </div>
    </main>
  );
}
