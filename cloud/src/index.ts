// lattice hosted share backend.
//
// One Worker, two jobs:
//   1. /v1/*            authenticated share API - the `lattice` CLI uploads
//                       snapshots and manages shares here (Bearer token).
//   2. public serving   a snapshot at <sub>.<SHARE_DOMAIN>/ (prod) or
//                       /s/<sub> (dev), with the poll bridge injected and
//                       /submit + /results endpoints - byte-for-byte the same
//                       contract as the local daemon's public listener.
//
// Storage: snapshots in R2 (key snap/<sub>), metadata + votes in D1.

import pollBridge from './poll.bridge.txt';

export interface Env {
  DB: D1Database;
  SNAPSHOTS: R2Bucket;
  SHARE_DOMAIN: string; // subdomain form: <sub>.<SHARE_DOMAIN> (needs wildcard DNS)
  PUBLIC_BASE: string;  // path form: <PUBLIC_BASE>/s/<sub> (a plain custom domain)
  MAX_SNAPSHOT_BYTES: string;
  DEFAULT_MAX_SHARES: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e) }, 500);
    }
  },
};

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // 1. Authenticated share API.
  if (path === '/v1/shares' || path.startsWith('/v1/shares/')) {
    return apiShares(req, env, path);
  }

  // 2. Public serving. Resolve which share this request targets: by subdomain
  //    in prod, or by /s/<sub> path in dev (no wildcard DNS on workers.dev).
  const target = resolveTarget(url, env);
  if (target) {
    return servePublic(req, env, target.sub, target.rest);
  }

  if (path === '/' || path === '/health') return json({ ok: true, service: 'lattice-share' });
  return json({ error: 'not found' }, 404);
}

// resolveTarget extracts (sub, rest) for public serving. rest is the sub-path:
// '' for the page, '/submit', '/results'.
function resolveTarget(url: URL, env: Env): { sub: string; rest: string } | null {
  // Subdomain form: <sub>.<SHARE_DOMAIN>
  if (env.SHARE_DOMAIN) {
    const host = url.hostname;
    const suffix = '.' + env.SHARE_DOMAIN;
    if (host.endsWith(suffix)) {
      const sub = host.slice(0, -suffix.length);
      if (sub && !sub.includes('.') && sub !== 'api' && sub !== 'www') {
        return { sub, rest: url.pathname === '/' ? '' : url.pathname };
      }
    }
  }
  // Path form (dev): /s/<sub>[/submit|/results]
  const m = url.pathname.match(/^\/s\/([a-z0-9-]+)(\/submit|\/results)?$/);
  if (m) return { sub: m[1], rest: m[2] ?? '' };
  return null;
}

// ---- Authenticated share API -------------------------------------------------

interface Token {
  token: string;
  owner: string;
  max_shares: number | null;
}

async function auth(req: Request, env: Env): Promise<Token | null> {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const row = await env.DB.prepare('SELECT token, owner, max_shares FROM tokens WHERE token = ?')
    .bind(m[1].trim())
    .first<Token>();
  return row ?? null;
}

async function apiShares(req: Request, env: Env, path: string): Promise<Response> {
  const tok = await auth(req, env);
  if (!tok) return json({ error: 'unauthorized' }, 401);

  // /v1/shares
  if (path === '/v1/shares') {
    if (req.method === 'POST') return createShare(req, env, tok);
    if (req.method === 'GET') return listShares(env, tok);
    return json({ error: 'method not allowed' }, 405);
  }

  // /v1/shares/<slug> and /v1/shares/<slug>/results
  const rest = path.slice('/v1/shares/'.length);
  const resultsMatch = rest.match(/^(.+)\/results$/);
  if (resultsMatch) {
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
    return shareResults(env, tok, decodeURIComponent(resultsMatch[1]));
  }
  const slug = decodeURIComponent(rest);
  if (req.method === 'DELETE') return deleteShare(env, tok, slug);
  return json({ error: 'method not allowed' }, 405);
}

interface CreateBody {
  slug?: string;
  sub?: string;
  html?: string;
  title?: string;
  random?: boolean;
}

