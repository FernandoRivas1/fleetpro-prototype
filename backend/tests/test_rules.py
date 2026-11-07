"""Unit tests for the pure business rules: no database, no HTTP."""
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.checkout import tiers
from app.checkout.models import DEPOSIT_AMOUNT_CLP, Driver
from app.config import Settings
from app.fleet import ranking
from app.shared.enums import CustomerTier, DepositMechanism, TransmissionType


def _vehicle(current_km: int, next_service_km: int) -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), current_km=current_km, next_service_km=next_service_km)


# --- Loyalty tiers -----------------------------------------------------------


@pytest.mark.parametrize(
    ("tier", "expected_amount", "expected_mechanism"),
    [
        (CustomerTier.GOLD, 0.0, DepositMechanism.WAIVED),
        (CustomerTier.SILVER, DEPOSIT_AMOUNT_CLP * 0.5, None),
        (CustomerTier.CORPORATE, float(DEPOSIT_AMOUNT_CLP), None),
        (CustomerTier.STANDARD, float(DEPOSIT_AMOUNT_CLP), None),
    ],
)
def test_deposit_terms_by_tier(tier, expected_amount, expected_mechanism):
    assert tiers.deposit_terms(Driver(tier=tier)) == (expected_amount, expected_mechanism)


def test_every_tier_has_conditions_and_free_extras_entry():
    for tier in CustomerTier:
        assert tiers.conditions_for(tier), f"{tier} has no commercial conditions"
        assert tier in tiers.FREE_EXTRAS


def test_gold_gets_child_seat_free_but_standard_does_not():
    assert "Child Seat" in tiers.free_extra_names(Driver(tier=CustomerTier.GOLD))
    assert tiers.free_extra_names(Driver(tier=CustomerTier.STANDARD)) == frozenset()


# --- Documents gate ----------------------------------------------------------


@pytest.mark.parametrize(
    ("verified", "expires_in_days", "ready"),
    [
        (True, 30, True),
        (True, 0, True),  # expiring today is still valid
        (True, -1, False),
        (False, 30, False),
    ],
)
def test_is_ready_for_checkout(verified, expires_in_days, ready):
    today = date(2026, 1, 15)
    driver = Driver(documents_verified=verified, license_expiration=today + timedelta(days=expires_in_days))
    assert driver.is_ready_for_checkout(as_of=today) is ready


def test_is_ready_for_checkout_requires_a_known_expiration():
    assert Driver(documents_verified=True, license_expiration=None).is_ready_for_checkout() is False


# --- Vehicle ranking ---------------------------------------------------------


def test_mileage_scores_reward_below_average_and_never_go_negative():
    low, avg, high = _vehicle(10_000, 0), _vehicle(20_000, 0), _vehicle(30_000, 0)
    scores = ranking._mileage_scores([low, avg, high])

    assert scores[low.id] == pytest.approx(ranking.MAX_MILEAGE_POINTS * 0.5)
    assert scores[avg.id] == 0
    assert scores[high.id] == 0


def test_service_headroom_is_min_max_normalized():
    tight, mid, roomy = _vehicle(0, 1_000), _vehicle(0, 3_000), _vehicle(0, 5_000)
    scores = ranking._service_headroom_scores([tight, mid, roomy])

    assert scores[tight.id] == 0
    assert scores[mid.id] == pytest.approx(ranking.MAX_SERVICE_HEADROOM_POINTS / 2)
    assert scores[roomy.id] == ranking.MAX_SERVICE_HEADROOM_POINTS


def test_identical_candidates_are_not_penalized():
    a, b = _vehicle(15_000, 20_000), _vehicle(15_000, 20_000)
    assert set(ranking._service_headroom_scores([a, b]).values()) == {ranking.MAX_SERVICE_HEADROOM_POINTS}


def test_empty_candidate_list_scores_nothing():
    assert ranking._mileage_scores([]) == {}
    assert ranking._service_headroom_scores([]) == {}


@pytest.mark.parametrize(
    ("preferred", "category_transmission", "points"),
    [
        (TransmissionType.AUTOMATIC, "automatic", ranking.TRANSMISSION_MATCH_POINTS),
        (TransmissionType.MANUAL, "automatic", 0.0),
        (None, "automatic", 0.0),
    ],
)
def test_transmission_score(preferred, category_transmission, points):
    category = SimpleNamespace(features={"transmission": category_transmission})
    driver = SimpleNamespace(preferred_transmission=preferred)
    assert ranking._transmission_score(category, driver) == points


# --- Settings ----------------------------------------------------------------


@pytest.mark.parametrize(
    "raw_url",
    ["postgres://u:p@host/db", "postgresql://u:p@host/db", "postgresql+psycopg://u:p@host/db"],
)
def test_database_url_is_normalized_to_psycopg3(raw_url):
    settings = Settings(database_url=raw_url, _env_file=None)
    assert settings.sqlalchemy_database_url == "postgresql+psycopg://u:p@host/db"


def test_cors_origins_are_split_and_trimmed():
    settings = Settings(database_url="postgresql://x", cors_origins=" https://a.app , ,https://b.app", _env_file=None)
    assert settings.cors_origin_list == ["https://a.app", "https://b.app"]
