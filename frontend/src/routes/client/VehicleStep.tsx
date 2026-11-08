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

/** Feature chips for a car; on an upgrade, what it adds over the booked
 * category is called out (accented) first. */
function featureTags(f: ACRISSFeatures, booked: ACRISSFeatures, isUpgrade: boolean, t: Strings) {
  const tags: { text: string; gain: boolean }[] = [];
  const seats = f.passenger_capacity - booked.passenger_capacity;
  const trunk = f.trunk_capacity_l - booked.trunk_capacity_l;
  const gainedAuto = isUpgrade && f.transmission === 'automatic' && booked.transmission !== 'automatic';
  const gainedBluetooth = isUpgrade && f.bluetooth && !booked.bluetooth;

  if (gainedAuto) tags.push({ text: t.automatic, gain: true });
  if (isUpgrade && seats > 0) tags.push({ text: t.moreSeats(seats), gain: true });
  if (isUpgrade && trunk > 0) tags.push({ text: t.moreTrunk(trunk), gain: true });
  if (gainedBluetooth) tags.push({ text: t.bluetooth, gain: true });

  if (!gainedAuto) tags.push({ text: f.transmission === 'automatic' ? t.automatic : t.manual, gain: false });
  if (!(isUpgrade && seats > 0)) tags.push({ text: t.seats(f.passenger_capacity), gain: false });
  if (!(isUpgrade && trunk > 0)) tags.push({ text: t.trunk(f.trunk_capacity_l), gain: false });
  if (f.bluetooth && !gainedBluetooth) tags.push({ text: t.bluetooth, gain: false });
  return tags;
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
  return (
    <div
      className={`car-card ${picked ? 'car-card--chosen' : ''} ${isUpgrade ? 'car-card--upgrade' : ''}`}
      onClick={onPick}
    >
      {o.kind === 'pre_assigned' && <div className="car-card__ribbon">{t.reservedForYou}</div>}
      {isUpgrade && <div className="car-card__ribbon car-card__ribbon--upgrade">★ {t.upgrade}</div>}
      {picked && <div className="car-card__check">✓</div>}
      <div className="car-card__photo-wrap">
        <div className="car-card__photo" style={v.main_photo_url ? { backgroundImage: `url(${v.main_photo_url})` } : undefined} />
        <div className={`car-card__prep ${o.ready ? 'car-card__prep--ready' : 'car-card__prep--inprep'}`}>
          {o.ready ? t.readyNow : t.beingPrepared}
        </div>
      </div>
      <div className="car-card__body">
        <div className="car-card__model">
          {v.make} {v.model}
        </div>
        <div className="car-card__category">
          {o.category.name} · {v.year}
        </div>
        <div className="car-card__tags">
          {featureTags(o.category.features, shortlist.reserved_category.features, isUpgrade, t).map((tag) => (
            <span key={tag.text} className={`car-card__tag ${tag.gain ? 'car-card__tag--gain' : ''}`}>
              {tag.text}
            </span>
          ))}
        </div>
        <div className="car-card__match">
          <div className="car-card__match-track">
            <div className="car-card__match-fill" style={{ width: `${o.match_pct}%` }} />
          </div>
          <span>{t.match(o.match_pct)}</span>
        </div>
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
