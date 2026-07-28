import type { Env, Token } from './index';
import fluidBridge from './denied.fluid.txt';

const SESSION_COOKIE = 'lattice_session';
const STATE_COOKIE = 'lattice_oidc_state';
const SESSION_TTL = 60 * 60 * 24 * 30;
const STATE_TTL = 10 * 60;
const MAX_COMMENT_BYTES = 16 * 1024;

interface Actor {
  id: string;
  email: string;
  name: string;
  domain: string | null;
}

interface GoogleTokenInfo {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  hd?: string;
  iss?: string;
  exp?: string;
}

export async function handleAuth(req: Request, env: Env, path: string): Promise<Response> {
  if (path === '/auth/google/start' && req.method === 'GET') return startGoogle(req, env);
  if (path === '/auth/google/callback' && req.method === 'GET') return finishGoogle(req, env);
  if (path === '/auth/logout' && req.method === 'POST') {
    const raw = cookie(req, SESSION_COOKIE);
    if (raw) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(raw)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE, req, env) });
  }
  return json({ error: 'not found' }, 404);
}

async function startGoogle(req: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return json({ error: 'Google authentication is not configured' }, 503);
  }
  const url = new URL(req.url);
  const returnTo = safeReturnTo(url.searchParams.get('return_to') ?? '', req, env);
  if (!returnTo) return json({ error: 'invalid return_to' }, 400);

  const state = randomToken(24);
  const nonce = randomToken(24);
  const expires = now() + STATE_TTL;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_states WHERE expires < ?').bind(now()),
    env.DB.prepare('INSERT INTO auth_states (state, nonce, return_to, expires) VALUES (?, ?, ?, ?)')
      .bind(state, nonce, returnTo, expires),
  ]);

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('redirect_uri', callbackURL(req, env));
  auth.searchParams.set('state', state);
  auth.searchParams.set('nonce', nonce);
  auth.searchParams.set('prompt', 'select_account');
  const domain = await requestedDomain(env, returnTo);
  if (domain) auth.searchParams.set('hd', domain);

  return redirect(auth.toString(), {
    'Set-Cookie': stateCookie(state, req),
  });
}

async function finishGoogle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!state || !code || cookie(req, STATE_COOKIE) !== state) {
    return json({ error: 'invalid OAuth state' }, 400);
  }
  const row = await env.DB.prepare(
    'SELECT nonce, return_to, expires FROM auth_states WHERE state = ?',
  )
    .bind(state)
    .first<{ nonce: string; return_to: string; expires: number }>();
  await env.DB.prepare('DELETE FROM auth_states WHERE state = ?').bind(state).run();
  if (!row || row.expires < now()) return json({ error: 'expired OAuth state' }, 400);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackURL(req, env),
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json<{ id_token?: string; error?: string }>();
  if (!tokenRes.ok || !tokens.id_token) return json({ error: tokens.error ?? 'token exchange failed' }, 401);

  const infoRes = await fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokens.id_token),
  );
  const info = await infoRes.json<GoogleTokenInfo>();
  const claims = decodeJWT(tokens.id_token);
  const validIssuer = info.iss === 'https://accounts.google.com' || info.iss === 'accounts.google.com';
  if (
    !infoRes.ok ||
    !validIssuer ||
    info.aud !== env.GOOGLE_CLIENT_ID ||
    !info.sub ||
    !info.email ||
    info.email_verified !== 'true' ||
    Number(info.exp ?? 0) <= now() ||
    claims.nonce !== row.nonce
  ) {
    return json({ error: 'invalid Google identity' }, 401);
  }

  const actorID = 'google_' + await sha256(info.sub);
  const created = now();
  await env.DB.prepare(
    `INSERT INTO actors
       (id, provider, provider_subject, email, name, domain, created, updated)
     VALUES (?, 'google', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_subject) DO UPDATE SET
       email = excluded.email, name = excluded.name,
       domain = excluded.domain, updated = excluded.updated`,
  )
    .bind(actorID, info.sub, info.email, info.name || info.email, info.hd ?? null, created, created)
    .run();

  const session = randomToken(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()),
    env.DB.prepare('INSERT INTO sessions (token_hash, actor_id, expires, created) VALUES (?, ?, ?, ?)')
      .bind(await sha256(session), actorID, now() + SESSION_TTL, now()),
  ]);
  return redirect(row.return_to, {
    'Set-Cookie': sessionCookie(session, req, env),
  });
}

