"""End-to-end tests of the check-out API against seeded data.

Each test walks the same path a counter executive and the client tablet do:
create a station, start a contract, confirm rental details, pick a vehicle,
authorize the deposit, sign. The interesting assertions are the "Critical
business rules" from CLAUDE.md, which must be enforced by the backend, not
just by the order of the wizard's screens.
"""
from datetime import datetime, timedelta, timezone

import pytest

API = "/api/v1"

GOLD_EMAIL = "maria.gonzalez@example.com"
EXPIRED_LICENSE_EMAIL = "jorge.alvarez@example.com"
STANDARD_EMAIL = "felipe.soto@example.com"
SILVER_EMAIL = "valentina.munoz@example.com"


# --- helpers -----------------------------------------------------------------


def _branch_id(client, code: str = "SCL-CTR") -> str:
    branches = client.get(f"{API}/branches").json()
    return next(b["id"] for b in branches if b["code"] == code)


def _category(client, code: str) -> dict:
    return next(c for c in client.get(f"{API}/fleet/categories").json() if c["code"] == code)


def _new_station(client, branch_id: str) -> dict:
    res = client.post(f"{API}/stations", json={"branch_id": branch_id, "label": "Counter 1"})
    assert res.status_code == 201, res.text
    return res.json()


def _start_walk_in(client, email: str | None = None, first_name: str = "Test", last_name: str = "Driver") -> dict:
    branch_id = _branch_id(client)
    station = _new_station(client, branch_id)
    res = client.post(
        f"{API}/checkout/start",
        json={"station_id": station["station_id"], "first_name": first_name, "last_name": last_name, "email": email},
    )
    assert res.status_code == 201, res.text
    return {**res.json(), "branch_id": branch_id}


def _confirm_rental_details(client, contract: dict, category_code: str = "ECAR") -> None:
    pickup = datetime.now(timezone.utc) + timedelta(hours=1)
    res = client.post(
        f"{API}/checkout/{contract['contract_id']}/rental-details",
        json={
            "pickup_branch_id": contract["branch_id"],
            "return_branch_id": contract["branch_id"],
            "pickup_date": pickup.isoformat(),
            "return_date": (pickup + timedelta(days=3)).isoformat(),
            "acriss_category_id": _category(client, category_code)["id"],
        },
    )
    assert res.status_code == 200, res.text


def _best_vehicle_id(client, contract: dict, category_code: str = "ECAR") -> str:
    res = client.get(
        f"{API}/fleet/candidates",
        params={
            "category_id": _category(client, category_code)["id"],
            "branch_id": contract["branch_id"],
            "driver_id": contract["driver_id"],
        },
    )
    assert res.status_code == 200, res.text
    candidates = res.json()["candidates"]
    assert candidates, f"seed data has no available {category_code} at {contract['branch_id']}"
    return candidates[0]["vehicle"]["id"]


def _select_vehicle(client, contract: dict, category_code: str = "ECAR"):
    vehicle_id = _best_vehicle_id(client, contract, category_code)
    return client.post(f"{API}/checkout/{contract['contract_id']}/select-vehicle", json={"vehicle_id": vehicle_id})


def _sign(client, contract: dict):
    return client.post(
        f"{API}/checkout/{contract['contract_id']}/sign", json={"signature_image_base64": "data:image/png;base64,AAAA"}
    )


# --- health & pairing --------------------------------------------------------


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_tablet_pairs_with_pin_then_with_stored_credentials(client):
    station = _new_station(client, _branch_id(client))

    by_pin = client.post(f"{API}/stations/pair", json={"pin": station["pin"]})
    assert by_pin.status_code == 200
    assert by_pin.json()["pairing_token"] == station["pairing_token"]

    by_credentials = client.post(
        f"{API}/stations/pair",
        json={"station_id": station["station_id"], "pairing_token": station["pairing_token"]},
    )
    assert by_credentials.status_code == 200
    assert client.get(f"{API}/stations/{station['station_id']}").json()["paired_at"] is not None


