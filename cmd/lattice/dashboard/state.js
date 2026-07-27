// lattice state bridge. Injected at serve time (never into the file on disk):
// gives the page window.lattice.state, so a summary can persist arbitrary
// key/value data - ticked items, notes, a collapsed section - past a reload.
//
// Two scopes, picked per key (default: document):
//   document - ONE shared value for the summary. Lives on the server: the local
//              daemon writes ~/.summaries/.lattice/state/<slug>.json, a hosted
//              share writes D1. Everyone reading the page sees the same value.
//   user     - one value per reader, keyed by a viewer id (this browser locally,
//              the signed-in Google actor on a domain-gated share).
//
//   window.lattice.state.get(key)                  → value | undefined
//   window.lattice.state.set(key, value, {scope})  → optimistic write, queued POST
//   window.lattice.state.remove(key)               → delete
//   window.lattice.state.all(scope?)               → { key: value } snapshot
//   window.lattice.state.scopeOf(key)              → 'document' | 'user'
//   window.lattice.state.subscribe(fn)             → fn({key,value,scope,remote})
//   window.lattice.state.ready                     → Promise, resolves once loaded
//   window.lattice.state.flush()                   → Promise<boolean>, force a POST
//   window.lattice.viewer                          → this reader's id
//
// Zero-JS integration: any element carrying data-lattice-state="<key>" is bound
// automatically - checkbox, radio group, select, text input, textarea, <details>.
// data-lattice-scope="user" on the element (or any ancestor) moves that key to
// the per-reader scope.
//
// Writes are optimistic: the value lands in memory and localStorage first, then
// a debounced POST carries it to the server. A failed POST keeps the operation
// queued, so a dropped daemon or a flaky link costs nothing but latency.
(() => {
  'use strict';
  const me = document.currentScript || document.getElementById('lattice-state');
  const endpoint = (me && me.dataset.endpoint) || '';
  // How often to look for someone else's writes while the tab is in front.
  // Deliberately a poll and not an SSE stream: the hot-reload client already
  // holds one EventSource per tab, and a browser allows six connections per
  // origin - a second stream per tab means three open summaries wedge every
  // request to the daemon, including the writes this bridge has to make.
  const every = Math.max(2000, Number(me && me.dataset.poll) || 5000);
  const DOC = 'document';
  const USER = 'user';
  const norm = (s) => (String(s || '').toLowerCase() === USER ? USER : DOC);

  const NS = 'lattice-state:' + location.pathname;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(NS + ':' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(NS + ':' + k, JSON.stringify(v)); } catch {} };

  let viewer = lsGet('viewer', null);
  if (!viewer) {
    viewer = 'v-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    lsSet('viewer', viewer);
  }

  // Page-wide default, for summaries that are entirely personal (or entirely
  // shared) and would otherwise repeat data-lattice-scope on every element.
  const metaScope = document.querySelector('meta[name="lattice-scope"]');
  const defaultScope = norm(
    (document.body && document.body.dataset.latticeScope) ||
    document.documentElement.dataset.latticeScope ||
    (metaScope && metaScope.content) ||
    DOC,
  );

  const cached = lsGet('cache', null);
  const store = { document: (cached && cached.document) || {}, user: (cached && cached.user) || {} };
  let queue = lsGet('queue', []);
  const declared = new Map(); // key → scope, from the DOM
  const subs = new Set();
  let timer = null;
  let sending = null;
  let inflight = []; // the batch a POST is currently carrying

  const scopeOf = (key) => declared.get(key) || defaultScope;
  const bucket = (scope) => store[norm(scope)];
  const persistCache = () => lsSet('cache', store);
  const persistQueue = () => lsSet('queue', queue);

  function notify(change) {
    for (const fn of subs) { try { fn(change); } catch {} }
    document.dispatchEvent(new CustomEvent('lattice:state', { detail: change, bubbles: true }));
  }

  // ---- server sync ----------------------------------------------------------

  let backoff = 0; // grows while the server is unreachable, so a dead daemon
                   // costs one request every 30s instead of three per second
  function schedule(delay) {
    if (!endpoint || timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, delay == null ? 300 : delay);
  }

  async function flush() {
    if (!endpoint || sending) return sending || false;
    if (!queue.length) return true;
    const batch = queue;
    queue = [];
    inflight = batch;
    persistQueue();
    sending = (async () => {
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ viewer, ops: batch }),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        backoff = 0;
        adopt(await r.json(), false);
        return true;
      } catch {
        // Put the batch back in front of anything queued since, so ordering -
        // and therefore last-write-wins - survives a failed flush.
        queue = batch.concat(queue);
        persistQueue();
        backoff = Math.min(backoff ? backoff * 2 : 1000, 30000);
        return false;
      } finally {
        sending = null;
        inflight = [];
        // Anything queued while this request was in flight (or put back by a
        // failure) gets its own trip; without this it would wait for a set().
        if (queue.length) schedule(backoff);
      }
    })();
    return sending;
  }

  // adopt replaces the local snapshot with the server's, replays anything not
  // yet acknowledged on top, and repaints whatever changed. Replaying `inflight`
  // matters when a poll's GET overtakes a POST: without it, a box the reader
  // just ticked would flick back for one round trip.
  function adopt(payload, remote) {
    if (!payload || typeof payload !== 'object') return;
    const next = {
      document: payload.document && typeof payload.document === 'object' ? payload.document : {},
      user: payload.user && typeof payload.user === 'object' ? payload.user : {},
    };
    for (const op of inflight.concat(queue)) {
      const b = next[norm(op.scope)];
      if (op.delete) delete b[op.key];
      else b[op.key] = op.value;
    }
    const changes = [];
    for (const scope of [DOC, USER]) {
      const before = store[scope];
      const after = next[scope];
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
        changes.push({ key, value: after[key], scope, remote: !!remote });
      }
    }
    store.document = next.document;
    store.user = next.user;
    persistCache();
    for (const change of changes) {
      paint(change.key, change.value, change.scope);
      notify(change);
    }
  }

  async function pull(remote) {
    if (!endpoint) return;
    try {
      const url = endpoint + (endpoint.includes('?') ? '&' : '?') + 'viewer=' + encodeURIComponent(viewer);
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return;
      adopt(await r.json(), remote);
    } catch {}
  }

  // ---- DOM binding ----------------------------------------------------------

  const isControl = (el) => el.matches('input, select, textarea');

  function readEl(el) {
    if (el.matches('details')) return el.open;
    if (el.matches('input[type="checkbox"]')) return el.checked;
    if (el.matches('input[type="radio"]')) {
      const group = document.querySelectorAll('[data-lattice-state="' + cssEscape(el.dataset.latticeState) + '"]');
      for (const r of group) if (r.checked) return r.value;
      return null;
    }
    if (el.matches('select[multiple]')) return [...el.selectedOptions].map((o) => o.value);
    if (isControl(el)) return el.value;
    return el.textContent;
  }

  function writeEl(el, value) {
    if (value === undefined) return;
    if (el.matches('details')) { el.open = !!value; return; }
    if (el.matches('input[type="checkbox"]')) { el.checked = !!value; return; }
    if (el.matches('input[type="radio"]')) { el.checked = el.value === value; return; }
    if (el.matches('select[multiple]')) {
      const want = Array.isArray(value) ? value : [];
      for (const o of el.options) o.selected = want.includes(o.value);
      return;
    }
    if (isControl(el)) { if (el.value !== value) el.value = value == null ? '' : value; return; }
    if (el.isContentEditable && el.textContent !== value) el.textContent = value == null ? '' : value;
  }

  // paint pushes a value into every element bound to that key, skipping the one
  // the reader is typing in - a remote update must never eat an edit in flight.
  function paint(key, value, scope) {
    for (const el of document.querySelectorAll('[data-lattice-state]')) {
      if (el.dataset.latticeState !== key || scopeOf(key) !== norm(scope)) continue;
      if (el === document.activeElement && isControl(el) && !el.matches('input[type="checkbox"], input[type="radio"]')) continue;
      writeEl(el, value);
    }
  }

  function cssEscape(v) {
    return String(v).replace(/["\\]/g, '\\$&');
  }

  function declare(el) {
    const key = el.dataset.latticeState;
    if (!key) return;
    const holder = el.closest('[data-lattice-scope]');
    declared.set(key, norm(holder ? holder.dataset.latticeScope : defaultScope));
  }

  function bindAll() {
    const els = document.querySelectorAll('[data-lattice-state]');
    for (const el of els) declare(el);
    for (const el of els) writeEl(el, bucket(scopeOf(el.dataset.latticeState))[el.dataset.latticeState]);
  }

  let typing = null;
  function fromEl(el, debounce) {
    const key = el.dataset.latticeState;
    if (!key) return;
    declare(el);
    const commit = () => api.set(key, readEl(el));
    if (!debounce) return commit();
    clearTimeout(typing);
    typing = setTimeout(commit, 400);
  }

  document.addEventListener('change', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-lattice-state]');
    if (el) fromEl(el, false);
  });
  document.addEventListener('input', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-lattice-state]');
    if (el && isControl(el) && !el.matches('input[type="checkbox"], input[type="radio"], select')) fromEl(el, true);
  });
  // <details> fires toggle, which does not bubble - capture instead.
  document.addEventListener('toggle', (e) => {
    const el = e.target;
    if (el && el.matches && el.matches('details[data-lattice-state]')) fromEl(el, false);
  }, true);

  // ---- public API -----------------------------------------------------------

  const api = {
    viewer,
    defaultScope,
    scopeOf,
    get(key) { return bucket(scopeOf(key))[key]; },
    all(scope) {
      if (scope) return Object.assign({}, bucket(scope));
      return Object.assign({}, store.document, store.user);
    },
    set(key, value, opts) {
      if (typeof key !== 'string' || !key) return false;
      const scope = norm((opts && opts.scope) || scopeOf(key));
      declared.set(key, scope);
      if (JSON.stringify(bucket(scope)[key]) === JSON.stringify(value)) return true;
      bucket(scope)[key] = value;
      persistCache();
      queue.push({ key, value, scope });
      persistQueue();
      paint(key, value, scope);
      notify({ key, value, scope, remote: false });
      schedule();
      return true;
    },
    remove(key) {
      const scope = scopeOf(key);
      if (!(key in bucket(scope))) return true;
      delete bucket(scope)[key];
      persistCache();
      queue.push({ key, scope, delete: true });
      persistQueue();
      paint(key, undefined, scope);
      notify({ key, value: undefined, scope, remote: false });
      schedule();
      return true;
    },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      return () => subs.delete(fn);
    },
    bind(el) {
      const els = el ? [el] : document.querySelectorAll('[data-lattice-state]');
      for (const node of els) { declare(node); writeEl(node, api.get(node.dataset.latticeState)); }
    },
    flush,
    ready: null,
  };

  api.ready = (async () => {
    bindAll();          // cached values first: no flash of unsaved state
    await pull(false);  // then the server's truth
    bindAll();
    if (queue.length) flush();
  })();

  window.lattice = Object.assign(window.lattice || {}, { persist: !!endpoint, viewer, state: api });

  // Live-ish sync: poll while the tab is in front, stop when it is not, and
  // catch up the moment the reader comes back.
  let ticker = null;
  function watch() {
    if (!endpoint) return;
    clearInterval(ticker);
    if (document.visibilityState !== 'visible') return;
    ticker = setInterval(() => pull(true), every);
  }
  document.addEventListener('visibilitychange', () => {
    watch();
    if (document.visibilityState !== 'visible') return;
    flush();
    pull(true);
  });
  watch();
  // Last chance to land a write the debounce hasn't sent yet.
  window.addEventListener('pagehide', () => {
    if (!endpoint || !queue.length || !navigator.sendBeacon) return;
    const body = new Blob([JSON.stringify({ viewer, ops: queue })], { type: 'application/json' });
    if (navigator.sendBeacon(endpoint, body)) { queue = []; persistQueue(); }
  });

  // The bridge is injected AFTER the page's own scripts, so load-time code can't
  // see window.lattice synchronously. Its own event, like the comment bridge -
  // `lattice:ready` belongs to the poll bridge, which is injected after this one
  // precisely so a poll page's ready handler finds both. Pattern for pages:
  //   const go = () => lattice.state.ready.then(paint);
  //   window.lattice?.state ? go() : document.addEventListener('lattice:state-ready', go, {once:true});
  document.dispatchEvent(new CustomEvent('lattice:state-ready', { detail: api }));
})();
