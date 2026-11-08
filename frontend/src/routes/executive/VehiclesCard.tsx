import { useEffect, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import {
  getVehicleOptions,
  type CheckoutStatusResponse,
  type VehicleOption,
  type VehicleOptionKind,
  type VehicleOptionsResponse,
  type VehicleShortlist,
} from '../../lib/api';

// Room for the pre-assigned car, a couple of alternatives and an upgrade.
const MAX_SHORTLIST = 4;

const SECTION_TITLES: Record<VehicleOptionKind, string> = {
  pre_assigned: 'Pre-assigned to this reservation',
  same_category: 'Reserved category',
  upgrade: 'Upselling options',
};

function clp(n: number): string {
  return `$${n.toLocaleString('de-DE')}`;
}

function matchColor(pct: number): string {
  if (pct >= 90) return 'var(--fp-status-available)';
  if (pct >= 75) return 'var(--fp-status-inprep)';
  return 'var(--fp-secondary)';
}

export function VehiclesCard({
  status,
  clientStep,
  vehicleStep,
  onSent,
}: {
  status: CheckoutStatusResponse;
  /** Index of the wizard step the tablet is showing, and of the Vehicle step. */
  clientStep: number;
  vehicleStep: number;
  onSent: () => void;
}) {
  const pairing = useStationPairing();
  // Only waits on the Rental Details step being confirmed — select-vehicle
  // and vehicle-options enforce this same rule server-side (409
  // otherwise), this is just the matching UI gate.
  const locked = !status.rental_details_confirmed;
  const chosenId = status.vehicle?.id ?? null;

  const [data, setData] = useState<VehicleOptionsResponse | null>(null);
  // null until the first load, which pre-picks the pre-assigned car.
  const [picks, setPicks] = useState<Set<string> | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null follows the default below until the agent opens or closes it.
  const [openChoice, setOpenChoice] = useState<boolean | null>(null);

  // A new customer starts a fresh shortlist.
  const categoryId = status.current_category?.id ?? null;
  const [seenContractId, setSeenContractId] = useState(status.contract_id);
  if (status.contract_id !== seenContractId) {
    setSeenContractId(status.contract_id);
    setData(null);
    setPicks(null);
    setSent(false);
    setError(null);
    setOpenChoice(null);
  }

  // Also refetched when the client picks a car, so the list reflects it
  // (the chosen car stays listed, everything else re-ranks).
  useEffect(() => {
    if (locked) return;
    getVehicleOptions(status.contract_id)
      .then((res) => {
        setData(res);
        setPicks(
          (prev) => prev ?? new Set(res.options.filter((o) => o.kind === 'pre_assigned').map((o) => o.vehicle.id)),
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [locked, status.contract_id, status.branch_id, categoryId, chosenId]);

  const picked = picks ?? new Set<string>();

  const togglePick = (vehicleId: string) => {
    setSent(false);
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(vehicleId)) next.delete(vehicleId);
      else if (next.size < MAX_SHORTLIST) next.add(vehicleId);
      return next;
    });
  };

  const send = () => {
    if (!data || picked.size === 0) return;
    const payload: VehicleShortlist = {
      contract_id: status.contract_id,
      reserved_category: data.reserved_category,
      rental_days: data.rental_days,
      options: data.options.filter((o) => picked.has(o.vehicle.id)),
    };
    pairing.send('candidates_sent', payload as unknown as Record<string, unknown>);
    setSent(true);
    onSent();
  };

  const chosen = data?.options.find((o) => o.vehicle.id === chosenId) ?? null;
  const clientHere = !locked && clientStep === vehicleStep;
  // Folds itself away once the client has picked a car and moved on.
  const done = chosenId !== null && clientStep > vehicleStep;
  const open = !locked && (openChoice ?? !done);
  const sections = (['pre_assigned', 'same_category', 'upgrade'] as const)
    .map((kind) => ({ kind, options: data?.options.filter((o) => o.kind === kind) ?? [] }))
    .filter((s) => s.options.length > 0);

  return (
    <div className={`session-card ${locked ? 'session-card--locked' : ''}`}>
      {/* The whole header toggles on click; the chevron is the keyboard-
          and screen-reader-reachable control for the same thing. */}
      <div
        className={`session-card__head ${locked ? '' : 'session-card__head--toggle'}`}
        onClick={() => !locked && setOpenChoice(!open)}
      >
        {!locked && (
          <button
            type="button"
            className={`session-card__chevron ${open ? 'session-card__chevron--open' : ''}`}
            aria-expanded={open}
            aria-label={open ? 'Collapse candidate vehicles' : 'Expand candidate vehicles'}
            onClick={(e) => {
              e.stopPropagation();
              setOpenChoice(!open);
            }}
          >
            ▸
          </button>
        )}
        <div className={`session-card__badge ${!locked ? (sent || chosen ? 'session-card__badge--done' : 'session-card__badge--active') : ''}`}>
          1
        </div>
        <div className="session-card__title">Candidate Vehicles</div>
        <div className={`session-card__state ${sent || chosen ? 'session-card__state--done' : ''}`}>
          {locked
            ? 'Locked'
            : chosen
              ? `Client chose the ${chosen.vehicle.make} ${chosen.vehicle.model}${chosen.kind === 'upgrade' ? ' (upgrade)' : ''}`
              : sent
                ? 'Sent to tablet'
                : `Shortlist up to ${MAX_SHORTLIST}`}
        </div>
        {clientHere && (
          <div className="client-here-chip">
            <span className="step-track__here-dot" />
            Client is here
          </div>
        )}
        <div className="session-card__spacer" />
        {!open && !locked && <div className="locked-hint">Show options</div>}
        {open && data && (
          <>
            <div className="locked-hint">
              {picked.size} of {MAX_SHORTLIST} selected
            </div>
            <button
              type="button"
              className="btn btn--sm"
              disabled={picked.size === 0}
              onClick={(e) => {
                e.stopPropagation();
                send();
              }}
            >
              {sent ? 'Options on tablet ✓' : 'Send options to client'}
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="session-card__body">
          {error && <div className="field__error">{error}</div>}
          {!data && !error && <div className="locked-hint">Loading candidates…</div>}

          {data && (
            <div className="vehicle-summary">
              Booked <span className="res-table__acriss">{data.reserved_category.code}</span>
              {data.reserved_category.name} · {clp(data.reserved_category.base_daily_rate)}/day · {data.rental_days}{' '}
              {data.rental_days === 1 ? 'day' : 'days'}
            </div>
          )}
          {data && data.options.length === 0 && (
            <div className="locked-hint">No vehicles in this category or above at this branch right now.</div>
          )}

          {sections.map(({ kind, options }) => (
            <div key={kind} className="vehicle-section">
              <div className={`vehicle-section__title ${kind === 'upgrade' ? 'vehicle-section__title--upgrade' : ''}`}>
                {SECTION_TITLES[kind]}
                {kind === 'same_category' && data && ` · ${data.reserved_category.code} ${data.reserved_category.name}`}
              </div>
              {options.map((o) => (
                <VehicleRow
                  key={o.vehicle.id}
                  option={o}
                  rentalDays={data?.rental_days ?? 1}
                  picked={picked.has(o.vehicle.id)}
                  chosenByClient={o.vehicle.id === chosenId}
                  onToggle={() => togglePick(o.vehicle.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VehicleRow({
  option: o,
  rentalDays,
  picked,
  chosenByClient,
  onToggle,
}: {
  option: VehicleOption;
  rentalDays: number;
  picked: boolean;
  chosenByClient: boolean;
  onToggle: () => void;
}) {
  const f = o.category.features;
  const toService = Math.max(o.vehicle.next_service_km - o.vehicle.current_km, 0);
  const b = o.score_breakdown;
  const why = [
    `Transmission ${b.transmission_match}`,
    `Low mileage ${b.low_mileage}`,
    `Service headroom ${b.service_headroom}`,
    `Damage ${b.damage_penalty}`,
  ].join(' · ');

  return (
    <div
      className={`vehicle-row ${picked ? 'vehicle-row--picked' : ''} ${o.kind === 'upgrade' ? 'vehicle-row--upgrade' : ''}`}
      onClick={onToggle}
    >
      <div className={`vehicle-row__box ${picked ? 'vehicle-row__box--picked' : ''}`}>{picked ? '✓' : ''}</div>
      <div
        className="vehicle-row__photo"
        style={o.vehicle.main_photo_url ? { backgroundImage: `url(${o.vehicle.main_photo_url})` } : undefined}
      />
      <div>
        <div className="vehicle-row__model">
          {o.vehicle.make} {o.vehicle.model}
        </div>
        <div className="vehicle-row__tags">
          <span className="vehicle-row__plate">{o.vehicle.plate}</span>
          <span className="vehicle-row__sub">{o.vehicle.year}</span>
          {o.kind === 'pre_assigned' && <span className="vehicle-tag vehicle-tag--preassigned">Pre-assigned</span>}
          {o.kind === 'upgrade' && <span className="res-table__acriss">{o.category.code}</span>}
          {chosenByClient && <span className="vehicle-tag vehicle-tag--chosen">Client's choice</span>}
        </div>
      </div>
      <div>
        <div>
          {f.transmission === 'automatic' ? 'Automatic' : 'Manual'} · {f.passenger_capacity} seats
        </div>
        <div className="vehicle-row__sub">
          {f.trunk_capacity_l} L trunk{f.bluetooth ? ' · Bluetooth' : ''}
          {f.air_conditioning ? ' · A/C' : ''}
        </div>
      </div>
      <div>
        <div>{o.vehicle.current_km.toLocaleString('de-DE')} km</div>
        <div className="vehicle-row__sub">
          {toService.toLocaleString('de-DE')} km to service
          {o.vehicle.damage_count > 0 && ` · ${o.vehicle.damage_count} damage${o.vehicle.damage_count > 1 ? 's' : ''}`}
        </div>
      </div>
      <div>
        <span className={`prep-chip ${o.ready ? 'prep-chip--ready' : 'prep-chip--inprep'}`}>
          {o.ready ? 'Prepared' : 'In preparation'}
        </span>
      </div>
      <div className="score-bar" title={why}>
        <div className="score-bar__rank">#{o.rank}</div>
        <div className="score-bar__track">
          <div className="score-bar__fill" style={{ width: `${o.match_pct}%`, background: matchColor(o.match_pct) }} />
        </div>
        <div className="score-bar__value" style={{ color: matchColor(o.match_pct) }}>
          {o.match_pct}%
        </div>
      </div>
      <div className="vehicle-row__price">
        {o.kind === 'upgrade' ? (
          <>
            <div className="vehicle-row__extra">+{clp(o.extra_daily_rate)}/day</div>
            <div className="vehicle-row__sub">+{clp(o.extra_daily_rate * rentalDays)} total</div>
          </>
        ) : (
          <div className="vehicle-row__sub">Included</div>
        )}
      </div>
    </div>
  );
}