def test_pairing_rejects_a_wrong_token(client):
    station = _new_station(client, _branch_id(client))
    res = client.post(f"{API}/stations/pair", json={"station_id": station["station_id"], "pairing_token": "nope"})
    assert res.status_code == 401


def test_pairing_rejects_an_unknown_pin(client):
    assert client.post(f"{API}/stations/pair", json={"pin": "000000"}).status_code == 400


# --- happy paths -------------------------------------------------------------


def test_gold_driver_checks_out_with_deposit_waived(client):
    contract = _start_walk_in(client, GOLD_EMAIL)
    assert contract["skip_driver_data"] is True  # verified returning customer

    _confirm_rental_details(client, contract)
    assert _select_vehicle(client, contract).status_code == 200

    deposit = client.get(f"{API}/checkout/{contract['contract_id']}/deposit").json()
    assert deposit["authorized"] is True
    assert deposit["deposit"]["mechanism"] == "waived"
    assert float(deposit["deposit"]["amount"]) == 0

    signed = _sign(client, contract)
    assert signed.status_code == 200, signed.text
    assert signed.json()["status"] == "Open"


def test_silver_driver_pays_half_deposit_in_person(client):
    contract = _start_walk_in(client, SILVER_EMAIL)
    _confirm_rental_details(client, contract)
    _select_vehicle(client, contract)

    deposit = client.post(f"{API}/checkout/{contract['contract_id']}/deposit/authorize")
    assert deposit.status_code == 200, deposit.text
    assert deposit.json()["mechanism"] == "in_person"
    assert float(deposit.json()["amount"]) == 250_000

    assert _sign(client, contract).status_code == 200


def test_selected_vehicle_is_taken_out_of_the_pool(client):
    contract = _start_walk_in(client, STANDARD_EMAIL)
    _confirm_rental_details(client, contract)
    vehicle_id = _best_vehicle_id(client, contract)
    client.post(f"{API}/checkout/{contract['contract_id']}/select-vehicle", json={"vehicle_id": vehicle_id})

    other = _start_walk_in(client, SILVER_EMAIL)
    _confirm_rental_details(client, other)
    res = client.post(f"{API}/checkout/{other['contract_id']}/select-vehicle", json={"vehicle_id": vehicle_id})
    assert res.status_code == 409


# --- critical business rules -------------------------------------------------


def test_vehicle_cannot_be_selected_before_rental_details_are_confirmed(client):
    contract = _start_walk_in(client, STANDARD_EMAIL)
    res = _select_vehicle(client, contract)
    assert res.status_code == 409
    assert "rental details" in res.json()["detail"].lower()


def test_rental_details_are_locked_after_vehicle_selection(client):
    contract = _start_walk_in(client, STANDARD_EMAIL)
    _confirm_rental_details(client, contract)
    _select_vehicle(client, contract)

    pickup = datetime.now(timezone.utc)
    res = client.post(
        f"{API}/checkout/{contract['contract_id']}/rental-details",
        json={
            "pickup_branch_id": contract["branch_id"],
            "return_branch_id": contract["branch_id"],
            "pickup_date": pickup.isoformat(),
            "return_date": (pickup + timedelta(days=1)).isoformat(),
            "acriss_category_id": _category(client, "ECAR")["id"],
        },
    )
    assert res.status_code == 409


def test_expired_license_blocks_deposit_and_signature(client):
    contract = _start_walk_in(client, EXPIRED_LICENSE_EMAIL)
    _confirm_rental_details(client, contract)
    assert _select_vehicle(client, contract).status_code == 200  # browsing is allowed

    assert client.post(f"{API}/checkout/{contract['contract_id']}/deposit/authorize").status_code == 409

    signed = _sign(client, contract)
    assert signed.status_code == 422
    errors = signed.json()["detail"]["errors"]
    assert "Driver's license has expired." in errors
    assert "Deposit has not been authorized." in errors