export async function requireShareAccess(
  req: Request,
  env: Env,
  sub: string,
): Promise<Response | null> {
  const policy = await accessPolicy(env, sub);
  if (policy.mode === 'public') return null;
  const actor = await sessionActor(req, env);
  if (!actor) {
    const start = authBase(req, env) + '/auth/google/start?return_to=' + encodeURIComponent(req.url);
    return redirect(start);
  }
  if (!actor.domain || !policy.domains.includes(actor.domain.toLowerCase())) {
    return accessDeniedPage(actor, policy.domains, loginURL(req, env));
  }
  return null;
}

export async function configureShareAccess(
  env: Env,
  sub: string,
  domains: string[] | undefined,
): Promise<void> {
  if (domains === undefined) return;
  const clean = normalizeDomains(domains);
  if (clean.length === 0) {
    await env.DB.prepare('DELETE FROM share_access WHERE sub = ?').bind(sub).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO share_access (sub, mode, allowed_domains) VALUES (?, 'domain', ?)
     ON CONFLICT(sub) DO UPDATE SET mode = 'domain', allowed_domains = excluded.allowed_domains`,
  )
    .bind(sub, JSON.stringify(clean))
    .run();
}

export function validateAllowedDomains(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  const clean = normalizeDomains(value);
  return clean.length === value.length ? clean : null;
}

export async function handlePublicThreads(
  req: Request,
  env: Env,
  sub: string,
  rest: string,
): Promise<Response> {
  if (!(await liveShare(env, sub))) return new Response('gone', { status: 404 });
  const denied = await requireShareAccess(req, env, sub);
  if (denied) return denied;

  if (rest === '/threads' && req.method === 'GET') {
    const viewer = await sessionActor(req, env);
    return json(await listThreads(env, sub, viewer?.id ?? null));
  }
  const actor = await sessionActor(req, env);
  if (!actor) {
    return json({ error: 'authentication required', login: loginURL(req, env) }, 401);
  }
  if (rest === '/threads' && req.method === 'POST') {
    return createThread(req, env, sub, actor);
  }
  const comment = rest.match(/^\/threads\/([^/]+)\/comments$/);
  if (comment && req.method === 'POST') {
    return addComment(req, env, sub, comment[1], actor);
  }
  const mutation = rest.match(/^\/threads\/([^/]+)\/comments\/([^/]+)$/);
  if (mutation && (req.method === 'PATCH' || req.method === 'DELETE')) {
    return mutateComment(req, env, sub, mutation[1], mutation[2], actor);
  }
  return json({ error: 'not found' }, 404);
}

export async function handleOwnerThreads(
  req: Request,
  env: Env,
  tok: Token,
  slug: string,
  rest: string,
): Promise<Response> {
  const share = await env.DB.prepare('SELECT sub FROM shares WHERE token = ? AND slug = ?')
    .bind(tok.token, slug)
    .first<{ sub: string }>();
  if (!share) return json({ error: `not shared: ${slug}` }, 404);
  const actor = await ownerActor(env, tok);

  if (rest === '/threads' && req.method === 'GET') {
    return json({ slug, threads: await listThreads(env, share.sub, actor.id) });
  }
  if (rest === '/threads' && req.method === 'POST') {
    return createThread(req, env, share.sub, actor);
  }
  const comments = rest.match(/^\/threads\/([^/]+)\/comments$/);
  if (comments && req.method === 'POST') {
    return addComment(req, env, share.sub, comments[1], actor);
  }
  const mutation = rest.match(/^\/threads\/([^/]+)\/comments\/([^/]+)$/);
  if (mutation && (req.method === 'PATCH' || req.method === 'DELETE')) {
    return mutateComment(req, env, share.sub, mutation[1], mutation[2], actor);
  }
  const status = rest.match(/^\/threads\/([^/]+)\/(resolve|reopen)$/);
  if (status && req.method === 'POST') {
    const next = status[2] === 'resolve' ? 'resolved' : 'open';
    const result = await env.DB.prepare(
      'UPDATE threads SET status = ?, updated = ? WHERE id = ? AND sub = ?',
    )
      .bind(next, now(), status[1], share.sub)
      .run();
    if (!result.meta.changes) return json({ error: 'thread not found' }, 404);
    return json({ id: status[1], status: next });
  }
  return json({ error: 'not found' }, 404);
}

async function createThread(req: Request, env: Env, sub: string, actor: Actor): Promise<Response> {
  let body: { selector?: string; anchor_text?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const selector = (body.selector ?? '').trim();
  const text = (body.body ?? '').trim();
  if (!selector || selector.length > 500) return json({ error: 'selector is required (max 500 chars)' }, 400);
  if (!validComment(text)) return json({ error: 'comment is required (max 16KB)' }, 400);
  if (await commentRateLimited(env, actor.id)) return json({ error: 'comment rate limit exceeded' }, 429);

  const id = 'thr_' + randomToken(12);
  const commentID = 'cmt_' + randomToken(12);
  const created = now();
  const version = await currentVersion(env, sub);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO threads
         (id, sub, selector, anchor_text, snapshot_version_created, status,
          created_by, created, updated)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).bind(id, sub, selector, (body.anchor_text ?? '').trim().slice(0, 500) || null, version, actor.id, created, created),
    env.DB.prepare(
      'INSERT INTO comments (id, thread_id, actor_id, body, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(commentID, id, actor.id, text, created, created),
  ]);
  return json({ id, selector, snapshot_version_created: version, status: 'open' }, 201);
}

async function addComment(
  req: Request,
  env: Env,
  sub: string,
  threadID: string,
  actor: Actor,
): Promise<Response> {
  let body: { body?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const text = (body.body ?? '').trim();
  if (!validComment(text)) return json({ error: 'comment is required (max 16KB)' }, 400);
  if (await commentRateLimited(env, actor.id)) return json({ error: 'comment rate limit exceeded' }, 429);
  const thread = await env.DB.prepare('SELECT id FROM threads WHERE id = ? AND sub = ?')
    .bind(threadID, sub)
    .first();
  if (!thread) return json({ error: 'thread not found' }, 404);
  const id = 'cmt_' + randomToken(12);
  const created = now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO comments (id, thread_id, actor_id, body, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, threadID, actor.id, text, created, created),
    env.DB.prepare('UPDATE threads SET updated = ? WHERE id = ?').bind(created, threadID),
  ]);
  return json({ id, thread_id: threadID, created }, 201);
}

async function mutateComment(
  req: Request,
  env: Env,
  sub: string,
  threadID: string,
  commentID: string,
  actor: Actor,
): Promise<Response> {
  const comment = await env.DB.prepare(
    `SELECT c.body, c.created, c.updated
       FROM comments c
       JOIN threads t ON t.id = c.thread_id
      WHERE c.id = ? AND c.thread_id = ? AND t.sub = ?
        AND c.actor_id = ? AND c.body <> ''`,
  )
    .bind(commentID, threadID, sub, actor.id)
    .first<{ body: string; created: number; updated: number }>();
  if (!comment) return json({ error: 'comment not found' }, 404);

  let nextBody = '';
  let action: 'edit' | 'delete' = 'delete';
  if (req.method === 'PATCH') {
    let body: { body?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'body must be JSON' }, 400);
    }
    nextBody = (body.body ?? '').trim();
    if (!validComment(nextBody)) return json({ error: 'comment is required (max 16KB)' }, 400);
    action = 'edit';
    if (nextBody === comment.body) {
      return json({
        id: commentID,
        thread_id: threadID,
        body: comment.body,
        created: comment.created,
        updated: comment.updated,
        deleted: false,
        edited: true,
        can_edit: true,
      });
    }
  }

  const updated = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO comment_revisions
         (id, comment_id, actor_id, body, action, created)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind('rev_' + randomToken(12), commentID, actor.id, comment.body, action, updated),
    env.DB.prepare(
      'UPDATE comments SET body = ?, updated = ? WHERE id = ? AND actor_id = ?',
    ).bind(nextBody, updated, commentID, actor.id),
    env.DB.prepare('UPDATE threads SET updated = ? WHERE id = ? AND sub = ?')
      .bind(updated, threadID, sub),
  ]);
  return json({
    id: commentID,
    thread_id: threadID,
    body: nextBody,
    created: comment.created,
    updated,
    deleted: action === 'delete',
    edited: action === 'edit',
    can_edit: action !== 'delete',
  });
}

async function listThreads(env: Env, sub: string, viewerActorID: string | null): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.selector, t.anchor_text, t.snapshot_version_created,
            t.status, t.created, t.updated
      FROM threads t
      WHERE t.sub = ?
      ORDER BY t.updated DESC
      LIMIT 200`,
  )
    .bind(sub)
    .all<{
      id: string;
      selector: string;
      anchor_text: string | null;
      snapshot_version_created: number;
      status: string;
      created: number;
      updated: number;
    }>();
  const out: unknown[] = [];
  for (const thread of results ?? []) {
    const comments = await env.DB.prepare(
      `SELECT c.id, c.body, c.created, c.updated, c.actor_id, a.name AS author,
              EXISTS (
                SELECT 1 FROM comment_revisions r
                 WHERE r.comment_id = c.id AND r.action = 'edit'
              ) AS edited,
              a.provider AS author_provider
         FROM comments c
         JOIN actors a ON a.id = c.actor_id
        WHERE c.thread_id = ?
        ORDER BY c.created
        LIMIT 500`,
    )
      .bind(thread.id)
      .all<{
        id: string;
        body: string;
        created: number;
        updated: number;
        actor_id: string;
        author: string;
        author_provider: string;
        edited: number;
      }>();
    const visibleComments = (comments.results ?? []).map(({ actor_id, ...comment }) => ({
      ...comment,
      edited: Boolean(comment.edited) && comment.body !== '',
      deleted: comment.body === '',
      can_edit: comment.body !== '' && actor_id === viewerActorID,
    }));
    out.push({ ...thread, comments: visibleComments });
  }
  return out;
}

