"""driver progressive fields + nullable vehicle on rental_contracts

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-30

RentalContract is now created (status=New) at POST /api/v1/checkout/start,
before a vehicle has been chosen — and a walk-in Driver row is created
right there too, with only first/last name + email, before OCR or the
executive fills in the rest. Both previously had NOT NULL columns that
can't be known that early in the flow.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "drivers", "national_id_or_passport", existing_type=sa.String(length=40), nullable=True
    )
    op.alter_column("drivers", "phone", existing_type=sa.String(length=30), nullable=True)
    op.alter_column("drivers", "license_number", existing_type=sa.String(length=40), nullable=True)
    op.alter_column("drivers", "license_expiration", existing_type=sa.Date(), nullable=True)
    op.alter_column("rental_contracts", "vehicle_id", existing_type=sa.Uuid(), nullable=True)


def downgrade() -> None:
    # NOTE: will fail if any row already has a NULL in one of these columns
    # (i.e. any in-progress contract/driver created since this upgraded).
    op.alter_column("rental_contracts", "vehicle_id", existing_type=sa.Uuid(), nullable=False)
    op.alter_column("drivers", "license_expiration", existing_type=sa.Date(), nullable=False)
    op.alter_column("drivers", "license_number", existing_type=sa.String(length=40), nullable=False)
    op.alter_column("drivers", "phone", existing_type=sa.String(length=30), nullable=False)
    op.alter_column(
        "drivers", "national_id_or_passport", existing_type=sa.String(length=40), nullable=False
    )