def test_unverified_walk_in_cannot_sign_until_documents_are_confirmed(client):
    contract = _start_walk_in(client)  # guest: no email, no documents on file
    assert contract["skip_document_scan"] is False
    _confirm_rental_details(client, contract)
    _select_vehicle(client, contract)

    assert client.post(f"{API}/checkout/{contract['contract_id']}/deposit/authorize").status_code == 409

    confirmed = client.post(
        f"{API}/checkout/{contract['contract_id']}/confirm-documents",
        json={
            "first_name": "Test",
            "last_name": "Driver",
            "national_id_or_passport": "P-1234567",
            "license_number": "LIC-TEST-1",
            "license_expiration": (datetime.now(timezone.utc).date() + timedelta(days=365)).isoformat(),
        },
    )
    assert confirmed.status_code == 200, confirmed.text

    assert client.post(f"{API}/checkout/{contract['contract_id']}/deposit/authorize").status_code == 200
    assert _sign(client, contract).status_code == 200


def test_confirm_documents_rejects_an_expired_license(client):
    contract = _start_walk_in(client)
    res = client.post(
        f"{API}/checkout/{contract['contract_id']}/confirm-documents",
        json={
            "first_name": "Test",
            "last_name": "Driver",
            "national_id_or_passport": "P-7654321",
            "license_number": "LIC-TEST-2",
            "license_expiration": "2020-01-01",
        },
    )
    assert res.status_code == 422


def test_duplicate_national_id_is_a_409_not_a_crash(client):
    contract = _start_walk_in(client)
    res = client.post(
        f"{API}/checkout/{contract['contract_id']}/confirm-documents",
        json={
            "first_name": "Test",
            "last_name": "Driver",
            "national_id_or_passport": "12.345.678-9",  # already on file for the Gold driver
            "license_number": "LIC-TEST-3",
            "license_expiration": (datetime.now(timezone.utc).date() + timedelta(days=365)).isoformat(),
        },
    )
    assert res.status_code == 409


@pytest.mark.parametrize("category_code", ["ECAR", "CDAR", "ICAR"])
def test_upsell_is_always_exactly_one_category_higher(client, category_code):
    contract = _start_walk_in(client, STANDARD_EMAIL)
    _confirm_rental_details(client, contract, category_code)
    _select_vehicle(client, contract, category_code)

    suggestion = client.get(f"{API}/checkout/{contract['contract_id']}/upsell-suggestion").json()
    current = suggestion["current_category"]["hierarchy_order"]
    assert suggestion["suggested_category"]["hierarchy_order"] == current + 1
    if suggestion["has_suggestion"]:
        assert suggestion["daily_price_difference"] > 0


def test_no_upsell_from_the_top_category(client):
    contract = _start_walk_in(client, STANDARD_EMAIL)
    _confirm_rental_details(client, contract, "FVAR")
    _select_vehicle(client, contract, "FVAR")

    suggestion = client.get(f"{API}/checkout/{contract['contract_id']}/upsell-suggestion").json()
    assert suggestion["has_suggestion"] is False
    assert suggestion.get("suggested_category") is None


def test_prepaid_reservation_starts_at_rental_details_not_signature(client):
    """Regression: a reservation whose deposit was paid online used to send
    the tablet straight to the Signature step before any vehicle was picked,
    because the inferred step checked "deposit authorized" first."""
    branch_id = _branch_id(client)
    station = _new_station(client, branch_id)
    reservations = client.get(f"{API}/checkout/reservations", params={"branch_id": branch_id}).json()
    prepaid = next(r for r in reservations if r["deposit_done_online"])

    started = client.post(
        f"{API}/checkout/start", json={"station_id": station["station_id"], "reservation_id": prepaid["id"]}
    )
    assert started.status_code == 201, started.text
    contract_id = started.json()["contract_id"]

    status = client.get(f"{API}/checkout/{contract_id}/status").json()
    assert status["current_step"] == "rental_details"
