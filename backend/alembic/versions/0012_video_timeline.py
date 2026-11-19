"""video timeline: when each step after recording happened, and the playable copy's size

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-19 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0012'
down_revision: Union[str, Sequence[str], None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TIMES = ('picked_up_at', 'queued_at', 'converting_at', 'converted_at')


def upgrade() -> None:
    """Upgrade schema."""
    for name in TIMES:
        op.add_column('videos', sa.Column(name, sa.DateTime(timezone=True), nullable=True))
    op.add_column('videos', sa.Column('playback_size', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('videos', 'playback_size')
    for name in reversed(TIMES):
        op.drop_column('videos', name)
