"""drivers.tier + deposit_mechanism 'waived'

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-31

Backs the customer loyalty tiers feature (Executive Main design's
"commercial conditions" banner). See app/checkout/tiers.py for what a
tier actually changes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    customer_tier = sa.Enum("Standard", "Silver", "Gold", "Corporate", name="customer_tier")
    customer_tier.create(op.get_bind())
    op.add_column(
        "drivers",
        sa.Column("tier", customer_tier, nullable=False, server_default="Standard"),
    )

    # Postgres enums can only gain a new label outside a transaction block
    # in older server versions; ALTER TYPE ... ADD VALUE is safe here
    # (Alembic's env.py runs each migration in its own transaction, and
    # modern Postgres — 12+ — allows this within one, which Neon runs).
    op.execute("ALTER TYPE deposit_mechanism ADD VALUE IF NOT EXISTS 'waived'")


def downgrade() -> None:
    # NOTE: Postgres has no ALTER TYPE ... DROP VALUE — a downgrade past
    # this point would need to recreate deposit_mechanism from scratch if
    # any row has already used 'waived'. Not handled here (matches this
    # project's other enum-extending migrations' downgrade caveats).
    op.drop_column("drivers", "tier")
    sa.Enum(name="customer_tier").drop(op.get_bind(), checkfirst=True)