async function createShare(req: Request, env: Env, tok: Token): Promise<Response> {
  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON: {slug, html, sub?, title?, random?}' }, 400);
  }
  const slug = (body.slug ?? '').trim();
  const html = body.html ?? '';
  if (!slug || !html) return json({ error: 'slug and html are required' }, 400);

  const maxBytes = intVar(env.MAX_SNAPSHOT_BYTES, 2 << 20);
  if (byteLength(html) > maxBytes) {
    return json({ error: `snapshot exceeds ${maxBytes} bytes` }, 413);
  }

  const now = Math.floor(Date.now() / 1000);

  // Idempotent per (token, slug): re-sharing the same slug updates in place and
  // keeps the existing subdomain, mirroring the local daemon.
  const existing = await env.DB.prepare('SELECT sub, r2_key FROM shares WHERE token = ? AND slug = ?')
    .bind(tok.token, slug)
    .first<{ sub: string; r2_key: string }>();

  let sub: string;
  if (existing) {
    sub = existing.sub;
  } else {
    // Enforce the free-tier active-share cap.
    const max = tok.max_shares ?? intVar(env.DEFAULT_MAX_SHARES, 10);
    const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE token = ?')
      .bind(tok.token)
      .first<{ n: number }>();
    if ((countRow?.n ?? 0) >= max) {
      return json({ error: `share limit reached (${max}); unshare something first` }, 403);
    }
    sub = body.random ? randSub() : validSub(body.sub ?? slug) ? (body.sub ?? slug) : randSub();
    // Subdomain must be globally unique.
    const taken = await env.DB.prepare('SELECT 1 FROM shares WHERE sub = ?').bind(sub).first();
    if (taken) return json({ error: `subdomain "${sub}" is taken; retry with --random` }, 409);
  }

  const r2Key = 'snap/' + sub;
  await env.SNAPSHOTS.put(r2Key, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });

  if (existing) {
    await env.DB.prepare('UPDATE shares SET r2_key = ?, title = ?, updated = ? WHERE sub = ?')
      .bind(r2Key, body.title ?? null, now, sub)
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO shares (sub, token, slug, r2_key, title, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(sub, tok.token, slug, r2Key, body.title ?? null, now, now)
      .run();
  }

  return json({ slug, sub, url: publicURL(env, sub) }, existing ? 200 : 201);
}

