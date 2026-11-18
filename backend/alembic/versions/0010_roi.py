"""roi (door area for skipping still moments)

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-18 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0010'
down_revision: Union[str, Sequence[str], None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('cameras', sa.Column('roi', sa.JSON(), nullable=True))
    op.add_column('videos', sa.Column('roi', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('videos', 'roi')
    op.drop_column('cameras', 'roi')
