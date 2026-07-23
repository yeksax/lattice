const API = 'http://127.0.0.1:4600';
const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const openUrl = tauri?.opener?.openUrl;
const $ = (id) => document.getElementById(id);

// Browser fetch from https://tauri.localhost → http://127.0.0.1 is blocked
// (mixed content). Prefer the Rust proxy when running inside Tauri.
async function api(path, { method = 'GET', body } = {}) {
  if (invoke) {
    try {
      const text = await invoke('daemon_fetch', {
        path,
        method,
        body: body == null ? null : typeof body === 'string' ? body : JSON.stringify(body),
      });
      return {
        ok: true,
        status: 200,
        json: async () => (text ? JSON.parse(text) : null),
        text: async () => text ?? '',
      };
    } catch (error) {
      const message = String(error?.message || error || 'request failed');
      return {
        ok: false,
        status: 0,
        json: async () => { throw new Error(message); },
        text: async () => message,
      };
    }
  }

  return fetch(`${API}${path}`, {
    method,
    headers: body == null ? undefined : { 'Content-Type': 'application/json' },
    body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const els = {
  apiBase: $('apiBase'), token: $('token'), systemDot: $('systemDot'),
  systemTitle: $('systemTitle'), msg: $('msg'), save: $('save'),
};

const tabCopy = {
  dashboard: ['Dashboard', 'Browse and search your local summary library.'],
  appearance: ['Appearance', 'Set the house style for new summaries.'],
  sharing: ['Sharing', 'Control hosted snapshots and CLI defaults.'],
  system: ['System', 'Manage the local daemon and library tools.'],
};

const fontStacks = {
  '': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, "Iowan Old Style", Baskerville, Georgia, serif',
};

let dirty = false;
let libraryDocs = [];
let searchSeq = 0;
let searchDebounce = 0;

function shortPath(path) {
  if (!path) return '';
  const home = path.match(/^\/(?:Users|home)\/[^/]+(\/.*)$/);
  if (home) return `~${home[1]}`;
  if (path.startsWith('~/')) return path;
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-2).join('/')}`;
}

function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function renderDashList(items, query = '') {
  const list = $('dashList');
  const empty = $('dashEmpty');
  const status = $('dashStatus');
  const count = $('dashCount');
  list.innerHTML = '';

  const total = libraryDocs.length;
  count.textContent = total ? `${total} summar${total === 1 ? 'y' : 'ies'}` : '';

  if (!total) {
    empty.hidden = false;
    status.hidden = true;
    const msg = $('dashEmptyMsg');
    if (msg) msg.textContent = 'No summaries yet.';
    const add = $('dashAdd');
    if (add) add.hidden = false;
    return;
  }

  empty.hidden = true;
  if (query) {
    status.hidden = false;
    status.textContent = `${items.length} result${items.length === 1 ? '' : 's'} for "${query}"`;
  } else {
    status.hidden = true;
    status.textContent = '';
  }

  const frag = document.createDocumentFragment();
  items.forEach((doc) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `dash-row${doc.missing ? ' is-missing' : ''}`;
    row.setAttribute('role', 'listitem');
    row.title = doc.source || doc.title || '';
    const tags = (doc.tags || []).map((tag) => `<span class="dash-tag">${escapeHtml(tag)}</span>`).join('');
    const snippet = doc.snippet || doc.description || '';
    row.innerHTML =
      `<div class="dash-row-top">` +
        `<span class="dash-title">${escapeHtml(doc.title || doc.slug)}</span>` +
        `<span class="dash-date">${escapeHtml(fmtDate(doc.created))}</span>` +
      `</div>` +
      (snippet ? `<div class="dash-sub">${escapeHtml(snippet)}</div>` : '') +
      `<div class="dash-meta">` +
        `<span class="dash-src">${escapeHtml(shortPath(doc.source || ''))}</span>` +
        (tags ? `<span class="dash-tags">${tags}</span>` : '') +
      `</div>`;
    if (!doc.missing) {
      row.addEventListener('click', () => openUrl?.(`${API}/#/read/${doc.slug}`));
    } else {
      row.disabled = true;
    }
    frag.appendChild(row);
  });
  list.appendChild(frag);
}

async function loadLibrary() {
  try {
    const response = await api('/api/summaries');
    if (!response.ok) throw new Error('offline');
    libraryDocs = await response.json() || [];
    const query = $('dashQ')?.value.trim() || '';
    if (query) await searchLibrary(query);
    else renderDashList(libraryDocs);
    if (!dirty && els.msg.textContent.includes('Daemon offline')) setMessage('');
  } catch {
    libraryDocs = [];
    renderDashList([]);
    const msg = $('dashEmptyMsg');
    if (msg) msg.textContent = 'Daemon offline. Open System to restart it.';
    const add = $('dashAdd');
    if (add) add.hidden = true;
  }
}

