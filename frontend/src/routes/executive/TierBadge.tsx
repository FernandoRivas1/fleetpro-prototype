import type { CustomerTier, TierCondition } from '../../lib/api';

const TIER_CLASS: Record<CustomerTier, string> = {
  Standard: 'tier-badge--standard',
  Silver: 'tier-badge--silver',
  Gold: 'tier-badge--gold',
  Corporate: 'tier-badge--corporate',
};

/** Design file: Executive Main.dc.html's tier chip, used wherever a
 * driver's loyalty tier needs a small visual marker (walk-in lookup,
 * active session header). See app/checkout/tiers.py for what a tier
 * actually changes. */
export function TierBadge({ tier }: { tier: CustomerTier }) {
  return <span className={`tier-badge ${TIER_CLASS[tier]}`}>{tier}</span>;
}

/** The "commercial conditions applied" box (Executive Main design) — the
 * discount line is informational (see tiers.py's module docstring); the
 * deposit and free-extras lines are enforced by the backend wherever the
 * deposit/extras are actually set. */
export function TierConditions({ tier, conditions }: { tier: CustomerTier; conditions: TierCondition[] }) {
  return (
    <div className="tier-conditions">
      <div className="tier-conditions__title">
        <div className="tier-conditions__dot" />
        <div>{tier} conditions applied to this contract</div>
      </div>
      {conditions.map((c) => (
        <div className="tier-conditions__row" key={c.text}>
          <div className="tier-conditions__row-dot" />
          <div>{c.text}</div>
          <div style={{ flex: 1 }} />
          <div className="tier-conditions__value">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