// viewerActorID is the identity the state bridge writes user-scoped keys under
// when the reader is signed in. Anonymous readers fall back to the browser id
// they send themselves - see state.ts.
export async function viewerActorID(req: Request, env: Env): Promise<string | null> {
  const actor = await sessionActor(req, env);
  return actor?.id ?? null;
}

async function sessionActor(req: Request, env: Env): Promise<Actor | null> {
  const raw = cookie(req, SESSION_COOKIE);
  if (!raw) return null;
  return (
    (await env.DB.prepare(
      `SELECT a.id, a.email, a.name, a.domain
         FROM sessions s JOIN actors a ON a.id = s.actor_id
        WHERE s.token_hash = ? AND s.expires > ?`,
    )
      .bind(await sha256(raw), now())
      .first<Actor>()) ?? null
  );
}

async function ownerActor(env: Env, tok: Token): Promise<Actor> {
  const subject = tok.owner;
  const id = 'owner_' + await sha256(subject);
  const created = now();
  await env.DB.prepare(
    `INSERT INTO actors
       (id, provider, provider_subject, email, name, domain, created, updated)
     VALUES (?, 'lattice', ?, '', ?, NULL, ?, ?)
     ON CONFLICT(provider, provider_subject) DO UPDATE SET
       name = excluded.name, updated = excluded.updated`,
  )
    .bind(id, subject, subject, created, created)
    .run();
  return { id, email: '', name: subject, domain: null };
}

