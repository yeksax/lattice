// Hosted page state - the D1 half of the persistence bridge, and a direct port
// of cmd/lattice/state.go so a summary behaves the same whether it is opened
// from the local daemon or from a public snapshot.
//
// Two scopes per snapshot:
//   document - one shared value per key (viewer ''), visible to every reader
//   user     - one value per reader, keyed by the signed-in Google actor when
//              there is a session and by the browser's own id otherwise
//
// A public-by-URL share therefore lets anyone holding the link write the
// document scope, exactly like anyone holding the link can vote. Snapshots that
// need reader-private state should use the user scope (or be domain-gated).

import type { Env, Token } from './index';
import { requireShareAccess, viewerActorID } from './threads';

const DOCUMENT = 'document';
const USER = 'user';
const MAX_KEY_CHARS = 200;
const MAX_VALUE_BYTES = 8 * 1024;
const MAX_KEYS = 500;   // per scope, per viewer
const MAX_ROWS = 5000;  // per snapshot, across every reader
const MAX_OPS = 200;    // per request
const VIEWER_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

interface StateOp {
  key?: string;
  scope?: string;
  value?: unknown;
  delete?: boolean;
}

interface CleanOp {
  key: string;
  scope: string;
  value: string;
  delete: boolean;
}

const normScope = (scope: unknown): string =>
  String(scope ?? '').toLowerCase() === USER ? USER : DOCUMENT;

const validViewer = (id: string): boolean => id === '' || VIEWER_RE.test(id);

// ---- public endpoints (the bridge in a served snapshot) ----------------------

export async function handlePublicState(
  req: Request,
  env: Env,
  sub: string,
  rest: string,
): Promise<Response> {
  if (rest !== '/state') return json({ error: 'not found' }, 404);
  if (!(await liveShare(env, sub))) return new Response('gone', { status: 404 });
  const denied = await requireShareAccess(req, env, sub);
  if (denied) return denied;

  // A signed-in reader keeps their keys across browsers; an anonymous one is
  // identified by the id their bridge minted in localStorage.
  const actor = await viewerActorID(req, env);

  if (req.method === 'GET') {
    const asked = new URL(req.url).searchParams.get('viewer') ?? '';
    const viewer = actor ?? asked;
    if (!validViewer(viewer)) return json({ error: 'invalid viewer id' }, 400);
    return json(await readState(env, sub, viewer));
  }
  if (req.method === 'POST') {
    let body: { viewer?: string; ops?: StateOp[] };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'body must be JSON: {viewer?, ops:[…]}' }, 400);
    }
    const viewer = actor ?? String(body.viewer ?? '');
    return applyOps(env, sub, viewer, body.ops);
  }
  return json({ error: 'method not allowed' }, 405);
}

// ---- owner endpoints (the CLI, Bearer token) --------------------------------

export async function handleOwnerState(
  req: Request,
  env: Env,
  tok: Token,
  slug: string,
  rest: string,
): Promise<Response> {
  if (rest !== '/state') return json({ error: 'not found' }, 404);
  const share = await env.DB.prepare('SELECT sub FROM shares WHERE token = ? AND slug = ?')
    .bind(tok.token, slug)
    .first<{ sub: string }>();
  if (!share) return json({ error: `not shared: ${slug}` }, 404);

  if (req.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT scope, viewer, "key", "value" FROM doc_state WHERE sub = ? ORDER BY scope, viewer, "key"',
    )
      .bind(share.sub)
      .all<{ scope: string; viewer: string; key: string; value: string }>();
    const document: Record<string, unknown> = {};
    const users: Record<string, Record<string, unknown>> = {};
    for (const row of results ?? []) {
      if (row.scope === USER) {
        (users[row.viewer] ??= {})[row.key] = parse(row.value);
      } else {
        document[row.key] = parse(row.value);
      }
    }
    return json({ slug, sub: share.sub, document, users });
  }
  if (req.method === 'POST') {
    let body: { viewer?: string; ops?: StateOp[] };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'body must be JSON: {viewer?, ops:[…]}' }, 400);
    }
    return applyOps(env, share.sub, String(body.viewer ?? ''), body.ops);
  }
  return json({ error: 'method not allowed' }, 405);
}

// stateDeleteStatement joins the unshare batch in index.ts.
export function stateDeleteStatement(env: Env, sub: string): D1PreparedStatement {
  return env.DB.prepare('DELETE FROM doc_state WHERE sub = ?').bind(sub);
}

