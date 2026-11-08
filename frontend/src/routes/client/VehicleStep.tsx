import { useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import {
  selectVehicle,
  type ACRISSFeatures,
  type CheckoutStatusResponse,
  type VehicleOption,
  type VehicleShortlist,
} from '../../lib/api';
import { vehicleStrings, type Lang } from './strings';
import type { WizardStep } from './ClientShell';

type Strings = (typeof vehicleStrings)['en'];

function clp(n: number): string {
  return `$${n.toLocaleString('de-DE')}`;
}

interface SpecRow {
  label: string;
  value: string;
  /** What an upgrade adds over the booked category, e.g. "+1" or "New". */
  gain: string | null;
}

/** The same spec rows, in the same order, on every card so they line up
 * side by side; on an upgrade, the rows that beat the booking are flagged. */
function specRows(f: ACRISSFeatures, booked: ACRISSFeatures, isUpgrade: boolean, t: Strings): SpecRow[] {
  const seats = f.passenger_capacity - booked.passenger_capacity;
  const trunk = f.trunk_capacity_l - booked.trunk_capacity_l;
  const gained = (has: boolean, bookedHas: boolean) => (isUpgrade && has && !bookedHas ? t.newFeature : null);
  return [
    {
      label: t.specTransmission,
      value: f.transmission === 'automatic' ? t.automatic : t.manual,
      gain: gained(f.transmission === 'automatic', booked.transmission === 'automatic'),
    },
    { label: t.specSeats, value: String(f.passenger_capacity), gain: isUpgrade && seats > 0 ? `+${seats}` : null },
    { label: t.specTrunk, value: `${f.trunk_capacity_l} L`, gain: isUpgrade && trunk > 0 ? `+${trunk} L` : null },
    { label: t.bluetooth, value: f.bluetooth ? t.yes : '—', gain: gained(f.bluetooth, booked.bluetooth) },
    { label: t.specAirCon, value: f.air_conditioning ? t.yes : '—', gain: gained(f.air_conditioning, booked.air_conditioning) },
  ];
}

export function VehicleStep({
  status,
  contractId,
  lang,
  refreshStatus,
  goTo,
  shortlist,
}: {
  status: CheckoutStatusResponse;
  contractId: string;
  lang: Lang;
  refreshStatus: () => Promise<void>;
  goTo: (step: WizardStep) => void;
  shortlist: VehicleShortlist | null;
}) {
  const pairing = useStationPairing();
  const t = vehicleStrings[lang];
  const options = shortlist?.options ?? null;
  // The pre-assigned car starts chosen, so a client happy with it just
  // taps Continue; otherwise whatever they chose before (reload resume).
  const [pick, setPick] = useState<string | null>(
    () => status.vehicle?.id ?? options?.find((o) => o.kind === 'pre_assigned')?.vehicle.id ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The shortlist can arrive after this screen mounts.
  const [seenShortlist, setSeenShortlist] = useState(shortlist);
  if (shortlist !== seenShortlist) {
    setSeenShortlist(shortlist);
    if (pick === null || !shortlist?.options.some((o) => o.vehicle.id === pick)) {
      setPick(shortlist?.options.find((o) => o.kind === 'pre_assigned')?.vehicle.id ?? null);
    }
  }

  const chosen = options?.find((o) => o.vehicle.id === pick) ?? null;

  const submit = async () => {
    if (!pick) return;
    setSubmitting(true);
    setError(null);
    try {
      await selectVehicle(contractId, pick);
      pairing.send('vehicle_selected', { contract_id: contractId, vehicle_id: pick });
      await refreshStatus();
      goTo('extras');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const booked = shortlist?.reserved_category ?? status.current_category;

  return (
    <main className="client-main">
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <h1>{t.title}</h1>
          {booked && <span className="res-table__acriss">{booked.code}</span>}
        </div>
        {shortlist && <div className="subtitle">{t.subtitle(shortlist.reserved_category.name, shortlist.rental_days)}</div>}
      </div>

      {options === null || !shortlist ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fp-text-muted)', fontSize: 20 }}>
          {t.waiting}
        </div>
      ) : (
        <div className={`car-grid car-grid--n${Math.min(options.length, 4)}`}>
          {options.map((o) => (
            <CarCard
              key={o.vehicle.id}
              option={o}
              shortlist={shortlist}
              picked={o.vehicle.id === pick}
              onPick={() => setPick(o.vehicle.id)}
              t={t}
            />
          ))}
        </div>
      )}

      {error && <div className="data-field__note">{error}</div>}

      <div style={{ flex: 1 }} />

      <footer className="client-footer">
        <button type="button" className="client-btn--ghost" onClick={() => goTo('rentalDetails')}>
          {t.back}
        </button>
        <div className="client-status">
          {chosen
            ? `${t.youChose(`${chosen.vehicle.make} ${chosen.vehicle.model}`, chosen.vehicle.plate)}${
                chosen.kind === 'upgrade' ? ` · +${clp(chosen.extra_daily_rate)}${t.perDay}` : ''
              }`
            : t.tapToChoose}
        </div>
        <button type="button" className="client-btn" disabled={!pick || submitting} onClick={submit}>
          {t.continue}
        </button>
      </footer>
    </main>
  );
}

function CarCard({
  option: o,
  shortlist,
  picked,
  onPick,
  t,
}: {
  option: VehicleOption;
  shortlist: VehicleShortlist;
  picked: boolean;
  onPick: () => void;
  t: Strings;
}) {
  const isUpgrade = o.kind === 'upgrade';
  const v = o.vehicle;
  const rows = specRows(o.category.features, shortlist.reserved_category.features, isUpgrade, t);
  const gains = rows.filter((r) => r.gain).length;
  return (
    <div
      className={`car-card ${picked ? 'car-card--chosen' : ''} ${isUpgrade ? 'car-card--upgrade' : ''}`}
      onClick={onPick}
    >
      {o.kind === 'pre_assigned' && <div className="car-card__ribbon">{t.reservedForYou}</div>}
      {isUpgrade && <div className="car-card__ribbon car-card__ribbon--upgrade">★ {t.upgrade}</div>}
      {picked && <div className="car-card__check">✓</div>}
      <div className="car-card__photo" style={v.main_photo_url ? { backgroundImage: `url(${v.main_photo_url})` } : undefined} />
      <div className="car-card__body">
        <div className="car-card__model">
          {v.make} {v.model}
        </div>
        <div className="car-card__category">
          {o.category.name} · {v.year}
        </div>
        <div className="car-card__specs">
          {rows.map((row) => (
            <div key={row.label} className={`car-card__spec ${row.gain ? 'car-card__spec--gain' : ''}`}>
              <span className="car-card__spec-label">{row.label}</span>
              <span className="car-card__spec-value">
                {row.value}
                {row.gain && <span className="car-card__spec-gain">▲ {row.gain}</span>}
              </span>
            </div>
          ))}
        </div>
        {isUpgrade && gains > 0 && <div className="car-card__gain-note">{t.betterThanBooking(gains)}</div>}
        {isUpgrade ? (
          <div>
            <div className="car-card__price-big">
              +{clp(o.extra_daily_rate)}
              <small>{t.perDay}</small>
            </div>
            <div className="car-card__price">
              {t.forTheRental(`+${clp(o.extra_daily_rate * shortlist.rental_days)}`, shortlist.rental_days)}
            </div>
          </div>
        ) : (
          <div className="car-card__price">{t.included}</div>
        )}
        <button type="button" className="car-card__btn" onClick={onPick}>
          {picked ? t.chosen : isUpgrade ? t.chooseUpgrade : t.choose}
        </button>
      </div>
    </div>
  );
}