async function searchLibrary(query) {
  const my = ++searchSeq;
  if (!query) {
    renderDashList(libraryDocs);
    return;
  }
  try {
    const response = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('search failed');
    const result = await response.json();
    if (my !== searchSeq) return;
    renderDashList(result.hits || [], query);
  } catch {
    if (my !== searchSeq) return;
    renderDashList([], query);
  }
}

function controlValue(id) {
  return $(id)?.dataset.value ?? '';
}

function setControlValue(id, value) {
  const control = $(id);
  if (!control) return;
  control.dataset.value = value ?? '';

  if (control.matches('[data-select]')) {
    const option = [...control.querySelectorAll('[role="option"]')].find((item) => item.dataset.value === control.dataset.value)
      ?? control.querySelector('[role="option"]');
    control.querySelector('[data-select-label]').textContent = option?.querySelector('span')?.textContent ?? '';
    control.querySelectorAll('[role="option"]').forEach((item) => item.setAttribute('aria-selected', String(item === option)));
  }

  if (control.matches('[data-segmented]')) {
    control.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.value === control.dataset.value)));
  }

  if (control.matches('[data-swatches]')) {
    const exact = [...control.querySelectorAll('button:not(.swatch-custom)')].some((button) => button.dataset.value === control.dataset.value);
    const custom = control.querySelector('.swatch-custom');
    if (custom) {
      custom.hidden = exact || !control.dataset.value;
      custom.dataset.value = exact ? '__custom' : control.dataset.value;
      custom.style.setProperty('--swatch', control.dataset.value || '#737274');
    }
    control.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.value === control.dataset.value)));
  }
}

function setDirty(value = true) {
  dirty = value;
  els.save.disabled = !dirty;
  if (dirty) setMessage('Unsaved changes');
}

function setMessage(text, ok = false) {
  els.msg.textContent = text;
  els.msg.className = `message${ok ? ' ok' : ''}`;
  if (ok) setTimeout(() => { if (!dirty) els.msg.textContent = ''; }, 2200);
}

function closeMenus(except) {
  document.querySelectorAll('[data-select].is-open').forEach((select) => {
    if (select === except) return;
    select.classList.remove('is-open');
    select.querySelector('[data-select-trigger]').setAttribute('aria-expanded', 'false');
    select.querySelector('.select-menu').hidden = true;
  });
}

function renderPreview() {
  const preview = $('preview');
  const style = preview.style;
  const font = controlValue('font');
  const preset = controlValue('preset');
  const density = controlValue('density');
  const accent = controlValue('accent');

  style.setProperty('--pv-font', fontStacks[font] ?? fontStacks['']);
  style.setProperty('--pv-accent', accent || '#e9e9e7');
  const warm = preset === 'warm';
  const mono = preset === 'mono';
  const values = warm
    ? { '--pv-bg': '#eee9de', '--pv-ink': '#1d1a17', '--pv-ink2': '#625c54', '--pv-muted': '#8d8479' }
    : mono
      ? { '--pv-bg': '#0e0e0f', '--pv-ink': '#f2f2ef', '--pv-ink2': '#9a9a9b', '--pv-muted': '#707072' }
      : { '--pv-bg': '', '--pv-ink': '', '--pv-ink2': '', '--pv-muted': '' };
  Object.entries(values).forEach(([key, value]) => value ? style.setProperty(key, value) : style.removeProperty(key));
  style.padding = { '': '24px 26px', comfortable: '29px 31px', spacious: '35px 37px' }[density] ?? '24px 26px';
}

function activateTab(name, focus = false) {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    const active = panel.dataset.panel === name;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
  const [title, description] = tabCopy[name];
  $('pageTitle').textContent = title;
  $('pageDescription').textContent = description;
  const content = document.querySelector('.content');
  if (content) content.dataset.mode = name === 'dashboard' ? 'dashboard' : 'settings';
  closeMenus();
  resetTitleCollapse();
  if (name === 'dashboard') loadLibrary();
}

function syncTitleCollapse() {
  const panels = document.querySelector('.panels');
  const content = document.querySelector('.content');
  if (!panels || !content) return;
  const range = 52;
  const t = Math.min(1, Math.max(0, panels.scrollTop / range));
  content.style.setProperty('--title-collapse', t.toFixed(3));
}

