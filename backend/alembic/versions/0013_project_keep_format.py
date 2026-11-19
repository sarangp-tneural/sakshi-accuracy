"""project keep_format switch (the playable copy keeps the stream's own format; on by default)

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-19 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0013'
down_revision: Union[str, Sequence[str], None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('projects', sa.Column('keep_format', sa.Boolean(), server_default=sa.true(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('projects', 'keep_format')
