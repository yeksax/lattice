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
// Storage: versioned snapshots in R2, metadata + interactions in D1.

import pollBridge from './poll.bridge.txt';
import threadBridge from './thread.bridge.txt';
import chromeBridge from './chrome.bridge.txt';
import stateBridge from './state.bridge.txt';
import { handleOwnerState, handlePublicState, stateDeleteStatement } from './state';
import {
  configureShareAccess,
  handleAuth,
  handleOwnerThreads,
  handlePublicThreads,
  requireShareAccess,
  validateAllowedDomains,
} from './threads';

export interface Env {
  DB: D1Database;
  SNAPSHOTS: R2Bucket;
  SHARE_DOMAIN: string; // subdomain form: <sub>.<SHARE_DOMAIN> (needs wildcard DNS)
  PUBLIC_BASE: string;  // path form: <PUBLIC_BASE>/s/<sub> (a plain custom domain)
  MAX_SNAPSHOT_BYTES: string;
  DEFAULT_MAX_SHARES: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AUTH_BASE: string;
  SESSION_COOKIE_DOMAIN: string;
}

// A shared snapshot is public-by-URL, never public-to-search. Every response
// this Worker emits carries the noindex directive, so a crawler that reaches a
// snapshot (a link pasted in a public channel, a leaked referrer, a wildcard
// scan) is told to drop it instead of listing it.
const NOINDEX = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

// What this deployment can do, for clients that have to work against an older
// one. `thread-signature` is dedupe on pushed discussion rows; `state-meta` is
// `?meta=1` on the owner state dump. Both were added together; both are listed
// separately so a client can degrade one without losing the other.
const CAPABILITIES = ['thread-signature', 'state-meta'];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let res: Response;
    try {
      res = await route(req, env);
    } catch (e) {
      res = json({ error: String((e as Error)?.message ?? e) }, 500);
    }
    // Set here, once, so no future handler can forget it.
    if (!res.headers.has('X-Robots-Tag')) {
      res = new Response(res.body, res);
      res.headers.set('X-Robots-Tag', NOINDEX);
    }
    return res;
  },
};

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // 0. robots.txt. It is per-host, so every <sub>.<SHARE_DOMAIN> needs its own.
  if (path === '/robots.txt') return robotsTxt();

  if (path.startsWith('/auth/')) return handleAuth(req, env, path);

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

  // The daemon probes this before double-writing anything. A backend that does
  // not answer with `thread-signature` cannot dedupe a pushed row, so the
  // daemon must not push at all - re-pushing into a store with no signatures
  // would grow a copy of every comment on every read.
  // no-store because this is a capability probe, not a status page: an edge
  // holding yesterday's answer would tell a current client that the deployment
  // it is talking to cannot dedupe, and it would stop writing for no reason.
  if (path === '/' || path === '/health') {
    return json({ ok: true, service: 'lattice-share', capabilities: CAPABILITIES }, 200, {
      'Cache-Control': 'no-store',
    });
  }
  return json({ error: 'not found' }, 404);
}

// resolveTarget extracts (sub, rest) for public serving. rest is the sub-path:
// '' for the page or the public interaction endpoint path.
function resolveTarget(url: URL, env: Env): { sub: string; rest: string } | null {
  // Subdomain form: <sub>.<SHARE_DOMAIN>
  if (env.SHARE_DOMAIN) {
    const host = url.hostname;
    const suffix = '.' + env.SHARE_DOMAIN;
    if (host.endsWith(suffix)) {
      const sub = host.slice(0, -suffix.length);
      // Reserved hosts are owned by the API, landing page, or legacy path-form
      // share endpoint and must not be interpreted as snapshot subdomains.
      if (sub && !sub.includes('.') && sub !== 'api' && sub !== 'www' && sub !== 'share') {
        return { sub, rest: url.pathname === '/' ? '' : url.pathname };
      }
    }
  }
  // Path form (dev): /s/<sub>[/submit|/results|/threads...]
  const m = url.pathname.match(/^\/s\/([a-z0-9-]+)(\/.*)?$/);
  if (m) return { sub: m[1], rest: m[2] ?? '' };
  return null;
}

