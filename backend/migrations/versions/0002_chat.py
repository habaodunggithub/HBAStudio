"""Local Codex conversation history, independent of planning revisions."""

from alembic import op
from backend.models import ChatThread

revision = "0002"
down_revision = "0001"


def upgrade():
    # 0001 creates current metadata for fresh installations as well.
    ChatThread.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    ChatThread.__table__.drop(op.get_bind(), checkfirst=True)
