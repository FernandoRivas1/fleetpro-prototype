from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.checkout.checkout import router as checkout_router
from app.checkout.documents import router as documents_router
from app.checkout.drivers import router as drivers_router
from app.checkout.flow import router as checkout_flow_router
from app.checkout.precheckin import admin_router as precheckin_admin_router
from app.checkout.precheckin import public_router as precheckin_public_router
from app.checkout.reservations import router as reservations_router
from app.checkout.tiers import router as tiers_router
from app.checkout.stations import router as stations_router
from app.checkout.ws import router as checkout_ws_router
from app.config import settings
from app.fleet.categories import router as fleet_categories_router
from app.fleet.ranking import router as fleet_ranking_router
from app.reports.handover import router as handover_router
from app.reports.pre_handover import router as pre_handover_router
from app.shared.branches import router as branches_router
from app.shared.extras import router as extras_router

app = FastAPI(title="Fleetpro API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# Each router already carries its own full path prefix (see the respective
# modules), so no extra prefix is passed here.
app.include_router(branches_router)
app.include_router(extras_router)
app.include_router(stations_router)
app.include_router(checkout_router)
app.include_router(checkout_flow_router)
app.include_router(documents_router)
app.include_router(drivers_router)
app.include_router(reservations_router)
app.include_router(tiers_router)
app.include_router(precheckin_public_router)
app.include_router(precheckin_admin_router)
app.include_router(checkout_ws_router)
app.include_router(fleet_ranking_router)
app.include_router(fleet_categories_router)
app.include_router(handover_router)
app.include_router(pre_handover_router)

# Serves the scanned ID/license photos app/checkout/documents.py saves to
# disk — must exist before StaticFiles mounts it.
Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")

# Remaining domain routers (drivers, vehicles CRUD) get wired in here as
# they're implemented.