// ---- Authenticated share API -------------------------------------------------

export interface Token {
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

  // /v1/shares/<slug>, results, and owner-managed threads.
  const rest = path.slice('/v1/shares/'.length);
  const threadMatch = rest.match(/^(.+?)(\/threads(?:\/.*)?)$/);
  if (threadMatch) {
    return handleOwnerThreads(req, env, tok, decodeURIComponent(threadMatch[1]), threadMatch[2]);
  }
  const stateMatch = rest.match(/^(.+?)(\/state)$/);
  if (stateMatch) {
    return handleOwnerState(req, env, tok, decodeURIComponent(stateMatch[1]), stateMatch[2]);
  }
  // Snapshot history: the list, and one past revision's HTML. Owner-only —
  // publishing a new version is meant to replace what readers see, so an old
  // revision must not be reachable from the public side.
  const versionsMatch = rest.match(/^(.+?)\/versions(?:\/(\d+))?$/);
  if (versionsMatch) {
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
    const slug = decodeURIComponent(versionsMatch[1]);
    return versionsMatch[2]
      ? shareVersionHTML(env, tok, slug, parseInt(versionsMatch[2], 10))
      : shareVersions(env, tok, slug);
  }
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
  allowed_domains?: string[];
}

async function createShare(req: Request, env: Env, tok: Token): Promise<Response> {
  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON: {slug, html, sub?, title?, random?, allowed_domains?}' }, 400);
  }
  const slug = (body.slug ?? '').trim();
  const html = body.html ?? '';
  if (!slug || !html) return json({ error: 'slug and html are required' }, 400);
  const allowedDomains = validateAllowedDomains(body.allowed_domains);
  if (allowedDomains === null) {
    return json({ error: 'allowed_domains must contain valid domain names' }, 400);
  }

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

  // Access changes happen before the live snapshot pointer moves. A failed
  // domain-gated publish therefore fails closed instead of briefly exposing the
  // new snapshot. A brand-new share without a policy is explicitly public.
  await configureShareAccess(env, sub, existing ? allowedDomains : (allowedDomains ?? []));

  let version = 1;
  if (existing) {
    const versionRow = await env.DB.prepare(
      'SELECT MAX(version) AS version FROM snapshot_versions WHERE sub = ?',
    )
      .bind(sub)
      .first<{ version: number | null }>();
    if (versionRow?.version) {
      version = versionRow.version + 1;
    } else {
      // A legacy share predates explicit versions. Preserve its current object
      // as version 1 before moving the live pointer to version 2.
      const legacy = await env.SNAPSHOTS.get(existing.r2_key);
      if (legacy) {
        const legacyKey = `snap/${sub}/v1`;
        await env.SNAPSHOTS.put(legacyKey, legacy.body, {
          httpMetadata: { contentType: 'text/html; charset=utf-8' },
        });
        await env.DB.prepare(
          'INSERT OR IGNORE INTO snapshot_versions (sub, version, r2_key, created) VALUES (?, 1, ?, ?)',
        )
          .bind(sub, legacyKey, now)
          .run();
      }
      version = 2;
    }
  }
  const r2Key = `snap/${sub}/v${version}`;
  await env.SNAPSHOTS.put(r2Key, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });

  const versionInsert = env.DB.prepare(
    'INSERT INTO snapshot_versions (sub, version, r2_key, created) VALUES (?, ?, ?, ?)',
  ).bind(sub, version, r2Key, now);
  if (existing) {
    await env.DB.batch([
      env.DB.prepare('UPDATE shares SET r2_key = ?, title = ?, updated = ? WHERE sub = ?')
        .bind(r2Key, body.title ?? null, now, sub),
      versionInsert,
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO shares (sub, token, slug, r2_key, title, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(sub, tok.token, slug, r2Key, body.title ?? null, now, now),
      versionInsert,
    ]);
  }

  return json({ slug, sub, url: publicURL(env, sub), version }, existing ? 200 : 201);
}

