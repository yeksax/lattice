-- Adds emoji reactions on comments.
--
-- schema.sql already declares the table, so a database created after this
-- change needs nothing. Run this file ONCE against a database that predates it:
--
--   wrangler d1 execute lattice --file migrations/0002-comment-reactions.sql
--   wrangler d1 execute lattice --remote --file migrations/0002-comment-reactions.sql
--
-- CREATE TABLE IF NOT EXISTS is re-runnable, so this one is harmless twice; it
-- lives here anyway to keep every schema change applied the same way.

CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created    INTEGER NOT NULL,
  PRIMARY KEY (comment_id, actor_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id);
