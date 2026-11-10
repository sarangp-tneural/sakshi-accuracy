"""cameras

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-11 01:35:43.318509

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('cameras',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('rtsp_url_enc', sa.Text(), nullable=False),
    sa.Column('rtsp_url_masked', sa.Text(), nullable=False),
    sa.Column('default_minutes', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_cameras_project_id'), 'cameras', ['project_id'], unique=False)
    op.create_index('uq_cameras_project_name', 'cameras', ['project_id', sa.literal_column('lower(name)')], unique=True)
    op.add_column('videos', sa.Column('camera_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_videos_camera_id'), 'videos', ['camera_id'], unique=False)
    op.create_foreign_key('fk_videos_camera_id', 'videos', 'cameras', ['camera_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_videos_camera_id', 'videos', type_='foreignkey')
    op.drop_index(op.f('ix_videos_camera_id'), table_name='videos')
    op.drop_column('videos', 'camera_id')
    op.drop_index('uq_cameras_project_name', table_name='cameras')
    op.drop_index(op.f('ix_cameras_project_id'), table_name='cameras')
    op.drop_table('cameras')
