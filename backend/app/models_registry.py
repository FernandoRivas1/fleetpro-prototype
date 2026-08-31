"""Import every domain's models so they register on Base.metadata.

Alembic's env.py and seed.py both import Base from here (not from
app.database directly) so metadata.create_all()/autogenerate see every
table regardless of which domain package happens to get imported first.
"""
from app.database import Base  # noqa: F401
from app.shared.models import Branch, Extra  # noqa: F401
from app.fleet.models import ACRISSCategory, Vehicle  # noqa: F401
from app.checkout.models import (  # noqa: F401
    ContractExtra,
    Deposit,
    DigitalSignature,
    Driver,
    RentalContract,
    Reservation,
    ReservationExtra,
    Station,
)
from app.reports.models import HandoverReport, PreHandoverReport  # noqa: F401

__all__ = [
    "Base",
    "Branch",
    "Extra",
    "ACRISSCategory",
    "Vehicle",
    "Driver",
    "Reservation",
    "ReservationExtra",
    "Station",
    "RentalContract",
    "ContractExtra",
    "Deposit",
    "DigitalSignature",
    "PreHandoverReport",
    "HandoverReport",
]
