// lattice dashboard - vanilla JS, no framework, no build step.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const list = $('list'), q = $('q'), count = $('count'), eyebrow = $('eyebrow');
  const reader = $('reader'), frame = $('frame');
  const settings = $('settings'), settingsSave = $('settings-save');

  let docs = []; // full library cache
  let settingsConfig = null;
  let settingsDirty = false;

  const esc = (s) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Wrap query terms in <mark> (input already HTML-escaped).
  const highlight = (safe, terms) => {
    for (const t of terms) {
      if (!t) continue;
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      safe = safe.replace(re, (m) => '\x01' + m + '\x02');
    }
    return safe.replaceAll('\x01', '<mark>').replaceAll('\x02', '</mark>');
  };

  const fmtDate = (iso) => iso ? iso.slice(0, 10) : '';

  // Prefer ~/… when the path is under a home directory; else keep the tail.
  const shortPath = (p) => {
    if (!p) return '';
    const normalized = p.replaceAll('\\', '/');
    const home = normalized.match(/^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+(\/.*)$/);
    if (home) return '~' + home[1];
    if (normalized.startsWith('~/')) return normalized;
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 3) return normalized;
    return '…/' + parts.slice(-2).join('/');
  };

  function render(items, terms = []) {
    list.innerHTML = '';
    $('empty').hidden = items.length > 0 || docs.length === 0;
    if (docs.length === 0) $('empty').hidden = false;

    const frag = document.createDocumentFragment();
    items.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'row' + (d.missing ? ' missing' : '');
      row.setAttribute('role', 'listitem');
      row.tabIndex = 0;
      row.title = d.source || d.title || '';

      const tags = (d.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
      const missingTag = d.missing ? '<span class="tag is-missing">missing</span>' : '';
      const sub = d.snippet
        ? highlight(esc(d.snippet), terms)
        : esc(d.description || '');
      const src = shortPath(d.source || '');

      row.innerHTML =
        `<div class="row-top">` +
          `<span class="title">${highlight(esc(d.title), terms)}</span>` +
          `<span class="date">${fmtDate(d.created)}</span>` +
        `</div>` +
        (sub ? `<div class="sub">${sub}</div>` : '') +
        `<div class="row-meta">` +
          (src ? `<span class="src" title="${esc(d.source || '')}">${esc(src)}</span>` : '') +
          ((tags || missingTag) ? `<span class="tags">${tags}${missingTag}</span>` : '') +
        `</div>`;

      if (!d.missing) {
        const open = () => { location.hash = '#/read/' + d.slug; };
        row.addEventListener('click', open);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      }
      frag.appendChild(row);
    });
    list.appendChild(frag);
  }

  function setStatus(text) {
    if (!text) {
      eyebrow.hidden = true;
      eyebrow.textContent = '';
      return;
    }
    eyebrow.hidden = false;
    eyebrow.textContent = text;
  }

  async function loadAll() {
    docs = await (await fetch('/api/summaries')).json() || [];
    count.textContent = docs.length + (docs.length === 1 ? ' summary' : ' summaries');
    if (!q.value.trim()) {
      setStatus('');
      render(docs);
    }
  }

  let seq = 0;
  async function search() {
    const query = q.value.trim();
    if (!query) { setStatus(''); render(docs); return; }
    const my = ++seq;
    const res = await (await fetch('/api/search?q=' + encodeURIComponent(query))).json();
    if (my !== seq) return;
    const n = res.hits.length;
    setStatus(`${n} result${n === 1 ? '' : 's'} for "${query}"`);
    render(res.hits, query.toLowerCase().split(/\s+/));
  }

  let deb;
  q.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(search, 120); });

  // ---- settings ------------------------------------------------------------
  const settingIds = ['setting-preset', 'setting-font', 'setting-density', 'setting-accent', 'setting-api', 'setting-token', 'setting-target'];

  function settingsMessage(text, error = false) {
    const message = $('settings-message');
    message.textContent = text;
    message.classList.toggle('is-error', error);
  }

  function setSettingsDirty(value = true) {
    settingsDirty = value;
    settingsSave.disabled = !value;
    settingsMessage(value ? 'Unsaved changes' : '');
  }

  function renderThemePreview() {
    const preview = $('theme-preview');
    const preset = $('setting-preset').value;
    const font = $('setting-font').value;
    const density = $('setting-density').value;
    const accent = $('setting-accent').value.trim();

    const palettes = {
      warm: ['#eee9de', '#1d1a17', '#746b60'],
      mono: ['#0e0e0f', '#f2f2ef', '#8a8a8c'],
      lattice: ['#f1f1ef', '#161616', '#6f6f6a'],
    };
    const [bg, ink, muted] = palettes[preset] || palettes.lattice;
    const fonts = {
      sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      serif: 'ui-serif, "Iowan Old Style", Baskerville, Georgia, serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    };
    const padding = { comfortable: '38px', spacious: '46px' }[density] || '31px';
    preview.style.setProperty('--pv-bg', bg);
    preview.style.setProperty('--pv-ink', ink);
    preview.style.setProperty('--pv-muted', muted);
    preview.style.setProperty('--pv-accent', /^#[0-9a-f]{6}$/i.test(accent) ? accent : ink);
    preview.style.setProperty('--pv-font', fonts[font] || fonts.mono);
    preview.style.padding = padding;
  }

  async function loadSettings() {
    settingsMessage('Loading…');
    settingsSave.disabled = true;
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Could not load config');
      settingsConfig = await response.json();
      const theme = settingsConfig.theme || {};
      $('setting-preset').value = theme.preset === 'lattice' ? '' : (theme.preset || '');
      $('setting-font').value = theme.font === 'mono' ? '' : (theme.font || '');
      $('setting-density').value = theme.density === 'compact' ? '' : (theme.density || '');
      $('setting-accent').value = theme.accent || '';
      $('setting-accent-color').value = /^#[0-9a-f]{6}$/i.test(theme.accent || '') ? theme.accent : '#6f8cff';
      const hosted = settingsConfig.hosted || {};
      $('setting-api').value = hosted.apiBase || '';
      $('setting-token').value = hosted.token || '';
      $('setting-target').value = hosted.defaultTarget || '';
      settingsDirty = false;
      settingsSave.disabled = true;
      settingsMessage('');
      renderThemePreview();
    } catch (error) {
      settingsMessage(error.message || 'Could not load config', true);
    }
  }

  async function saveSettings() {
    if (!settingsConfig) return;
    const accent = $('setting-accent').value.trim().toLowerCase();
    if (accent && !/^#[0-9a-f]{6}$/.test(accent)) {
      settingsMessage('Accent must be a six-digit hex color', true);
      $('setting-accent').focus();
      return;
    }

    settingsConfig.version ||= 1;
    settingsConfig.theme = {
      preset: $('setting-preset').value || undefined,
      font: $('setting-font').value || undefined,
      density: $('setting-density').value || undefined,
      accent: accent || undefined,
    };
    settingsConfig.hosted = {
      apiBase: $('setting-api').value.trim().replace(/\/$/, '') || undefined,
      token: $('setting-token').value.trim() || undefined,
      defaultTarget: $('setting-target').value || undefined,
    };

    settingsSave.disabled = true;
    settingsMessage('Saving…');
    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settingsConfig),
      });
      if (!response.ok) {
        const out = await response.json().catch(() => ({}));
        throw new Error(out.error || 'Could not save config');
      }
      settingsConfig = await response.json();
      settingsDirty = false;
      settingsMessage('Changes saved');
      setTimeout(() => { if (!settingsDirty) settingsMessage(''); }, 1800);
    } catch (error) {
      settingsSave.disabled = false;
      settingsMessage(error.message || 'Could not save config', true);
    }
  }

  settingIds.forEach((id) => $(id).addEventListener('input', () => {
    setSettingsDirty();
    renderThemePreview();
  }));
  $('setting-accent-color').addEventListener('input', (event) => {
    $('setting-accent').value = event.target.value;
    setSettingsDirty();
    renderThemePreview();
  });
  $('accent-clear').addEventListener('click', () => {
    $('setting-accent').value = '';
    setSettingsDirty();
    renderThemePreview();
  });
  $('settings-form').addEventListener('submit', (event) => event.preventDefault());
  settingsSave.addEventListener('click', saveSettings);
  $('settings-open').addEventListener('click', () => { location.hash = '#/settings'; });
  $('settings-back').addEventListener('click', () => { location.hash = ''; });

  // ---- share popover -------------------------------------------------------
  const shareBtn = $('r-share'), sharePop = $('share-pop');
  let readerSlug = null;

  const closeShare = () => { sharePop.hidden = true; shareBtn.setAttribute('aria-expanded', 'false'); };

  async function shareState(slug) {
    try {
      const shares = await (await fetch('/api/shares')).json();
      return (shares || []).find((s) => s.slug === slug) || null;
    } catch { return null; }
  }

  function shareLoading() { sharePop.replaceChildren(el('div', { class: 'lead' }, 'Loading…')); }

  function shareUnshared(slug) {
    const random = el('input', { type: 'checkbox' });
    const btn = el('button', { class: 'btn wide' }, 'Share publicly');
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Sharing…';
      try {
        const r = await fetch('/api/shares', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, random: random.checked }),
        });
        const out = await r.json();
        if (!r.ok) throw new Error(out.error || 'share failed');
        shareShared({ slug, url: out.url, votes: 0 });
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Share publicly';
        sharePop.querySelector('.meta')?.remove();
        sharePop.appendChild(el('div', { class: 'meta' }, String(e.message || e)));
      }
    });
    sharePop.replaceChildren(
      el('div', { class: 'lead' }, 'Expose only this summary at a public URL. The dashboard, API, and every other summary stay private.'),
      el('label', { class: 'opt' }, random, 'Random subdomain'),
      btn,
    );
  }

  function shareShared(sh) {
    const url = el('input', { class: 'url', type: 'text', readonly: 'readonly', value: sh.url });
    url.addEventListener('focus', () => url.select());
    const copy = el('button', { class: 'btn' }, 'Copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(sh.url); }
      catch { url.focus(); url.select(); document.execCommand?.('copy'); }
      copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200);
    });
    const open = el('a', { class: 'btn', href: sh.url, target: '_blank', rel: 'noopener' }, 'Open');
    const stop = el('button', { class: 'btn' }, 'Stop sharing');
    stop.addEventListener('click', async () => {
      stop.disabled = true; stop.textContent = 'Stopping…';
      try {
        const r = await fetch('/api/shares/' + sh.slug, { method: 'DELETE' });
        if (!r.ok && r.status !== 204) throw new Error('stop failed');
        shareUnshared(sh.slug);
      } catch { stop.disabled = false; stop.textContent = 'Stop sharing'; }
    });
    sharePop.replaceChildren(
      el('div', { class: 'lead' }, 'Live. Anyone with the link can view and vote. Only this summary is reachable.'),
      el('div', { class: 'row2' }, url, copy),
      el('div', { class: 'row2', style: 'margin-top:8px' }, open, stop),
      el('div', { class: 'meta' }, `${sh.votes || 0} vote(s). Tally with `, el('code', {}, `lattice results ${sh.slug}`)),
    );
  }

  shareBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!sharePop.hidden) { closeShare(); return; }
    if (!readerSlug) return;
    sharePop.hidden = false; shareBtn.setAttribute('aria-expanded', 'true');
    shareLoading();
    const sh = await shareState(readerSlug);
    if (sharePop.hidden) return; // closed while loading
    sh ? shareShared(sh) : shareUnshared(readerSlug);
  });
  sharePop.addEventListener('click', (e) => e.stopPropagation());
  addEventListener('click', () => { if (!sharePop.hidden) closeShare(); });

  // tiny DOM builder - keeps user strings out of innerHTML
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    for (const kid of kids) n.append(kid);
    return n;
  }

  // Reader chrome only - deliberately never touches frame.src, so autosync can
  // repaint a retitled doc without reloading the iframe (which would throw away
  // the in-place morph the injected hot-reload client just did).
  function paintReader(slug) {
    const d = docs.find((x) => x.slug === slug);
    $('r-title').textContent = d ? d.title : slug;
    const src = d ? d.source : '';
    $('r-source').textContent = shortPath(src);
    $('r-source').title = src;
    $('r-raw').href = `/s/${slug}?raw=1`;
    const dl = $('r-dl');
    dl.href = `/s/${slug}?raw=1`;
    dl.download = slug + '.html';
  }

  // Point the iframe somewhere without leaving a browser-history entry.
  // Assigning frame.src pushes one, so opening a summary stacks two entries
  // (the hash + the iframe load) and browser-back rewinds the iframe to blank
  // while the hash - and so the reader - stays put: a blank reader. Replacing
  // the inner document in place keeps history one entry per view. Same-origin
  // throughout (/s/… or about:blank), so reaching in is allowed.
  const frameTo = (url) => {
    const w = frame.contentWindow;
    if (w) w.location.replace(url);
    else frame.src = url;
  };

  // hash routing: '' = library, '#/read/<slug>' = reader, '#/settings' = config
  function route() {
    closeShare();
    if (location.hash === '#/settings') {
      readerSlug = null;
      reader.hidden = true;
      frameTo('about:blank');
      settings.hidden = false;
      loadSettings();
      return;
    }
    settings.hidden = true;
    const m = location.hash.match(/^#\/read\/([\w-]+)$/);
    if (m) {
      const slug = m[1];
      readerSlug = slug;
      paintReader(slug);
      frameTo(`/s/${slug}`);
      reader.hidden = false;
    } else {
      readerSlug = null;
      reader.hidden = true;
      frameTo('about:blank');
      loadAll();
    }
  }
  addEventListener('hashchange', route);
  $('back').addEventListener('click', () => { location.hash = ''; });

  addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== q && reader.hidden && settings.hidden) {
      e.preventDefault();
      q.focus();
      q.select();
    } else if (e.key === 'Escape') {
      if (!sharePop.hidden) closeShare();
      else if (!settings.hidden) location.hash = '';
      else if (!reader.hidden) location.hash = '';
      else if (q.value) { q.value = ''; search(); }
    }
  });

  // ---- autosync ------------------------------------------------------------
  // The server pushes a digest of the library on connect and on every change,
  // so adds, deletes and edits land without a refresh. EventSource reconnects
  // on its own, which covers server restarts too: the digest replayed on
  // reconnect gets compared against what we last rendered.
  async function sync() {
    await loadAll();               // leaves the view alone if a query is active…
    if (q.value.trim()) search();  // …so re-run it against the fresh index
    if (readerSlug) paintReader(readerSlug);
  }

  let libState = null;
  new EventSource('/api/watch').addEventListener('state', (e) => {
    if (libState !== null && e.data !== libState) sync();
    libState = e.data;
  });

  loadAll().then(route);
})();
