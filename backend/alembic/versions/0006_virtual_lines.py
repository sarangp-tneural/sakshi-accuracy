"""virtual_lines

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-12 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('cameras', sa.Column('lines', sa.JSON(), server_default='[]', nullable=False))
    op.add_column('videos', sa.Column('lines', sa.JSON(), server_default='[]', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('videos', 'lines')
    op.drop_column('cameras', 'lines')
