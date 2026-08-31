"""nullable delivery_km / delivery_fuel_level on handover_reports

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-31

A HandoverReport is now created in "pending" status at
POST /api/v1/checkout/{contract_id}/resolve-handover, before the parking
lot assistant has recorded these at
POST /api/v1/reports/new/{contract_id}/complete.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("handover_reports", "delivery_km", existing_type=sa.Integer(), nullable=True)
    op.alter_column(
        "handover_reports", "delivery_fuel_level", existing_type=sa.String(length=20), nullable=True
    )


def downgrade() -> None:
    # NOTE: will fail if any row already has a NULL in one of these columns.
    op.alter_column(
        "handover_reports", "delivery_fuel_level", existing_type=sa.String(length=20), nullable=False
    )
    op.alter_column("handover_reports", "delivery_km", existing_type=sa.Integer(), nullable=False)