async function currentVersion(env: Env, sub: string): Promise<number> {
  const row = await env.DB.prepare('SELECT MAX(version) AS version FROM snapshot_versions WHERE sub = ?')
    .bind(sub)
    .first<{ version: number | null }>();
  return row?.version ?? 1;
}

async function requestedDomain(env: Env, returnTo: string): Promise<string | null> {
  const url = new URL(returnTo);
  let sub = '';
  if (env.SHARE_DOMAIN && url.hostname.endsWith('.' + env.SHARE_DOMAIN)) {
    sub = url.hostname.slice(0, -(env.SHARE_DOMAIN.length + 1));
  } else {
    const match = url.pathname.match(/^\/s\/([a-z0-9-]+)/);
    sub = match?.[1] ?? '';
  }
  if (!sub) return null;
  const policy = await accessPolicy(env, sub);
  return policy.domains.length === 1 ? policy.domains[0] : null;
}

async function accessPolicy(env: Env, sub: string): Promise<{ mode: string; domains: string[] }> {
  const row = await env.DB.prepare('SELECT mode, allowed_domains FROM share_access WHERE sub = ?')
    .bind(sub)
    .first<{ mode: string; allowed_domains: string }>();
  if (!row || row.mode !== 'domain') return { mode: 'public', domains: [] };
  try {
    return { mode: 'domain', domains: normalizeDomains(JSON.parse(row.allowed_domains)) };
  } catch {
    return { mode: 'domain', domains: [] };
  }
}

