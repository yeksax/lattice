// Lattice discussion bridge. Injected at response time, never written into the
// summary. Threads use stable CSS selectors and work in local and hosted views.
(() => {
  'use strict';

  const script = document.currentScript || document.getElementById('lattice-comments');
  const endpoint = (script && script.dataset.endpoint) || '/threads';
  const isEmbedded = window.parent !== window;
  const markerHosts = new Map();
  const expandedThreads = new Set(); // replies are folded away until asked for
  let threads = [];
  let commentMode = false;
  let openSelector = '';      // an anchor's existing threads are on screen
  let composingSelector = ''; // ...with a composer for one more, inside it
  let newThreadSelector = ''; // a first thread is being written at the cursor
  let openCommentMenuID = '';
  let editingCommentID = '';
  let deletingCommentID = '';
  let openReactionPickerID = '';
  let replyingThreadID = ''; // reply composer is opt-in, not always on screen
  let commentActionError;
  let reactionError; // a toggle that bounced, shown under the chips it undid

  const pageStyle = document.createElement('style');
  pageStyle.id = 'lattice-comment-page-style';
  pageStyle.textContent = `
    [data-lattice-comment-target]{position:relative;isolation:isolate}
    body[data-lattice-comment-mode="true"]:not([data-lattice-comment-open]) [data-lattice-comment-target]{
      cursor:none!important
    }
    body[data-lattice-comment-mode="true"]:not([data-lattice-comment-open]) [data-lattice-comment-target] *{
      cursor:none!important
    }
    body[data-lattice-comment-mode="true"] [data-lattice-comment-target]::after{
      content:"";
      position:absolute;
      inset:-12px;
      z-index:2147482000;
      border-radius:8px;
      background:rgba(22,131,255,.10);
      box-shadow:inset 0 0 0 1px rgba(22,131,255,.72);
      opacity:0;
      pointer-events:none;
      transition:opacity 160ms cubic-bezier(.2,0,0,1)
    }
    body[data-lattice-comment-mode="true"] [data-lattice-comment-target].is-lattice-cursor-target::after{
      opacity:1
    }
    .lattice-comment-marker.is-cursor{pointer-events:none}
  `;
  document.head.append(pageStyle);

  const css = `
    :host{all:initial;color-scheme:light;--ink:#171717;--ink-2:#565656;--muted:#8c8c8c;--paper:#fff;--sub:#f5f5f4;--line:#e6e6e3;--blue:#1683ff;font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    *{box-sizing:border-box}button,textarea{font:inherit}button{color:inherit}.marker{position:relative;display:grid;place-items:center;width:28px;height:28px;padding:0;border:2px solid var(--paper);border-radius:50%;background:var(--blue);color:#fff;box-shadow:0 1px 3px #0002,0 4px 14px #0002;cursor:pointer;pointer-events:auto;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;transition:scale 160ms cubic-bezier(.2,0,0,1),box-shadow 160ms cubic-bezier(.2,0,0,1)}
    .marker::before{content:"";position:absolute;inset:-6px;border-radius:50%}.marker:hover,.marker:focus-visible{scale:1.06;box-shadow:0 2px 5px #0002,0 8px 20px #0002;outline:none}.marker:active{scale:.96}.marker.is-new{background:var(--blue);color:#fff;cursor:none;pointer-events:none;font-size:17px;font-weight:400}
    .preview{position:absolute;right:38px;top:-3px;width:260px;padding:12px 14px;border-radius:12px;background:var(--paper);color:var(--ink);box-shadow:0 0 0 1px var(--line),0 2px 6px #0001,0 14px 36px #0002;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(3px) scale(.98);transform-origin:top right;transition:opacity 160ms cubic-bezier(.2,0,0,1),transform 180ms cubic-bezier(.2,0,0,1),visibility 160ms}
    .marker-wrap:hover .preview,.marker:focus-visible+.preview{opacity:1;visibility:visible;transform:none}.preview[hidden]{display:none}.preview-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}.avatar{display:grid;place-items:center;flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:var(--ink);color:var(--paper);font-size:10px;text-transform:uppercase}.preview b{font-weight:600}.preview-time{color:var(--muted)}.preview-body{display:-webkit-box;overflow:hidden;color:var(--ink-2);-webkit-box-orient:vertical;-webkit-line-clamp:2}.preview-replies{margin-top:4px;color:var(--muted);font-size:11px}
    .popover{position:absolute;z-index:2;right:38px;top:-8px;width:min(360px,calc(100vw - 56px));overflow:hidden;border-radius:16px;background:var(--paper);color:var(--ink);box-shadow:0 0 0 1px var(--line),0 2px 6px #0001,0 18px 48px #0002;opacity:1;pointer-events:auto;transform:none;transform-origin:top right;transition:opacity 160ms cubic-bezier(.2,0,0,1),transform 180ms cubic-bezier(.2,0,0,1)}
    .popover[hidden]{display:block;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(4px) scale(.98)}.pop-head{display:flex;align-items:center;min-height:52px;padding:0 6px 0 18px;background:var(--paper);border-bottom:1px solid var(--line)}.pop-head strong{min-width:0;flex:1;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pop-actions{display:flex;align-items:center;flex:0 0 auto}.close,.new-thread{display:grid;place-items:center;width:40px;height:40px;border:0;background:none;border-radius:50%;cursor:pointer;color:var(--muted)}.close{font-size:19px}.new-thread{font-size:18px}.close:hover,.new-thread:hover{background:var(--sub);color:var(--ink)}.close:active,.new-thread:active{scale:.96}
    .pop-body{display:block;max-height:min(430px,66vh);overflow:auto;padding:18px 18px 20px}.thread{display:block}.thread+.thread{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}.thread-meta{display:flex;align-items:center;gap:8px;margin-bottom:14px;color:var(--muted);font-size:10.5px}.comment{position:relative;display:grid;grid-template-columns:24px 1fr;gap:10px;margin-bottom:16px;padding-right:28px}.comment-main{min-width:0}.comment-head{display:flex;align-items:baseline;gap:6px;margin-bottom:3px}.comment-head b{font-weight:600}.comment-head time,.edited{color:var(--muted);font-size:10.5px}.comment p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink-2)}.comment p.is-deleted{color:var(--muted);font-style:italic}
    .comment-actions{position:absolute;z-index:3;top:-6px;right:-6px}.comment-menu-trigger{position:relative;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--muted);cursor:pointer;font-size:7px;letter-spacing:1.5px;opacity:.72}.comment-menu-trigger::before{content:"";position:absolute;inset:-4px;border-radius:13px}.comment-menu-trigger:hover,.comment-menu-trigger:focus-visible{background:var(--sub);color:var(--ink);opacity:1;outline:none}.comment-menu-trigger:active{scale:.96}.comment-menu{position:absolute;z-index:4;top:36px;right:0;width:132px;padding:5px;border-radius:10px;background:var(--paper);box-shadow:0 0 0 1px var(--line),0 4px 14px #0002,0 14px 34px #0001}.comment-menu button{display:flex;align-items:center;width:100%;min-height:38px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--ink);cursor:pointer;text-align:left}.comment-menu button:hover,.comment-menu button:focus-visible{background:var(--sub);outline:none}.comment-menu button:active{scale:.96}.comment-menu .danger{color:#c43b3b}.delete-confirm{padding:7px}.delete-confirm p{margin:0 0 8px;color:var(--ink);font-size:11.5px;line-height:1.35}.delete-confirm-actions{display:flex;gap:4px}.delete-confirm-actions button{justify-content:center;min-height:34px;padding:0 8px}.delete-confirm-actions .danger{background:#c43b3b;color:#fff}.delete-confirm-actions .danger:hover{background:#ad3030}
    .inline-edit{margin-top:5px}.inline-edit textarea{display:block;width:100%;min-height:72px;max-height:160px;resize:vertical;padding:10px 11px;border:0;border-radius:10px;background:var(--sub);color:var(--ink);outline:none;box-shadow:inset 0 0 0 1px var(--blue)}.inline-edit-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}.inline-edit-actions button{min-height:36px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:var(--ink);cursor:pointer}.inline-edit-actions button:hover{background:var(--sub)}.inline-edit-actions button:active{scale:.96}.inline-edit-actions .save{background:var(--ink);color:var(--paper)}.inline-edit-actions .save:disabled{opacity:.3;cursor:default}.action-error{margin-top:7px;color:#c43b3b;font-size:11px}
    .comment.is-reply{margin-left:26px}
    .replies-toggle{display:inline-flex;align-items:center;gap:6px;margin:0 0 16px 26px;padding:0;border:0;background:none;color:var(--muted);cursor:pointer;font-size:11.5px}.replies-toggle:hover{color:var(--ink)}.replies-toggle::before{content:"";width:18px;height:1px;background:currentColor;opacity:.45}
    .thread-meta .label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .thread-resolve{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:0;border-radius:999px;background:transparent;box-shadow:inset 0 0 0 1px var(--line);color:var(--muted);cursor:pointer;font-size:10.5px}.thread-resolve:hover{background:var(--sub);color:var(--ink)}.thread-resolve:active{scale:.96}.thread-resolve.is-resolved{background:rgba(22,131,255,.12);box-shadow:none;color:var(--blue)}.thread-resolve.is-resolved:hover{background:rgba(22,131,255,.18);color:var(--blue)}
    .thread-replies-caret{flex:0 0 auto;display:inline-grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer}.thread-replies-caret:hover{background:var(--sub);color:var(--ink)}.thread-replies-caret:active{scale:.96}.thread-replies-caret svg{display:block;width:14px;height:14px}
    .thread.is-resolved .comment p,.thread.is-resolved .comment-head b{opacity:.62}
    .reactions{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:7px}.chip{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:0;border-radius:999px;background:var(--sub);box-shadow:inset 0 0 0 1px var(--line);color:var(--ink-2);cursor:pointer;font-size:11.5px;line-height:1;transition:background-color 120ms cubic-bezier(.2,0,0,1),box-shadow 120ms cubic-bezier(.2,0,0,1)}
    .chip:hover{background:var(--paper);box-shadow:inset 0 0 0 1px var(--muted)}.chip:active{scale:.96}.chip.is-mine{background:rgba(22,131,255,.12);box-shadow:inset 0 0 0 1px var(--blue);color:var(--ink)}.chip-emoji{font-size:12.5px}.chip-count{font-variant-numeric:tabular-nums}.reactions .action-error{flex:0 0 100%;margin-top:3px}
    .add-reaction,.reply-action{display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;box-shadow:none;color:var(--muted);cursor:pointer;font-size:17px;line-height:1;opacity:.72}.add-reaction:hover,.reply-action:hover{background:var(--sub);color:var(--ink);opacity:1}.add-reaction:active,.reply-action:active{scale:.96}.reply-action{font-size:15px}.reply-action.is-active{background:rgba(22,131,255,.12);color:var(--ink);opacity:1}.reaction-add{position:relative;display:inline-flex}
    .reaction-picker{position:absolute;z-index:5;bottom:-4px;left:32px;display:grid;grid-template-columns:repeat(4,28px);gap:2px;padding:5px;border-radius:12px;background:var(--paper);box-shadow:0 0 0 1px var(--line),0 4px 14px #0002,0 14px 34px #0001}.reaction-picker button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;cursor:pointer;font-size:15px;line-height:1}.reaction-picker button:hover{background:var(--sub)}.reaction-picker button:active{scale:.92}
    .composer{display:grid;grid-template-columns:24px 1fr;gap:10px;margin-top:16px}.composer.is-reply{margin-left:26px}.composer.is-new-thread{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}.composer-box{position:relative}.composer textarea{display:block;width:100%;height:44px;min-height:44px;max-height:120px;resize:none;overflow-y:auto;padding:11px 44px 10px 12px;border:0;border-radius:12px;background:var(--sub);color:var(--ink);outline:none;box-shadow:inset 0 0 0 1px transparent;transition:box-shadow 140ms cubic-bezier(.2,0,0,1),background-color 140ms cubic-bezier(.2,0,0,1);color-scheme:inherit}.composer textarea:focus{background:var(--paper);box-shadow:inset 0 0 0 1px var(--blue)}.send{position:absolute;right:6px;bottom:6px;display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:50%;background:var(--ink);color:var(--paper);cursor:pointer}.send:disabled{opacity:.24;cursor:default}.send:not(:disabled):active{scale:.96}.error{grid-column:2;color:#c43b3b;font-size:11px}
    .launcher{position:fixed;z-index:2147483645;right:18px;bottom:18px;display:grid;place-items:center;width:42px;height:42px;border:0;border-radius:50%;background:var(--ink);color:var(--paper);box-shadow:0 2px 5px #0002,0 10px 28px #0003;cursor:pointer}.launcher:active{scale:.96}
    @media(prefers-color-scheme:dark){:host{color-scheme:dark;--ink:#f2f2f2;--ink-2:#b5b5b5;--muted:#777;--paper:#171717;--sub:#242424;--line:#303030}}
    @media(max-width:560px){.popover{position:fixed;inset:auto 12px 12px;width:auto;max-height:70vh;transform-origin:bottom center}.preview{display:none}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  `;

  const esc = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => '\\' + char);
  };

  const attrSelector = (name, value) =>
    `[${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;

  const selectorFor = (element) => {
    if (element.id) return '#' + esc(element.id);
    const commentKey = element.getAttribute('data-lattice-comment');
    if (commentKey) return attrSelector('data-lattice-comment', commentKey);
    const sectionKey = element.getAttribute('data-lattice-section');
    if (sectionKey) return attrSelector('data-lattice-section', sectionKey);
    const generatedKey = element.getAttribute('data-lattice-comment-anchor');
    if (generatedKey) return attrSelector('data-lattice-comment-anchor', generatedKey);
    return '';
  };

  const anchorText = (element) => {
    const heading = element.matches('h1,h2,h3,h4,h5,h6')
      ? element
      : element.querySelector('h1,h2,h3,h4,h5,h6');
    const localLabel = element.querySelector('figcaption,caption,.lbl,.k,.ttl,.t');
    const named = (
      element.getAttribute('data-lattice-comment-label') ||
      (heading && heading.textContent) ||
      element.getAttribute('aria-label') ||
      (localLabel && localLabel.textContent) ||
      ''
    ).replace(/\s+/g, ' ').trim();
    if (named) return named.slice(0, 500);
    // Nothing named it. A checklist row has no heading and no label, and
    // "[data-lattice-comment-anchor=…]" is not a thing anyone recognises in a
    // popover title - its own first words are.
    return (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  };

  const formatTime = (seconds) => {
    const date = new Date(seconds * 1000);
    const delta = Math.max(0, Date.now() - date.getTime());
    if (delta < 60_000) return 'now';
    if (delta < 3_600_000) return Math.floor(delta / 60_000) + 'm';
    if (delta < 86_400_000) return Math.floor(delta / 3_600_000) + 'h';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const initials = (name) => (name || '?').trim().slice(0, 1).toUpperCase();

  const request = async (url, options) => {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-lattice-return-to': location.href,
      },
      ...options,
    });
    const out = await response.json().catch(() => ({}));
    if (response.status === 401 && out.login) {
      location.href = out.login;
      return null;
    }
    if (!response.ok) throw new Error(out.error || 'Request failed');
    return out;
  };

  const autoAnchorSelector = [
    '.card',
    '.metric',
    '.cell',
    '.tblwrap',
    'table',
    'figure',
    'pre',
    'blockquote',
    'progress',
    '[role="progressbar"]',
    '[role="img"]',
    '.progress',
    '.bar',
    '.chart',
    '.flow',
    '.ba',
    '.invert',
    '.disclose',
    'details',
  ].join(',');

  // Rows a reader can act on - a checklist item, a toggle, anything the state
  // bridge persists - are the finest thing worth a thread, and the ones a
  // reviewer actually argues about. They are found by their control rather
  // than by a class name: the design system has no row class, and a summary
  // free to invent its own markup should not have to know ours.
  const actionableRows = () => {
    const rows = new Set();
    document
      .querySelectorAll('input[type="checkbox"],input[type="radio"],[data-lattice-state]')
      .forEach((control) => {
        const row = control.closest('label,li,tr,.act,.row,.item') || control.parentElement;
        if (row && row !== document.body && row !== document.documentElement) rows.add(row);
      });
    return rows;
  };

  // A generated anchor key has to survive the next revision of the summary, or
  // every thread hanging off one slides down when a row is inserted above it.
  // Prefer whatever the author already named the row - its data-id, the state
  // key of its control - and fall back to counting only when there is nothing
  // stable to hold on to.
  const stableKey = (element) => {
    const own = (element.getAttribute('data-id') || '').trim();
    if (own) return 'id-' + own;
    const stateful = element.matches('[data-lattice-state]')
      ? element
      : element.querySelector('[data-lattice-state]');
    const key = stateful && (stateful.getAttribute('data-lattice-state') || '').trim();
    return key ? 'state-' + key : '';
  };

  const anchorKind = (element) => {
    if (element.matches('.card')) return 'card';
    if (element.matches('.metric')) return 'metric';
    if (element.matches('.cell')) return 'cell';
    if (element.matches('.tblwrap,table')) return 'table';
    if (element.matches('progress,[role="progressbar"],.progress,.bar')) return 'progress';
    if (element.matches('.chart')) return 'chart';
    if (element.matches('.flow')) return 'flow';
    if (element.matches('.ba')) return 'comparison';
    if (element.matches('.invert')) return 'callout';
    if (element.matches('figure,[role="img"]')) return 'visual';
    if (element.matches('pre')) return 'code';
    if (element.matches('blockquote')) return 'quote';
    if (element.matches('.disclose,details')) return 'detail';
    if (element.matches('label,li,tr')) return 'row';
    return element.tagName.toLowerCase();
  };

  const sectionKeyFor = (element) => {
    const section = element.closest('section[id],[data-lattice-section]');
    if (!section) return 'document';
    return section.id || section.getAttribute('data-lattice-section') || 'document';
  };

  const eligibleAnchors = () => {
    document.querySelectorAll('[data-lattice-comment-anchor]').forEach((element) =>
      element.removeAttribute('data-lattice-comment-anchor'));

    const anchors = new Set(document.querySelectorAll(
      'section[id], [data-lattice-section], [data-lattice-comment]',
    ));
    const counters = new Map();
    const rows = actionableRows();
    new Set([...document.querySelectorAll(autoAnchorSelector), ...rows]).forEach((element) => {
      if (element.matches('[data-lattice-comment]')) return;
      // An explicitly marked container owns its decoration, not its rows. The
      // whole point of anchoring a checklist item is to argue about that line,
      // and "the group" is rarely what the argument is about.
      if (!rows.has(element) && element.parentElement?.closest('[data-lattice-comment]')) return;
      if (element.matches('table') && element.closest('.tblwrap')) return;

      const base = sectionKeyFor(element);
      const counterKey = `${base}/${stableKey(element) || anchorKind(element)}`;
      const order = (counters.get(counterKey) || 0) + 1;
      counters.set(counterKey, order);
      element.setAttribute('data-lattice-comment-anchor', `${counterKey}-${order}`);
      anchors.add(element);
    });
    return anchors;
  };

  const threadsFor = (selector) => threads.filter((thread) => thread.selector === selector);

  const avatar = (author) => {
    const node = document.createElement('span');
    node.className = 'avatar';
    node.textContent = initials(author);
    return node;
  };

  const makeHost = (selector, element) => {
    const host = document.createElement('span');
    host.className = 'lattice-comment-marker';
    host.dataset.selector = selector;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const wrap = document.createElement('span');
    wrap.className = 'marker-wrap';
    root.append(style, wrap);
    element.append(host);
    markerHosts.set(selector, host);
    return host;
  };

  // A marker anchored inside its element needs a positioning context there.
  // Measuring naively reads our own comment-mode rule, which already sets
  // position:relative on every target - the element then looks positioned, gets
  // no inline style, and falls back to static the moment comment mode ends,
  // dropping the marker in the page's top-right corner. Measure with the
  // attribute off, once per element, and keep the answer.
  const ensurePositioned = (element) => {
    if (element.hasAttribute('data-lattice-comment-positioned')) return;
    const wasTarget = element.hasAttribute('data-lattice-comment-target');
    element.removeAttribute('data-lattice-comment-target');
    if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
    if (wasTarget) element.setAttribute('data-lattice-comment-target', '');
    element.setAttribute('data-lattice-comment-positioned', '');
  };

  const placeHost = (host, element) => {
    ensurePositioned(element);
    if (host.parentElement !== element) element.append(host);
    // Set properties individually - cssText would wipe the theme tokens
    // reportTheme wrote on the host, and the next paint flashes dark inputs.
    host.style.position = 'absolute';
    host.style.right = '-8px';
    host.style.top = '12px';
    host.style.left = 'auto';
    host.style.transform = 'none';
    host.style.zIndex = '2147483000';
  };

  // The cursor marker is one host for the whole page, not one per anchor. It
  // used to be the anchor's own marker doing double duty, which meant an
  // element that already had a thread had nothing left to follow the pointer
  // with - hover a commented section and the tool simply vanished. Separating
  // them lets the count stay pinned to its anchor while the "+" tracks the
  // cursor everywhere, over commented and uncommented things alike.
  let cursorHost;
  const ensureCursorHost = () => {
    if (cursorHost) return cursorHost;
    cursorHost = document.createElement('span');
    cursorHost.className = 'lattice-comment-marker is-cursor';
    const root = cursorHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const wrap = document.createElement('span');
    wrap.className = 'marker-wrap';
    root.append(style, wrap);
    cursorHost.style.cssText =
      'position:fixed;left:0;top:0;display:none;width:28px;height:28px;z-index:2147483000';
    document.body.append(cursorHost);
    moveCursorHost(-100, -100);
    return cursorHost;
  };

  const moveCursorHost = (x, y) => {
    if (!cursorHost) return;
    cursorHost.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
  };

  const preview = (items) => {
    const box = document.createElement('span');
    box.className = 'preview';
    const first = items[0] && items[0].comments && items[0].comments[0];
    if (!first) {
      box.hidden = true;
      return box;
    }
    const head = document.createElement('span');
    head.className = 'preview-head';
    const identity = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = first.author || 'Unknown';
    const time = document.createElement('span');
    time.className = 'preview-time';
    time.textContent = formatTime(first.created);
    identity.append(name, document.createTextNode(' '), time);
    head.append(avatar(first.author), identity);
    const body = document.createElement('span');
    body.className = 'preview-body';
    body.textContent = first.body;
    const replies = document.createElement('span');
    replies.className = 'preview-replies';
    const count = items.reduce((total, item) => total + Math.max(0, (item.comments || []).length - 1), 0);
    replies.textContent = count + (count === 1 ? ' reply' : ' replies');
    box.append(head, body, replies);
    return box;
  };

  const resetCommentActions = () => {
    openCommentMenuID = '';
    editingCommentID = '';
    deletingCommentID = '';
    openReactionPickerID = '';
    replyingThreadID = '';
    commentActionError = undefined;
    reactionError = undefined;
  };

  const commentMutationURL = (thread, comment) =>
    `${endpoint}/${encodeURIComponent(thread.id)}/comments/${encodeURIComponent(comment.id)}`;

  const REACTIONS = ['👍', '👎', '❤️', '🎉', '👀', '🚀', '😄', '✅'];

  // Every write paints first and talks to the server second. Outstanding work
  // lives in these lists so a refresh that lands mid-flight can put the
  // optimistic rows back on top of the server's answer instead of snapping.
  const pendingReactions = [];
  const pendingStatuses = new Map(); // thread id → status
  const pendingEdits = new Map(); // comment id → body
  const pendingDeletes = new Set(); // comment id
  const pendingCreates = []; // { type, tempId, threadId?, thread?, comment? }

  const nowSecs = () => Math.floor(Date.now() / 1000);
  const tempID = (prefix) =>
    prefix + '_' + Math.random().toString(36).slice(2, 10) + nowSecs().toString(36);

  const findThread = (threadID) =>
    threads.find((thread) => thread.id === threadID || thread.hosted_id === threadID);

  const findComment = (threadID, commentID) => {
    const thread = findThread(threadID);
    if (!thread) return undefined;
    return (thread.comments || []).find(
      (comment) => comment.id === commentID || comment.hosted_id === commentID,
    );
  };

  const flipReaction = (comment, emoji) => {
    const rows = comment.reactions || [];
    const row = rows.find((reaction) => reaction.emoji === emoji);
    if (!row) {
      comment.reactions = rows.concat({ emoji, count: 1, mine: true });
      return;
    }
    row.count += row.mine ? -1 : 1;
    row.mine = !row.mine;
    comment.reactions = rows.filter((reaction) => reaction.count > 0);
  };

  const dropPendingCreate = (op) => {
    const at = pendingCreates.indexOf(op);
    if (at >= 0) pendingCreates.splice(at, 1);
  };

  const notifyCount = () => {
    if (isEmbedded) {
      window.parent.postMessage({ type: 'lattice:comment-count', count: threads.length }, location.origin);
    } else {
      document.dispatchEvent(new CustomEvent('lattice:comment-count', { detail: { count: threads.length } }));
    }
  };

  // Refresh replaces every row with the server's, which is also the answer to
  // requests that have not come back yet. Put the outstanding writes back.
  const replayPending = () => {
    pendingReactions.forEach((pending) => {
      const comment = findComment(pending.thread, pending.comment);
      if (comment) flipReaction(comment, pending.emoji);
    });
    pendingStatuses.forEach((status, id) => {
      const thread = findThread(id);
      if (thread) thread.status = status;
    });
    pendingEdits.forEach((body, id) => {
      for (const thread of threads) {
        const comment = (thread.comments || []).find((row) => row.id === id || row.hosted_id === id);
        if (!comment) continue;
        comment.body = body;
        comment.edited = true;
        break;
      }
    });
    pendingDeletes.forEach((id) => {
      for (const thread of threads) {
        const comment = (thread.comments || []).find((row) => row.id === id || row.hosted_id === id);
        if (comment) comment.deleted = true;
      }
    });
    pendingCreates.forEach((op) => {
      if (op.type === 'thread') {
        if (!threads.some((thread) => thread.id === op.tempId)) threads.push(op.thread);
        return;
      }
      const thread = findThread(op.threadId);
      if (!thread) return;
      if ((thread.comments || []).some((comment) => comment.id === op.tempId)) return;
      thread.comments = (thread.comments || []).concat(op.comment);
    });
  };

  // The reaction strip under a comment: the emoji already on it, the button
  // that adds one, and (on the root comment) the reply toggle. Chips are
  // toggles - clicking one you are already in takes your name back off it.
  const reactionStrip = (thread, comment, { canReply = false } = {}) => {
    const strip = document.createElement('div');
    strip.className = 'reactions';
    const toggle = async (emoji) => {
      const pending = { thread: thread.id, comment: comment.id, emoji };
      pendingReactions.push(pending);
      flipReaction(comment, emoji);
      openReactionPickerID = '';
      reactionError = undefined;
      render();
      let failure;
      try {
        await request(commentMutationURL(thread, comment) + '/reactions', {
          method: 'POST',
          body: JSON.stringify({ emoji }),
        });
      } catch (cause) {
        failure = cause;
      }
      const at = pendingReactions.indexOf(pending);
      if (at >= 0) pendingReactions.splice(at, 1);
      if (failure) {
        reactionError = { id: comment.id, message: failure.message || 'Could not react' };
        // Undo it here too: if the refresh below also fails, the chip is still
        // claiming something the server never accepted.
        const current = findComment(thread.id, comment.id);
        if (current) flipReaction(current, emoji);
        render();
      }
      // Reconcile either way - the counts include other readers' reactions.
      await refresh().catch(() => {});
    };
    (comment.reactions || []).forEach((reaction) => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (reaction.mine ? ' is-mine' : '');
      chip.type = 'button';
      chip.title = reaction.mine ? 'Remove your reaction' : 'React';
      chip.append(
        Object.assign(document.createElement('span'), { className: 'chip-emoji', textContent: reaction.emoji }),
        Object.assign(document.createElement('span'), { className: 'chip-count', textContent: String(reaction.count) }),
      );
      chip.addEventListener('click', (event) => {
        event.stopPropagation();
        toggle(reaction.emoji);
      });
      strip.append(chip);
    });

    const add = document.createElement('button');
    add.className = 'add-reaction';
    add.type = 'button';
    add.textContent = '☺';
    add.setAttribute('aria-label', 'Add reaction');
    add.setAttribute('aria-expanded', String(openReactionPickerID === comment.id));
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      openReactionPickerID = openReactionPickerID === comment.id ? '' : comment.id;
      render();
    });
    const wrap = document.createElement('span');
    wrap.className = 'reaction-add';
    wrap.append(add);
    if (openReactionPickerID === comment.id) {
      const picker = document.createElement('div');
      picker.className = 'reaction-picker';
      REACTIONS.forEach((emoji) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = emoji;
        option.setAttribute('aria-label', emoji);
        option.addEventListener('click', (event) => {
          event.stopPropagation();
          toggle(emoji);
        });
        picker.append(option);
      });
      wrap.append(picker);
    }
    strip.append(wrap);
    if (canReply) {
      const replyBtn = document.createElement('button');
      replyBtn.className = 'reply-action' + (replyingThreadID === thread.id ? ' is-active' : '');
      replyBtn.type = 'button';
      replyBtn.textContent = '↩';
      replyBtn.title = 'Reply';
      replyBtn.setAttribute('aria-label', 'Reply');
      replyBtn.setAttribute('aria-expanded', String(replyingThreadID === thread.id));
      replyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (replyingThreadID === thread.id) {
          replyingThreadID = '';
        } else {
          replyingThreadID = thread.id;
          expandedThreads.add(thread.id);
        }
        openReactionPickerID = '';
        render();
      });
      strip.append(replyBtn);
    }
    // An optimistic chip that gets rolled back has to say why, or it just
    // flickers and lies.
    if (reactionError?.id === comment.id) {
      const error = document.createElement('div');
      error.className = 'action-error';
      error.textContent = reactionError.message;
      strip.append(error);
    }
    return strip;
  };

  const commentRow = (thread, comment, isReply) => {
    const row = document.createElement('article');
    row.className = 'comment' + (isReply ? ' is-reply' : '');
    const main = document.createElement('div');
    main.className = 'comment-main';
    const head = document.createElement('div');
    head.className = 'comment-head';
    const author = document.createElement('b');
    author.textContent = comment.author || 'Unknown';
    const time = document.createElement('time');
    time.textContent = formatTime(comment.created);
    if (!comment.deleted && (comment.edited || Number(comment.updated) > Number(comment.created))) {
      const edited = document.createElement('span');
      edited.className = 'edited';
      edited.textContent = 'edited';
      head.append(author, time, edited);
    } else {
      head.append(author, time);
    }
    const body = document.createElement('p');
    body.textContent = comment.deleted ? 'Comment deleted' : comment.body;
    body.classList.toggle('is-deleted', Boolean(comment.deleted));
    main.append(head);

    if (editingCommentID === comment.id && !comment.deleted) {
      const form = document.createElement('form');
      form.className = 'inline-edit';
      const area = document.createElement('textarea');
      area.value = comment.body;
      area.setAttribute('aria-label', 'Edit comment');
      const actions = document.createElement('div');
      actions.className = 'inline-edit-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', (event) => {
        event.stopPropagation();
        resetCommentActions();
        render();
      });
      const save = document.createElement('button');
      save.className = 'save';
      save.type = 'submit';
      save.textContent = 'Save';
      save.disabled = true;
      area.addEventListener('input', () => {
        save.disabled = !area.value.trim() || area.value.trim() === comment.body;
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = area.value.trim();
        if (!text || text === comment.body) return;
        const previous = {
          body: comment.body,
          edited: comment.edited,
          updated: comment.updated,
        };
        comment.body = text;
        comment.edited = true;
        comment.updated = nowSecs();
        pendingEdits.set(comment.id, text);
        editingCommentID = '';
        openCommentMenuID = '';
        commentActionError = undefined;
        render();
        try {
          await request(commentMutationURL(thread, comment), {
            method: 'PATCH',
            body: JSON.stringify({ body: text }),
          });
          pendingEdits.delete(comment.id);
          await refresh();
        } catch (cause) {
          pendingEdits.delete(comment.id);
          const current = findComment(thread.id, comment.id);
          if (current) {
            current.body = previous.body;
            current.edited = previous.edited;
            current.updated = previous.updated;
          }
          editingCommentID = comment.id;
          commentActionError = { id: comment.id, message: cause.message || 'Could not edit comment' };
          render();
        }
      });
      actions.append(cancel, save);
      form.append(area, actions);
      if (commentActionError?.id === comment.id) {
        const error = document.createElement('div');
        error.className = 'action-error';
        error.textContent = commentActionError.message;
        form.append(error);
      }
      main.append(form);
      queueMicrotask(() => {
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      });
    } else {
      main.append(body);
      if (!comment.deleted) main.append(reactionStrip(thread, comment, { canReply: !isReply }));
    }
    row.append(avatar(comment.author), main);

    if (comment.can_edit && !comment.deleted && editingCommentID !== comment.id) {
      const actions = document.createElement('div');
      actions.className = 'comment-actions';
      const trigger = document.createElement('button');
      trigger.className = 'comment-menu-trigger';
      trigger.type = 'button';
      trigger.textContent = '•••';
      trigger.setAttribute('aria-label', 'Comment actions');
      trigger.setAttribute('aria-expanded', String(openCommentMenuID === comment.id));
      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        openCommentMenuID = openCommentMenuID === comment.id ? '' : comment.id;
        deletingCommentID = '';
        commentActionError = undefined;
        render();
      });
      actions.append(trigger);

      if (openCommentMenuID === comment.id) {
        const menu = document.createElement('div');
        menu.className = 'comment-menu';
        menu.setAttribute('role', 'menu');
        if (deletingCommentID === comment.id) {
          const confirm = document.createElement('div');
          confirm.className = 'delete-confirm';
          const label = document.createElement('p');
          label.textContent = 'Delete this comment?';
          const buttons = document.createElement('div');
          buttons.className = 'delete-confirm-actions';
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.textContent = 'Cancel';
          cancel.addEventListener('click', (event) => {
            event.stopPropagation();
            deletingCommentID = '';
            commentActionError = undefined;
            render();
          });
          const remove = document.createElement('button');
          remove.className = 'danger';
          remove.type = 'button';
          remove.textContent = 'Delete';
          remove.addEventListener('click', async (event) => {
            event.stopPropagation();
            const previous = {
              deleted: comment.deleted,
              body: comment.body,
            };
            comment.deleted = true;
            pendingDeletes.add(comment.id);
            resetCommentActions();
            commentActionError = undefined;
            render();
            try {
              await request(commentMutationURL(thread, comment), { method: 'DELETE' });
              pendingDeletes.delete(comment.id);
              await refresh();
            } catch (cause) {
              pendingDeletes.delete(comment.id);
              const current = findComment(thread.id, comment.id);
              if (current) {
                current.deleted = previous.deleted;
                current.body = previous.body;
              }
              deletingCommentID = comment.id;
              openCommentMenuID = comment.id;
              commentActionError = { id: comment.id, message: cause.message || 'Could not delete comment' };
              render();
            }
          });
          buttons.append(cancel, remove);
          confirm.append(label, buttons);
          if (commentActionError?.id === comment.id) {
            const error = document.createElement('div');
            error.className = 'action-error';
            error.textContent = commentActionError.message;
            confirm.append(error);
          }
          menu.append(confirm);
        } else {
          const edit = document.createElement('button');
          edit.type = 'button';
          edit.setAttribute('role', 'menuitem');
          edit.textContent = 'Edit';
          edit.addEventListener('click', (event) => {
            event.stopPropagation();
            openCommentMenuID = '';
            editingCommentID = comment.id;
            commentActionError = undefined;
            render();
          });
          const remove = document.createElement('button');
          remove.className = 'danger';
          remove.type = 'button';
          remove.setAttribute('role', 'menuitem');
          remove.textContent = 'Delete';
          remove.addEventListener('click', (event) => {
            event.stopPropagation();
            deletingCommentID = comment.id;
            commentActionError = undefined;
            render();
          });
          menu.append(edit, remove);
        }
        actions.append(menu);
      }
      row.append(actions);
    }
    return row;
  };

  const composer = (placeholder, submit) => {
    const form = document.createElement('form');
    form.className = 'composer';
    const box = document.createElement('div');
    box.className = 'composer-box';
    const area = document.createElement('textarea');
    area.placeholder = placeholder;
    area.rows = 1;
    const send = document.createElement('button');
    send.className = 'send';
    send.type = 'submit';
    send.disabled = true;
    send.setAttribute('aria-label', placeholder);
    send.textContent = '↑';
    const error = document.createElement('div');
    error.className = 'error';
    area.addEventListener('input', () => {
      send.disabled = !area.value.trim();
      area.style.height = '44px';
      area.style.height = Math.min(area.scrollHeight, 120) + 'px';
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = area.value.trim();
      if (!body) return;
      send.disabled = true;
      error.textContent = '';
      try {
        // Submit paints optimistically and waits on the server behind the
        // scenes; on success the composer is usually already gone.
        await submit(body);
        composingSelector = '';
        newThreadSelector = '';
        replyingThreadID = '';
        exitCommentMode(true);
      } catch (cause) {
        if (form.isConnected) {
          error.textContent = cause.message || 'Could not save comment';
          send.disabled = false;
        }
      }
    });
    box.append(area, send);
    form.append(avatar('You'), box, error);
    return { form, area };
  };

  const popover = (selector, items, isComposing, visible) => {
    const box = document.createElement('div');
    box.className = 'popover';
    box.hidden = !visible;
    const head = document.createElement('div');
    head.className = 'pop-head';
    const title = document.createElement('strong');
    let element;
    try { element = document.querySelector(selector); } catch {}
    title.textContent = (items[0] && items[0].anchor_text) || (element && anchorText(element)) || selector;
    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closePopovers();
      render();
    });
    const actions = document.createElement('div');
    actions.className = 'pop-actions';
    actions.append(close);
    head.append(title, actions);
    const body = document.createElement('div');
    body.className = 'pop-body';
    items.forEach((thread) => {
      const resolved = thread.status === 'resolved';
      const section = document.createElement('div');
      section.className = 'thread' + (resolved ? ' is-resolved' : '');
      const meta = document.createElement('span');
      meta.className = 'thread-meta';
      const source = typeof thread.snapshot_version_created === 'number'
        ? ` · snapshot v${thread.snapshot_version_created}`
        : ' · local source';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = (resolved ? 'resolved' : 'open') + source;
      const resolve = document.createElement('button');
      resolve.className = 'thread-resolve' + (resolved ? ' is-resolved' : '');
      resolve.type = 'button';
      resolve.textContent = resolved ? '✓ Resolved' : '✓ Resolve';
      resolve.title = resolved ? 'Reopen this thread' : 'Mark this thread resolved';
      resolve.addEventListener('click', (event) => {
        event.stopPropagation();
        const next = resolved ? 'open' : 'resolved';
        const previous = thread.status;
        pendingStatuses.set(thread.id, next);
        thread.status = next;
        commentActionError = undefined;
        render();
        request(`${endpoint}/${encodeURIComponent(thread.id)}/${resolved ? 'reopen' : 'resolve'}`, {
          method: 'POST',
        }).then(async () => {
          pendingStatuses.delete(thread.id);
          await refresh();
        }).catch((cause) => {
          pendingStatuses.delete(thread.id);
          const current = findThread(thread.id);
          if (current) current.status = previous;
          commentActionError = { id: thread.id, message: cause.message || 'Could not change status' };
          render();
        });
      });
      meta.append(label, resolve);

      // The opening comment sits at the root and is the whole thread until you
      // ask for the rest: a popover that unrolls every answer to every thread
      // buries the one you came to read. Replies are indented, never boxed in.
      const comments = thread.comments || [];
      const [first, ...replies] = comments;
      const expanded = expandedThreads.has(thread.id);
      if (resolved && replies.length) {
        // Resolved threads drop the "n replies" link; the caret beside the
        // badge is the only expand control, so a closed thread stays quiet.
        const caret = document.createElement('button');
        caret.className = 'thread-replies-caret';
        caret.type = 'button';
        caret.title = expanded ? 'Hide replies' : 'Show replies';
        caret.setAttribute('aria-label', expanded ? 'Hide replies' : 'Show replies');
        caret.setAttribute('aria-expanded', String(expanded));
        caret.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>';
        caret.addEventListener('click', (event) => {
          event.stopPropagation();
          if (expanded) expandedThreads.delete(thread.id);
          else expandedThreads.add(thread.id);
          render();
        });
        meta.append(caret);
      }
      section.append(meta);
      if (commentActionError?.id === thread.id) {
        const error = document.createElement('div');
        error.className = 'action-error';
        error.textContent = commentActionError.message;
        section.append(error);
      }

      if (first) section.append(commentRow(thread, first, false));
      if (replies.length) {
        if (!resolved) {
          const toggle = document.createElement('button');
          toggle.className = 'replies-toggle';
          toggle.type = 'button';
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.textContent = expanded
            ? 'Hide replies'
            : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`;
          toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            if (expanded) expandedThreads.delete(thread.id);
            else expandedThreads.add(thread.id);
            render();
          });
          section.append(toggle);
        }
        if (expanded) replies.forEach((comment) => section.append(commentRow(thread, comment, true)));
      }
      if (replyingThreadID === thread.id) {
        const reply = composer('Reply', async (message) => {
          const tempId = tempID('c');
          const created = nowSecs();
          const comment = {
            id: tempId,
            author: 'You',
            author_kind: 'human',
            body: message,
            created,
            updated: created,
            can_edit: true,
            reactions: [],
          };
          const op = { type: 'reply', tempId, threadId: thread.id, comment };
          pendingCreates.push(op);
          const current = findThread(thread.id) || thread;
          current.comments = (current.comments || []).concat(comment);
          current.updated = created;
          // Answering a thread is asking to see it: never file your own reply
          // away behind the toggle you just wrote past.
          expandedThreads.add(thread.id);
          replyingThreadID = '';
          commentActionError = undefined;
          render();
          try {
            await request(`${endpoint}/${encodeURIComponent(thread.id)}/comments`, {
              method: 'POST',
              body: JSON.stringify({ body: message, author: 'You', author_kind: 'human' }),
            });
            dropPendingCreate(op);
            await refresh();
          } catch (cause) {
            dropPendingCreate(op);
            const live = findThread(thread.id);
            if (live) live.comments = (live.comments || []).filter((row) => row.id !== tempId);
            replyingThreadID = thread.id;
            commentActionError = { id: thread.id, message: cause.message || 'Could not reply' };
            render();
            throw cause;
          }
        });
        reply.form.classList.add('is-reply');
        section.append(reply.form);
        queueMicrotask(() => reply.area.focus());
      }
      body.append(section);
    });
    // Starting another thread here is not a mode you have to find a button for:
    // the box is simply there, under whatever is already being discussed.
    const fresh = composer(items.length ? 'Start another thread' : 'Add a comment', async (message) => {
      const tempId = tempID('t');
      const created = nowSecs();
      const comment = {
        id: tempID('c'),
        author: 'You',
        author_kind: 'human',
        body: message,
        created,
        updated: created,
        can_edit: true,
        reactions: [],
      };
      const thread = {
        id: tempId,
        selector,
        anchor_text: element ? anchorText(element) : '',
        status: 'open',
        created,
        updated: created,
        comments: [comment],
      };
      const op = { type: 'thread', tempId, thread };
      pendingCreates.push(op);
      threads = threads.concat(thread);
      openSelector = selector;
      newThreadSelector = '';
      composingSelector = '';
      commentActionError = undefined;
      notifyCount();
      render();
      try {
        await request(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            selector,
            anchor_text: element ? anchorText(element) : '',
            body: message,
            author: 'You',
            author_kind: 'human',
          }),
        });
        dropPendingCreate(op);
        await refresh();
      } catch (cause) {
        dropPendingCreate(op);
        threads = threads.filter((row) => row.id !== tempId);
        notifyCount();
        commentActionError = { id: selector, message: cause.message || 'Could not save comment' };
        if (!items.length) {
          openSelector = '';
          newThreadSelector = selector;
        }
        render();
        throw cause;
      }
    });
    if (items.length) fresh.form.classList.add('is-new-thread');
    body.append(fresh.form);
    if (commentActionError?.id === selector) {
      const error = document.createElement('div');
      error.className = 'action-error';
      error.textContent = commentActionError.message;
      body.append(error);
    }
    if (isComposing || !items.length) queueMicrotask(() => fresh.area.focus());
    box.append(head, body);
    return box;
  };

  // An anchor's own marker: the count, pinned to the element, and the popover
  // listing what is already there. It exists only while the anchor has threads.
  const renderMarker = (selector, element, items) => {
    const host = markerHosts.get(selector) || makeHost(selector, element);
    placeHost(host, element);
    host.classList.toggle('is-open', openSelector === selector);
    const wrap = host.shadowRoot.querySelector('.marker-wrap');
    // Rebuilding the popover is how every reaction, menu and edit redraws, and
    // a conversation that jumps back to its first line each time is unreadable.
    const scrolled = wrap.querySelector('.pop-body')?.scrollTop || 0;
    wrap.replaceChildren();
    const button = document.createElement('button');
    button.className = 'marker';
    button.type = 'button';
    button.textContent = String(items.length);
    button.setAttribute('aria-label', `${items.length} discussion threads`);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = openSelector === selector;
      closePopovers();
      openSelector = open ? '' : selector;
      render();
    });
    wrap.append(
      button,
      preview(items),
      popover(selector, items, composingSelector === selector, openSelector === selector),
    );
    if (scrolled) {
      const body = wrap.querySelector('.pop-body');
      if (body) body.scrollTop = scrolled;
    }
  };

  // The cursor marker: the "+" that follows the pointer, and the composer for a
  // brand-new thread, frozen wherever you clicked.
  const renderCursorMarker = () => {
    const host = ensureCursorHost();
    const composing = Boolean(newThreadSelector);
    const visible = commentMode && (Boolean(cursorTarget) || composing);
    host.style.display = visible ? 'block' : 'none';
    const wrap = host.shadowRoot.querySelector('.marker-wrap');
    wrap.replaceChildren();
    if (!visible) return;
    const button = document.createElement('button');
    button.className = 'marker is-new';
    button.type = 'button';
    button.tabIndex = -1;
    button.textContent = '+';
    button.setAttribute('aria-hidden', 'true');
    wrap.append(button);
    if (composing) wrap.append(popover(newThreadSelector, [], true, true));
  };

  const closePopovers = () => {
    openSelector = '';
    composingSelector = '';
    newThreadSelector = '';
    resetCommentActions();
  };

  const render = () => {
    // The comment-mode cursor is hidden because the marker replaces it. With a
    // popover open the marker is parked, so the real cursor has to come back.
    document.body.toggleAttribute(
      'data-lattice-comment-open',
      Boolean(openSelector || newThreadSelector),
    );
    const anchors = eligibleAnchors();
    threads.forEach((thread) => {
      try {
        const element = document.querySelector(thread.selector);
        if (element) anchors.add(element);
      } catch {}
    });
    const anchored = new Set();
    anchors.forEach((element) => {
      const selector = selectorFor(element);
      if (!selector) return;
      element.toggleAttribute('data-lattice-comment-target', commentMode);
      const items = threadsFor(selector);
      if (!items.length) return;
      anchored.add(selector);
      renderMarker(selector, element, items);
    });
    // A thread that was deleted, or an anchor the page no longer has, leaves a
    // marker behind pointing at nothing.
    markerHosts.forEach((host, selector) => {
      if (anchored.has(selector)) return;
      host.remove();
      markerHosts.delete(selector);
    });
    renderCursorMarker();
    reportTheme();
  };

  const enterCommentMode = () => {
    commentMode = true;
    document.body.dataset.latticeCommentMode = 'true';
    render();
    notifyMode();
  };

  const exitCommentMode = (renderNow = true) => {
    commentMode = false;
    delete document.body.dataset.latticeCommentMode;
    document.body.removeAttribute('data-lattice-comment-open');
    document.querySelectorAll('[data-lattice-comment-target]').forEach((element) => {
      element.removeAttribute('data-lattice-comment-target');
      element.classList.remove('is-lattice-cursor-target');
    });
    cursorTarget = null;
    if (cursorHost) cursorHost.style.display = 'none';
    if (renderNow) render();
    notifyMode();
  };

  const notifyMode = () => {
    if (isEmbedded) window.parent.postMessage({ type: 'lattice:comment-mode-state', active: commentMode }, location.origin);
    else document.dispatchEvent(new CustomEvent('lattice:comment-mode-state', { detail: { active: commentMode } }));
  };

  // Clicking two chips in a row puts two fetches in flight, and they do not
  // have to come back in order. Only the newest answer is allowed to land.
  let refreshTicket = 0;

  const refresh = async () => {
    const ticket = ++refreshTicket;
    const out = await request(endpoint);
    if (!out || ticket !== refreshTicket) return;
    threads = Array.isArray(out) ? out : (out.threads || []);
    replayPending();
    render();
    notifyCount();
  };

  // Rough luminance so a light summary on a dark-OS machine does not hand the
  // shadow tree color-scheme:dark and flash native form controls black.
  const schemeFor = (background, fallback) => {
    if (fallback === 'light' || fallback === 'dark') return fallback;
    const match = String(background || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return 'light';
    const luminance = (0.2126 * match[1] + 0.7152 * match[2] + 0.0722 * match[3]) / 255;
    return luminance < 0.45 ? 'dark' : 'light';
  };

  const reportTheme = () => {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const value = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;
    const theme = {
      '--paper': value('--bg', bodyStyle.backgroundColor),
      '--sub': value('--bg-sub', bodyStyle.backgroundColor),
      '--ink': value('--ink', bodyStyle.color),
      '--ink-2': value('--ink-2', bodyStyle.color),
      '--muted': value('--muted', bodyStyle.color),
      '--line': value('--line', bodyStyle.color),
    };
    const scheme = schemeFor(theme['--paper'], rootStyle.colorScheme);
    [...markerHosts.values(), cursorHost].forEach((host) => {
      if (!host) return;
      Object.entries(theme).forEach(([name, color]) => host.style.setProperty(name, color));
      host.style.colorScheme = scheme;
    });
    if (isEmbedded) {
      window.parent.postMessage({
        type: 'lattice:document-theme',
        background: theme['--paper'],
        color: theme['--ink'],
      }, location.origin);
    }
  };

  let cursorTarget;
  const clearCursorTarget = () => {
    if (!cursorTarget) return;
    cursorTarget.classList.remove('is-lattice-cursor-target');
    cursorTarget = null;
    if (cursorHost) cursorHost.style.display = 'none';
  };

  // An open popover freezes the cursor tracking. The marker under the pointer
  // has become the thread you are writing in: moving it (or re-targeting the
  // highlight) while you type pulls the composer out from under the caret.
  document.addEventListener('pointermove', (event) => {
    if (!commentMode || openSelector || newThreadSelector) return;
    const insideMarker = event.composedPath().some((node) =>
      node.classList && node.classList.contains('lattice-comment-marker'));
    if (insideMarker) return;

    const target = event.target.closest && event.target.closest('[data-lattice-comment-target]');
    if (!target) {
      clearCursorTarget();
      return;
    }

    if (cursorTarget !== target) {
      clearCursorTarget();
      cursorTarget = target;
      target.classList.add('is-lattice-cursor-target');
      renderCursorMarker();
    }
    moveCursorHost(event.clientX, event.clientY);
  }, true);

  document.addEventListener('pointerout', (event) => {
    if (commentMode && !event.relatedTarget) clearCursorTarget();
  }, true);

  document.addEventListener('click', (event) => {
    if (commentMode) {
      const target = event.target.closest && event.target.closest('[data-lattice-comment-target]');
      if (target && !event.composedPath().some((node) => node.classList && node.classList.contains('lattice-comment-marker'))) {
        event.preventDefault();
        event.stopPropagation();
        const selector = selectorFor(target);
        const items = threadsFor(selector);
        closePopovers();
        // Something already said here: show it, and let the popover's own "+"
        // start another. Nothing yet: write the first one where you clicked.
        if (items.length) openSelector = selector;
        else newThreadSelector = selector;
        render();
        return;
      }
    }
    const insideMarker = event.composedPath().some((node) =>
      node.classList && node.classList.contains('lattice-comment-marker'));
    if (!insideMarker && (openSelector || newThreadSelector)) {
      closePopovers();
      render();
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (openCommentMenuID || editingCommentID || deletingCommentID) {
      resetCommentActions();
      render();
    } else if (openSelector || newThreadSelector) {
      closePopovers();
      render();
    } else if (commentMode) {
      exitCommentMode();
    }
  });

  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'lattice:comment-mode') return;
    if (event.data.active === false) exitCommentMode();
    else if (event.data.active === true) enterCommentMode();
    else commentMode ? exitCommentMode() : enterCommentMode();
  });

  new MutationObserver(reportTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style', 'class'],
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reportTheme);

  if (!isEmbedded && !window.latticeChrome) {
    const host = document.createElement('span');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const launcher = document.createElement('button');
    launcher.className = 'launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Comment');
    launcher.textContent = '＋';
    launcher.addEventListener('click', () => commentMode ? exitCommentMode() : enterCommentMode());
    root.append(style, launcher);
    document.body.append(host);
  }

  window.lattice = Object.assign(window.lattice || {}, {
    comments: {
      list: () => threads.slice(),
      refresh,
      start: enterCommentMode,
      stop: exitCommentMode,
    },
  });

  reportTheme();
  refresh().catch(() => {});
  document.dispatchEvent(new CustomEvent('lattice:comments-ready', { detail: window.lattice.comments }));
})();
