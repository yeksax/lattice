// lattice dashboard - vanilla JS, no framework, no build step.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const list = $('list'), q = $('q'), count = $('count'), eyebrow = $('eyebrow');
  const frame = $('frame');
  const shell = $('shell');
  const searchSlot = $('search-slot');
  const searchMenu = $('search-menu');
  const breadcrumb = $('breadcrumb');
  const readerActions = $('reader-actions');
  const settingsSave = $('settings-save');
  const sharingSave = $('sharing-save');

  let docs = []; // full library cache
  let settingsConfig = null;
  let appearanceDirty = false;
  let sharingDirty = false;
  let currentView = 'home';
  let readerSlug = null;

  const views = {
    home: $('view-home'),
    shared: $('view-shared'),
    sharing: $('view-sharing'),
    settings: $('view-settings'),
    read: $('view-read'),
  };
  const navLinks = [...document.querySelectorAll('[data-nav]')];
  const viewLabels = {
    home: 'página inicial',
    shared: 'compartilhados',
    sharing: 'sharing',
    settings: 'settings',
  };

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

  // tiny DOM builder - keeps user strings out of innerHTML
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    for (const kid of kids) n.append(kid);
    return n;
  }

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

  const isSearchDropdown = () => currentView !== 'home';

  let searchCloseTimer = 0;
  function closeSearchMenu() {
    searchSlot.classList.remove('is-open');
    clearTimeout(searchCloseTimer);
    // Keep node mounted until the exit transition finishes.
    searchCloseTimer = setTimeout(() => {
      if (!searchSlot.classList.contains('is-open')) {
        searchMenu.hidden = true;
        searchMenu.replaceChildren();
      }
    }, 320);
  }

  function renderSearchMenu(hits, query = '') {
    clearTimeout(searchCloseTimer);
    searchMenu.hidden = false;
    searchSlot.classList.add('is-open');
    searchMenu.replaceChildren();
    if (!hits.length) {
      searchMenu.appendChild(el('div', { class: 'search-menu-empty' },
        query ? 'No results' : 'Type to search the library'));
      return;
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const frag = document.createDocumentFragment();
    hits.slice(0, 8).forEach((d) => {
      const btn = el('button', {
        type: 'button',
        class: 'search-hit',
        role: 'option',
        title: d.source || d.title || '',
      });
      const title = el('span', { class: 'hit-title' });
      title.innerHTML = highlight(esc(d.title || d.slug), terms);
      btn.append(title, el('span', { class: 'hit-date' }, fmtDate(d.created)));
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus for click
      btn.addEventListener('click', () => {
        closeSearchMenu();
        q.value = '';
        location.hash = '#/read/' + d.slug;
      });
      frag.appendChild(btn);
    });
    searchMenu.appendChild(frag);
  }

  let seq = 0;
  async function search() {
    const query = q.value.trim();

    if (!isSearchDropdown()) {
      closeSearchMenu();
      if (!query) { setStatus(''); render(docs); return; }
      const my = ++seq;
      const res = await (await fetch('/api/search?q=' + encodeURIComponent(query))).json();
      if (my !== seq) return;
      const n = res.hits.length;
      setStatus(`${n} result${n === 1 ? '' : 's'} for "${query}"`);
      render(res.hits, query.toLowerCase().split(/\s+/));
      return;
    }

    if (!query) {
      renderSearchMenu([]);
      return;
    }
    const my = ++seq;
    const res = await (await fetch('/api/search?q=' + encodeURIComponent(query))).json();
    if (my !== seq) return;
    renderSearchMenu(res.hits || [], query);
  }

  let deb;
  q.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(search, 120); });
  q.addEventListener('focus', () => {
    if (isSearchDropdown()) search();
  });
  addEventListener('click', (e) => {
    if (!searchSlot.contains(e.target)) closeSearchMenu();
  });

  // ---- compartilhados ------------------------------------------------------
  const sharedList = $('shared-list');
  const sharedEmpty = $('shared-empty');
  const sharedCount = $('shared-count');
  const sharedStatus = $('shared-status');

  function setSharedStatus(text, isError = false) {
    if (!text) {
      sharedStatus.hidden = true;
      sharedStatus.textContent = '';
      sharedStatus.classList.remove('is-error');
      return;
    }
    sharedStatus.hidden = false;
    sharedStatus.textContent = text;
    sharedStatus.classList.toggle('is-error', isError);
  }

  function showSharedEmpty(html) {
    sharedList.innerHTML = '';
    sharedEmpty.hidden = false;
    sharedEmpty.innerHTML = html;
    sharedCount.textContent = '';
  }

  async function loadShared() {
    setSharedStatus('Loading…');
    sharedEmpty.hidden = true;
    sharedList.innerHTML = '';
    sharedCount.textContent = '';

    if (!docs.length) {
      try { await loadAll(); } catch { /* keep going; titles may be missing */ }
    }

    let shares;
    try {
      const response = await fetch('/api/shares');
      if (!response.ok) {
        const out = await response.json().catch(() => ({}));
        throw new Error(out.error || 'Could not load shares');
      }
      shares = await response.json() || [];
    } catch (error) {
      setSharedStatus(error.message || 'Could not load shares', true);
      showSharedEmpty('Could not load shared summaries.');
      return;
    }

    setSharedStatus('');

    // Empty array from the API also covers "not logged in" (server returns []).
    // Probe config so we can distinguish "no shares" from "token missing".
    if (!shares.length) {
      let hasToken = false;
      try {
        const cfg = settingsConfig || await (await fetch('/api/config')).json();
        settingsConfig = cfg;
        hasToken = !!(cfg.hosted && cfg.hosted.token);
      } catch { /* treat as not configured */ }

      if (!hasToken) {
        showSharedEmpty(
          'Sharing is not configured yet.<br>' +
          'Add an access token on <a href="#/sharing">sharing</a>, or run <code>lattice login</code>.'
        );
      } else {
        showSharedEmpty(
          'Nothing shared yet.<br>' +
          'Open a summary and use Share, or check <a href="#/sharing">sharing</a> settings.'
        );
      }
      return;
    }

    sharedEmpty.hidden = true;
    sharedCount.textContent = shares.length + (shares.length === 1 ? ' share' : ' shares');

    const frag = document.createDocumentFragment();
    shares.forEach((sh) => {
      const doc = docs.find((d) => d.slug === sh.slug);
      const title = doc ? doc.title : sh.slug;
      const row = el('div', { class: 'share-row', role: 'listitem' });
      const top = el('div', { class: 'share-row-top' },
        el('span', { class: 'title' }, title),
        el('span', { class: 'votes' }, `${sh.votes || 0} vote${(sh.votes || 0) === 1 ? '' : 's'}`),
      );
      const slugEl = el('div', { class: 'slug' }, sh.slug);
      const urlEl = el('div', { class: 'url', title: sh.url || '' }, sh.url || '');

      const copyBtn = el('button', { type: 'button' }, 'Copy URL');
      copyBtn.addEventListener('click', async () => {
        if (!sh.url) return;
        try { await navigator.clipboard.writeText(sh.url); }
        catch {
          const tmp = el('input', { value: sh.url });
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand?.('copy');
          tmp.remove();
        }
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 1200);
      });

      const openPublic = el('a', {
        href: sh.url || '#',
        target: '_blank',
        rel: 'noopener',
      }, 'Open public');
      if (!sh.url) openPublic.setAttribute('aria-disabled', 'true');

      const openReader = el('button', { type: 'button' }, 'Open in reader');
      openReader.addEventListener('click', () => { location.hash = '#/read/' + sh.slug; });

      const stopBtn = el('button', { type: 'button' }, 'Stop sharing');
      stopBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        stopBtn.textContent = 'Stopping…';
        try {
          const r = await fetch('/api/shares/' + encodeURIComponent(sh.slug), { method: 'DELETE' });
          if (!r.ok && r.status !== 204) throw new Error('stop failed');
          await loadShared();
        } catch {
          stopBtn.disabled = false;
          stopBtn.textContent = 'Stop sharing';
        }
      });

      row.append(
        top,
        slugEl,
        urlEl,
        el('div', { class: 'share-actions' }, copyBtn, openPublic, openReader, stopBtn),
      );
      frag.appendChild(row);
    });
    sharedList.appendChild(frag);
  }

  // ---- appearance / sharing forms ------------------------------------------
  const appearanceIds = [
    'setting-preset', 'setting-tone', 'setting-font', 'setting-heading',
    'setting-density', 'setting-dividers', 'setting-modules', 'setting-accent',
  ];
  const sharingIds = ['setting-api', 'setting-token'];

  function formMessage(elId, text, error = false) {
    const message = $(elId);
    message.textContent = text;
    message.classList.toggle('is-error', error);
  }

  function setAppearanceDirty(value = true) {
    appearanceDirty = value;
    settingsSave.disabled = !value;
    formMessage('settings-message', value ? 'Unsaved changes' : '');
  }

  function setSharingDirty(value = true) {
    sharingDirty = value;
    sharingSave.disabled = !value;
    formMessage('sharing-message', value ? 'Unsaved changes' : '');
  }

  function renderThemePreview() {
    const preview = $('theme-preview');
    const preset = $('setting-preset').value;
    const tone = $('setting-tone').value;
    const font = $('setting-font').value;
    const heading = $('setting-heading').value || font;
    const density = $('setting-density').value;
    const dividers = $('setting-dividers').value || 'hairline';
    const modules = $('setting-modules').value || 'mixed';
    const accent = $('setting-accent').value.trim();

    const tones = {
      neutral: ['#ffffff', '#171717', '#737373', '#f5f5f5'],
      zinc: ['#fafafa', '#18181b', '#71717a', '#f4f4f5'],
      mist: ['#f8fafc', '#0f172a', '#64748b', '#f1f5f9'],
    };
    const presets = {
      warm: ['#eee9de', '#1d1a17', '#746b60', '#e7e1d4'],
      mono: ['#0e0e0f', '#f2f2ef', '#8a8a8c', '#1a1a1b'],
      lattice: ['#ffffff', '#161616', '#6f6f6a', '#f5f5f4'],
    };
    const [bg, ink, muted, sub] = tones[tone] || presets[preset] || presets.lattice;
    const fonts = {
      sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      serif: 'ui-serif, "Iowan Old Style", Baskerville, Georgia, serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    };
    const padding = { comfortable: '34px', spacious: '42px' }[density] || '28px';
    preview.style.setProperty('--pv-bg', bg);
    preview.style.setProperty('--pv-sub', sub);
    preview.style.setProperty('--pv-ink', ink);
    preview.style.setProperty('--pv-muted', muted);
    preview.style.setProperty('--pv-line', colorMixInk(ink, 0.14));
    preview.style.setProperty('--pv-accent', /^#[0-9a-f]{6}$/i.test(accent) ? accent : ink);
    preview.style.setProperty('--pv-font', fonts[font] || fonts.mono);
    preview.style.setProperty('--pv-heading', fonts[heading] || fonts[font] || fonts.mono);
    preview.style.padding = padding;
    preview.dataset.dividers = dividers;
    preview.dataset.modules = modules;
  }

  function colorMixInk(ink, amount) {
    // Lightweight stand-in for CSS color-mix so the preview hairline tracks ink.
    if (ink.startsWith('#') && ink.length === 7) {
      const n = parseInt(ink.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return `rgba(${r}, ${g}, ${b}, ${amount})`;
    }
    return 'rgba(0,0,0,0.14)';
  }

  // ---- custom controls -----------------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(cls, d) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', cls);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  const uiSelects = []; // { sync } for each enhanced <select>
  const closeAllSelects = (except) => uiSelects.forEach((s) => { if (s.wrap !== except) s.close(); });

  // Replace a native <select> with a monochrome custom dropdown while keeping
  // the native element as the source of truth (value, form, existing listeners).
  function enhanceSelect(native) {
    const wrap = el('div', { class: 'uisel' });
    native.parentNode.insertBefore(wrap, native);
    wrap.appendChild(native);
    native.classList.add('uisel-native');
    native.tabIndex = -1;
    native.setAttribute('aria-hidden', 'true');

    const label = el('span', { class: 'uisel-value' });
    const trigger = el('button', {
      type: 'button', class: 'uisel-trigger',
      'aria-haspopup': 'listbox', 'aria-expanded': 'false',
    });
    trigger.append(label, icon('uisel-caret', 'm6 9 6 6 6-6'));
    const menu = el('div', { class: 'uisel-menu', role: 'listbox', hidden: 'hidden' });

    const options = [...native.options].map((opt) => {
      const item = el('button', { type: 'button', class: 'uisel-option', role: 'option' });
      item.dataset.value = opt.value;
      item.append(el('span', {}, opt.textContent), icon('uisel-check', 'M20 6 9 17l-5-5'));
      item.addEventListener('click', () => { choose(opt.value); close(); trigger.focus(); });
      menu.appendChild(item);
      return item;
    });
    wrap.append(trigger, menu);

    function sync() {
      const opt = native.options[native.selectedIndex] || native.options[0];
      label.textContent = opt ? opt.textContent : '';
      options.forEach((item) => item.setAttribute('aria-selected', item.dataset.value === native.value ? 'true' : 'false'));
    }
    function choose(value) {
      if (native.value !== value) {
        native.value = value;
        native.dispatchEvent(new Event('input', { bubbles: true }));
      }
      sync();
    }
    function open() {
      if (!menu.hidden) return;
      closeAllSelects(wrap);
      menu.hidden = false;
      wrap.dataset.open = '';
      trigger.setAttribute('aria-expanded', 'true');
      const room = window.innerHeight - trigger.getBoundingClientRect().bottom;
      menu.dataset.drop = room < menu.offsetHeight + 16 ? 'up' : 'down';
      (options.find((i) => i.getAttribute('aria-selected') === 'true') || options[0])?.focus();
    }
    function close() {
      if (menu.hidden) return;
      menu.hidden = true;
      delete wrap.dataset.open;
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden ? open() : close(); });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    menu.addEventListener('keydown', (e) => {
      const i = options.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); options[Math.min(i + 1, options.length - 1)].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); options[Math.max(i - 1, 0)].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); trigger.focus(); }
      else if (e.key === 'Tab') close();
    });

    sync();
    uiSelects.push({ wrap, sync, close });
  }

  // ---- accent swatch -------------------------------------------------------
  const accentSwatch = $('accent-swatch');
  const accentColor = $('setting-accent-color');
  const accentText = $('setting-accent');
  function updateSwatch() {
    const value = accentText.value.trim();
    const valid = /^#[0-9a-f]{6}$/i.test(value);
    accentSwatch.classList.toggle('is-empty', !valid);
    accentSwatch.style.setProperty('--swatch', valid ? value : '');
    if (valid) accentColor.value = value;
  }

  function syncCustomControls() {
    uiSelects.forEach((s) => s.sync());
    updateSwatch();
  }

  function applyConfigToForms(cfg) {
    const theme = cfg.theme || {};
      $('setting-preset').value = theme.preset === 'lattice' ? '' : (theme.preset || '');
      $('setting-tone').value = theme.tone || '';
      $('setting-font').value = theme.font === 'mono' ? '' : (theme.font || '');
      $('setting-heading').value = theme.heading || '';
      $('setting-density').value = theme.density === 'compact' ? '' : (theme.density || '');
      $('setting-dividers').value = theme.dividers === 'hairline' ? '' : (theme.dividers || '');
      $('setting-modules').value = theme.modules === 'mixed' ? '' : (theme.modules || '');
      $('setting-accent').value = theme.accent || '';
      $('setting-accent-color').value = /^#[0-9a-f]{6}$/i.test(theme.accent || '') ? theme.accent : '#6f8cff';
    const hosted = cfg.hosted || {};
    $('setting-api').value = hosted.apiBase || '';
    $('setting-token').value = hosted.token || '';
    appearanceDirty = false;
    sharingDirty = false;
    settingsSave.disabled = true;
    sharingSave.disabled = true;
    formMessage('settings-message', '');
    formMessage('sharing-message', '');
    renderThemePreview();
    syncCustomControls();
  }

  async function loadConfig(opts = {}) {
    const { forAppearance = false, forSharing = false } = opts;
    if (forAppearance) formMessage('settings-message', 'Loading…');
    if (forSharing) formMessage('sharing-message', 'Loading…');
    if (forAppearance) settingsSave.disabled = true;
    if (forSharing) sharingSave.disabled = true;
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Could not load config');
      settingsConfig = await response.json();
      applyConfigToForms(settingsConfig);
    } catch (error) {
      const msg = error.message || 'Could not load config';
      if (forAppearance) formMessage('settings-message', msg, true);
      if (forSharing) formMessage('sharing-message', msg, true);
    }
  }

  async function ensureConfig() {
    if (settingsConfig) return settingsConfig;
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Could not load config');
    settingsConfig = await response.json();
    return settingsConfig;
  }

  async function saveAppearance() {
    try {
      await ensureConfig();
    } catch (error) {
      formMessage('settings-message', error.message || 'Could not load config', true);
      return;
    }

    const accent = $('setting-accent').value.trim().toLowerCase();
    if (accent && !/^#[0-9a-f]{6}$/.test(accent)) {
      formMessage('settings-message', 'Accent must be a six-digit hex color', true);
      $('setting-accent').focus();
      return;
    }

    settingsConfig.version ||= 1;
    settingsConfig.theme = {
      preset: $('setting-preset').value || undefined,
      tone: $('setting-tone').value || undefined,
      font: $('setting-font').value || undefined,
      heading: $('setting-heading').value || undefined,
      density: $('setting-density').value || undefined,
      dividers: $('setting-dividers').value || undefined,
      modules: $('setting-modules').value || undefined,
      accent: accent || undefined,
    };
    // Preserve hosted when saving appearance only.
    settingsConfig.hosted = settingsConfig.hosted || {};

    settingsSave.disabled = true;
    formMessage('settings-message', 'Saving…');
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
      appearanceDirty = false;
      formMessage('settings-message', 'Changes saved');
      setTimeout(() => { if (!appearanceDirty) formMessage('settings-message', ''); }, 1800);
    } catch (error) {
      settingsSave.disabled = false;
      formMessage('settings-message', error.message || 'Could not save config', true);
    }
  }

  async function saveSharing() {
    try {
      await ensureConfig();
    } catch (error) {
      formMessage('sharing-message', error.message || 'Could not load config', true);
      return;
    }

    settingsConfig.version ||= 1;
    settingsConfig.theme = settingsConfig.theme || {};
    settingsConfig.hosted = {
      apiBase: $('setting-api').value.trim().replace(/\/$/, '') || undefined,
      token: $('setting-token').value.trim() || undefined,
    };

    sharingSave.disabled = true;
    formMessage('sharing-message', 'Saving…');
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
      sharingDirty = false;
      formMessage('sharing-message', 'Changes saved');
      setTimeout(() => { if (!sharingDirty) formMessage('sharing-message', ''); }, 1800);
    } catch (error) {
      sharingSave.disabled = false;
      formMessage('sharing-message', error.message || 'Could not save config', true);
    }
  }

  appearanceIds.forEach((id) => $(id).addEventListener('input', () => {
    setAppearanceDirty();
    renderThemePreview();
  }));
  sharingIds.forEach((id) => $(id).addEventListener('input', () => setSharingDirty()));

  accentText.addEventListener('input', updateSwatch);
  accentSwatch.addEventListener('click', () => accentColor.click());
  accentColor.addEventListener('input', (event) => {
    accentText.value = event.target.value;
    setAppearanceDirty();
    renderThemePreview();
    updateSwatch();
  });
  $('accent-clear').addEventListener('click', () => {
    accentText.value = '';
    setAppearanceDirty();
    renderThemePreview();
    updateSwatch();
  });

  // enhance selects and dismiss any open menu on outside click
  $('settings-form').querySelectorAll('select[data-uisel]').forEach(enhanceSelect);
  addEventListener('click', () => closeAllSelects());
  const anySelectOpen = () => uiSelects.some((s) => s.wrap.hasAttribute('data-open'));
  $('settings-form').addEventListener('submit', (event) => event.preventDefault());
  $('sharing-form').addEventListener('submit', (event) => event.preventDefault());
  settingsSave.addEventListener('click', saveAppearance);
  sharingSave.addEventListener('click', saveSharing);

  // ---- share popover -------------------------------------------------------
  const shareBtn = $('r-share'), sharePop = $('share-pop');

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
      el('div', { class: 'lead' }, 'Publish a snapshot of this summary at a public URL. The dashboard, API, and every other summary stay private.'),
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

  function paintBreadcrumb(view, slug) {
    breadcrumb.replaceChildren();
    if (view === 'read') {
      breadcrumb.append(
        el('a', { href: '#/' }, 'página inicial'),
        el('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
      );
      const d = docs.find((x) => x.slug === slug);
      const current = el('span', { 'aria-current': 'page' }, d ? d.title : (slug || 'summary'));
      if (d?.source) current.title = d.source;
      breadcrumb.appendChild(current);
      return;
    }
    breadcrumb.appendChild(
      el('span', { 'aria-current': 'page' }, viewLabels[view] || 'página inicial'),
    );
  }

  // Reader chrome only - deliberately never touches frame.src, so autosync can
  // repaint a retitled doc without reloading the iframe (which would throw away
  // the in-place morph the injected hot-reload client just did).
  function paintReader(slug) {
    $('r-raw').href = `/s/${slug}?raw=1`;
    const dl = $('r-dl');
    dl.href = `/s/${slug}?raw=1`;
    dl.download = slug + '.html';
    paintBreadcrumb('read', slug);
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

  function setActiveNav(name) {
    navLinks.forEach((link) => {
      const active = link.dataset.nav === name;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function showView(name) {
    currentView = name;
    Object.entries(views).forEach(([key, node]) => {
      node.hidden = key !== name;
    });
    shell.classList.toggle('is-reading', name === 'read');
    // Reading lives only in the main pane — sidebar stays out of that page.
    if (name === 'read') {
      navLinks.forEach((link) => {
        link.classList.remove('is-active');
        link.removeAttribute('aria-current');
      });
    } else {
      setActiveNav(name);
    }
    readerActions.hidden = name !== 'read';
    searchSlot.classList.toggle('is-dropdown', name !== 'home');
    if (name === 'home') closeSearchMenu();
    paintBreadcrumb(name, readerSlug);
  }

  function parseRoute() {
    const hash = location.hash || '';
    const read = hash.match(/^#\/read\/([\w-]+)$/);
    if (read) return { view: 'read', slug: read[1] };
    if (hash === '#/shared') return { view: 'shared' };
    if (hash === '#/sharing') return { view: 'sharing' };
    if (hash === '#/settings') return { view: 'settings' };
    if (hash === '' || hash === '#' || hash === '#/') return { view: 'home' };
    return { view: 'home' };
  }

  // hash routing: home / shared / sharing / settings + reader (same shell header)
  function route() {
    closeShare();
    closeSearchMenu();
    const next = parseRoute();

    if (next.view === 'read') {
      readerSlug = next.slug;
      showView('read');
      paintReader(next.slug);
      frameTo(`/s/${next.slug}`);
      if (!docs.length) loadAll().then(() => { if (readerSlug === next.slug) paintReader(next.slug); });
      return;
    }

    readerSlug = null;
    frameTo('about:blank');
    showView(next.view);

    if (next.view === 'home') {
      loadAll().then(() => { if (q.value.trim()) search(); });
    } else if (next.view === 'shared') {
      loadShared();
    } else if (next.view === 'sharing') {
      loadConfig({ forSharing: true });
    } else if (next.view === 'settings') {
      loadConfig({ forAppearance: true });
    }
  }

  addEventListener('hashchange', route);

  addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    if (e.key === '/' && document.activeElement !== q && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      q.focus();
      q.select();
    } else if (e.key === 'Escape') {
      if (anySelectOpen()) closeAllSelects();
      else if (!sharePop.hidden) closeShare();
      else if (!searchMenu.hidden) closeSearchMenu();
      else if (currentView === 'read') location.hash = '#/';
      else if (currentView === 'home' && q.value) { q.value = ''; search(); }
    }
  });

  // ---- autosync ------------------------------------------------------------
  // The server pushes a digest of the library on connect and on every change,
  // so adds, deletes and edits land without a refresh. EventSource reconnects
  // on its own, which covers server restarts too: the digest replayed on
  // reconnect gets compared against what we last rendered.
  async function sync() {
    await loadAll();               // leaves the view alone if a query is active…
    if (currentView === 'home' && q.value.trim()) search();
    if (currentView === 'shared') loadShared();
    if (readerSlug) paintReader(readerSlug);
  }

  let libState = null;
  new EventSource('/api/watch').addEventListener('state', (e) => {
    if (libState !== null && e.data !== libState) sync();
    libState = e.data;
  });

  loadAll().then(route);
})();
