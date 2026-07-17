-- lattice hosted share backend - D1 schema.
-- Apply with: wrangler d1 execute lattice --file schema.sql   (add --remote for prod)

-- Access tokens. No signup yet: rows are inserted by hand for friends.
--   wrangler d1 execute lattice --command \
--     "INSERT INTO tokens (token, owner, created) VALUES ('tok_...', 'demo', unixepoch())"
CREATE TABLE IF NOT EXISTS tokens (
  token      TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  created    INTEGER NOT NULL,
  max_shares INTEGER              -- NULL ⇒ use DEFAULT_MAX_SHARES
);

-- One row per active share. `sub` is the globally-unique public subdomain;
-- `slug` is the owner's local slug (so the CLI can be idempotent per slug).
CREATE TABLE IF NOT EXISTS shares (
  sub     TEXT PRIMARY KEY,
  token   TEXT NOT NULL,
  slug    TEXT NOT NULL,
  r2_key  TEXT NOT NULL,
  title   TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_token_slug ON shares(token, slug);
CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);

-- Append-only votes, mirroring the local .lattice/polls/<slug>.jsonl shape:
-- one row per submission, keyed by the public subdomain. Kept on unshare.
CREATE TABLE IF NOT EXISTS votes (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  sub  TEXT NOT NULL,
  t    TEXT NOT NULL,   -- RFC3339 timestamp
  ip   TEXT,
  ua   TEXT,
  data TEXT NOT NULL    -- the vote payload JSON, verbatim
);
CREATE INDEX IF NOT EXISTS idx_votes_sub ON votes(sub);
