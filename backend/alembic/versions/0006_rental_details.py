"""Rental Details step: return_branch_id, contract-level rental fields

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-02

Backs the new Rental Details step (Tablet Rental Details design) and the
reordered check-out wizard (Rental details -> Vehicle -> Extras ->
Documents -> Data -> Deposit -> Signature). See app/checkout/rental_details.py.

- reservations.return_branch_id: new, nullable, backfilled to
  pickup_branch_id for existing rows so every reservation has one in
  practice even though the column stays nullable going forward.
- rental_contracts gains its own return_branch_id / acriss_category_id /
  pickup_date / return_date / rental_details_confirmed — only meaningful
  for a walk-in contract (reservation_id is null), which has no
  Reservation row to hold these instead.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("reservations", sa.Column("return_branch_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_reservations_return_branch_id", "reservations", "branches", ["return_branch_id"], ["id"]
    )
    op.execute("UPDATE reservations SET return_branch_id = pickup_branch_id WHERE return_branch_id IS NULL")

    op.add_column("rental_contracts", sa.Column("return_branch_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_rental_contracts_return_branch_id", "rental_contracts", "branches", ["return_branch_id"], ["id"]
    )
    op.add_column("rental_contracts", sa.Column("acriss_category_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_rental_contracts_acriss_category_id",
        "rental_contracts",
        "acriss_categories",
        ["acriss_category_id"],
        ["id"],
    )
    op.add_column("rental_contracts", sa.Column("pickup_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("rental_contracts", sa.Column("return_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "rental_contracts",
        sa.Column("rental_details_confirmed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # A contract that already has a vehicle (or is further along) predates
    # this step entirely — treat it as already confirmed so existing
    # in-flight contracts aren't retroactively sent back to a step before
    # the one they're already past.
    op.execute("UPDATE rental_contracts SET rental_details_confirmed = true WHERE vehicle_id IS NOT NULL")


def downgrade() -> None:
    op.drop_column("rental_contracts", "rental_details_confirmed")
    op.drop_column("rental_contracts", "return_date")
    op.drop_column("rental_contracts", "pickup_date")
    op.drop_constraint("fk_rental_contracts_acriss_category_id", "rental_contracts", type_="foreignkey")
    op.drop_column("rental_contracts", "acriss_category_id")
    op.drop_constraint("fk_rental_contracts_return_branch_id", "rental_contracts", type_="foreignkey")
    op.drop_column("rental_contracts", "return_branch_id")

    op.drop_constraint("fk_reservations_return_branch_id", "reservations", type_="foreignkey")
    op.drop_column("reservations", "return_branch_id")