// The dashboard's shared view is the only place an owner sees a share without
// opening it, so the listing carries everything that page shows: not just the
// URL and the access policy, but how many revisions the snapshot has and how
// much conversation happened on it. All of it is one round trip of subqueries
// against indexed columns — cheaper than the N follow-up requests a thinner
// payload would cost.
async function listShares(env: Env, tok: Token): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT s.sub, s.slug, s.title, s.created, s.updated,
            (SELECT sa.allowed_domains FROM share_access sa
              WHERE sa.sub = s.sub AND sa.mode = 'domain') AS allowed_domains,
            (SELECT COUNT(*) FROM votes v WHERE v.sub = s.sub) AS votes,
            (SELECT MAX(sv.version) FROM snapshot_versions sv WHERE sv.sub = s.sub) AS version,
            (SELECT COUNT(*) FROM threads th WHERE th.sub = s.sub) AS threads,
            (SELECT COUNT(*) FROM threads th
              WHERE th.sub = s.sub AND th.status = 'open') AS threads_open,
            (SELECT COUNT(*) FROM comments c
               JOIN threads th ON th.id = c.thread_id
              WHERE th.sub = s.sub AND c.body != '') AS comments
     FROM shares s WHERE s.token = ? ORDER BY s.updated DESC`,
  )
    .bind(tok.token)
    .all<{
      sub: string;
      slug: string;
      title: string | null;
      created: number;
      updated: number;
      votes: number;
      version: number | null;
      threads: number;
      threads_open: number;
      comments: number;
      allowed_domains: string | null;
    }>();
  return json(
    (results ?? []).map((r) => ({
      slug: r.slug,
      sub: r.sub,
      title: r.title,
      url: publicURL(env, r.sub),
      created: r.created,
      updated: r.updated,
      votes: r.votes,
      // A share published before snapshot_versions existed has no rows there
      // and is version 1 by definition — the same reading createShare uses.
      version: r.version ?? 1,
      threads: r.threads,
      threads_open: r.threads_open,
      comments: r.comments,
      domains: parseStringArray(r.allowed_domains),
    })),
  );
}

async function deleteShare(env: Env, tok: Token, slug: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT sub, r2_key FROM shares WHERE token = ? AND slug = ?')
    .bind(tok.token, slug)
    .first<{ sub: string; r2_key: string }>();
  if (!row) return json({ error: `not shared: ${slug}` }, 404);
  const versions = await env.DB.prepare('SELECT r2_key FROM snapshot_versions WHERE sub = ?')
    .bind(row.sub)
    .all<{ r2_key: string }>();
  const keys = new Set([row.r2_key, ...(versions.results ?? []).map((version) => version.r2_key)]);
  await Promise.all([...keys].map((key) => env.SNAPSHOTS.delete(key)));
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM comment_revisions
        WHERE comment_id IN (
          SELECT c.id FROM comments c
          JOIN threads t ON t.id = c.thread_id
          WHERE t.sub = ?
        )`,
    ).bind(row.sub),
    env.DB.prepare(
      `DELETE FROM comment_reactions
        WHERE comment_id IN (
          SELECT c.id FROM comments c
          JOIN threads t ON t.id = c.thread_id
          WHERE t.sub = ?
        )`,
    ).bind(row.sub),
    env.DB.prepare('DELETE FROM comments WHERE thread_id IN (SELECT id FROM threads WHERE sub = ?)')
      .bind(row.sub),
    env.DB.prepare('DELETE FROM threads WHERE sub = ?').bind(row.sub),
    stateDeleteStatement(env, row.sub),
    env.DB.prepare('DELETE FROM snapshot_versions WHERE sub = ?').bind(row.sub),
    env.DB.prepare('DELETE FROM share_access WHERE sub = ?').bind(row.sub),
    env.DB.prepare('DELETE FROM shares WHERE sub = ?').bind(row.sub),
  ]);
  // Votes are kept (mirrors local unshare: poll data survives).
  return new Response(null, { status: 204 });
}

