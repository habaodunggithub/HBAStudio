"""Initial local workspace, domain entities, retrieval and sync state."""

from alembic import op
from backend.models import Base

revision = "0001"
down_revision = None


def upgrade():
    Base.metadata.create_all(op.get_bind())
    op.execute(
        "CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')"
    )


def downgrade():
    op.execute("DROP TABLE chunks_fts")
    Base.metadata.drop_all(op.get_bind())