function resetTitleCollapse() {
  const panels = document.querySelector('.panels');
  if (panels) panels.scrollTop = 0;
  syncTitleCollapse();
}

async function loadConfig() {
  try {
    const response = await api('/api/config');
    if (!response.ok) throw new Error('daemon unavailable');
    const config = await response.json();
    const theme = config.theme || {};
    setControlValue('preset', theme.preset || '');
    setControlValue('font', theme.font || '');
    setControlValue('density', theme.density || '');
    setControlValue('accent', theme.accent || '');
    const hosted = config.hosted || {};
    els.apiBase.value = hosted.apiBase || '';
    els.token.value = hosted.token || '';
    renderPreview();
    setDirty(false);
  } catch {
    setMessage('Daemon offline. Open System to restart it.');
  }
}

async function saveConfig() {
  const body = {
    version: 1,
    theme: {
      preset: controlValue('preset') || undefined,
      font: controlValue('font') || undefined,
      density: controlValue('density') || undefined,
      accent: controlValue('accent') || undefined,
    },
    hosted: {
      apiBase: els.apiBase.value.trim() || undefined,
      token: els.token.value.trim() || undefined,
    },
  };

  els.save.disabled = true;
  try {
    const response = await api('/api/config', { method: 'PUT', body });
    if (!response.ok) throw new Error(await response.text());
    dirty = false;
    setMessage('Changes saved', true);
    invoke?.('refresh').catch(() => {});
  } catch (error) {
    els.save.disabled = false;
    setMessage(`Could not save: ${error.message}`);
  }
}

async function refreshStatus() {
  let status = 'offline';
  if (invoke) {
    try { status = await invoke('daemon_status'); } catch {}
  } else {
    status = await api('/api/health').then((response) => response.ok ? 'running' : 'offline').catch(() => 'offline');
  }
  const online = status === 'running';
  els.systemDot.className = `large-dot ${online ? 'on' : 'off'}`;
  els.systemTitle.textContent = online ? 'Running normally' : 'Not responding';
}

document.querySelectorAll('[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const next = tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length];
    activateTab(next.dataset.tab, true);
  });
});

document.querySelectorAll('[data-select]').forEach((select) => {
  const trigger = select.querySelector('[data-select-trigger]');
  const menu = select.querySelector('.select-menu');
  trigger.addEventListener('click', () => {
    const open = !select.classList.contains('is-open');
    closeMenus(open ? select : undefined);
    select.classList.toggle('is-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
  });
  select.querySelectorAll('[role="option"]').forEach((option) => option.addEventListener('click', () => {
    setControlValue(select.id, option.dataset.value);
    closeMenus();
    if (select.id === 'preset') renderPreview();
    setDirty();
  }));
});

document.querySelectorAll('[data-segmented], [data-swatches]').forEach((control) => {
  control.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    setControlValue(control.id, button.dataset.value);
    renderPreview();
    setDirty();
  }));
});

document.addEventListener('click', (event) => { if (!event.target.closest('[data-select]')) closeMenus(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenus(); });
['apiBase', 'token'].forEach((id) => $(id).addEventListener('input', () => setDirty()));

$('toggleToken').addEventListener('click', (event) => {
  const show = els.token.type === 'password';
  els.token.type = show ? 'text' : 'password';
  event.currentTarget.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
  event.currentTarget.querySelector('i').className = `ph ${show ? 'ph-eye-slash' : 'ph-eye'}`;
});

els.save.addEventListener('click', saveConfig);
$('restart').addEventListener('click', async () => { await invoke?.('daemon_restart'); setMessage('Restarting daemon', true); setTimeout(refreshStatus, 1400); });
$('logs').addEventListener('click', () => invoke?.('open_logs'));
$('add').addEventListener('click', () => invoke?.('add_summary'));
$('dashAdd')?.addEventListener('click', () => invoke?.('add_summary'));
[$('dash'), $('openDashboard')].forEach((button) => button.addEventListener('click', () => openUrl?.(API)));

$('dashQ')?.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchLibrary($('dashQ').value.trim());
  }, 120);
});

window.__latticeNavigate = (tab) => {
  if (tab && tabCopy[tab]) activateTab(tab);
};
if (window.__latticePendingTab) {
  window.__latticeNavigate(window.__latticePendingTab);
  delete window.__latticePendingTab;
}

document.querySelector('.panels')?.addEventListener('scroll', syncTitleCollapse, { passive: true });
syncTitleCollapse();

loadConfig();
refreshStatus();
loadLibrary();
setInterval(refreshStatus, 5000);
setInterval(() => {
  if (document.querySelector('[data-panel="dashboard"].is-active')) loadLibrary();
}, 8000);
