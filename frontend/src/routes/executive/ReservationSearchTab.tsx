import { useEffect, useMemo, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import {
  confirmPrecheckin,
  listAcrissCategories,
  listPrecheckinQueue,
  remindPrecheckin,
  requestPrecheckin,
  startCheckoutFromReservation,
  type ACRISSCategoryRead,
  type PrecheckinQueueItem,
} from '../../lib/api';
import { TierBadge } from './TierBadge';

/** Design file: Executive Main.dc.html's reservation search table — code,
 * driver (+ tier), pick-up, return, category, a data-validation status
 * column (DATA_STATES) and the start-check-out action. The design's grid
 * also carries a branch column and a per-row plate/vehicle chip; both are
 * left out here — branch is redundant (this table is already scoped to one
 * branch, see CLAUDE.md's multi-branch switching note) and a bare
 * Reservation has no vehicle assigned yet, so there's no plate to show
 * pre-checkout. */

type SortKey = 'code' | 'driver' | 'pickup' | 'return' | 'category';
type DataStatus = 'none' | 'requested' | 'loaded' | 'confirmed';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}
function daysBetween(a: string, b: string): string {
  const n = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

function statusOf(item: PrecheckinQueueItem): DataStatus {
  return item.precheckin?.status ?? 'none';
}

const STATUS_LABEL: Record<DataStatus, string> = {
  none: 'Not requested',
  requested: 'Requested',
  loaded: 'Loaded',
  confirmed: 'Confirmed',
};

export function ReservationSearchTab({
  branchId,
  onSessionStart,
}: {
  branchId: string;
  onSessionStart: (contractId: string) => void;
}) {
  const pairing = useStationPairing();
  const [items, setItems] = useState<PrecheckinQueueItem[] | null>(null);
  const [categories, setCategories] = useState<ACRISSCategoryRead[]>([]);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('pickup');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [starting, setStarting] = useState<string | null>(null);
  const [dataBusyId, setDataBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () =>
    listPrecheckinQueue(branchId)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    setItems(null);
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

  const rows = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    let rs = items.filter(({ reservation: r }) => {
      if (!q) return true;
      return `${r.code} ${r.driver_first_name} ${r.driver_last_name} ${r.driver_email}`.toLowerCase().includes(q);
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    rs = rs.slice().sort((a, b) => {
      let av: string, bv: string;
      switch (sortKey) {
        case 'code':
          av = a.reservation.code;
          bv = b.reservation.code;
          break;
        case 'driver':
          av = a.reservation.driver_first_name + a.reservation.driver_last_name;
          bv = b.reservation.driver_first_name + b.reservation.driver_last_name;
          break;
        case 'return':
          av = a.reservation.return_date;
          bv = b.reservation.return_date;
          break;
        case 'category':
          av = categoryById.get(a.reservation.acriss_category_id)?.code ?? '';
          bv = categoryById.get(b.reservation.acriss_category_id)?.code ?? '';
          break;
        default:
          av = a.reservation.pickup_date;
          bv = b.reservation.pickup_date;
      }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return rs;
  }, [items, query, sortKey, sortDir, categoryById]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const start = async (reservationId: string) => {
    if (!pairing.stationId) return;
    setStarting(reservationId);
    setError(null);
    try {
      const res = await startCheckoutFromReservation(pairing.stationId, reservationId);
      onSessionStart(res.contract_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(null);
    }
  };

  const runDataAction = (item: PrecheckinQueueItem) => {
    const st = statusOf(item);
    if (st === 'confirmed') return;
    setDataBusyId(item.reservation.id);
    setError(null);
    const call =
      st === 'none'
        ? requestPrecheckin(item.reservation.id, item.reservation.driver_email)
        : st === 'requested'
          ? remindPrecheckin(item.reservation.id)
          : confirmPrecheckin(item.reservation.id);
    call
      .then(() => {
        setToast(
          st === 'none'
            ? `Pre check-in link generated for ${item.reservation.driver_first_name} ${item.reservation.driver_last_name}`
            : st === 'requested'
              ? `Reminder logged for ${item.reservation.driver_email}`
              : `${item.reservation.driver_first_name} validated · ready for the counter`,
        );
        return refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setDataBusyId(null));
  };

  const columns: { key: SortKey; label: string }[] = [
    { key: 'code', label: 'Code' },
    { key: 'driver', label: 'Driver' },
    { key: 'pickup', label: 'Pick-up' },
    { key: 'return', label: 'Return' },
    { key: 'category', label: 'Vehicle' },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="search-toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by code, driver name or email"
        />
        <div style={{ flex: 1 }} />
        <div className="search-count">
          {rows.length} {rows.length === 1 ? 'reservation' : 'reservations'}
        </div>
      </div>

      {error && <div className="field__error">{error}</div>}

      <div className="res-table">
        <div className="res-table__head">
          <div className="res-table__row res-table__row--search">
            {columns.map((c) => (
              <button key={c.key} type="button" className="res-table__head-cell" onClick={() => toggleSort(c.key)}>
                {c.label} {sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
              </button>
            ))}
            <div className="res-table__head-cell">Data</div>
            <div />
          </div>
        </div>

        <div className="res-table__body">
          {items === null && <div className="res-table__empty">Loading…</div>}
          {items !== null && rows.length === 0 && (
            <div className="res-table__empty">
              {query ? `No reservation matches "${query}"` : 'No reservations at this branch right now'}
            </div>
          )}
          {rows.map((item) => {
            const r = item.reservation;
            const cat = categoryById.get(r.acriss_category_id);
            const st = statusOf(item);
            return (
              <div className="res-table__row res-table__row--search" key={r.id}>
                <div className="mono res-table__code">{r.code}</div>
                <div>
                  <div className="res-table__driver">
                    {r.driver_first_name} {r.driver_last_name}
                    {r.driver_tier && (
                      <>
                        {' '}
                        <TierBadge tier={r.driver_tier} />
                      </>
                    )}
                  </div>
                  <div className="res-table__email">{r.driver_email}</div>
                </div>
                <div>
                  <div className="res-table__date">{fmtDate(r.pickup_date)}</div>
                  <div className="res-table__time">{fmtTime(r.pickup_date)}</div>
                </div>
                <div>
                  <div className="res-table__date">{fmtDate(r.return_date)}</div>
                  <div className="res-table__time">
                    {fmtTime(r.return_date)} · {daysBetween(r.pickup_date, r.return_date)}
                  </div>
                </div>
                <div>
                  {cat && <span className="res-table__acriss">{cat.code}</span>}
                  <span className="res-table__sub">{cat?.name ?? ''}</span>
                </div>
                <div className="precheckin__status">
                  <div className={`precheckin__dot precheckin__dot--${st}`} />
                  <div>
                    <div className={`precheckin__status-label precheckin__status-label--${st}`}>{STATUS_LABEL[st]}</div>
                    {st !== 'confirmed' && (
                      <button
                        type="button"
                        className="res-table__data-cta"
                        disabled={dataBusyId === r.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          runDataAction(item);
                        }}
                      >
                        {dataBusyId === r.id
                          ? 'Working…'
                          : st === 'none'
                            ? 'Request data'
                            : st === 'requested'
                              ? 'Remind'
                              : 'Validate'}
                      </button>
                    )}
                  </div>
                </div>
                <button type="button" className="btn btn--sm" disabled={starting === r.id} onClick={() => start(r.id)}>
                  {starting === r.id ? 'Starting…' : 'Start Check-out'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
