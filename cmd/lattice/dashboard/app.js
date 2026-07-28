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
  const commentBtn = $('r-comment');
  const commentShell = $('r-comment-shell');
  const commentCount = $('r-comment-count');
  const commentPop = $('comment-pop');
  const settingsSave = $('settings-save');
  const sharingSave = $('sharing-save');

  let docs = []; // full library cache
  let settingsConfig = null;
  let appearanceDirty = false;
  let sharingDirty = false;
  let currentView = 'home';
  let readerSlug = null;
  let readerCommentMode = false;
  let readerThreads = [];

  const views = {
    home: $('view-home'),
    shared: $('view-shared'),
    sharing: $('view-sharing'),
    settings: $('view-settings'),
    read: $('view-read'),
  };
  const navLinks = [...document.querySelectorAll('[data-nav]')];

  // ---- i18n ----------------------------------------------------------------
  // Static markup is translated by its data-i18n key (see i18n.js); anything
  // built here goes through t(). Do this first so nothing paints in the wrong
  // language, then repaint the dynamic parts whenever the language changes.
  const i18n = window.LatticeI18n;
  const t = (key, vars) => i18n.t(key, vars);
  i18n.apply();

  // ---- theme ---------------------------------------------------------------
  // system | light | dark. "system" clears the pin on <html> so the CSS media
  // query takes over again; the inline head script replays the stored value
  // before first paint, so this only has to keep the buttons in sync.
  const THEME_KEY = 'lattice.theme';
  const THEMES = ['system', 'light', 'dark'];
  const themeToggle = $('theme-toggle');
  const themeLabel = $('theme-label');

  const readTheme = () => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch { return 'system'; }
  };

  const applyTheme = (pref) => {
    if (pref === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = pref;
    const name = t('theme.' + pref);
    themeToggle.dataset.pref = pref;
    themeLabel.textContent = name;
    themeToggle.title = t('theme.title', { name });
    themeToggle.setAttribute('aria-label', t('theme.aria', { name }));
  };

  themeToggle.addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length];
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch { /* private mode: the choice just won't stick */ }
    applyTheme(next);
  });

  // Keep other open tabs on the same theme.
  addEventListener('storage', (e) => {
    if (e.key === THEME_KEY || e.key === null) applyTheme(readTheme());
  });

  applyTheme(readTheme());

  const paintCommentMode = (active) => {
    readerCommentMode = active;
    commentShell.classList.toggle('is-active', active);
    commentBtn.classList.toggle('is-active', active);
    commentBtn.setAttribute('aria-pressed', String(active));
  };

  const REPLY_ICON =
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M85.66,146.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,61.66L43.31,104ZM128,96H99.31l34.35-34.34a8,8,0,0,0-11.32-11.32l-48,48a8,8,0,0,0,0,11.32l48,48a8,8,0,0,0,11.32-11.32L99.31,112H128a88.1,88.1,0,0,1,88,88,8,8,0,0,0,16,0A104.11,104.11,0,0,0,128,96Z"/></svg>';

  const commentRelativeTime = (seconds) => {
    const created = Number(seconds) || 0;
    if (!created) return '';
    const delta = Math.max(0, Date.now() - created * 1000);
    if (delta < 60_000) return t('reader.comment.threads.now');
    if (delta < 3_600_000) return Math.floor(delta / 60_000) + 'm';
    if (delta < 86_400_000) return Math.floor(delta / 3_600_000) + 'h';
    return new Date(created * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };

  const commentInitials = (name) => (name || '?').trim().slice(0, 1).toUpperCase();

  const closeCommentPop = () => {
    commentPop.hidden = true;
    commentCount.setAttribute('aria-expanded', 'false');
  };

  const openThreadInReader = (thread) => {
    if (!readerSlug || !frame.contentWindow || !thread?.selector) return;
    closeCommentPop();
    frame.contentWindow.postMessage({
      type: 'lattice:comment-open',
      selector: thread.selector,
      thread: thread.id,
    }, location.origin);
  };

  const paintCommentPop = () => {
    commentPop.replaceChildren();
    if (!readerThreads.length) {
      commentPop.append(el('p', { class: 'comment-pop-empty' }, t('reader.comment.threads.empty')));
      return;
    }
    readerThreads.forEach((thread) => {
      const author = thread.author || t('reader.comment.threads.someone');
      const row = el('button', {
        class: 'comment-thread' + (thread.status === 'resolved' ? ' is-resolved' : ''),
        type: 'button',
      });

      const avatar = el('span', { class: 'comment-thread-avatar', 'aria-hidden': 'true' }, commentInitials(author));
      const main = el('span', { class: 'comment-thread-main' });

      const head = el('span', { class: 'comment-thread-head' });
      head.append(el('b', { class: 'comment-thread-author' }, author));
      const when = commentRelativeTime(thread.created);
      if (when) head.append(el('time', {}, when));
      if (thread.edited) {
        head.append(el('span', { class: 'comment-thread-edited' }, t('reader.comment.threads.edited')));
      }
      main.append(head);

      if (thread.body) {
        main.append(el('p', { class: 'comment-thread-body' }, thread.body));
      }

      const reactionRows = Array.isArray(thread.reactions) ? thread.reactions : [];
      const hasReplies = thread.replies > 0;
      const hasReactions = reactionRows.length > 0;
      if (hasReplies || hasReactions) {
        const foot = el('span', { class: 'comment-thread-foot' });
        const replies = el('span', {
          class: 'comment-thread-replies',
          title: hasReplies ? t('reader.comment.threads.replies', { n: thread.replies }) : '',
        });
        if (hasReplies) {
          replies.innerHTML = REPLY_ICON;
          replies.append(document.createTextNode(
            t('reader.comment.threads.replies', { n: thread.replies }),
          ));
        } else {
          replies.hidden = true;
        }
        const reactions = el('span', { class: 'comment-thread-reactions' });
        if (hasReactions) {
          reactionRows.slice(0, 6).forEach((reaction) => {
            const chip = el('span', { class: 'comment-thread-chip' });
            chip.append(
              el('span', { class: 'comment-thread-chip-emoji' }, reaction.emoji),
              el('span', { class: 'comment-thread-chip-count' }, String(reaction.count || 1)),
            );
            reactions.append(chip);
          });
        } else {
          reactions.hidden = true;
        }
        foot.append(replies, reactions);
        main.append(foot);
      }

      row.append(avatar, main);
      row.addEventListener('click', (event) => {
        event.stopPropagation();
        openThreadInReader(thread);
      });
      commentPop.append(row);
    });
  };

  const toggleCommentPop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (commentCount.hidden) return;
    if (!commentPop.hidden) {
      closeCommentPop();
      return;
    }
    paintCommentPop();
    commentPop.hidden = false;
    commentCount.setAttribute('aria-expanded', 'true');
  };

  commentBtn.addEventListener('click', () => {
    if (!readerSlug || !frame.contentWindow) return;
    closeCommentPop();
    frame.contentWindow.postMessage({
      type: 'lattice:comment-mode',
      active: !readerCommentMode,
    }, location.origin);
  });

  commentCount.addEventListener('click', toggleCommentPop);

  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'lattice:comment-mode-state') {
      paintCommentMode(Boolean(event.data.active));
      return;
    }
    if (event.data?.type === 'lattice:comment-count') {
      const n = Number(event.data.count) || 0;
      readerThreads = Array.isArray(event.data.threads) ? event.data.threads : [];
      commentCount.textContent = String(n);
      commentCount.hidden = n === 0;
      if (n === 0) closeCommentPop();
      else if (!commentPop.hidden) paintCommentPop();
      return;
    }
    if (event.data?.type === 'lattice:document-theme') {
      const background = String(event.data.background || '');
      const color = String(event.data.color || '');
      const accent = String(event.data.accent || '');
      if (background) shell.style.setProperty('--reader-bg', background);
      if (color) shell.style.setProperty('--reader-ink', color);
      if (/^#[0-9a-f]{6}$/i.test(accent)) {
        shell.style.setProperty('--comment', accent);
      } else if (color) {
        shell.style.setProperty('--comment', color);
      }
    }
  });

  frame.addEventListener('load', () => {
    paintCommentMode(false);
    readerThreads = [];
    commentCount.hidden = true;
    closeCommentPop();
  });

  addEventListener('click', (event) => {
    if (commentPop.hidden) return;
    if (commentPop.contains(event.target) || commentCount.contains(event.target)) return;
    closeCommentPop();
  });

  const esc = (s) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Wrap query terms in <mark> (input already HTML-escaped).
  const highlight = (safe, terms) => {
    for (const term of terms) {
      if (!term) continue;
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      safe = safe.replace(re, (m) => '\x01' + m + '\x02');
    }
    return safe.replaceAll('\x01', '<mark>').replaceAll('\x02', '</mark>');
  };

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

  // Parent folder + filename — enough to locate without a wall of path.
  const fileLabel = (p) => {
    if (!p) return '';
    const parts = p.replaceAll('\\', '/').split('/').filter(Boolean);
    if (!parts.length) return '';
    const file = parts[parts.length - 1];
    const parent = parts[parts.length - 2];
    return parent ? parent + '/' + file : file;
  };

  // Prefer …/dev/personal/<project>/… or …/dev/<project>/…; else parent folder.
  const projectOf = (source) => {
    if (!source) return { key: 'unknown', label: t('library.project.unknown') };
    const parts = source.replaceAll('\\', '/').split('/').filter(Boolean);
    const dirs = parts.slice(0, -1);
    const lower = dirs.map((p) => p.toLowerCase());
    const personalIdx = lower.indexOf('personal');
    if (personalIdx >= 0 && dirs[personalIdx + 1]) {
      const label = dirs[personalIdx + 1];
      return { key: label.toLowerCase(), label };
    }
    const devIdx = lower.indexOf('dev');
    if (devIdx >= 0 && dirs[devIdx + 1] && lower[devIdx + 1] !== 'personal') {
      const label = dirs[devIdx + 1];
      return { key: label.toLowerCase(), label };
    }
    const parent = dirs[dirs.length - 1];
    if (parent) return { key: parent.toLowerCase(), label: parent };
    return { key: 'unknown', label: t('library.project.unknown') };
  };

  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const createdMs = (d) => {
    const t = d.created ? new Date(d.created).getTime() : 0;
    return Number.isNaN(t) ? 0 : t;
  };

  const fmtRelDate = (iso) => {
    if (!iso) return { label: '', title: '', datetime: '' };
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { label: '', title: '', datetime: '' };
    const title = d.toLocaleDateString(i18n.locale, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
    const datetime = iso.slice(0, 10);
    const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 86400000);
    let label;
    if (diff <= 0) label = t('date.today');
    else if (diff === 1) label = t('date.yesterday');
    else if (diff < 7) label = t('date.daysAgo', { n: diff });
    else label = d.toLocaleDateString(i18n.locale, { month: 'short', day: 'numeric' });
    return { label, title, datetime };
  };

  // ---- library prefs: group / sort / tag filter ----------------------------
  const LIB_GROUP_KEY = 'lattice.library.group';
  const LIB_SORT_KEY = 'lattice.library.sort';
  const LIB_TAGS_KEY = 'lattice.library.tags';
  const LIB_GROUPS = ['project', 'date', 'none'];
  const LIB_SORTS = ['newest', 'oldest', 'title'];

  const readLibGroup = () => {
    try {
      const v = localStorage.getItem(LIB_GROUP_KEY);
      return LIB_GROUPS.includes(v) ? v : 'project';
    } catch { return 'project'; }
  };
  const readLibSort = () => {
    try {
      const v = localStorage.getItem(LIB_SORT_KEY);
      return LIB_SORTS.includes(v) ? v : 'newest';
    } catch { return 'newest'; }
  };
  const readLibTags = () => {
    try {
      const raw = localStorage.getItem(LIB_TAGS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
    } catch { return new Set(); }
  };

  let libGroup = readLibGroup();
  let libSort = readLibSort();
  let libTags = readLibTags();

  const persistLibTags = () => {
    try { localStorage.setItem(LIB_TAGS_KEY, JSON.stringify([...libTags])); }
    catch { /* private mode */ }
  };

  const libraryBar = $('library-bar');
  const libraryTags = $('library-tags');

  const sortItems = (items) => {
    const out = items.slice();
    if (libSort === 'title') {
      out.sort((a, b) => (a.title || '').localeCompare(b.title || '', i18n.locale, { sensitivity: 'base' }));
    } else if (libSort === 'oldest') {
      out.sort((a, b) => createdMs(a) - createdMs(b));
    } else {
      out.sort((a, b) => createdMs(b) - createdMs(a));
    }
    return out;
  };

  const filterByTags = (items) => {
    if (!libTags.size) return items;
    return items.filter((d) => (d.tags || []).some((tag) => libTags.has(tag)));
  };

  // Bucket items while preserving encounter order (caller sorts first).
  const groupByDate = (items) => {
    const groups = [];
    const seen = new Map();
    for (const item of items) {
      const d = item.created ? new Date(item.created) : null;
      const valid = d && !Number.isNaN(d.getTime());
      const diff = valid
        ? Math.round((dayStart(new Date()) - dayStart(d)) / 86400000)
        : null;
      let key, label;
      if (diff == null) {
        key = 'unknown';
        label = t('date.unknown');
      } else if (diff <= 0) {
        key = 'today';
        label = t('date.today');
      } else if (diff === 1) {
        key = 'yesterday';
        label = t('date.yesterday');
      } else if (diff < 7) {
        key = 'week';
        label = t('date.week');
      } else {
        key = 'm-' + d.getFullYear() + '-' + d.getMonth();
        label = d.toLocaleDateString(i18n.locale, { month: 'long', year: 'numeric' });
      }
      let group = seen.get(key);
      if (!group) {
        group = { key, label, items: [] };
        seen.set(key, group);
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  };

  const groupByProject = (items) => {
    const groups = [];
    const seen = new Map();
    for (const item of items) {
      const { key, label } = projectOf(item.source);
      let group = seen.get(key);
      if (!group) {
        group = { key, label, items: [] };
        seen.set(key, group);
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  };

  // tiny DOM builder - keeps user strings out of innerHTML
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    for (const kid of kids) n.append(kid);
    return n;
  }

  // ---- hover peek (single shared iframe + LRU blob cache) ------------------
  const rowPeek = $('row-peek');
  const rowPeekFrame = $('row-peek-frame');
  const peekOk = () =>
    matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduceMotion = () =>
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PEEK_CACHE_MAX = 10;
  const peekCache = new Map(); // slug -> blob: URL (insertion order = LRU)
  let peekTimer = 0;
  let peekSlug = '';
  let peekRow = null;
  let peekAbort = null;
  let peekGen = 0;

  function peekCacheGet(slug) {
    if (!peekCache.has(slug)) return '';
    const url = peekCache.get(slug);
    // Refresh LRU position.
    peekCache.delete(slug);
    peekCache.set(slug, url);
    return url;
  }

  function peekCachePut(slug, url) {
    if (peekCache.has(slug)) {
      URL.revokeObjectURL(peekCache.get(slug));
      peekCache.delete(slug);
    }
    while (peekCache.size >= PEEK_CACHE_MAX) {
      const oldest = peekCache.keys().next().value;
      URL.revokeObjectURL(peekCache.get(oldest));
      peekCache.delete(oldest);
    }
    peekCache.set(slug, url);
  }

  async function fetchPeekUrl(slug) {
    const hit = peekCacheGet(slug);
    if (hit) return hit;
    peekAbort?.abort();
    const ac = new AbortController();
    peekAbort = ac;
    const res = await fetch('/s/' + encodeURIComponent(slug) + '?raw=1', {
      signal: ac.signal,
      headers: { Accept: 'text/html' },
    });
    if (!res.ok) throw new Error('peek failed');
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    peekCachePut(slug, url);
    return url;
  }

  function hidePeek() {
    clearTimeout(peekTimer);
    peekTimer = 0;
    peekRow = null;
    peekAbort?.abort();
    peekAbort = null;
    peekGen++;
    rowPeek.classList.remove('is-visible', 'is-ready');
    // Park the node so a re-render does not destroy the iframe mid-flight.
    if (rowPeek.parentElement !== $('view-home')) {
      $('view-home').appendChild(rowPeek);
    }
    rowPeek.hidden = true;
    rowPeek.setAttribute('aria-hidden', 'true');
  }

  function showPeek(row, slug) {
    if (!peekOk() || !slug || !row || row.classList.contains('missing')) return;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(async () => {
      const gen = ++peekGen;
      peekRow = row;
      rowPeek.hidden = false;
      rowPeek.setAttribute('aria-hidden', 'false');
      rowPeekFrame.removeAttribute('title');
      row.appendChild(rowPeek);

      const reveal = () => {
        if (gen !== peekGen || peekRow !== row) return;
        rowPeek.classList.add('is-visible');
        if (reduceMotion()) rowPeek.classList.add('is-ready');
        else {
          const ready = () => {
            if (gen === peekGen) rowPeek.classList.add('is-ready');
          };
          rowPeekFrame.addEventListener('load', ready, { once: true });
          setTimeout(ready, 420);
        }
      };

      if (peekSlug === slug && rowPeekFrame.src) {
        reveal();
        return;
      }

      rowPeek.classList.remove('is-visible', 'is-ready');
      void rowPeek.offsetWidth;

      try {
        const url = await fetchPeekUrl(slug);
        if (gen !== peekGen || peekRow !== row) return;
        peekSlug = slug;
        // Only assign when the blob URL actually changes — avoids a reload.
        if (rowPeekFrame.src !== url) rowPeekFrame.src = url;
        reveal();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        if (gen === peekGen) hidePeek();
      }
    }, 120);
  }

  list.addEventListener('mouseleave', hidePeek);
  const mainBody = document.querySelector('.main-body');
  mainBody?.addEventListener('scroll', hidePeek, { passive: true });

  function renderRow(d, terms = [], { showDate = true } = {}) {
    const when = fmtRelDate(d.created);
    // Skip the per-row label when the section heading already says it
    // (Today / Yesterday). No title tooltips — full paths are noisy.
    const dateHtml = showDate && when.label
      ? `<time class="date" datetime="${esc(when.datetime)}">${esc(when.label)}</time>`
      : '';

    const row = document.createElement('div');
    row.className = 'row' + (d.missing ? ' missing' : '') + (dateHtml ? ' has-date' : '');
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;
    row.dataset.slug = d.slug || '';

    const tags = (d.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('');
    const missingTag = d.missing ? `<span class="tag is-missing">${esc(t('row.missing'))}</span>` : '';
    const sub = d.snippet
      ? highlight(esc(d.snippet), terms)
      : esc(d.description || '');
    const src = fileLabel(d.source || '');

    row.innerHTML =
      dateHtml +
      `<div class="row-content">` +
        `<div class="row-top">` +
          `<span class="title">${highlight(esc(d.title), terms)}</span>` +
        `</div>` +
        (sub ? `<div class="sub">${sub}</div>` : '') +
        `<div class="row-meta">` +
          (src ? `<span class="src">${esc(src)}</span>` : '') +
          ((tags || missingTag) ? `<span class="tags">${tags}${missingTag}</span>` : '') +
        `</div>` +
      `</div>`;

    if (!d.missing) {
      const open = () => { location.hash = '#/read/' + d.slug; };
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      row.addEventListener('mouseenter', () => showPeek(row, d.slug));
    }
    return row;
  }

  function syncLibraryControls() {
    libraryBar.querySelectorAll('[data-lib-group]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.libGroup === libGroup);
      btn.setAttribute('aria-pressed', btn.dataset.libGroup === libGroup ? 'true' : 'false');
    });
    libraryBar.querySelectorAll('[data-lib-sort]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.libSort === libSort);
      btn.setAttribute('aria-pressed', btn.dataset.libSort === libSort ? 'true' : 'false');
    });
  }

  const TAG_CHIP_LIMIT = 8;
  let tagsExpanded = false;

  function renderTagChips() {
    const counts = new Map();
    for (const d of docs) {
      for (const tag of d.tags || []) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    const ranked = [...counts.entries()].sort((a, b) =>
      b[1] - a[1] || a[0].localeCompare(b[0], i18n.locale, { sensitivity: 'base' }));
    const all = ranked.map(([tag]) => tag);

    let visible;
    if (tagsExpanded || all.length <= TAG_CHIP_LIMIT) {
      visible = all;
    } else {
      const top = all.slice(0, TAG_CHIP_LIMIT);
      const topSet = new Set(top);
      // Keep active filters visible even when they fall outside the top N.
      const extras = [...libTags].filter((tag) => counts.has(tag) && !topSet.has(tag));
      visible = [...extras, ...top];
    }

    libraryTags.replaceChildren();
    libraryTags.hidden = all.length === 0;
    for (const tag of visible) {
      const btn = el('button', {
        type: 'button',
        class: 'library-chip library-tag' + (libTags.has(tag) ? ' is-active' : ''),
        'aria-pressed': libTags.has(tag) ? 'true' : 'false',
      }, tag);
      btn.addEventListener('click', () => {
        if (libTags.has(tag)) libTags.delete(tag);
        else libTags.add(tag);
        persistLibTags();
        paintLibrary();
      });
      libraryTags.appendChild(btn);
    }

    if (all.length > TAG_CHIP_LIMIT) {
      const more = el('button', {
        type: 'button',
        class: 'library-chip library-tag-more',
        'aria-expanded': tagsExpanded ? 'true' : 'false',
      }, tagsExpanded ? t('library.tags.less') : t('library.tags.more', { n: all.length - TAG_CHIP_LIMIT }));
      more.addEventListener('click', () => {
        tagsExpanded = !tagsExpanded;
        renderTagChips();
      });
      libraryTags.appendChild(more);
    }
  }

  function prepareGroups(items, { searching }) {
    const filtered = filterByTags(items);
    const sorted = sortItems(filtered);

    // Search stays flat — snippets matter more than shelves.
    if (searching || libGroup === 'none' || sorted.length < 2) {
      return [{ key: 'all', label: '', items: sorted, showDate: true }];
    }
    if (libGroup === 'date') {
      return groupByDate(sorted).map((g) => ({
        ...g,
        showDate: g.key !== 'today' && g.key !== 'yesterday',
      }));
    }
    // project (default): always show relative dates on the row
    return groupByProject(sorted).map((g) => ({
      ...g,
      label: t('library.project.count', { name: g.label, n: g.items.length }),
      showDate: true,
    }));
  }

  function render(items, terms = []) {
    hidePeek();
    list.innerHTML = '';
    const searching = terms.some(Boolean);
    const groups = prepareGroups(items, { searching });
    const visible = groups.reduce((n, g) => n + g.items.length, 0);

    $('empty').hidden = visible > 0 || docs.length === 0;
    if (docs.length === 0) $('empty').hidden = false;
    libraryBar.hidden = docs.length === 0;

    const frag = document.createDocumentFragment();
    for (const group of groups) {
      if (!group.items.length) continue;
      const section = document.createElement('section');
      section.className = 'list-group';
      if (group.label) {
        section.setAttribute('aria-label', group.label);
        const heading = document.createElement('h2');
        heading.className = 'list-group-label';
        heading.textContent = group.label;
        section.appendChild(heading);
      }
      const body = document.createElement('div');
      body.className = 'list-group-body';
      group.items.forEach((d) => body.appendChild(renderRow(d, terms, { showDate: group.showDate })));
      section.appendChild(body);
      frag.appendChild(section);
    }
    list.appendChild(frag);
  }

  function paintLibrary() {
    syncLibraryControls();
    renderTagChips();
    if (q.value.trim()) search();
    else {
      setStatus('');
      render(docs);
    }
  }

  libraryBar.addEventListener('click', (e) => {
    const groupBtn = e.target.closest('[data-lib-group]');
    if (groupBtn) {
      libGroup = groupBtn.dataset.libGroup;
      try { localStorage.setItem(LIB_GROUP_KEY, libGroup); } catch { /* */ }
      paintLibrary();
      return;
    }
    const sortBtn = e.target.closest('[data-lib-sort]');
    if (sortBtn) {
      libSort = sortBtn.dataset.libSort;
      try { localStorage.setItem(LIB_SORT_KEY, libSort); } catch { /* */ }
      paintLibrary();
    }
  });

  function setStatus(text) {
    if (!text) {
      eyebrow.hidden = true;
      eyebrow.textContent = '';
      return;
    }
    eyebrow.hidden = false;
    eyebrow.textContent = text;
  }

  const updateCount = () => { count.textContent = t('home.count', { n: docs.length }); };

  async function loadAll() {
    docs = await (await fetch('/api/summaries')).json() || [];
    updateCount();
    if (!q.value.trim()) {
      setStatus('');
      paintLibrary();
    } else {
      renderTagChips();
      syncLibraryControls();
      search();
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
        query ? t('search.none') : t('search.hint')));
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
      if (!query) { setStatus(''); paintLibrary(); return; }
      const my = ++seq;
      const res = await (await fetch('/api/search?q=' + encodeURIComponent(query))).json();
      if (my !== seq) return;
      const n = res.hits.length;
      setStatus(t('search.results', { n, q: query }));
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

  // ---- domain helpers (shared by the shared view and the share popover) -----
  // "acme.com, @Team.dev " → ['acme.com', 'team.dev']. An empty field means
  // public, which is what the API reads an empty array as.
  const parseDomains = (value) =>
    String(value || '')
      .split(/[,\s]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@+/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(Boolean);

  const domainField = (value) =>
    el('input', {
      class: 'url',
      type: 'text',
      value: value || '',
      placeholder: t('share.domains.placeholder'),
      spellcheck: 'false',
      autocapitalize: 'off',
    });

  // A domain-gated share is gated by a company, and a favicon says which one
  // faster than the string does. The daemon proxies and caches it (see
  // favicon.go) so no icon service learns who this person shares with; a domain
  // that serves no icon falls back to the monogram, which is what paints first.
  function domainMark(domain) {
    const wrap = el('span', { class: 'share-mark' });
    const mono = el('span', { class: 'share-mono' }, (domain[0] || '?').toUpperCase());
    const img = el('img', {
      class: 'share-favicon',
      src: '/api/favicon?domain=' + encodeURIComponent(domain),
      alt: '',
      loading: 'lazy',
      width: '13',
      height: '13',
    });
    img.hidden = true;
    img.addEventListener('load', () => { img.hidden = false; mono.remove(); });
    img.addEventListener('error', () => img.remove());
    wrap.append(mono, img);
    return wrap;
  }

  // ---- compartilhados ------------------------------------------------------
  const sharedList = $('shared-list');
  const sharedEmpty = $('shared-empty');
  const sharedCount = $('shared-count');
  const sharedStatus = $('shared-status');
  const sharedBar = $('shared-bar');

  const SHARED_SORT_KEY = 'lattice.shared.sort';
  const SHARED_ACCESS_KEY = 'lattice.shared.access';
  const SHARED_SORTS = ['updated', 'created', 'title'];
  const SHARED_ACCESSES = ['all', 'public', 'domain'];

  const readPref = (key, allowed, fallback) => {
    try {
      const v = localStorage.getItem(key);
      return allowed.includes(v) ? v : fallback;
    } catch { return fallback; }
  };

  let sharedSort = readPref(SHARED_SORT_KEY, SHARED_SORTS, 'updated');
  let sharedAccess = readPref(SHARED_ACCESS_KEY, SHARED_ACCESSES, 'all');
  let sharedRows = [];              // last payload, so filters repaint without a refetch
  const sharedOpenPanels = new Set();  // slugs whose access editor is expanded
  const sharedOpenHistory = new Set(); // slugs whose snapshot history is expanded

  const ICONS = {
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H7a2 2 0 0 0-2 2v8"/>',
    external: '<path d="M7 17 17 7"/><polyline points="9 7 17 7 17 15"/>',
    reader: '<path d="M3 5.5h5.5a3.5 3.5 0 0 1 3.5 3.5v9a3 3 0 0 0-3-3H3Z"/><path d="M21 5.5h-5.5a3.5 3.5 0 0 0-3.5 3.5v9a3 3 0 0 1 3-3H21Z"/>',
    republish: '<path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M4 20v-4.5h4.5"/>',
    access: '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
    stop: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5 17.5 17.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5a13 13 0 0 1 0 17"/><path d="M12 3.5a13 13 0 0 0 0 17"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    history: '<path d="M3.8 9.5A8.5 8.5 0 1 1 3.5 12"/><path d="M3.5 4.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  };

  function actionIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  // Actions are icons with the label kept in the DOM but hidden: the tooltip
  // and the accessible name still read it, and a state change (copied, armed,
  // publishing) can reveal it without a second element.
  function shareAction(name, label, onClick, { danger = false, tag = 'button' } = {}) {
    const node = tag === 'a'
      ? el('a', { class: 'share-act', target: '_blank', rel: 'noopener' })
      : el('button', { class: 'share-act', type: 'button' });
    if (danger) node.classList.add('is-danger');
    node.dataset.icon = name;
    node.append(actionIcon(name), el('span', { class: 'share-act-label' }, label));
    node.title = label;
    node.setAttribute('aria-label', label);
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick?.(node, event);
    });
    return node;
  }

  // Swap an action's icon and label for the duration of a state, then put both
  // back. Returns the restore function for the paths that finish early.
  function actionState(node, iconName, label) {
    const svg = node.querySelector('svg');
    const text = node.querySelector('.share-act-label');
    if (svg) svg.innerHTML = ICONS[iconName] || '';
    if (text) text.textContent = label;
    return () => {
      if (svg) svg.innerHTML = ICONS[node.dataset.icon] || '';
      if (text) text.textContent = node.title;
    };
  }

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
    sharedList.replaceChildren();
    sharedBar.hidden = true;
    sharedEmpty.hidden = false;
    sharedEmpty.innerHTML = html;
    sharedCount.textContent = '';
  }

  async function copyText(text) {
    if (!text) return false;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const tmp = el('input', { value: text });
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand?.('copy');
      tmp.remove();
    }
    return true;
  }

  // Copy, then say so on the control that was clicked.
  async function copyFrom(node, text) {
    if (!await copyText(text)) return;
    const restore = actionState(node, 'check', t('shared.copied'));
    node.classList.add('is-done');
    setTimeout(() => {
      restore();
      node.classList.remove('is-done');
    }, 1200);
  }

  // Epoch seconds (hosted API) → the same relative label the library uses.
  // `lower` is the form that reads right mid-sentence ("published yesterday").
  const epochLabel = (sec) => {
    if (!sec) return null;
    const when = fmtRelDate(new Date(sec * 1000).toISOString());
    return { ...when, lower: when.label.toLocaleLowerCase(i18n.locale) };
  };

  // The snapshot is a copy, so the file on disk drifts away from it silently.
  // 30s of slack absorbs the gap between reading the file and the upload
  // landing — anything past that is a real edit the reader has not seen.
  const shareDrifted = (sh, doc) =>
    !!(doc && !doc.missing && sh.updated && doc.modified &&
      Date.parse(doc.modified) / 1000 > sh.updated + 30);

  function sharedSortValue(sh) {
    if (sharedSort === 'created') return sh.created || sh.updated || 0;
    return sh.updated || sh.created || 0;
  }

  function visibleShares() {
    const out = sharedRows.filter((sh) => {
      if (sharedAccess === 'public') return !(sh.domains || []).length;
      if (sharedAccess === 'domain') return (sh.domains || []).length > 0;
      return true;
    });
    if (sharedSort === 'title') {
      out.sort((a, b) => shareTitle(a).localeCompare(shareTitle(b), i18n.locale, { sensitivity: 'base' }));
    } else {
      out.sort((a, b) => sharedSortValue(b) - sharedSortValue(a));
    }
    return out;
  }

  const shareTitle = (sh) => {
    const doc = docs.find((d) => d.slug === sh.slug);
    return doc?.title || sh.title || sh.slug;
  };

  function syncSharedControls() {
    sharedBar.querySelectorAll('[data-shared-sort]').forEach((btn) => {
      const on = btn.dataset.sharedSort === sharedSort;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    sharedBar.querySelectorAll('[data-shared-access]').forEach((btn) => {
      const on = btn.dataset.sharedAccess === sharedAccess;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  sharedBar.addEventListener('click', (event) => {
    const sortBtn = event.target.closest('[data-shared-sort]');
    if (sortBtn) {
      sharedSort = sortBtn.dataset.sharedSort;
      try { localStorage.setItem(SHARED_SORT_KEY, sharedSort); } catch { /* private mode */ }
      paintShared();
      return;
    }
    const accessBtn = event.target.closest('[data-shared-access]');
    if (accessBtn) {
      sharedAccess = accessBtn.dataset.sharedAccess;
      try { localStorage.setItem(SHARED_ACCESS_KEY, sharedAccess); } catch { /* private mode */ }
      paintShared();
    }
  });

  // The access badge: who can open this link, stated the way the reader will
  // experience it — a public link, or a Google sign-in on these domains.
  function accessBadge(domains) {
    if (!domains.length) {
      const badge = el('span', { class: 'share-badge' });
      const globe = actionIcon('globe');
      globe.classList.add('share-badge-icon');
      badge.append(globe, el('span', { class: 'share-badge-text' }, t('shared.access.public')));
      return badge;
    }
    const badge = el('span', {
      class: 'share-badge is-domain',
      title: domains.map((d) => '@' + d).join(', '),
    });
    domains.slice(0, 2).forEach((d) => badge.appendChild(domainMark(d)));
    badge.append(el('span', { class: 'share-badge-text' }, '@' + domains[0]));
    if (domains.length > 1) {
      badge.append(el('span', { class: 'share-badge-more' }, '+' + (domains.length - 1)));
    }
    return badge;
  }

  function shareMeta(sh, doc) {
    const meta = el('div', { class: 'share-meta' });
    // No dot separators: this line wraps, and a wrapped line would open or end
    // on an orphan dot. Spacing does the separating instead.
    const push = (node) => {
      meta.appendChild(node);
      return node;
    };
    const chip = (text, cls) => push(el('span', { class: 'share-chip' + (cls ? ' ' + cls : '') }, text));

    push(accessBadge(sh.domains || []));
    if (sh.version > 1) chip(t('shared.version', { n: sh.version }));
    if (sh.votes) chip(t('shared.votes', { n: sh.votes }));
    if (sh.comments) chip(t('shared.comments', { n: sh.comments }));
    if (sh.threads_open) chip(t('shared.threadsOpen', { n: sh.threads_open }));

    // Second line: where the file lives, and — pinned right, same spot on every
    // card — how fresh the snapshot is.
    const sub = el('div', { class: 'share-subline' });
    const src = fileLabel(doc?.source || '');
    if (src) {
      const node = el('span', { class: 'share-chip is-src' }, src);
      node.title = doc.source;
      sub.appendChild(node);
    }
    const updated = epochLabel(sh.updated);
    const created = epochLabel(sh.created);
    if (updated?.label) {
      const node = el('span', { class: 'share-chip is-when' }, t('shared.updated', { when: updated.lower }));
      node.title = created?.title
        ? t('shared.published.title', { when: created.title })
        : t('shared.updated.title', { when: updated.title || updated.label });
      sub.appendChild(node);
    }

    const wrap = document.createDocumentFragment();
    wrap.append(meta, sub);
    return wrap;
  }

  // Access editor, inline. Saving re-posts the share, which is also how the CLI
  // changes a restriction — and re-uploads the file as it stands on disk.
  function accessPanel(sh) {
    const panel = el('div', { class: 'share-panel' });
    const field = domainField((sh.domains || []).join(', '));
    const save = el('button', { class: 'share-panel-save', type: 'button' }, t('share.access.save'));
    const note = el('div', { class: 'share-panel-note' }, t('share.domains.hint'));

    save.addEventListener('click', async (event) => {
      event.stopPropagation();
      save.disabled = true;
      save.textContent = t('share.access.saving');
      try {
        const response = await fetch('/api/shares', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: sh.slug, domains: parseDomains(field.value) }),
        });
        const out = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(out.error || t('form.error.save'));
        save.textContent = t('share.access.saved');
        sharedOpenPanels.delete(sh.slug);
        setTimeout(loadShared, 600);
      } catch (error) {
        save.disabled = false;
        save.textContent = t('share.access.save');
        note.textContent = String(error.message || error);
        note.classList.add('is-error');
      }
    });
    field.addEventListener('click', (event) => event.stopPropagation());
    field.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') save.click();
    });

    panel.append(
      el('span', { class: 'share-panel-label' }, t('share.domains.label')),
      el('div', { class: 'share-panel-row' }, field, save),
      note,
    );
    return panel;
  }

  // Re-upload the file as it stands on disk. Works from a card button or a menu
  // item; both report on the control that was clicked.
  async function republishShare(sh, node) {
    const label = node.querySelector('.share-act-label') || node.querySelector('span');
    const original = label?.textContent;
    node.disabled = true;
    node.classList.add('is-busy');
    if (label) label.textContent = t('shared.republishing');
    try {
      const response = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: sh.slug }),
      });
      if (!response.ok) {
        const out = await response.json().catch(() => ({}));
        throw new Error(out.error || t('shared.error.republish'));
      }
      node.classList.remove('is-busy');
      if (label) label.textContent = t('shared.republished');
      setTimeout(loadShared, 700);
    } catch (error) {
      node.disabled = false;
      node.classList.remove('is-busy');
      if (label) label.textContent = original;
      setSharedStatus(error.message || t('shared.error.republish'), true);
    }
  }

  // Unsharing takes a public URL down for everyone holding it, so it asks once.
  // Two clicks on the same item, no modal: the second click is the answer.
  function stopMenuItem(sh) {
    let armed = false;
    let disarm = 0;
    const item = menuItem('stop', t('shared.stop'), async () => {
      const label = item.querySelector('span');
      if (!armed) {
        armed = true;
        item.classList.add('is-armed');
        label.textContent = t('shared.stop.confirm');
        disarm = setTimeout(() => {
          armed = false;
          item.classList.remove('is-armed');
          label.textContent = t('shared.stop');
        }, 4000);
        return;
      }
      clearTimeout(disarm);
      item.disabled = true;
      label.textContent = t('shared.stopping');
      try {
        const response = await fetch('/api/shares/' + encodeURIComponent(sh.slug), { method: 'DELETE' });
        if (!response.ok && response.status !== 204) throw new Error(t('shared.error.stop'));
        closeShareMenu();
        await loadShared();
      } catch (error) {
        item.disabled = false;
        armed = false;
        item.classList.remove('is-armed');
        label.textContent = t('shared.stop');
        setSharedStatus(error.message || t('shared.error.stop'), true);
      }
    }, { danger: true });
    return item;
  }

  // ---- card preview --------------------------------------------------------
  // The snapshot itself is the best description of a share, so every card shows
  // one: the local file, scaled down, in a script-less iframe. Mounted only
  // when the card scrolls into view — a shelf of shares should not open twenty
  // documents at once — and sandboxed, so a preview cannot run anything.
  const previewObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        if (!entry.target.dataset.mounted) mountPreview(entry.target);
      }
    }, { rootMargin: '200px' })
    : null;

  function mountPreview(box, src) {
    box.dataset.mounted = '1';
    const frame = el('iframe', {
      src: src || '/s/' + encodeURIComponent(box.dataset.slug) + '?raw=1',
      title: '',
      tabindex: '-1',
      loading: 'lazy',
      sandbox: '',
      'aria-hidden': 'true',
    });
    box.classList.remove('is-ready');
    frame.addEventListener('load', () => box.classList.add('is-ready'));
    box.replaceChildren(frame);
  }

  function sharePreview(sh, doc, openable) {
    const box = el('div', { class: 'share-preview', 'aria-hidden': 'true' });
    if (!openable) {
      // No local file to render: say so instead of framing an error page.
      box.classList.add('is-blank');
      box.appendChild(el('span', { class: 'share-preview-note' },
        t(doc ? 'row.missing' : 'shared.orphan')));
      return box;
    }
    box.dataset.slug = sh.slug;
    if (previewObserver) previewObserver.observe(box);
    else mountPreview(box);
    return box;
  }

  // ---- snapshot history ----------------------------------------------------
  // Publishing replaces what readers see, but the old revisions are still in
  // R2. This panel is the only place they are visible: pick one and the card's
  // preview swaps to it, so "what did they see last week" is one click, not an
  // archaeology exercise.
  const fmtBytes = (n) => {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const fmtStamp = (sec) => {
    if (!sec) return '';
    return new Date(sec * 1000).toLocaleString(i18n.locale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  function historyPanel(sh, card, preview, openable) {
    const panel = el('div', { class: 'share-panel share-history' });
    const list = el('div', { class: 'share-history-list' });
    panel.append(el('span', { class: 'share-panel-label' }, t('shared.history')), list);

    const note = (text, error = false) => {
      const node = el('div', { class: 'share-panel-note' + (error ? ' is-error' : '') }, text);
      list.replaceChildren(node);
    };

    const showVersion = (version, current) => {
      if (!preview) return;
      card.classList.toggle('is-viewing', !current);
      viewingLabel.textContent = t('shared.history.viewing', { n: version });
      viewing.hidden = current;
      mountPreview(
        preview,
        current
          ? undefined
          : `/api/shares/${encodeURIComponent(sh.slug)}/versions/${version}`,
      );
      // Stamp the preview itself (after mounting, which replaces its children):
      // the panel can be scrolled out of sight, and an old revision must never
      // read as the live one.
      if (!current) {
        preview.appendChild(el('span', { class: 'share-preview-badge' }, 'v' + version));
      }
      list.querySelectorAll('.share-version').forEach((row) => {
        row.classList.toggle('is-active', Number(row.dataset.version) === version);
      });
    };

    const viewingLabel = el('span', {});
    const back = el('button', { class: 'share-version-back', type: 'button' }, t('shared.history.back'));
    const viewing = el('div', { class: 'share-viewing' }, viewingLabel, back);
    viewing.hidden = true;
    back.addEventListener('click', (event) => {
      event.stopPropagation();
      const live = list.querySelector('.share-version[data-current="1"]');
      showVersion(Number(live?.dataset.version) || 1, true);
    });
    panel.appendChild(viewing);

    let loaded = false;
    panel.loadHistory = async () => {
      if (loaded) return;
      note(t('shared.loading'));
      try {
        const response = await fetch('/api/shares/' + encodeURIComponent(sh.slug) + '/versions');
        const versions = await response.json();
        // 501: the backend predates the history API (see hosted.go). Say that
        // in the dashboard's own words rather than relaying an HTTP verdict.
        if (response.status === 501) throw new Error(t('shared.history.unsupported'));
        if (!response.ok) throw new Error(versions?.error || t('shared.error.history'));
        loaded = true;
        if (!versions.length) {
          note(t('shared.history.none'));
          return;
        }
        list.replaceChildren();
        versions.forEach((v) => {
          const row = el('div', { class: 'share-version' });
          row.dataset.version = String(v.version);
          if (v.current) {
            row.dataset.current = '1';
            row.classList.add('is-active');
          }
          const facts = [fmtStamp(v.created), fmtBytes(v.size)].filter(Boolean).join(' · ');
          row.append(
            el('span', { class: 'share-version-n' }, 'v' + v.version),
            el('span', { class: 'share-version-facts' }, facts),
          );
          if (v.current) {
            row.appendChild(el('span', { class: 'share-version-tag' }, t('shared.history.current')));
          } else if (openable) {
            const view = el('button', { class: 'share-version-view', type: 'button' }, t('shared.history.view'));
            view.addEventListener('click', (event) => {
              event.stopPropagation();
              showVersion(v.version, false);
            });
            row.appendChild(view);
          }
          const open = el('a', {
            class: 'share-version-open',
            href: `/api/shares/${encodeURIComponent(sh.slug)}/versions/${v.version}`,
            target: '_blank',
            rel: 'noopener',
            title: t('shared.history.openTab'),
          });
          open.appendChild(actionIcon('external'));
          open.addEventListener('click', (event) => event.stopPropagation());
          row.appendChild(open);
          list.appendChild(row);
        });
      } catch (error) {
        note(error.message || t('shared.error.history'), true);
      }
    };
    return panel;
  }

  // ---- overflow menu -------------------------------------------------------
  let openMenu = null;

  function closeShareMenu() {
    if (!openMenu) return;
    openMenu.menu.remove();
    openMenu.button.setAttribute('aria-expanded', 'false');
    openMenu = null;
  }

  addEventListener('click', closeShareMenu);
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeShareMenu();
  });

  function menuItem(iconName, label, onClick, { danger = false } = {}) {
    const item = el('button', { class: 'share-menu-item', type: 'button' });
    if (danger) item.classList.add('is-danger');
    item.append(actionIcon(iconName), el('span', {}, label));
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick(item);
    });
    return item;
  }

  function renderShareCard(sh) {
    const doc = docs.find((d) => d.slug === sh.slug);
    const openable = !!doc && !doc.missing;
    const drifted = shareDrifted(sh, doc);

    const card = el('article', { class: 'share-card', role: 'listitem' });
    if (drifted) card.classList.add('has-drift');
    if (openable) card.tabIndex = 0;

    const heading = el('div', { class: 'share-card-top' },
      el('h2', { class: 'title' }, shareTitle(sh)),
    );
    if (drifted) {
      heading.appendChild(el('span', { class: 'share-flag is-drift', title: t('shared.drift.title') }, t('shared.drift')));
    }

    const body = el('div', { class: 'share-card-body' }, heading);

    // Meta description if the file has one, its own opening paragraph if not.
    const description = doc?.description || doc?.excerpt || '';
    if (description) body.appendChild(el('p', { class: 'share-desc' }, description));
    body.appendChild(shareMeta(sh, doc));

    // Footer: the link, and the two actions worth a permanent button. The rest
    // lives behind the menu — a card with six buttons reads as a toolbar, not
    // as a document.
    const host = (sh.url || '').replace(/^https?:\/\//, '');
    const link = el('button', { class: 'share-url', type: 'button', title: t('shared.copy') },
      el('span', { class: 'share-url-text' }, host));
    link.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!await copyText(sh.url)) return;
      const text = link.firstChild;
      text.textContent = t('shared.copied');
      link.classList.add('is-done');
      setTimeout(() => {
        text.textContent = host;
        link.classList.remove('is-done');
      }, 1200);
    });

    const actions = el('div', { class: 'share-actions' });
    const openPublic = shareAction('external', t('shared.openPublic'), null, { tag: 'a' });
    openPublic.href = sh.url || '#';
    if (!sh.url) openPublic.setAttribute('aria-disabled', 'true');
    actions.append(
      shareAction('copy', t('shared.copy'), (node) => copyFrom(node, sh.url)),
      openPublic,
    );

    const preview = sharePreview(sh, doc, openable);
    const panel = accessPanel(sh);
    const history = historyPanel(sh, card, openable ? preview : null, openable);
    panel.hidden = !sharedOpenPanels.has(sh.slug);
    history.hidden = !sharedOpenHistory.has(sh.slug);
    if (!panel.hidden || !history.hidden) card.classList.add('is-open');
    if (!history.hidden) history.loadHistory();

    // The two panels share the bottom of the card, so opening one closes the
    // other instead of stacking two editors under a 310px card.
    const togglePanel = (which) => {
      const set = which === 'access' ? sharedOpenPanels : sharedOpenHistory;
      const other = which === 'access' ? sharedOpenHistory : sharedOpenPanels;
      const expanded = set.has(sh.slug);
      other.delete(sh.slug);
      if (expanded) set.delete(sh.slug);
      else set.add(sh.slug);
      panel.hidden = !sharedOpenPanels.has(sh.slug);
      history.hidden = !sharedOpenHistory.has(sh.slug);
      card.classList.toggle('is-open', !panel.hidden || !history.hidden);
      card.querySelector('.share-overlay-btn.is-left')
        ?.setAttribute('aria-expanded', history.hidden ? 'false' : 'true');
      if (!panel.hidden) panel.querySelector('input')?.focus();
      if (!history.hidden) history.loadHistory();
    };

    const more = shareAction('more', t('shared.more'), (node, event) => {
      event.stopPropagation();
      const wasOpen = openMenu?.button === node;
      closeShareMenu();
      if (wasOpen) return;

      const menu = el('div', { class: 'share-menu', role: 'menu' });
      if (openable) {
        menu.appendChild(menuItem('reader', t('shared.openReader'), () => {
          closeShareMenu();
          location.hash = '#/read/' + sh.slug;
        }));
        menu.appendChild(menuItem('republish', t('shared.republish'), (item) => {
          closeShareMenu();
          republishShare(sh, item);
        }));
      }
      menu.appendChild(menuItem('access', t('shared.access'), () => {
        closeShareMenu();
        togglePanel('access');
      }));
      menu.appendChild(el('div', { class: 'share-menu-sep' }));
      menu.appendChild(stopMenuItem(sh));
      menu.addEventListener('click', (e) => e.stopPropagation());
      node.parentElement.appendChild(menu);
      node.setAttribute('aria-expanded', 'true');
      openMenu = { menu, button: node };
      menu.querySelector('button')?.focus();
    });
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    actions.appendChild(more);

    // Two controls ride on the preview itself, where they belong to the
    // document rather than to the row of link actions: history on the left,
    // and — only when the file has moved on — the fix for that on the right.
    const overlay = el('div', { class: 'share-overlay' });
    const historyBtn = shareAction('history', t('shared.history'), () => togglePanel('history'));
    historyBtn.classList.add('share-overlay-btn', 'is-left');
    historyBtn.setAttribute('aria-expanded', history.hidden ? 'false' : 'true');
    overlay.appendChild(historyBtn);

    if (drifted && openable) {
      const republish = shareAction('republish', t('shared.republish'), (node) => republishShare(sh, node));
      republish.classList.add('share-overlay-btn', 'is-right', 'is-suggested');
      overlay.appendChild(republish);
    }

    card.append(
      preview,
      overlay,
      body,
      el('div', { class: 'share-card-foot' }, link, actions),
      history,
      panel,
    );

    if (openable) {
      const openReader = (event) => {
        if (event.target.closest('button, a, input')) return;
        location.hash = '#/read/' + sh.slug;
      };
      card.addEventListener('click', openReader);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') openReader(event);
      });
    }
    return card;
  }

  function paintShared() {
    syncSharedControls();
    // Visible from the first share on: with a filter saved from a past visit,
    // hiding the bar would strand the page on "nothing matches" with no way back.
    sharedBar.hidden = sharedRows.length === 0;
    sharedCount.textContent = t('shared.count', { n: sharedRows.length });

    const items = visibleShares();
    if (!items.length) {
      sharedList.replaceChildren();
      sharedEmpty.hidden = false;
      sharedEmpty.innerHTML = t('shared.filtered');
      return;
    }
    sharedEmpty.hidden = true;
    closeShareMenu();
    const grid = el('div', { class: 'share-grid' });
    items.forEach((sh) => grid.appendChild(renderShareCard(sh)));
    sharedList.replaceChildren(grid);
  }

  async function loadShared() {
    if (!sharedRows.length) {
      setSharedStatus(t('shared.loading'));
      sharedEmpty.hidden = true;
      sharedList.replaceChildren();
      sharedCount.textContent = '';
    }

    if (!docs.length) {
      try { await loadAll(); } catch { /* keep going; titles may be missing */ }
    }

    let shares;
    try {
      const response = await fetch('/api/shares');
      if (!response.ok) {
        const out = await response.json().catch(() => ({}));
        throw new Error(out.error || t('shared.error.load'));
      }
      shares = await response.json() || [];
    } catch (error) {
      sharedRows = [];
      setSharedStatus(error.message || t('shared.error.load'), true);
      showSharedEmpty(t('shared.error.empty'));
      return;
    }

    setSharedStatus('');
    sharedRows = shares;

    // Empty array from the API also covers "not logged in" (server returns []).
    // Probe config so we can distinguish "no shares" from "token missing".
    if (!shares.length) {
      let hasToken = false;
      try {
        const cfg = settingsConfig || await (await fetch('/api/config')).json();
        settingsConfig = cfg;
        hasToken = !!(cfg.hosted && cfg.hosted.token);
      } catch { /* treat as not configured */ }

      showSharedEmpty(t(hasToken ? 'shared.none' : 'shared.unconfigured'));
      return;
    }

    paintShared();
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
    formMessage('settings-message', value ? t('form.unsaved') : '');
  }

  function setSharingDirty(value = true) {
    sharingDirty = value;
    sharingSave.disabled = !value;
    formMessage('sharing-message', value ? t('form.unsaved') : '');
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

    // Option labels are re-read on every sync so a language change repaints
    // them without rebuilding the control.
    const options = [...native.options].map((opt) => {
      const item = el('button', { type: 'button', class: 'uisel-option', role: 'option' });
      item.dataset.value = opt.value;
      const text = el('span', {}, opt.textContent);
      item.append(text, icon('uisel-check', 'M20 6 9 17l-5-5'));
      item.addEventListener('click', () => { choose(opt.value); close(); trigger.focus(); });
      menu.appendChild(item);
      return Object.assign(item, { _opt: opt, _text: text });
    });
    wrap.append(trigger, menu);

    function sync() {
      const opt = native.options[native.selectedIndex] || native.options[0];
      label.textContent = opt ? opt.textContent : '';
      options.forEach((item) => {
        item._text.textContent = item._opt.textContent;
        item.setAttribute('aria-selected', item.dataset.value === native.value ? 'true' : 'false');
      });
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
    document.documentElement.style.setProperty(
      '--comment',
      /^#[0-9a-f]{6}$/i.test(theme.accent || '') ? theme.accent : 'var(--ink)',
    );
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
    if (forAppearance) formMessage('settings-message', t('form.loading'));
    if (forSharing) formMessage('sharing-message', t('form.loading'));
    if (forAppearance) settingsSave.disabled = true;
    if (forSharing) sharingSave.disabled = true;
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error(t('form.error.load'));
      settingsConfig = await response.json();
      applyConfigToForms(settingsConfig);
    } catch (error) {
      const msg = error.message || t('form.error.load');
      if (forAppearance) formMessage('settings-message', msg, true);
      if (forSharing) formMessage('sharing-message', msg, true);
    }
  }

  async function ensureConfig() {
    if (settingsConfig) return settingsConfig;
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error(t('form.error.load'));
    settingsConfig = await response.json();
    return settingsConfig;
  }

  async function saveAppearance() {
    try {
      await ensureConfig();
    } catch (error) {
      formMessage('settings-message', error.message || t('form.error.load'), true);
      return;
    }

    const accent = $('setting-accent').value.trim().toLowerCase();
    if (accent && !/^#[0-9a-f]{6}$/.test(accent)) {
      formMessage('settings-message', t('form.error.accent'), true);
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
    formMessage('settings-message', t('form.saving'));
    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settingsConfig),
      });
      if (!response.ok) {
        const out = await response.json().catch(() => ({}));
        throw new Error(out.error || t('form.error.save'));
      }
      settingsConfig = await response.json();
      appearanceDirty = false;
      formMessage('settings-message', t('form.saved'));
      setTimeout(() => { if (!appearanceDirty) formMessage('settings-message', ''); }, 1800);
    } catch (error) {
      settingsSave.disabled = false;
      formMessage('settings-message', error.message || t('form.error.save'), true);
    }
  }

  async function saveSharing() {
    try {
      await ensureConfig();
    } catch (error) {
      formMessage('sharing-message', error.message || t('form.error.load'), true);
      return;
    }

    settingsConfig.version ||= 1;
    settingsConfig.theme = settingsConfig.theme || {};
    settingsConfig.hosted = {
      apiBase: $('setting-api').value.trim().replace(/\/$/, '') || undefined,
      token: $('setting-token').value.trim() || undefined,
    };

    sharingSave.disabled = true;
    formMessage('sharing-message', t('form.saving'));
    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settingsConfig),
      });
      if (!response.ok) {
        const out = await response.json().catch(() => ({}));
        throw new Error(out.error || t('form.error.save'));
      }
      settingsConfig = await response.json();
      sharingDirty = false;
      formMessage('sharing-message', t('form.saved'));
      setTimeout(() => { if (!sharingDirty) formMessage('sharing-message', ''); }, 1800);
    } catch (error) {
      sharingSave.disabled = false;
      formMessage('sharing-message', error.message || t('form.error.save'), true);
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

  // ---- language ------------------------------------------------------------
  // Interface language is a dashboard preference, not part of the skill theme:
  // it applies instantly and lives in this browser, so it never touches
  // ~/.summaries/.lattice/config.json or the save/dirty flow above.
  const localeSelect = $('setting-locale');
  localeSelect.value = i18n.pref;
  localeSelect.addEventListener('input', () => i18n.setPref(localeSelect.value));

  // Repaint everything built in JS after a language change. Static markup is
  // handled by i18n.apply(); this covers the rest.
  i18n.onChange(() => {
    applyTheme(readTheme());
    syncCustomControls();
    updateCount();
    paintBreadcrumb(currentView, readerSlug);
    if (appearanceDirty) formMessage('settings-message', t('form.unsaved'));
    if (sharingDirty) formMessage('sharing-message', t('form.unsaved'));
    if (currentView === 'home') {
      paintLibrary();
    } else if (currentView === 'shared') {
      loadShared();
    }
  });

  // enhance selects and dismiss any open menu on outside click
  document.querySelectorAll('select[data-uisel]').forEach(enhanceSelect);
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

  function shareLoading() { sharePop.replaceChildren(el('div', { class: 'lead' }, t('share.loading'))); }

  function shareUnshared(slug) {
    const random = el('input', { type: 'checkbox' });
    const domains = domainField('');
    const btn = el('button', { class: 'btn wide' }, t('share.publish'));
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = t('share.publishing');
      const list = parseDomains(domains.value);
      try {
        const r = await fetch('/api/shares', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, random: random.checked, domains: list }),
        });
        const out = await r.json();
        if (!r.ok) throw new Error(out.error || 'share failed');
        shareShared({ slug, url: out.url, votes: 0, domains: list });
      } catch (e) {
        btn.disabled = false; btn.textContent = t('share.publish');
        sharePop.querySelector('.meta')?.remove();
        sharePop.appendChild(el('div', { class: 'meta' }, String(e.message || e)));
      }
    });
    sharePop.replaceChildren(
      el('div', { class: 'lead' }, t('share.lede.off')),
      el('label', { class: 'opt' }, random, t('share.random')),
      el('div', { class: 'field' },
        el('span', { class: 'field-label' }, t('share.domains.label')),
        domains,
        el('div', { class: 'meta tight' }, t('share.domains.hint')),
      ),
      btn,
    );
  }

  function shareShared(sh) {
    const url = el('input', { class: 'url', type: 'text', readonly: 'readonly', value: sh.url });
    url.addEventListener('focus', () => url.select());
    const copy = el('button', { class: 'btn' }, t('share.copy'));
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(sh.url); }
      catch { url.focus(); url.select(); document.execCommand?.('copy'); }
      copy.textContent = t('share.copied');
      setTimeout(() => (copy.textContent = t('share.copy')), 1200);
    });
    const open = el('a', { class: 'btn', href: sh.url, target: '_blank', rel: 'noopener' }, t('share.open'));
    const stop = el('button', { class: 'btn' }, t('share.stop'));
    stop.addEventListener('click', async () => {
      stop.disabled = true; stop.textContent = t('share.stopping');
      try {
        const r = await fetch('/api/shares/' + sh.slug, { method: 'DELETE' });
        if (!r.ok && r.status !== 204) throw new Error('stop failed');
        shareUnshared(sh.slug);
      } catch { stop.disabled = false; stop.textContent = t('share.stop'); }
    });
    // Access editor. Saving posts the share again, which is also how the CLI
    // changes a restriction — the note under the button says so out loud.
    const current = sh.domains || [];
    const domains = domainField(current.join(', '));
    const save = el('button', { class: 'btn' }, t('share.access.save'));
    const state = el('div', { class: 'meta tight' },
      current.length
        ? t('share.access.restricted', { d: current.map((d) => '@' + d).join(', ') })
        : t('share.access.public'));
    save.addEventListener('click', async () => {
      save.disabled = true; save.textContent = t('share.access.saving');
      const list = parseDomains(domains.value);
      try {
        const r = await fetch('/api/shares', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: sh.slug, domains: list }),
        });
        const out = await r.json();
        if (!r.ok) throw new Error(out.error || 'save failed');
        save.textContent = t('share.access.saved');
        setTimeout(() => shareShared({ ...sh, url: out.url || sh.url, domains: list }), 700);
      } catch (e) {
        save.disabled = false; save.textContent = t('share.access.save');
        state.textContent = String(e.message || e);
      }
    });

    sharePop.replaceChildren(
      el('div', { class: 'lead' }, t(current.length ? 'share.lede.on.domain' : 'share.lede.on')),
      el('div', { class: 'row2' }, url, copy),
      el('div', { class: 'row2', style: 'margin-top:8px' }, open, stop),
      el('div', { class: 'sep' }),
      el('div', { class: 'field' },
        el('span', { class: 'field-label' }, t('share.access')),
        state,
        el('div', { class: 'row2', style: 'margin-top:8px' }, domains, save),
        el('div', { class: 'meta tight' }, t('share.access.republish')),
      ),
      el('div', { class: 'meta' }, t('share.tally', { n: sh.votes || 0 }), el('code', {}, `lattice results ${sh.slug}`)),
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
        el('a', { href: '#/' }, t('page.home')),
        el('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
      );
      const d = docs.find((x) => x.slug === slug);
      const current = el('span', { 'aria-current': 'page' }, d ? d.title : (slug || t('page.summary')));
      if (d?.source) current.title = d.source;
      breadcrumb.appendChild(current);
      return;
    }
    breadcrumb.appendChild(
      el('span', { 'aria-current': 'page' }, t('page.' + view)),
    );
  }

  // Reader chrome only - deliberately never touches frame.src, so autosync can
  // repaint a retitled doc without reloading the iframe (which would throw away
  // the in-place morph the injected hot-reload client just did).
  function paintReader(slug) {
    shell.style.removeProperty('--reader-bg');
    shell.style.removeProperty('--reader-ink');
    paintCommentMode(false);
    readerThreads = [];
    commentCount.hidden = true;
    closeCommentPop();
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
    if (name !== 'home') hidePeek();
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
    closeCommentPop();
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
      if (!commentPop.hidden) {
        e.preventDefault();
        closeCommentPop();
      } else if (readerCommentMode && readerSlug && frame.contentWindow) {
        e.preventDefault();
        frame.contentWindow.postMessage({
          type: 'lattice:comment-mode',
          active: false,
        }, location.origin);
      } else if (anySelectOpen()) closeAllSelects();
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
