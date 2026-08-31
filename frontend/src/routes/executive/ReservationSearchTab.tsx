import { useEffect, useMemo, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import {
  listAcrissCategories,
  listReservations,
  startCheckoutFromReservation,
  type ACRISSCategoryRead,
  type ReservationRead,
} from '../../lib/api';

type SortKey = 'driver' | 'pickup' | 'return' | 'category';

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

export function ReservationSearchTab({
  branchId,
  onSessionStart,
}: {
  branchId: string;
  onSessionStart: (contractId: string) => void;
}) {
  const pairing = useStationPairing();
  const [reservations, setReservations] = useState<ReservationRead[] | null>(null);
  const [categories, setCategories] = useState<ACRISSCategoryRead[]>([]);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('pickup');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReservations(null);
    listReservations(branchId)
      .then(setReservations)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [branchId]);

  useEffect(() => {
    listAcrissCategories().then(setCategories).catch(console.error);
  }, []);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const rows = useMemo(() => {
    if (!reservations) return [];
    const q = query.trim().toLowerCase();
    let rs = reservations.filter(
      (r) => !q || `${r.driver_first_name} ${r.driver_last_name} ${r.driver_email}`.toLowerCase().includes(q),
    );
    const dir = sortDir === 'asc' ? 1 : -1;
    rs = rs.slice().sort((a, b) => {
      let av: string, bv: string;
      switch (sortKey) {
        case 'driver':
          av = a.driver_first_name + a.driver_last_name;
          bv = b.driver_first_name + b.driver_last_name;
          break;
        case 'return':
          av = a.return_date;
          bv = b.return_date;
          break;
        case 'category':
          av = categoryById.get(a.acriss_category_id)?.code ?? '';
          bv = categoryById.get(b.acriss_category_id)?.code ?? '';
          break;
        default:
          av = a.pickup_date;
          bv = b.pickup_date;
      }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return rs;
  }, [reservations, query, sortKey, sortDir, categoryById]);

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

  const columns: { key: SortKey; label: string }[] = [
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
          placeholder="Search by driver name or email"
        />
        <div style={{ flex: 1 }} />
        <div className="search-count">
          {rows.length} {rows.length === 1 ? 'reservation' : 'reservations'}
        </div>
      </div>

      {error && <div className="field__error">{error}</div>}

      <div className="res-table">
        <div className="res-table__head">
          <div className="res-table__row">
            {columns.map((c) => (
              <button key={c.key} type="button" className="res-table__head-cell" onClick={() => toggleSort(c.key)}>
                {c.label} {sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
              </button>
            ))}
            <div />
          </div>
        </div>

        <div className="res-table__body">
          {reservations === null && <div className="res-table__empty">Loading…</div>}
          {reservations !== null && rows.length === 0 && (
            <div className="res-table__empty">
              {query ? `No reservation matches "${query}"` : 'No reservations at this branch right now'}
            </div>
          )}
          {rows.map((r) => {
            const cat = categoryById.get(r.acriss_category_id);
            return (
              <div className="res-table__row" key={r.id}>
                <div>
                  <div className="res-table__driver">
                    {r.driver_first_name} {r.driver_last_name}
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
                <button type="button" className="btn btn--sm" disabled={starting === r.id} onClick={() => start(r.id)}>
                  {starting === r.id ? 'Starting…' : 'Start Check-out'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
