-- Adds the dedupe signature the local daemon stamps on rows it pushes.
--
-- schema.sql already declares these columns, so a database created after this
-- change needs nothing. Run this file ONCE against a database that predates it:
--
--   wrangler d1 execute lattice --file migrations/0001-comment-signature.sql
--   wrangler d1 execute lattice --remote --file migrations/0001-comment-signature.sql
--
-- It is deliberately not part of `pnpm run deploy`: ALTER TABLE ADD COLUMN
-- fails once the column exists, and the deploy path has to stay re-runnable.

ALTER TABLE threads ADD COLUMN signature TEXT;
ALTER TABLE comments ADD COLUMN signature TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_signature ON threads(sub, signature);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_signature ON comments(thread_id, signature);
