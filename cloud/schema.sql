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

-- Arbitrary page state: what a reader ticked, typed or collapsed, mirroring the
-- local .lattice/state/<slug>.json shape. `document` rows are shared by every
-- reader of the snapshot (viewer is ''); `user` rows are per reader, keyed by
-- the Google actor id when signed in and by the browser's own id otherwise.
-- Dropped on unshare, like threads: a released subdomain must not hand its
-- state to whatever share claims it next.
CREATE TABLE IF NOT EXISTS doc_state (
  sub     TEXT NOT NULL,
  scope   TEXT NOT NULL CHECK (scope IN ('document', 'user')),
  viewer  TEXT NOT NULL DEFAULT '',
  "key"   TEXT NOT NULL,
  "value" TEXT NOT NULL,          -- the value as JSON, verbatim
  updated INTEGER NOT NULL,
  PRIMARY KEY (sub, scope, viewer, "key")
);
CREATE INDEX IF NOT EXISTS idx_doc_state_sub ON doc_state(sub, scope, viewer);

-- Immutable snapshot revisions. Legacy shares without rows here are version 1;
-- the Worker backfills their current R2 object before publishing version 2.
CREATE TABLE IF NOT EXISTS snapshot_versions (
  sub        TEXT NOT NULL,
  version    INTEGER NOT NULL,
  r2_key     TEXT NOT NULL,
  created    INTEGER NOT NULL,
  PRIMARY KEY (sub, version)
);
CREATE INDEX IF NOT EXISTS idx_snapshot_versions_sub ON snapshot_versions(sub);

-- Optional access policy. No row means public-by-URL, preserving the existing
-- sharing contract. Domain-gated shares authenticate viewers with Google.
CREATE TABLE IF NOT EXISTS share_access (
  sub             TEXT PRIMARY KEY,
  mode            TEXT NOT NULL CHECK (mode IN ('public', 'domain')),
  allowed_domains TEXT NOT NULL DEFAULT '[]'
);

-- Google identities are collaboration actors, not Lattice-owned accounts.
CREATE TABLE IF NOT EXISTS actors (
  id               TEXT PRIMARY KEY,
  provider         TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email            TEXT NOT NULL,
  name             TEXT NOT NULL,
  domain           TEXT,
  created          INTEGER NOT NULL,
  updated          INTEGER NOT NULL,
  UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  actor_id   TEXT NOT NULL,
  expires    INTEGER NOT NULL,
  created    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

-- One-time OIDC state binds the Google callback to its nonce and destination.
CREATE TABLE IF NOT EXISTS auth_states (
  state      TEXT PRIMARY KEY,
  nonce      TEXT NOT NULL,
  return_to  TEXT NOT NULL,
  expires    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_states_expires ON auth_states(expires);

-- A thread is anchored by a stable CSS selector and records the snapshot
-- version where the conversation began. anchor_text is recovery context only.
--
-- `signature` is how a conversation stays one conversation across two stores.
-- The local daemon writes every comment to its own sidecar and pushes the same
-- row here, carrying the id it minted; that id lands in this column. A row born
-- on the hosted side has no signature (NULL), and SQLite treats NULLs as
-- distinct, so the unique index binds only the pushed rows - re-pushing one is
-- a no-op instead of a second copy, and neither side double counts.
CREATE TABLE IF NOT EXISTS threads (
  id                       TEXT PRIMARY KEY,
  sub                      TEXT NOT NULL,
  selector                 TEXT NOT NULL,
  anchor_text              TEXT,
  snapshot_version_created INTEGER NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'resolved')),
  created_by               TEXT NOT NULL,
  signature                TEXT,
  created                  INTEGER NOT NULL,
  updated                  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_sub ON threads(sub, updated);
CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_signature ON threads(sub, signature);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  body       TEXT NOT NULL,
  signature  TEXT,
  created    INTEGER NOT NULL,
  updated    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id, created);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_signature ON comments(thread_id, signature);

-- One row per (comment, actor, emoji). The unique key is the whole point: a
-- reaction is a fact about a person, so reacting twice with the same emoji is
-- not two reactions, and the toggle in the UI is a delete of this exact row.
CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created    INTEGER NOT NULL,
  PRIMARY KEY (comment_id, actor_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id);

-- Append-only audit trail. The current row remains fast to read while every
-- edit or soft deletion preserves the previous body and the actor responsible.
CREATE TABLE IF NOT EXISTS comment_revisions (
  id         TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  body       TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('edit', 'delete')),
  created    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comment_revisions_comment
  ON comment_revisions(comment_id, created);
