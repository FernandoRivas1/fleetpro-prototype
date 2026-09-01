import { useEffect, useMemo, useState } from 'react';
import {
  confirmPrecheckin,
  listAcrissCategories,
  listPrecheckinQueue,
  remindPrecheckin,
  requestPrecheckin,
  setPrecheckinUnskip,
  type ACRISSCategoryRead,
  type PrecheckinQueueItem,
  type PrecheckinStatus,
} from '../../lib/api';

/** Design file: Executive Pre Check-in.dc.html (13a). Arrivals in the next
 * 72 hours at this branch, with a review queue for whatever the driver has
 * submitted through the public /precheckin portal (routes/precheckin) —
 * see app/checkout/precheckin.py for the state machine this mirrors. */

const WITHIN_HOURS = 72;

type StatusKey = 'none' | 'requested' | 'loaded' | 'confirmed';
type FilterKey = 'all' | StatusKey;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All arrivals' },
  { key: 'loaded', label: 'To review' },
  { key: 'requested', label: 'Waiting on driver' },
  { key: 'none', label: 'Not requested' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}
function daysBetween(a: string, b: string): string {
  const n = Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}
function timeAgo(iso: string): string {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

function statusOf(item: PrecheckinQueueItem): StatusKey {
  return item.precheckin?.status ?? 'none';
}

const STATUS_LABEL: Record<FilterKey, string> = {
  all: '',
  none: 'Not requested',
  requested: 'Requested',
  loaded: 'Loaded — to review',
  confirmed: 'Confirmed',
};

export function PreCheckinPage({ branchId }: { branchId: string }) {
  const [items, setItems] = useState<PrecheckinQueueItem[] | null>(null);
  const [categories, setCategories] = useState<ACRISSCategoryRead[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compose, setCompose] = useState<PrecheckinQueueItem | null>(null);
  const [composeEmail, setComposeEmail] = useState('');
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () =>
    listPrecheckinQueue(branchId, WITHIN_HOURS)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    setItems(null);
    setSelectedId(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    listAcrissCategories().then(setCategories).catch(console.error);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, loaded: 0, requested: 0, none: 0, confirmed: 0 };
    for (const item of items ?? []) {
      c.all++;
      c[statusOf(item)]++;
    }
    return c;
  }, [items]);

  const visible = (items ?? []).filter((item) => filter === 'all' || statusOf(item) === filter);
  const selected = visible.find((i) => i.reservation.id === selectedId) ?? visible[0] ?? null;
  const notRequested = (items ?? []).filter((item) => statusOf(item) === 'none');

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openCompose = (item: PrecheckinQueueItem) => {
    setCompose(item);
    setComposeEmail(item.precheckin?.contact_email ?? item.reservation.driver_email);
    setPortalUrl(null);
  };

  const sendRequest = () =>
    withBusy(async () => {
      if (!compose) return;
      const res = await requestPrecheckin(compose.reservation.id, composeEmail.trim());
      setPortalUrl(res.portal_url);
      setToast(`Pre check-in link ready for ${compose.reservation.driver_first_name} ${compose.reservation.driver_last_name}`);
      await refresh();
    });

  const remind = (item: PrecheckinQueueItem) =>
    withBusy(async () => {
      await remindPrecheckin(item.reservation.id);
      setToast(`Reminder logged for ${item.precheckin?.contact_email ?? item.reservation.driver_email}`);
      await refresh();
    });

  const bulkRequest = () =>
    withBusy(async () => {
      for (const item of notRequested) {
        await requestPrecheckin(item.reservation.id, item.reservation.driver_email);
      }
      setToast(`${notRequested.length} pre check-in link${notRequested.length === 1 ? '' : 's'} generated`);
      await refresh();
    });

  const toggleConfirm = (item: PrecheckinQueueItem) =>
    withBusy(async () => {
      await confirmPrecheckin(item.reservation.id);
      setToast(
        item.precheckin?.status === 'confirmed'
          ? `${item.reservation.driver_first_name} moved back to review`
          : `${item.reservation.driver_first_name} pre-checked · Documents and Data skipped at the counter`,
      );
      await refresh();
    });

  const toggleUnskip = (item: PrecheckinQueueItem, unskip: boolean) =>
    withBusy(async () => {
      await setPrecheckinUnskip(item.reservation.id, unskip);
      setToast(
        unskip
          ? 'Documents and Data re-enabled · the client will review them on the tablet'
          : 'Documents and Data hidden again · client tablet skips straight to Vehicle',
      );
      await refresh();
    });

  return (
    <div className="exec-body precheckin">
      <div className="precheckin__layout">
        <div className="res-table precheckin__list">
          <div className="precheckin__filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`precheckin__filter-pill ${filter === f.key ? 'precheckin__filter-pill--active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className="mono">{counts[f.key]}</span>
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ whiteSpace: 'nowrap', flex: 'none' }}
              disabled={busy || notRequested.length === 0}
              onClick={bulkRequest}
            >
              {notRequested.length
                ? `Request data from ${notRequested.length} driver${notRequested.length === 1 ? '' : 's'}`
                : 'All drivers contacted'}
            </button>
          </div>

          {error && <div className="field__error" style={{ padding: '0 20px' }}>{error}</div>}

          <div className="res-table__body">
            {items === null && <div className="res-table__empty">Loading…</div>}
            {items !== null && visible.length === 0 && (
              <div className="res-table__empty">No arrivals match this filter in the next {WITHIN_HOURS} hours.</div>
            )}
            {visible.map((item) => {
              const st = statusOf(item);
              const cat = categoryById.get(item.reservation.acriss_category_id);
              const pc = item.precheckin;
              return (
                <div
                  key={item.reservation.id}
                  className={`precheckin__row ${selected?.reservation.id === item.reservation.id ? 'precheckin__row--active' : ''}`}
                  onClick={() => setSelectedId(item.reservation.id)}
                >
                  <div>
                    <div className="res-table__driver">
                      {item.reservation.driver_first_name} {item.reservation.driver_last_name}
                    </div>
                    <div className="mono precheckin__code">{item.reservation.code}</div>
                  </div>
                  <div>
                    <div className="res-table__date">{fmtDate(item.reservation.pickup_date)}</div>
                    <div className="res-table__time">{fmtTime(item.reservation.pickup_date)}</div>
                  </div>
                  <div>
                    {cat && <span className="res-table__acriss">{cat.code}</span>}
                    <span className="res-table__sub">{daysBetween(item.reservation.pickup_date, item.reservation.return_date)}</span>
                  </div>
                  <div className="precheckin__status">
                    <div className={`precheckin__dot precheckin__dot--${st}`} />
                    <div>
                      <div className={`precheckin__status-label precheckin__status-label--${st}`}>{STATUS_LABEL[st]}</div>
                      <div className="res-table__sub">
                        {st === 'none' && 'No request sent'}
                        {st === 'requested' && `Sent ${timeAgo(pc!.requested_at!)}${pc!.reminder_count ? ` · ${pc!.reminder_count} reminder${pc!.reminder_count === 1 ? '' : 's'}` : ''}`}
                        {st === 'loaded' && `Received ${timeAgo(pc!.loaded_at!)}`}
                        {st === 'confirmed' && (pc!.unskip ? 'Reviewed · client re-checks on tablet' : 'Reviewed · 5 steps at the counter')}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`btn btn--sm ${st === 'none' ? '' : 'btn--ghost'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(item.reservation.id);
                      if (st === 'none') openCompose(item);
                      else if (st === 'requested') void remind(item);
                    }}
                  >
                    {st === 'none' ? 'Request data' : st === 'requested' ? 'Remind' : st === 'loaded' ? 'Review' : 'Ready ✓'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="precheckin__detail">
          {!selected ? (
            <div className="centered-empty">Select an arrival</div>
          ) : (
            <PrecheckinDetail
              key={selected.reservation.id}
              item={selected}
              category={categoryById.get(selected.reservation.acriss_category_id)}
              busy={busy}
              onCompose={() => openCompose(selected)}
              onRemind={() => void remind(selected)}
              onConfirm={() => void toggleConfirm(selected)}
              onUnskip={(v) => void toggleUnskip(selected, v)}
            />
          )}
        </div>
      </div>

      {compose && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal__head">
              <div className="modal__title">Ask the driver to load their data</div>
              <div className="modal__subtitle">
                The driver opens the link, signs in with their reservation number ({compose.reservation.code}) and last
                name, fills in their data and uploads their ID and driving licence. On completion this reservation is
                marked <strong>Driver&apos;s data loaded = true</strong>.
              </div>
            </div>

            <div className="field">
              <label htmlFor="precheckin-email">Send to</label>
              <input
                id="precheckin-email"
                value={composeEmail}
                onChange={(e) => setComposeEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>

            {portalUrl ? (
              <div className="precheckin__link-box">
                <div className="field__hint">
                  No mail service is wired up for this prototype — copy this link and send it yourself.
                </div>
                <div className="precheckin__link-row">
                  <input readOnly value={portalUrl} onFocus={(e) => e.currentTarget.select()} />
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => void navigator.clipboard.writeText(portalUrl)}
                  >
                    Copy link
                  </button>
                </div>
              </div>
            ) : null}

            {error && <div className="field__error">{error}</div>}

            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setCompose(null)}>
                {portalUrl ? 'Done' : 'Cancel'}
              </button>
              {!portalUrl && (
                <button type="button" className="btn" disabled={busy || !composeEmail.trim()} onClick={sendRequest}>
                  {busy ? 'Generating…' : 'Generate link'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function PrecheckinDetail({
  item,
  category,
  busy,
  onCompose,
  onRemind,
  onConfirm,
  onUnskip,
}: {
  item: PrecheckinQueueItem;
  category: ACRISSCategoryRead | undefined;
  busy: boolean;
  onCompose: () => void;
  onRemind: () => void;
  onConfirm: () => void;
  onUnskip: (unskip: boolean) => void;
}) {
  const { reservation, precheckin: pc } = item;
  const status: PrecheckinStatus | 'none' = pc?.status ?? 'none';
  const loaded = status === 'loaded' || status === 'confirmed';
  const confirmed = status === 'confirmed';
  const initials = `${reservation.driver_first_name[0] ?? ''}${reservation.driver_last_name[0] ?? ''}`.toUpperCase();

  const fields: { k: string; v: string }[] = loaded
    ? [
        { k: 'National ID / passport', v: pc!.national_id_or_passport ?? '—' },
        { k: 'Licence no.', v: pc!.license_number ?? '—' },
        { k: 'Licence expiry', v: pc!.license_expiration ?? '—' },
        { k: 'Phone', v: pc!.phone ?? '—' },
        { k: 'Email', v: pc!.contact_email },
      ]
    : [];

  return (
    <>
      <div className="precheckin__detail-head">
        <div className="precheckin__avatar">{initials}</div>
        <div>
          <div className="precheckin__detail-name">
            {reservation.driver_first_name} {reservation.driver_last_name}
          </div>
          <div className="mono precheckin__detail-meta">
            {reservation.code} {category ? `· ${category.code}` : ''} · {fmtDate(reservation.pickup_date)}{' '}
            {fmtTime(reservation.pickup_date)} → {fmtDate(reservation.return_date)} {fmtTime(reservation.return_date)}
          </div>
        </div>
      </div>

      <div className={`precheckin__flag ${loaded ? 'precheckin__flag--on' : ''}`}>
        <div>
          <div className="precheckin__flag-label">Driver&apos;s data loaded</div>
          <div className="precheckin__flag-note">
            {loaded
              ? `Submitted by the driver ${timeAgo(pc!.loaded_at!)}`
              : status === 'requested'
                ? `Request sent ${timeAgo(pc!.requested_at!)}`
                : 'Nothing on file yet'}
          </div>
        </div>
        <div className="mono precheckin__flag-value">{loaded ? 'true' : 'false'}</div>
      </div>

      <div className="precheckin__detail-body">
        {status === 'none' && (
          <div className="precheckin__empty">
            <div>
              This driver hasn&apos;t been asked for their data yet. Sending the request lets them fill everything in
              from home — at the counter the client only confirms it on the tablet.
            </div>
            <button type="button" className="btn" onClick={onCompose}>
              Compose request
            </button>
          </div>
        )}

        {status === 'requested' && (
          <div className="precheckin__waiting">
            <div className="precheckin__waiting-title">Waiting on {reservation.driver_first_name}</div>
            <div className="precheckin__waiting-body">
              Sent to {pc!.contact_email} {timeAgo(pc!.requested_at!)}
              {pc!.reminder_count ? ` · ${pc!.reminder_count} reminder${pc!.reminder_count === 1 ? '' : 's'} sent` : ''}.
              Data and documents can still be captured at the counter if they arrive without loading them.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onRemind}>
                Send reminder
              </button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onCompose}>
                Change email
              </button>
            </div>
          </div>
        )}

        {loaded && (
          <>
            <div className="precheckin__section-title">Driver data</div>
            <div className="precheckin__fields">
              {fields.map((f) => (
                <div key={f.k}>
                  <div className="precheckin__field-k">{f.k}</div>
                  <div className="precheckin__field-v">{f.v}</div>
                </div>
              ))}
            </div>

            <div className="precheckin__section-title">Documents</div>
            <div className="precheckin__docs">
              <div className={`precheckin__doc ${pc!.id_photo_url ? 'precheckin__doc--on' : ''}`}>
                {pc!.id_photo_url ? 'ID uploaded' : 'ID not uploaded'}
              </div>
              <div className={`precheckin__doc ${pc!.license_photo_url ? 'precheckin__doc--on' : ''}`}>
                {pc!.license_photo_url ? 'Licence uploaded' : 'Licence not uploaded'}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="precheckin__detail-footer">
        <button
          type="button"
          className={`confirm-btn ${confirmed ? 'confirm-btn--checked' : ''}`}
          disabled={!loaded || busy}
          onClick={onConfirm}
        >
          {confirmed ? 'Data confirmed — ready for counter ✓' : 'Confirm data and documents'}
        </button>

        {confirmed && (
          <div className="confirm-row" onClick={() => onUnskip(!pc!.unskip)}>
            <div className={`confirm-row__box ${pc!.unskip ? 'confirm-row__box--checked' : ''}`}>
              {pc!.unskip ? '✓' : ''}
            </div>
            <div>
              <div>{pc!.unskip ? 'Documents and Data shown on the tablet' : 'Skip Documents and Data on the tablet'}</div>
              <div className="field__hint">
                {pc!.unskip ? 'The client asked to review them — 7 steps' : 'Turn on if the client wants to check them — 7 steps'}
              </div>
            </div>
          </div>
        )}

        <div className="field__hint" style={{ textAlign: 'center' }}>
          {confirmed
            ? pc!.unskip
              ? 'The client will confirm their data and documents on the tablet as steps.'
              : 'The counter session opens straight at Vehicle.'
            : loaded
              ? 'Confirming here removes the Documents and Data steps from the client tablet.'
              : 'Available once the driver has loaded their data and documents.'}
        </div>
      </div>
    </>
  );
}
