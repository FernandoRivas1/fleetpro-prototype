"""Pre-assigned vehicle on a reservation

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-07

reservations.assigned_vehicle_id: nullable FK to vehicles. A reservation
can arrive with a specific car already set aside for it; the executive
sees that car pre-selected (and marked "pre-assigned") at the top of the
Candidate Vehicles list, and can still add alternatives and upgrades to
the shortlist — see flow.py's vehicle-options endpoint.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("reservations", sa.Column("assigned_vehicle_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_reservations_assigned_vehicle_id", "reservations", "vehicles", ["assigned_vehicle_id"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_reservations_assigned_vehicle_id", "reservations", type_="foreignkey")
    op.drop_column("reservations", "assigned_vehicle_id")
