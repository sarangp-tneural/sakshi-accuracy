"""marking_types

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-16 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# label, direction, key, colour, SQL condition on marks.gender
DEFAULTS = [
    ("Male IN", "in", "KeyF", "#3b82f6", "marks.gender = 'male'"),
    ("Male OUT", "out", "KeyD", "#1d4ed8", "marks.gender = 'male'"),
    ("Female IN", "in", "KeyJ", "#ec4899", "marks.gender = 'female'"),
    ("Female OUT", "out", "KeyK", "#be185d", "marks.gender = 'female'"),
    ("IN (gender unknown)", "in", "KeyG", "#64748b", "marks.gender NOT IN ('male', 'female')"),
    ("OUT (gender unknown)", "out", "KeyH", "#475569", "marks.gender NOT IN ('male', 'female')"),
]


def upgrade() -> None:
    op.create_table(
        'marking_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('label', sa.String(60), nullable=False),
        sa.Column('direction', sa.String(3), nullable=True),
        sa.Column('key_code', sa.String(20), nullable=False),
        sa.Column('color', sa.String(7), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('archived', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.create_index('ix_marking_types_project_id', 'marking_types', ['project_id'])
    op.add_column('marks', sa.Column('marking_type_id', sa.Integer(), sa.ForeignKey('marking_types.id'), nullable=True))
    op.create_index('ix_marks_marking_type_id', 'marks', ['marking_type_id'])
    op.alter_column('marks', 'direction', existing_type=sa.String(3), nullable=True)
    op.add_column('sakshi_results', sa.Column('counts', sa.JSON(none_as_null=True), nullable=True))

    bind = op.get_bind()
    for pid in [r[0] for r in bind.execute(sa.text("SELECT id FROM projects"))]:
        for i, (label, direction, key, color, _) in enumerate(DEFAULTS):
            bind.execute(sa.text(
                "INSERT INTO marking_types (project_id, label, direction, key_code, color, sort_order, archived) "
                "VALUES (:p, :l, :d, :k, :c, :i, false)"), dict(p=pid, l=label, d=direction, k=key, c=color, i=i))
    for label, direction, _k, _c, cond in DEFAULTS:
        bind.execute(sa.text(
            "UPDATE marks SET marking_type_id = mt.id FROM videos v, marking_types mt "
            "WHERE v.id = marks.video_id AND mt.project_id = v.project_id AND mt.label = :l "
            f"AND marks.direction = :d AND {cond}"), dict(l=label, d=direction))


def downgrade() -> None:
    op.drop_column('sakshi_results', 'counts')
    op.execute("UPDATE marks SET direction = 'in' WHERE direction IS NULL")
    op.alter_column('marks', 'direction', existing_type=sa.String(3), nullable=False)
    op.drop_index('ix_marks_marking_type_id', table_name='marks')
    op.drop_column('marks', 'marking_type_id')
    op.drop_index('ix_marking_types_project_id', table_name='marking_types')
    op.drop_table('marking_types')
