"""evaluation

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-16 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLS = ['tp', 'gender_assigned', 'real_male_in_tp', 'real_female_in_tp', 'correct_male', 'correct_female']


def upgrade() -> None:
    for c in COLS:
        op.add_column('sakshi_results', sa.Column(c, sa.Integer(), nullable=True))
    op.add_column('sakshi_results', sa.Column('tp_source', sa.String(10), nullable=False, server_default='manual'))


def downgrade() -> None:
    op.drop_column('sakshi_results', 'tp_source')
    for c in reversed(COLS):
        op.drop_column('sakshi_results', c)