// ---- storage ----------------------------------------------------------------

async function applyOps(
  env: Env,
  sub: string,
  viewer: string,
  raw: StateOp[] | undefined,
): Promise<Response> {
  if (!validViewer(viewer)) return json({ error: 'invalid viewer id' }, 400);
  if (!Array.isArray(raw)) return json({ error: 'ops must be an array' }, 400);
  if (raw.length > MAX_OPS) return json({ error: `too many operations (max ${MAX_OPS})` }, 400);

  const ops: CleanOp[] = [];
  for (const op of raw) {
    const key = String(op?.key ?? '').trim();
    if (!key || key.length > MAX_KEY_CHARS) {
      return json({ error: `key is required (max ${MAX_KEY_CHARS} chars)` }, 400);
    }
    const scope = normScope(op?.scope);
    if (scope === USER && viewer === '') {
      return json({ error: 'user-scoped state needs a viewer id' }, 400);
    }
    if (op?.delete) {
      ops.push({ key, scope, value: '', delete: true });
      continue;
    }
    const value = JSON.stringify(op?.value ?? null);
    if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
      return json({ error: `value for "${key}" exceeds ${MAX_VALUE_BYTES} bytes` }, 400);
    }
    ops.push({ key, scope, value, delete: false });
  }

  const writes = ops.filter((op) => !op.delete);
  if (writes.length) {
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM doc_state WHERE sub = ?')
      .bind(sub)
      .first<{ n: number }>();
    if ((total?.n ?? 0) + writes.length > MAX_ROWS) {
      return json({ error: `state limit reached for this snapshot (${MAX_ROWS} keys)` }, 403);
    }
    // Per-scope cap. Overwriting a key that is already there is always allowed;
    // only genuinely new keys count against the limit.
    for (const scope of new Set(writes.map((op) => op.scope))) {
      const existing = await existingKeys(env, sub, scope, scope === USER ? viewer : '');
      const added = new Set(
        writes.filter((op) => op.scope === scope && !existing.has(op.key)).map((op) => op.key),
      );
      if (existing.size + added.size > MAX_KEYS) {
        return json({ error: `state key limit reached (${MAX_KEYS} per scope)` }, 403);
      }
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const statements = ops.map((op) => {
    const owner = op.scope === USER ? viewer : '';
    if (op.delete) {
      return env.DB.prepare(
        'DELETE FROM doc_state WHERE sub = ? AND scope = ? AND viewer = ? AND "key" = ?',
      ).bind(sub, op.scope, owner, op.key);
    }
    return env.DB.prepare(
      `INSERT INTO doc_state (sub, scope, viewer, "key", "value", updated)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(sub, scope, viewer, "key") DO UPDATE SET
         "value" = excluded."value", updated = excluded.updated`,
    ).bind(sub, op.scope, owner, op.key, op.value, now);
  });
  if (statements.length) await env.DB.batch(statements);

  return json(await readState(env, sub, viewer));
}

async function existingKeys(
  env: Env,
  sub: string,
  scope: string,
  viewer: string,
): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    'SELECT "key" FROM doc_state WHERE sub = ? AND scope = ? AND viewer = ?',
  )
    .bind(sub, scope, viewer)
    .all<{ key: string }>();
  return new Set((results ?? []).map((row) => row.key));
}

// readState returns one viewer's window: the shared document scope plus their
// own user keys. Same shape as the daemon's GET /api/state/<slug>.
async function readState(
  env: Env,
  sub: string,
  viewer: string,
): Promise<{ sub: string; viewer: string; document: Record<string, unknown>; user: Record<string, unknown> }> {
  const { results } = await env.DB.prepare(
    `SELECT scope, "key", "value" FROM doc_state
      WHERE sub = ? AND (scope = 'document' OR (scope = 'user' AND viewer = ?))`,
  )
    .bind(sub, viewer)
    .all<{ scope: string; key: string; value: string }>();
  const document: Record<string, unknown> = {};
  const user: Record<string, unknown> = {};
  for (const row of results ?? []) {
    if (row.scope === USER) user[row.key] = parse(row.value);
    else document[row.key] = parse(row.value);
  }
  return { sub, viewer, document, user };
}

async function liveShare(env: Env, sub: string): Promise<boolean> {
  return Boolean(await env.DB.prepare('SELECT 1 FROM shares WHERE sub = ?').bind(sub).first());
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
