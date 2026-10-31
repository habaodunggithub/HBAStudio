"""Independent spatial layouts; moving a card does not change planning revisions."""

from alembic import op
from backend.models import CanvasBoard

revision = "0003"
down_revision = "0002"


def upgrade():
    CanvasBoard.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    CanvasBoard.__table__.drop(op.get_bind(), checkfirst=True)