// shareVersions lists the snapshot revisions of a share, newest first. Sizes
// come from R2 metadata, one HEAD per revision, issued in parallel; a share
// that predates snapshot_versions reports the single version it implicitly is.
async function shareVersions(env: Env, tok: Token, slug: string): Promise<Response> {
  const share = await env.DB.prepare(
    'SELECT sub, r2_key, created, updated FROM shares WHERE token = ? AND slug = ?',
  )
    .bind(tok.token, slug)
    .first<{ sub: string; r2_key: string; created: number; updated: number }>();
  if (!share) return json({ error: `not shared: ${slug}` }, 404);

  const { results } = await env.DB.prepare(
    'SELECT version, r2_key, created FROM snapshot_versions WHERE sub = ? ORDER BY version DESC',
  )
    .bind(share.sub)
    .all<{ version: number; r2_key: string; created: number }>();

  const rows = (results ?? []).length
    ? (results ?? [])
    : [{ version: 1, r2_key: share.r2_key, created: share.created }];

  const versions = await Promise.all(
    rows.map(async (row) => {
      const head = await env.SNAPSHOTS.head(row.r2_key).catch(() => null);
      return {
        version: row.version,
        created: row.created,
        size: head?.size ?? 0,
        // The live one is whatever the share row points at, not simply the
        // highest number: that stays true if a rollback ever moves the pointer.
        current: row.r2_key === share.r2_key,
      };
    }),
  );
  return json({ slug, sub: share.sub, versions });
}

