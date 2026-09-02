import { useEffect, useState } from 'react';
import {
  confirmRentalDetails,
  getRentalDetails,
  listAcrissCategories,
  listBranches,
  type ACRISSCategoryRead,
  type BranchRead,
  type CheckoutStatusResponse,
  type RentalDetailsResponse,
} from '../../lib/api';
import { rentalDetailsStrings, type Lang } from './strings';
import type { WizardStep } from './ClientShell';

/** Splits an ISO datetime into the `<input type="date">` / `type="time">`
 * value pairs those controls expect, and back again — see toIso below. */
function splitIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function toIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function RentalDetailsStep({
  status,
  contractId,
  lang,
  refreshStatus,
  goTo,
}: {
  status: CheckoutStatusResponse;
  contractId: string;
  lang: Lang;
  refreshStatus: () => Promise<void>;
  goTo: (step: WizardStep) => void;
}) {
  const t = rentalDetailsStrings[lang];
  const walkin = status.origin === 'walk_in';

  const [details, setDetails] = useState<RentalDetailsResponse | null>(null);
  const [branches, setBranches] = useState<BranchRead[]>([]);
  const [categories, setCategories] = useState<ACRISSCategoryRead[]>([]);
  const [pickupBranchId, setPickupBranchId] = useState('');
  const [returnBranchId, setReturnBranchId] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [pickupTime, setPickupTime] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [returnTime, setReturnTime] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [confirmedNow, setConfirmedNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getRentalDetails(contractId), listBranches(), listAcrissCategories()])
      .then(([res, branchList, categoryList]) => {
        setDetails(res);
        setBranches(branchList);
        setCategories(categoryList);
        const pu = splitIso(res.pickup_date);
        const ret = splitIso(res.return_date);
        setPickupBranchId(res.pickup_branch.id);
        setReturnBranchId(res.return_branch.id);
        setPickupDate(pu.date);
        setPickupTime(pu.time);
        setReturnDate(ret.date);
        setReturnTime(ret.time);
        setCategoryId(res.category?.id ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [contractId]);

  const pickupIso = toIso(pickupDate, pickupTime);
  const returnIso = toIso(returnDate, returnTime);
  const validDates = !!(pickupIso && returnIso && returnIso > pickupIso);
  const days = validDates ? Math.max(1, Math.ceil((Date.parse(returnIso!) - Date.parse(pickupIso!)) / 86_400_000)) : null;
  const ready = validDates && !!categoryId;

  const mark = () => setConfirmedNow(false);

  const submit = async () => {
    if (!ready || !pickupIso || !returnIso || !categoryId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await confirmRentalDetails(contractId, {
        pickup_branch_id: pickupBranchId,
        return_branch_id: returnBranchId,
        pickup_date: pickupIso,
        return_date: returnIso,
        acriss_category_id: categoryId,
      });
      setDetails(res);
      setConfirmedNow(true);
      await refreshStatus();
      goTo('vehicle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!details) {
    return (
      <main className="client-main" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="scan-slot__spinner" />
      </main>
    );
  }

  const leg = (
    key: 'pickup' | 'return',
    mark_: '↑' | '↓',
    heading: string,
    branchId: string,
    setBranchId: (v: string) => void,
    date: string,
    setDate: (v: string) => void,
    time: string,
    setTime: (v: string) => void,
  ) => (
    <div className="rental-leg" key={key}>
      <div className="rental-leg__head">
        <div className="rental-leg__mark">{mark_}</div>
        <div className="rental-leg__heading">{heading}</div>
      </div>
      <label className="data-field">
        <div className="data-field__label-row">
          <div className="data-field__label">{t.branch}</div>
        </div>
        <select
          value={branchId}
          onChange={(e) => {
            setBranchId(e.target.value);
            mark();
          }}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <div className="rental-leg__datetime">
        <label className="data-field">
          <div className="data-field__label-row">
            <div className="data-field__label">{t.date}</div>
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              mark();
            }}
          />
        </label>
        <label className="data-field">
          <div className="data-field__label-row">
            <div className="data-field__label">{t.time}</div>
          </div>
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              mark();
            }}
          />
        </label>
      </div>
    </div>
  );

  const statusText = !validDates
    ? t.needsDates
    : !categoryId
      ? t.needsCategory
      : confirmedNow
        ? t.confirmed
        : t.idle;

  return (
    <main className="client-main">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
        <div>
          <h1>{t.title}</h1>
          <p className="subtitle">{walkin ? t.noteWalkin : t.noteReservation}</p>
        </div>
        <div className="rental-source-chip">{walkin ? t.chipWalkin : details.reservation_code}</div>
      </div>

      {error && <div className="data-field__note">{error}</div>}

      <div className="rental-legs">
        {leg('pickup', '↑', t.pickup, pickupBranchId, setPickupBranchId, pickupDate, setPickupDate, pickupTime, setPickupTime)}
        {leg('return', '↓', t.dropoff, returnBranchId, setReturnBranchId, returnDate, setReturnDate, returnTime, setReturnTime)}
      </div>

      <div className="rental-bottom-row">
        <div className="rental-groups">
          <div className="data-field__label">{t.groupLabel}</div>
          <div className="rental-groups__grid">
            {categories.map((c) => {
              const on = c.id === categoryId;
              return (
                <button
                  type="button"
                  key={c.id}
                  className={`rental-group-btn ${on ? 'rental-group-btn--active' : ''}`}
                  onClick={() => {
                    setCategoryId(c.id);
                    mark();
                  }}
                >
                  <div className="rental-group-btn__code">{c.code}</div>
                  <div className="rental-group-btn__name">{c.name}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rental-duration">
          <div className="rental-duration__label">{t.durationLabel}</div>
          <div className="rental-duration__value">{days === null ? '—' : t.days(days)}</div>
          <div className="rental-duration__sub">{t.durationSub}</div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <footer className="client-footer">
        <button type="button" className="client-btn--ghost" onClick={() => goTo('rentalDetails')}>
          {t.back}
        </button>
        <div className={`client-status ${confirmedNow ? 'client-status--ok' : ''}`}>{statusText}</div>
        <button type="button" className="client-btn" disabled={!ready || submitting} onClick={submit}>
          {submitting ? '…' : t.cta}
        </button>
      </footer>
    </main>
  );
}