async function liveShare(env: Env, sub: string): Promise<boolean> {
  return Boolean(await env.DB.prepare('SELECT 1 FROM shares WHERE sub = ?').bind(sub).first());
}

async function commentRateLimited(env: Env, actorID: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM comments WHERE actor_id = ? AND created >= ?',
  )
    .bind(actorID, now() - 60)
    .first<{ count: number }>();
  return (row?.count ?? 0) >= 30;
}

function loginURL(req: Request, env: Env): string {
  const requested = req.headers.get('X-Lattice-Return-To') ?? '';
  const fallback = new URL(req.url);
  fallback.pathname = fallback.pathname.replace(/\/threads(?:\/.*)?$/, '') || '/';
  fallback.search = '';
  const returnTo = safeReturnTo(requested, req, env) ?? fallback.toString();
  return authBase(req, env) + '/auth/google/start?return_to=' + encodeURIComponent(returnTo);
}

function authBase(req: Request, env: Env): string {
  return (env.AUTH_BASE || new URL(req.url).origin).replace(/\/$/, '');
}

function callbackURL(req: Request, env: Env): string {
  return authBase(req, env) + '/auth/google/callback';
}

function safeReturnTo(value: string, req: Request, env: Env): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin === new URL(req.url).origin) return url.toString();
  if (env.SHARE_DOMAIN) {
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== env.SHARE_DOMAIN && !url.hostname.endsWith('.' + env.SHARE_DOMAIN)) return null;
    return url.toString();
  }
  return url.origin === new URL(req.url).origin ? url.toString() : null;
}

function normalizeDomains(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toLowerCase().replace(/^@/, ''))
    .filter(validDomain))];
}

