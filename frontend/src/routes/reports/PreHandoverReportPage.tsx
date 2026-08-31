import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { addPreHandoverComment, getPreHandoverReport, type PreHandoverReportPublicView } from '../../lib/api';
import './reports.css';

/** Public, unauthenticated — reached by scanning the QR the client's
 * result screen shows (see app/reports/pre_handover.py's docstring). No
 * design file exists for this screen; built to match the rest of the
 * app's brand tokens/voice. */
export function PreHandoverReportPage() {
  const { preReportId } = useParams();
  const [report, setReport] = useState<PreHandoverReportPublicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    if (!preReportId) return;
    getPreHandoverReport(preReportId)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(load, [preReportId]);

  const submitComment = async () => {
    if (!preReportId || (!note.trim() && !photo)) return;
    setSubmitting(true);
    setError(null);
    try {
      await addPreHandoverComment(preReportId, note.trim() || undefined, photo ?? undefined);
      setNote('');
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !report) {
    return (
      <div className="report-page">
        <div className="report-container">
          <div className="report-card">
            <div className="rp-error">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="report-page">
        <div className="report-container">Loading…</div>
      </div>
    );
  }

  const { scratches = [], dents = [], notes, client_comments = [] } = report.damage_diagram;
  const hasDamage = scratches.length > 0 || dents.length > 0;

  return (
    <div className="report-page">
      <div className="report-container">
        <div className="report-header">
          <div className="report-header__mark">F</div>
          <div className="report-header__title">Vehicle condition report</div>
        </div>

        {report.vehicle && (
          <div className="report-card">
            <div className="report-vehicle">
              <div
                className="report-vehicle__photo"
                style={report.vehicle.main_photo_url ? { backgroundImage: `url(${report.vehicle.main_photo_url})` } : undefined}
              />
              <div>
                <div className="report-vehicle__name">
                  {report.vehicle.make} {report.vehicle.model} · {report.vehicle.year}
                </div>
                <div className="report-vehicle__plate">{report.vehicle.plate}</div>
              </div>
            </div>
          </div>
        )}

        <div className="report-card">
          <h2>Photos</h2>
          {report.photos.length === 0 ? (
            <div style={{ color: 'var(--fp-text-muted)', fontSize: 14 }}>No photos on this report.</div>
          ) : (
            <div className="report-photo-grid">
              {report.photos.map((url) => (
                <div key={url} className="report-photo" style={{ backgroundImage: `url(${url})` }} />
              ))}
            </div>
          )}
        </div>

        <div className="report-card">
          <h2>Damage noted at pickup</h2>
          {!hasDamage && <div className="damage-none">No damage found ✓</div>}
          {hasDamage && (
            <div className="damage-list">
              {scratches.map((s, i) => (
                <div className="damage-row" key={`s${i}`}>
                  <span className={`damage-row__badge damage-row__badge--${s.severity === 'major' ? 'major' : 'minor'}`}>
                    Scratch
                  </span>
                  <span style={{ textTransform: 'capitalize' }}>{s.panel.replace(/_/g, ' ')}</span>
                  <span style={{ color: 'var(--fp-text-muted)' }}>{s.severity}</span>
                </div>
              ))}
              {dents.map((d, i) => (
                <div className="damage-row" key={`d${i}`}>
                  <span className={`damage-row__badge damage-row__badge--${d.severity === 'major' ? 'major' : 'minor'}`}>
                    Dent
                  </span>
                  <span style={{ textTransform: 'capitalize' }}>{d.panel.replace(/_/g, ' ')}</span>
                  <span style={{ color: 'var(--fp-text-muted)' }}>{d.severity}</span>
                </div>
              ))}
            </div>
          )}
          {notes && <div style={{ fontSize: 14, color: 'var(--fp-secondary)' }}>{notes}</div>}
        </div>

        <div className="report-card">
          <h2>Comments</h2>
          {client_comments.length > 0 && (
            <div className="comment-list">
              {client_comments.map((c) => (
                <div className="comment-item" key={c.id}>
                  <div className="comment-item__meta">{new Date(c.created_at).toLocaleString()}</div>
                  {c.note && <div>{c.note}</div>}
                  {c.photo_url && <div className="report-photo" style={{ backgroundImage: `url(${c.photo_url})`, marginTop: 8, maxWidth: 200 }} />}
                </div>
              ))}
            </div>
          )}

          <div className="rp-field">
            <label htmlFor="note">Add a comment (optional photo)</label>
            <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything you'd like to note before driving off…" />
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          {error && <div className="rp-error">{error}</div>}
          <button type="button" className="rp-btn" disabled={submitting || (!note.trim() && !photo)} onClick={submitComment}>
            {submitting ? 'Sending…' : 'Add comment'}
          </button>
        </div>
      </div>
    </div>
  );
}