// shareVersionHTML returns one past revision as it was uploaded: no bridges,
// no chrome. The dashboard frames it as a preview of what readers saw then.
async function shareVersionHTML(env: Env, tok: Token, slug: string, version: number): Promise<Response> {
  const share = await env.DB.prepare('SELECT sub, r2_key FROM shares WHERE token = ? AND slug = ?')
    .bind(tok.token, slug)
    .first<{ sub: string; r2_key: string }>();
  if (!share) return json({ error: `not shared: ${slug}` }, 404);

  let key = share.r2_key;
  const row = await env.DB.prepare(
    'SELECT r2_key FROM snapshot_versions WHERE sub = ? AND version = ?',
  )
    .bind(share.sub, version)
    .first<{ r2_key: string }>();
  if (row) {
    key = row.r2_key;
  } else if (version !== 1) {
    return json({ error: `no version ${version} of ${slug}` }, 404);
  }

  const obj = await env.SNAPSHOTS.get(key);
  if (!obj) return json({ error: 'snapshot is gone' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': NOINDEX,
      'Referrer-Policy': 'no-referrer',
    },
  });
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
  const denied = await requireShareAccess(req, env, sub);
  if (denied) return denied;
  if (rest === '/threads' || rest.startsWith('/threads/')) {
    return handlePublicThreads(req, env, sub, rest);
  }
  if (rest === '/state') {
    return handlePublicState(req, env, sub, rest);
  }
  if (rest === '/submit') {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    return recordVote(req, env, sub);
  }
  if (rest === '/results') {
    return json(await aggregate(env, sub));
  }
  if (rest !== '' && rest !== '/download') return json({ error: 'not found' }, 404);
  // The page itself.
  const share = await env.DB.prepare('SELECT r2_key FROM shares WHERE sub = ?')
    .bind(sub)
    .first<{ r2_key: string }>();
  if (!share) return new Response('gone', { status: 404 });
  const obj = await env.SNAPSHOTS.get(share.r2_key);
  if (!obj) return new Response('gone', { status: 404 });

  // The chrome's Download action: the snapshot as uploaded, with none of the
  // bridges injected. What the reader saves is the file the author wrote.
  if (rest === '/download') {
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${sub}.html"`,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': NOINDEX,
        'Referrer-Policy': 'no-referrer',
      },
    });
  }

  const html = await obj.text();
  // Endpoints are relative - resolve against whatever origin served the page,
  // so subdomain (prod) and /s/<sub> (dev) both work without hard-coding.
  const base = new URL(req.url).pathname.startsWith('/s/') ? `/s/${sub}` : '';
  const pollTag =
    `<script id="lattice-poll" data-endpoint="${base}/submit" data-results="${base}/results">` +
    pollBridge +
    `</script>`;
  const threadTag =
    `<script id="lattice-comments" data-endpoint="${base}/threads">` +
    threadBridge +
    `</script>`;
  // A slower poll than the daemon's: a hosted reader's tab should not bill a
  // request every four seconds for a page nobody else is editing.
  const stateTag =
    `<script id="lattice-state" data-endpoint="${base}/state" data-poll="20000">` +
    stateBridge +
    `</script>`;
  // Reader chrome: the dashboard's top bar, minus home, search, Raw and Share.
  // Injected BEFORE the comment bridge so it can claim the launcher — the
  // Comment action belongs in the bar, not in a second floating button.
  const chromeTag = `<script id="lattice-chrome" data-base="${base}">` + chromeBridge + `</script>`;
  // stateTag first: poll.js fires the shared `lattice:ready`, so the state
  // bridge must already exist when a page's ready handler runs.
  const page = injectScript(
    injectScript(injectScript(injectScript(html, stateTag), pollTag), chromeTag),
    threadTag,
  );
  return new Response(injectNoindex(page), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': NOINDEX,
      // A snapshot URL is the secret. Without this, every outbound click hands
      // that URL to a third party, where it lands in logs and analytics and
      // eventually in a crawler's queue.
      'Referrer-Policy': 'no-referrer',
    },
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

// robotsTxt answers on every host this Worker serves: <sub>.<SHARE_DOMAIN>,
// share.<SHARE_DOMAIN> and api.<SHARE_DOMAIN>. The marketing site sits on the
// apex, which this Worker never handles, so its own robots.txt is untouched.
//
// Note what is NOT disallowed: the snapshot itself. Blocking the crawl would
// stop a crawler from ever reading the noindex header, and Google lists a
// robots-blocked URL it found in a link anyway — that is the "No information is
// available for this page" result everybody has seen. Letting it fetch the page
// is what gets the URL dropped rather than listed.
function robotsTxt(): Response {
  const body = [
    'User-agent: *',
    'Disallow: /v1/',
    'Disallow: /auth/',
    'Disallow: /submit',
    'Disallow: /results',
    'Disallow: /threads',
    'Disallow: /state',
    '',
  ].join('\n');
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': NOINDEX, 'Cache-Control': 'no-store' },
  });
}

// injectNoindex puts the meta tag in the served HTML. The header above is the
// authoritative signal; this covers crawlers that only parse markup, and it
// survives the page being saved and re-hosted somewhere else. Snapshots on disk
// are never modified — the tag exists only in the response, like the poll bridge.
function injectNoindex(html: string): string {
  const tag = '<meta name="robots" content="noindex, nofollow, noarchive">';
  // Anchored on <head> proper: a bare "<head" prefix also matches the <header>
  // every summary has in its body, which would bury the tag mid-document.
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  // No <head>: the parser builds one implicitly and a leading <meta> lands in
  // it. Stay after the doctype so the document does not fall into quirks mode.
  const m = html.match(/^\s*<!doctype[^>]*>/i);
  const at = m ? m[0].length : 0;
  return html.slice(0, at) + tag + html.slice(at);
}

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

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function json(v: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(v), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
