import type { Env, Token } from './index';

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
    const retry = escapeHTML(loginURL(req, env));
    return htmlMessage(
      403,
      'Access denied',
      `This snapshot is restricted to ${policy.domains.map((d) => '@' + escapeHTML(d)).join(', ')}. ` +
        `<a href="${retry}">Try another Google account.</a>`,
    );
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

function htmlMessage(status: number, title: string, message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">` +
      `<title>${escapeHTML(title)}</title><style>body{font:16px/1.5 ui-monospace,monospace;max-width:44rem;margin:15vh auto;padding:2rem;color:#191817}small{color:#706c66}</style>` +
      `<main><small>lattice</small><h1>${escapeHTML(title)}</h1><p>${message}</p></main>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
