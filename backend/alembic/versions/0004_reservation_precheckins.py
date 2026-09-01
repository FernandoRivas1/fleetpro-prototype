"""reservation_precheckins table + precheckin_status enum

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-31

Backs the new Pre Check-in feature (Executive Pre Check-in design):
pre-arrival driver self-service, reviewed and confirmed by the executive
before the counter session starts. See app/checkout/models.py's
ReservationPrecheckin docstring.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reservation_precheckins",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reservation_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.Enum("requested", "loaded", "confirmed", name="precheckin_status"), nullable=False),
        sa.Column("contact_email", sa.String(length=255), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminder_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("loaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("national_id_or_passport", sa.String(length=40), nullable=True),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("license_number", sa.String(length=40), nullable=True),
        sa.Column("license_expiration", sa.Date(), nullable=True),
        sa.Column("id_photo_url", sa.String(length=500), nullable=True),
        sa.Column("license_photo_url", sa.String(length=500), nullable=True),
        sa.Column("unskip", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reservation_id"),
    )


def downgrade() -> None:
    op.drop_table("reservation_precheckins")
    sa.Enum(name="precheckin_status").drop(op.get_bind(), checkfirst=True)