function validDomain(value: string): boolean {
  if (value.length > 253 || !value.includes('.')) return false;
  return value.split('.').every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function validComment(value: string): boolean {
  return value.length > 0 && new TextEncoder().encode(value).length <= MAX_COMMENT_BYTES;
}

function cookie(req: Request, name: string): string {
  const raw = req.headers.get('Cookie') ?? '';
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function stateCookie(value: string, req: Request): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=${STATE_TTL}${secure}`;
}

function sessionCookie(value: string, req: Request, env: Env): string {
  const url = new URL(req.url);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const domain = env.SESSION_COOKIE_DOMAIN ? `; Domain=${env.SESSION_COOKIE_DOMAIN}` : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}${domain}${secure}`;
}

function clearCookie(name: string, req: Request, env: Env): string {
  const domain = env.SESSION_COOKIE_DOMAIN ? `; Domain=${env.SESSION_COOKIE_DOMAIN}` : '';
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${domain}${secure}`;
}

function randomToken(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(data);
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64url(new Uint8Array(hash));
}

function base64url(value: Uint8Array): string {
  let raw = '';
  for (const byte of value) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJWT(token: string): Record<string, unknown> {
  try {
    let part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    part += '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(part));
  } catch {
    return {};
  }
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// Access-denied gate for domain-restricted shares. Lives outside the snapshot
// chrome on purpose: the reader never reached the HTML, so this page has to
// carry the Lattice identity itself. Kept as one Response so the Worker has no
// extra asset to fetch.
function accessDeniedPage(actor: Actor, domains: string[], retryURL: string): Response {
  const chips = domains
    .map(
      (d) =>
        `<li><span class="chip"><span class="mono" aria-hidden="true">${escapeHTML(
          (d[0] || '?').toUpperCase(),
        )}</span>@${escapeHTML(d)}</span></li>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Access denied · lattice</title>
<style>
  :root {
    --paper: #ffffff;
    --paper-2: #f7f7f5;
    --ink: #141414;
    --ink-2: #545454;
    --muted: #8b8b8b;
    --line: #e6e6e4;
    --line-2: #c9c9c6;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, ui-serif, serif;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --ease: cubic-bezier(0.16, 1, 0.3, 1);
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    min-height: 100%;
    font: 400 16px/1.65 var(--sans);
    color: var(--ink);
    background:
      radial-gradient(120% 80% at 12% -10%, #f3f1eb 0%, transparent 55%),
      radial-gradient(90% 70% at 100% 0%, #eef2f0 0%, transparent 48%),
      var(--paper);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  /*
    One paint stack, no z-index isolation — difference only works when the
    wash is in the same backdrop as the copy. Fluid first in DOM, then grain,
    then main. White type + difference → black on paper, white on ink.
  */
  #fluid {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
    mix-blend-mode: multiply;
  }
  .grain {
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: 0.035;
    mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  main {
    position: relative;
    display: flex;
    min-height: 100%;
    align-items: center;
    width: min(100%, 72rem);
    margin: 0 auto;
    padding: clamp(2.5rem, 10vh, 6rem) clamp(1.5rem, 5vw, 2.5rem);
  }
  .panel { width: min(100%, 34rem); }
  .copy {
    mix-blend-mode: difference;
    color: #fff;
  }
  .brand {
    display: inline-block;
    font-family: var(--serif);
    font-size: 21px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: #fff;
    text-decoration: none;
  }
  .brand:hover { color: #e8e8e8; }
  .eyebrow {
    margin: 2.25rem 0 0;
    font-family: var(--mono);
    font-size: 13px;
    color: #c8c8c8;
  }
  h1 {
    margin: 0.85rem 0 0;
    font-family: var(--serif);
    font-size: clamp(2rem, 4.4vw, 2.85rem);
    font-weight: 500;
    line-height: 1.08;
    letter-spacing: -0.02em;
    color: #fff;
    text-wrap: balance;
  }
  .lede {
    margin: 1.15rem 0 0;
    max-width: 38ch;
    color: #dedede;
    font-size: 1.0625rem;
    line-height: 1.7;
    text-wrap: pretty;
  }
  .signed {
    margin: 1.75rem 0 0;
    color: #c8c8c8;
    font-size: 0.9375rem;
  }
  .signed strong {
    color: #f2f2f2;
    font-weight: 500;
  }
  /* Solid chrome — kept out of the difference group on purpose. */
  .chrome {
    animation: rise 0.65s var(--ease) both;
    animation-delay: 0.12s;
  }
  .domains {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    list-style: none;
    margin: 1.5rem 0 0;
    padding: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
    padding: 0 0.85rem 0 0.45rem;
    border: 1px solid rgba(20, 20, 20, 0.14);
    border-radius: 999px;
    background: #fff;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
    color: var(--ink);
    font-family: var(--mono);
    font-size: 13px;
  }
  .mono {
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 999px;
    background: #efefed;
    color: var(--ink-2);
    font-size: 11px;
    font-weight: 500;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 2rem;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    min-height: 2.85rem;
    padding: 0 1.35rem;
    border: 1px solid #141414;
    border-radius: 999px;
    background: #141414;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
    color: #fff;
    font-family: var(--mono);
    font-size: 13.5px;
    text-decoration: none;
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      transform 0.2s var(--ease);
  }
  .btn:hover {
    background: #2a2a2a;
    border-color: #2a2a2a;
    transform: translateY(-1px);
  }
  .btn:active { transform: translateY(0) scale(0.98); }
  .btn:focus-visible {
    outline: 2px solid #141414;
    outline-offset: 3px;
  }
  .btn svg { width: 14px; height: 14px; flex: 0 0 auto; }
  /* Transform only — opacity on a difference layer kills the blend. */
  @keyframes rise {
    from { transform: translateY(10px); }
    to { transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .chrome { animation: none; }
    .btn { transition: none; }
    .btn:hover { transform: none; }
  }
</style>
</head>
<body>
  <canvas id="fluid" aria-hidden="true"></canvas>
  <div class="grain" aria-hidden="true"></div>
  <main>
    <div class="panel">
      <div class="copy">
        <a class="brand" href="https://lattice.pub" rel="noopener">lattice</a>
        <p class="eyebrow">403 · restricted</p>
        <h1>This snapshot isn't open to you.</h1>
        <p class="lede">Only Google accounts on the domains below can open it. Sign in with a matching account, or ask the owner to add yours.</p>
      </div>
      <div class="chrome">
        <ul class="domains" aria-label="Allowed domains">${chips}</ul>
      </div>
      <p class="copy signed">Signed in as <strong>${escapeHTML(actor.email)}</strong></p>
      <div class="chrome actions">
        <a class="btn" href="${escapeHTML(retryURL)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Try another Google account
        </a>
      </div>
    </div>
  </main>
  <script>` +
    fluidBridge +
    `</script>
</body>
</html>`;
  return new Response(html, {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
