"""video playback_vcodec / width / height / fps: the playable copy's own format

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-19 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0014'
down_revision: Union[str, Sequence[str], None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('videos', sa.Column('playback_vcodec', sa.String(length=32), nullable=True))
    op.add_column('videos', sa.Column('playback_width', sa.Integer(), nullable=True))
    op.add_column('videos', sa.Column('playback_height', sa.Integer(), nullable=True))
    op.add_column('videos', sa.Column('playback_fps', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    for name in ('playback_fps', 'playback_height', 'playback_width', 'playback_vcodec'):
        op.drop_column('videos', name)
