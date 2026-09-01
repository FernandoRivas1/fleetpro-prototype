"""Customer loyalty tiers (Executive Main design's "commercial conditions"
banner) and what each one actually changes in the checkout flow.

A tier is assigned by the business ahead of time (see seed.py) — there's
no loyalty-program management UI here, same "out of scope" spirit as
CLAUDE.md's other CRM-adjacent exclusions. Nothing in this app lets an
executive or a driver set a tier; it only ever comes from the Driver row
already on file.

What's real vs. informational, and why:
  - Deposit terms (waived for Gold, halved for Silver) are enforced —
    see deposit_terms(), used by flow.py's select_vehicle (Gold's
    auto-waive) and authorize_deposit (Silver's reduced amount).
  - Free extras are enforced — see FREE_EXTRAS, used by flow.py's
    set_extras. STUB: matched by the seeded Extra's `name` (there's no
    a stable extra "kind" to match on instead — see shared/models.py),
    so renaming an extra in seed.py silently drops the perk.
  - The discount percentage is informational only. This prototype has no
    quoting/pricing engine at all (CLAUDE.md's "Out of scope: Quoting")
    to apply a discount to — every price shown anywhere in the app
    (ACRISSCategory.base_daily_rate, an upsell's price difference) is
    already the executive's number to read out loud, not something this
    app charges or invoices. So the discount is surfaced as text in the
    conditions list for the executive to apply manually, not deducted
    from any figure the backend computes.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.checkout.models import DEPOSIT_AMOUNT_CLP, Driver
from app.shared.enums import CustomerTier, DepositMechanism

router = APIRouter(prefix="/api/v1/checkout/tiers", tags=["checkout", "tiers"])


class TierCondition(BaseModel):
    text: str
    value: str


class TierInfo(BaseModel):
    tier: CustomerTier
    conditions: list[TierCondition]


_CONDITIONS: dict[CustomerTier, list[TierCondition]] = {
    CustomerTier.GOLD: [
        TierCondition(text="Gold rate discount on base tariff", value="-15%"),
        TierCondition(text="Security deposit", value="Waived"),
        TierCondition(text="Additional driver + child seat", value="Free"),
    ],
    CustomerTier.SILVER: [
        TierCondition(text="Silver rate discount on base tariff", value="-8%"),
        TierCondition(text="Security deposit", value="-50%"),
        TierCondition(text="Additional driver", value="Free"),
    ],
    CustomerTier.CORPORATE: [
        TierCondition(text="Corporate agreement rate", value="-22%"),
        TierCondition(text="Full insurance coverage", value="Free"),
    ],
    CustomerTier.STANDARD: [
        TierCondition(text="Standard published tariff", value="Base"),
    ],
}

# Matched against Extra.name at set-extras time (flow.py) — see the STUB
# note above. Names must match seed.py's seed_extras() exactly.
FREE_EXTRAS: dict[CustomerTier, frozenset[str]] = {
    CustomerTier.GOLD: frozenset({"Additional Driver", "Child Seat"}),
    CustomerTier.SILVER: frozenset({"Additional Driver"}),
    CustomerTier.CORPORATE: frozenset({"Full Insurance"}),
    CustomerTier.STANDARD: frozenset(),
}


def conditions_for(tier: CustomerTier) -> list[TierCondition]:
    return _CONDITIONS[tier]


def all_tier_info() -> list[TierInfo]:
    return [TierInfo(tier=tier, conditions=conditions) for tier, conditions in _CONDITIONS.items()]


@router.get("", response_model=list[TierInfo])
def list_tiers() -> list[TierInfo]:
    """So the frontend renders the conditions banner from one source of
    truth instead of duplicating this copy — see WalkInTab.tsx."""
    return all_tier_info()


def deposit_terms(driver: Driver) -> tuple[float, DepositMechanism | None]:
    """(amount, forced_mechanism) for this driver's tier.

    forced_mechanism is WAIVED for Gold: wherever a Deposit row gets
    created for this driver, it should be authorized immediately at $0
    regardless of how it would otherwise have been collected. None means
    "no override" — the caller's own mechanism (online prepayment,
    in-person) applies, just at this tier-adjusted amount.
    """
    if driver.tier is CustomerTier.GOLD:
        return 0.0, DepositMechanism.WAIVED
    if driver.tier is CustomerTier.SILVER:
        return DEPOSIT_AMOUNT_CLP * 0.5, None
    return float(DEPOSIT_AMOUNT_CLP), None


def free_extra_names(driver: Driver) -> frozenset[str]:
    return FREE_EXTRAS.get(driver.tier, frozenset())
