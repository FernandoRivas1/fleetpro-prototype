"""The demo is only as good as its sample data: these tests keep seed.py
giving every reservation real vehicles to choose from, and keep the demo
self-healing (DEMO_RESEED_ON_STARTUP)."""
from collections import Counter
from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.fleet.models import Vehicle
from app.shared.enums import VehicleStatus

API = "/api/v1"
FRONTEND_PUBLIC = Path(__file__).resolve().parents[2] / "frontend" / "public"
MIN_CHOICES = 3


def test_every_branch_has_choices_in_every_category(seeded_db):
    with SessionLocal() as db:
        available = Counter(
            (v.branch_id, v.acriss_category_id)
            for v in db.query(Vehicle).filter(Vehicle.status == VehicleStatus.AVAILABLE)
        )
        branches = {v.branch_id for v in db.query(Vehicle)}
        categories = {v.acriss_category_id for v in db.query(Vehicle)}

    for branch_id in branches:
        for category_id in categories:
            assert available[(branch_id, category_id)] >= MIN_CHOICES, (branch_id, category_id)


def test_every_reservation_has_vehicles_to_offer(client):
    """Regression: the airport's single Economy car was the only option for
    Diego's reservation, so one earlier check-out left him with none."""
    any_driver = client.get(f"{API}/checkout/drivers/by-email", params={"email": "felipe.soto@example.com"}).json()
    for branch in client.get(f"{API}/branches").json():
        reservations = client.get(f"{API}/checkout/reservations", params={"branch_id": branch["id"]}).json()
        assert len(reservations) >= 4, branch["code"]
        for reservation in reservations:
            candidates = client.get(
                f"{API}/fleet/candidates",
                params={
                    "category_id": reservation["acriss_category_id"],
                    "branch_id": branch["id"],
                    "driver_id": any_driver["id"],
                },
            ).json()["candidates"]
            assert len(candidates) >= MIN_CHOICES, reservation["code"]


def test_every_vehicle_photo_is_a_bundled_illustration(seeded_db):
    with SessionLocal() as db:
        urls = {v.main_photo_url for v in db.query(Vehicle)}
    for url in urls:
        assert url.startswith("/vehicles/"), url
        assert (FRONTEND_PUBLIC / url.lstrip("/")).is_file(), url


def test_startup_reseed_restores_a_drained_demo(seeded_db, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    with SessionLocal() as db:
        db.query(Vehicle).update({Vehicle.status: VehicleStatus.RENTED})
        db.commit()

    monkeypatch.setattr(settings, "demo_reseed_on_startup", True)
    with TestClient(app):
        pass

    with SessionLocal() as db:
        assert db.query(Vehicle).filter(Vehicle.status == VehicleStatus.AVAILABLE).count() >= 48
