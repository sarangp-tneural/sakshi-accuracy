"""marking_tp

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-16 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sakshi_results', sa.Column('tp_by_type', sa.JSON(none_as_null=True), nullable=True))


def downgrade() -> None:
    op.drop_column('sakshi_results', 'tp_by_type')