async function listShares(env: Env, tok: Token): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT s.sub, s.slug, s.title, s.created, s.updated,
            (SELECT COUNT(*) FROM votes v WHERE v.sub = s.sub) AS votes
     FROM shares s WHERE s.token = ? ORDER BY s.updated DESC`,
  )
    .bind(tok.token)
    .all<{ sub: string; slug: string; title: string | null; created: number; updated: number; votes: number }>();
  return json(
    (results ?? []).map((r) => ({
      slug: r.slug,
      sub: r.sub,
      title: r.title,
      url: publicURL(env, r.sub),
      created: r.created,
      updated: r.updated,
      votes: r.votes,
    })),
  );
}

async function deleteShare(env: Env, tok: Token, slug: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT sub, r2_key FROM shares WHERE token = ? AND slug = ?')
    .bind(tok.token, slug)
    .first<{ sub: string; r2_key: string }>();
  if (!row) return json({ error: `not shared: ${slug}` }, 404);
  await env.SNAPSHOTS.delete(row.r2_key);
  await env.DB.prepare('DELETE FROM shares WHERE sub = ?').bind(row.sub).run();
  // Votes are kept (mirrors local unshare: poll data survives).
  return new Response(null, { status: 204 });
}

async function shareResults(env: Env, tok: Token, slug: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT sub FROM shares WHERE token = ? AND slug = ?')
    .bind(tok.token, slug)
    .first<{ sub: string }>();
  if (!row) return json({ error: `not shared: ${slug}` }, 404);
  const { results } = await env.DB.prepare('SELECT t, ip, ua, data FROM votes WHERE sub = ? ORDER BY id')
    .bind(row.sub)
    .all<{ t: string; ip: string; ua: string; data: string }>();
  // Same line shape as the local .jsonl dump.
  const submissions = (results ?? []).map((r) => ({
    t: r.t,
    via: 'hosted',
    ip: r.ip,
    ua: r.ua,
    data: JSON.parse(r.data),
  }));
  return json({ slug, submissions });
}

// ---- Public serving ----------------------------------------------------------

async function servePublic(req: Request, env: Env, sub: string, rest: string): Promise<Response> {
  if (rest === '/submit') {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    return recordVote(req, env, sub);
  }
  if (rest === '/results') {
    return json(await aggregate(env, sub));
  }
  // The page itself.
  const share = await env.DB.prepare('SELECT r2_key FROM shares WHERE sub = ?')
    .bind(sub)
    .first<{ r2_key: string }>();
  if (!share) return new Response('gone', { status: 404 });
  const obj = await env.SNAPSHOTS.get(share.r2_key);
  if (!obj) return new Response('gone', { status: 404 });
  const html = await obj.text();
  // Endpoints are relative - resolve against whatever origin served the page,
  // so subdomain (prod) and /s/<sub> (dev) both work without hard-coding.
  const base = rest === '' && !env.SHARE_DOMAIN ? `/s/${sub}` : '';
  const tag =
    `<script id="lattice-poll" data-endpoint="${base}/submit" data-results="${base}/results">` +
    pollBridge +
    `</script>`;
  return new Response(injectScript(html, tag), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function recordVote(req: Request, env: Env, sub: string): Promise<Response> {
  // Only accept votes for a live share.
  const exists = await env.DB.prepare('SELECT 1 FROM shares WHERE sub = ?').bind(sub).first();
  if (!exists) return new Response('gone', { status: 404 });

  const body = await req.text();
  if (body.length > 64 * 1024) return json({ error: 'body must be JSON ≤ 64KB' }, 400);
  try {
    JSON.parse(body);
  } catch {
    return json({ error: 'body must be JSON ≤ 64KB' }, 400);
  }
  const ip = req.headers.get('CF-Connecting-IP') ?? '';
  const ua = req.headers.get('User-Agent') ?? '';
  await env.DB.prepare('INSERT INTO votes (sub, t, ip, ua, data) VALUES (?, ?, ?, ?, ?)')
    .bind(sub, new Date().toISOString(), ip, ua, body)
    .run();
  return json({ ok: true }, 201);
}

// aggregate folds a share's votes into per-question option counts, deduping
// last-write-wins per (poll, voter) - a direct port of pollagg.go so hosted and
// local /results return the identical shape. Counts only, never IP/UA/voter.
async function aggregate(env: Env, sub: string): Promise<{ polls: Record<string, { total: number; counts: Record<string, number> }>; voters: number }> {
  const { results } = await env.DB.prepare('SELECT data FROM votes WHERE sub = ? ORDER BY id')
    .bind(sub)
    .all<{ data: string }>();

  const latest = new Map<string, string>(); // "poll\x00voter" → choice
  (results ?? []).forEach((row, i) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(row.data);
    } catch {
      return;
    }
    let voter = typeof data.voter === 'string' ? data.voter : '';
    if (!voter) voter = '_l' + i;
    if (typeof data.choice === 'string' && data.choice) {
      const poll = typeof data.poll === 'string' && data.poll ? data.poll : '_';
      latest.set(poll + '\x00' + voter, data.choice);
    }
    if (data.votes && typeof data.votes === 'object') {
      for (const [poll, c] of Object.entries(data.votes as Record<string, unknown>)) {
        if (typeof c === 'string' && c) latest.set(poll + '\x00' + voter, c);
      }
    }
  });

  const polls: Record<string, { total: number; counts: Record<string, number> }> = {};
  const voters = new Set<string>();
  for (const [key, choice] of latest) {
    const [poll, voter] = key.split('\x00');
    const q = (polls[poll] ??= { total: 0, counts: {} });
    q.counts[choice] = (q.counts[choice] ?? 0) + 1;
    q.total++;
    voters.add(voter);
  }
  return { polls, voters: voters.size };
}

// ---- helpers -----------------------------------------------------------------

// injectScript inserts markup before </body> (append as fallback). Port of the
// Go injectScript so injection is identical to the daemon.
function injectScript(html: string, tag: string): string {
  const i = html.toLowerCase().lastIndexOf('</body>');
  if (i >= 0) return html.slice(0, i) + tag + html.slice(i);
  return html + tag;
}

function publicURL(env: Env, sub: string): string {
  if (env.SHARE_DOMAIN) return `https://${sub}.${env.SHARE_DOMAIN}`;
  if (env.PUBLIC_BASE) return `${env.PUBLIC_BASE.replace(/\/$/, '')}/s/${sub}`;
  return `/s/${sub}`; // dev: caller prepends the workers.dev origin
}

function validSub(s: string): boolean {
  if (!s || s.length > 63) return false;
  if (!/^[a-z0-9-]+$/.test(s)) return false;
  return s[0] !== '-' && s[s.length - 1] !== '-';
}

function randSub(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const b = crypto.getRandomValues(new Uint8Array(8));
  for (const x of b) s += alphabet[x % alphabet.length];
  return s;
}

function intVar(v: string, dflt: number): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function json(v: unknown, status = 200): Response {
  return new Response(JSON.stringify(v), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
