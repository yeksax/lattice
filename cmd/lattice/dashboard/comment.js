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
  // Do not set position:relative here. Sticky/fixed/absolute anchors (the
  // live counter on gcp-next-actions, a sticky section head, …) already form
  // a containing block; forcing relative would override sticky and the bar
  // would scroll away the moment comment mode turns on. Static anchors get
  // relative from ensurePositioned instead.
  pageStyle.textContent = `
    [data-lattice-comment-target]{isolation:isolate}
    body[data-lattice-comment-mode="true"]:not([data-lattice-comment-open]) [data-lattice-comment-target]{
      cursor:none!important
    }
    body[data-lattice-comment-mode="true"]:not([data-lattice-comment-open]) [data-lattice-comment-target] *{
      cursor:none!important
    }
    /* Hovered / open anchors rise above neighbouring page chrome, but stay
       under sticky master headers (template + live bars use z-index:20). */
    body[data-lattice-comment-mode="true"] [data-lattice-comment-target].is-lattice-cursor-target,
    body[data-lattice-comment-mode="true"] [data-lattice-comment-target].is-lattice-comment-open{
      z-index:15
    }
    body[data-lattice-comment-mode="true"] [data-lattice-comment-target]::after{
      content:"";
      position:absolute;
      inset:-4px;
      z-index:0;
      border-radius:8px;
      background:color-mix(in srgb,var(--lattice-accent,var(--ink,#111)) 10%,transparent);
      box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lattice-accent,var(--ink,#111)) 72%,transparent);
      opacity:0;
      pointer-events:none;
      transition:opacity 160ms cubic-bezier(.2,0,0,1)
    }
    body[data-lattice-comment-mode="true"] [data-lattice-comment-target].is-lattice-cursor-target::after,
    body[data-lattice-comment-mode="true"] [data-lattice-comment-target].is-lattice-comment-open::after{
      opacity:1
    }
    .lattice-comment-marker.is-cursor{pointer-events:none}
  `;
  document.head.append(pageStyle);

  const css = `
    :host{all:initial;color-scheme:light;--ink:#171717;--ink-2:#565656;--muted:#8c8c8c;--paper:#fff;--sub:#f5f5f4;--line:#e6e6e3;--accent:var(--ink);--accent-hover:color-mix(in srgb,var(--accent) 82%,#000);--accent-soft:color-mix(in srgb,var(--accent) 12%,transparent);font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    *{box-sizing:border-box}button,textarea{font:inherit}button{color:inherit}.marker{position:relative;display:grid;place-items:center;width:28px;height:28px;padding:0;border:2px solid var(--paper);border-radius:50%;border-bottom-left-radius:0;background:var(--accent);color:#fff;box-shadow:0 1px 3px #7373731f,0 4px 14px #7373731f;cursor:pointer;pointer-events:auto;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;transition:scale 160ms cubic-bezier(.2,0,0,1),box-shadow 160ms cubic-bezier(.2,0,0,1)}
    .marker::before{content:"";position:absolute;inset:-6px;border-radius:50%;border-bottom-left-radius:0}.marker:hover,.marker:focus-visible{scale:1.06;background:var(--accent-hover);box-shadow:0 2px 5px #7373731f,0 8px 20px #7373731f;outline:none}.marker:active{scale:.96}.marker.is-new{background:var(--accent);color:#fff;cursor:none;pointer-events:none;line-height:0}.marker.is-new svg{display:block;width:12px;height:12px}
    .preview{position:absolute;right:38px;top:-3px;width:260px;padding:12px 14px;border-radius:20px;background:var(--paper);color:var(--ink);box-shadow:0 0 0 1px var(--line),0 2px 6px #73737314,0 14px 36px #7373731f;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(3px) scale(.98);transform-origin:top right;transition:opacity 160ms cubic-bezier(.2,0,0,1),transform 180ms cubic-bezier(.2,0,0,1),visibility 160ms}
    .marker-wrap:hover .preview,.marker:focus-visible+.preview{opacity:1;visibility:visible;transform:none}.preview[hidden]{display:none}.preview-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}.avatar{display:grid;place-items:center;flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:var(--ink);color:var(--paper);font-size:11px;text-transform:uppercase}.preview b{font-weight:600}.preview-time{color:var(--muted)}.preview-body{display:-webkit-box;overflow:hidden;color:var(--ink-2);-webkit-box-orient:vertical;-webkit-line-clamp:2}.preview-replies{margin-top:4px;color:var(--muted);font-size:11px}
    .popover{position:absolute;z-index:2;right:38px;top:-8px;display:flex;flex-direction:column;width:min(352px,calc(100vw - 56px));max-height:min(420px,calc(100vh - 20px));overflow:hidden;border-radius:24px;background:var(--paper);color:var(--ink);box-shadow:0 0 0 1px color-mix(in srgb,var(--ink) 8%,transparent),0 2px 6px #73737314,0 18px 48px #7373731f;opacity:1;pointer-events:auto;transform:none;transform-origin:top right;transition:opacity 160ms cubic-bezier(.2,0,0,1),transform 180ms cubic-bezier(.2,0,0,1)}
    .popover[hidden]{display:flex;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(4px) scale(.98)}.pop-head{display:flex;align-items:center;gap:10px;flex:0 0 auto;padding:14px 10px 14px 18px;background:var(--paper);box-shadow:inset 0 -1px 0 color-mix(in srgb,var(--ink) 7%,transparent)}.pop-head strong{min-width:0;flex:1;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-wrap:balance}.pop-actions{display:flex;align-items:center;flex:0 0 auto}.close,.new-thread{display:grid;place-items:center;width:32px;height:32px;border:0;background:none;border-radius:50%;cursor:pointer;color:var(--muted)}.close{font-size:18px;line-height:1}.new-thread{font-size:17px}.close:hover,.new-thread:hover{background:var(--sub);color:var(--ink)}.close:active,.new-thread:active{scale:.96}
    .pop-body{display:block;flex:1 1 auto;min-height:0;overflow:auto;padding:16px}.pop-foot{flex:0 0 auto;padding:12px 16px 16px;background:var(--paper)}.pop-foot.has-threads{box-shadow:inset 0 1px 0 color-mix(in srgb,var(--ink) 7%,transparent)}.popover:not(:has(.pop-body)) .pop-foot{padding-top:16px}.thread{display:block}.thread+.thread{margin-top:14px;padding-top:14px;box-shadow:inset 0 1px 0 color-mix(in srgb,var(--ink) 7%,transparent)}.thread-meta{display:flex;align-items:center;gap:8px;margin-bottom:10px;color:var(--muted);font-size:10.5px}.comment{position:relative;display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:start;margin-bottom:10px}.comment-main{min-width:0}.comment-head{display:flex;align-items:center;gap:6px;margin-bottom:3px}.comment-head b{font-weight:600}.comment-head time,.edited{color:var(--muted);font-size:10.5px}.comment p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink-2);line-height:1.5;text-wrap:pretty}
    .comment-actions{position:relative;z-index:3;flex:0 0 auto;margin-left:auto;opacity:0;transition:opacity 120ms cubic-bezier(.2,0,0,1)}.comment:hover .comment-actions,.comment:focus-within .comment-actions,.comment-actions.is-open{opacity:1}@media(hover:none){.comment-actions{opacity:1}}.comment-menu-trigger{position:relative;display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--muted);cursor:pointer;font-size:6.5px;letter-spacing:1px}.comment-menu-trigger::before{content:"";position:absolute;inset:-4px;border-radius:10px}.comment-menu-trigger:hover,.comment-menu-trigger:focus-visible{background:var(--sub);color:var(--ink);outline:none}.comment-menu-trigger:active{scale:.96}.comment-menu{position:absolute;z-index:4;top:28px;right:0;width:124px;padding:5px;border-radius:16px;background:var(--paper);box-shadow:0 0 0 1px var(--line),0 4px 14px #7373731f,0 14px 34px #73737314}.comment-menu.is-confirm{width:188px;padding:10px;border-radius:18px}.comment-menu button{display:flex;align-items:center;width:100%;min-height:32px;padding:0 10px;border:0;border-radius:11px;background:transparent;color:var(--ink);cursor:pointer;text-align:left;font-size:12px}.comment-menu button:hover,.comment-menu button:focus-visible{background:var(--sub);outline:none}.comment-menu button:active{scale:.96}.comment-menu .danger{color:var(--accent)}.delete-confirm p{margin:0 0 10px;padding:0 2px;color:var(--ink);font-size:12px;line-height:1.35}.delete-confirm-actions{display:flex;gap:6px}.delete-confirm-actions button{flex:1;width:auto;justify-content:center;min-height:32px;padding:0 10px;border-radius:12px;font-size:12px}.delete-confirm-actions .danger{background:var(--accent);color:#fff}.delete-confirm-actions .danger:hover,.delete-confirm-actions .danger:focus-visible{background:var(--accent-hover)}
    .inline-edit{margin-top:5px}.inline-edit textarea{display:block;width:100%;min-height:64px;max-height:160px;resize:vertical;padding:10px 11px;border:0;border-radius:10px;background:var(--sub);color:var(--ink);outline:none;box-shadow:inset 0 0 0 1px var(--accent)}.inline-edit-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}.inline-edit-actions button{min-height:30px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--ink);cursor:pointer;font-size:12px}.inline-edit-actions button:hover{background:var(--sub)}.inline-edit-actions button:active{scale:.96}.inline-edit-actions .save{background:var(--ink);color:var(--paper)}.inline-edit-actions .save:disabled{opacity:.3;cursor:default}.action-error{margin-top:7px;color:#c43b3b;font-size:11px}
    .comment.is-reply{margin-left:38px}
    .replies-toggle{display:inline-flex;align-items:center;gap:6px;margin:4px 0 12px 38px;padding:0;border:0;background:none;color:var(--muted);cursor:pointer;font-size:11.5px}.replies-toggle:hover{color:var(--ink)}.replies-toggle::before{content:"";width:18px;height:1px;background:currentColor;opacity:.35}
    .thread-meta .label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .thread-resolve{flex:0 0 auto;display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}.thread-resolve svg{display:block;width:14px;height:14px}.thread-resolve:hover{background:var(--sub);color:var(--ink)}.thread-resolve:active{scale:.96}.thread-resolve.is-resolved{background:color-mix(in srgb,var(--accent) 7%,transparent);color:var(--accent)}.thread-resolve.is-resolved:hover{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent-hover)}
    .thread-replies-caret{flex:0 0 auto;display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}.thread-replies-caret:hover{background:var(--sub);color:var(--ink)}.thread-replies-caret:active{scale:.96}.thread-replies-caret svg{display:block;width:14px;height:14px}
    .thread.is-resolved .comment p,.thread.is-resolved .comment-head b{opacity:.62}
    .reactions{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:4px;margin-left:-6px;min-height:28px}.chip{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 9px;border:0;border-radius:8px;background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink) 10%,transparent);color:var(--ink-2);cursor:pointer;font-size:11px;line-height:1;transition:background-color 120ms cubic-bezier(.2,0,0,1)}
    .chip:hover{background:var(--sub)}.chip:active{scale:.96}.chip.is-mine{background:var(--sub);box-shadow:none;color:var(--ink)}.chip-emoji{display:block;font-size:13px;line-height:1}.chip-count{font-variant-numeric:tabular-nums;line-height:1}.reactions .action-error{flex:0 0 100%;margin-top:3px}
    .add-reaction,.reply-action{position:relative;display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;box-shadow:none;color:var(--muted);cursor:pointer;opacity:.68;line-height:0}.add-reaction::before,.reply-action::before{content:"";position:absolute;inset:-6px;border-radius:12px}.add-reaction:hover,.reply-action:hover{background:var(--sub);color:var(--ink);opacity:1}.add-reaction:active,.reply-action:active{scale:.96}.add-reaction svg,.reply-action svg{display:block;width:15px;height:15px}.reply-action.is-active{background:var(--accent-soft);color:var(--accent);opacity:1}.reaction-add{position:relative;display:inline-grid;place-items:center}
    .reaction-picker{position:absolute;z-index:5;bottom:-4px;left:34px;display:grid;grid-template-columns:repeat(4,28px);gap:2px;padding:5px;border-radius:12px;background:var(--paper);box-shadow:0 0 0 1px color-mix(in srgb,var(--ink) 8%,transparent),0 4px 14px #7373731f,0 14px 34px #73737314}.reaction-picker button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;cursor:pointer;font-size:15px;line-height:1}.reaction-picker button:hover{background:var(--sub)}.reaction-picker button:active{scale:.92}
    .composer{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;width:100%;margin-top:10px;align-items:start}.composer>.avatar{margin-top:5px}.composer.is-reply{margin-left:38px;width:calc(100% - 38px)}.pop-foot .composer{margin-top:0}.composer-box{position:relative;display:flex;align-items:flex-end;gap:4px;min-height:38px;padding:5px 5px 5px 12px;border-radius:19px;background:var(--sub);box-shadow:0 0 0 1px color-mix(in srgb,var(--muted) 32%,transparent);transition:box-shadow 140ms cubic-bezier(.2,0,0,1),background 140ms cubic-bezier(.2,0,0,1)}.composer-box:focus-within{background:var(--paper);box-shadow:0 0 0 2px color-mix(in srgb,var(--muted) 42%,transparent)}.composer textarea{display:block;flex:1 1 auto;width:100%;min-width:0;height:28px;min-height:28px;max-height:110px;resize:none;overflow-y:auto;padding:5px 0;border:0;border-radius:0;background:transparent;color:var(--ink);outline:none;line-height:18px;color-scheme:inherit}.send{flex:0 0 auto;display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:50%;background:var(--accent);color:#fff;cursor:pointer;line-height:0;transition:background-color 120ms cubic-bezier(.2,0,0,1)}.send:not(:disabled):hover{background:var(--accent-hover)}.send svg{display:block;width:14px;height:14px}.send:disabled{opacity:.24;cursor:default}.send:not(:disabled):active{scale:.96}.error{grid-column:2;color:#c43b3b;font-size:11px}
    .launcher{position:fixed;z-index:2147483645;right:18px;bottom:18px;display:grid;place-items:center;width:42px;height:42px;border:0;border-radius:50%;background:var(--ink);color:var(--paper);box-shadow:0 2px 5px #7373731f,0 10px 28px #7373732e;cursor:pointer}.launcher:active{scale:.96}
    @media(prefers-color-scheme:dark){:host{color-scheme:dark;--ink:#f2f2f2;--ink-2:#b5b5b5;--muted:#777;--paper:#171717;--sub:#242424;--line:#303030;--accent-hover:color-mix(in srgb,var(--accent) 78%,#fff);--accent-soft:color-mix(in srgb,var(--accent) 22%,transparent)}}
    @media(max-width:560px){.popover{position:fixed;inset:auto 12px 12px;width:auto;max-height:70vh;transform-origin:bottom center}.popover[hidden]{inset:auto 12px 12px}.preview{display:none}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  `;

  // Stroke icons for the popover chrome. Text glyphs (✓ ☺ ↩) sit on mismatched
  // baselines and refuse to line up with chips; these share one optical box.
  const icon = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    smile: icon('<circle cx="12" cy="12" r="9"/><path d="M8.2 14.2s1.6 2.2 3.8 2.2 3.8-2.2 3.8-2.2"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/>'),
    reply: icon('<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>'),
    send: icon('<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>'),
  };

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

  // Soft-deleted comments stay on disk for history, but the UI treats them as
  // gone: no placeholder row, and a thread with nothing left disappears.
  const liveComments = (thread) => (thread.comments || []).filter((comment) => !comment.deleted);
  const threadIsLive = (thread) => liveComments(thread).length > 0;
  const threadsFor = (selector) =>
    threads.filter((thread) => thread.selector === selector && threadIsLive(thread));

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
  // Only static elements need an inline relative: sticky/fixed/absolute already
  // contain absolute children, and forcing relative would kill sticky (the live
  // counter on summaries that pin a bar to the top). Measure with the target
  // attribute off so a future page rule cannot masquerade as positioned, keep
  // the answer once per element, and leave sticky alone.
  const ensurePositioned = (element) => {
    if (element.hasAttribute('data-lattice-comment-positioned')) return;
    const wasTarget = element.hasAttribute('data-lattice-comment-target');
    element.removeAttribute('data-lattice-comment-target');
    if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
    if (wasTarget) element.setAttribute('data-lattice-comment-target', '');
    element.setAttribute('data-lattice-comment-positioned', '');
  };

  // Stacking: markers 15 < outline peek 18 < open popovers 19 < sticky
  // master headers 20 (template <header>, live counters, …). Popovers must
  // sit above neighbour markers — same z as the anchors lets a later
  // section's badge paint over the open card.
  const COMMENT_Z = '15';
  const POPOVER_Z = '19';

  const placeHost = (host, element) => {
    ensurePositioned(element);
    if (host.parentElement !== element) element.append(host);
    // Set properties individually - cssText would wipe the theme tokens
    // reportTheme wrote on the host, and the next paint flashes dark inputs.
    host.style.position = 'absolute';
    host.style.right = '0';
    host.style.top = '12px';
    host.style.left = 'auto';
    host.style.transform = 'none';
    host.style.zIndex = COMMENT_Z;
    // Lift the anchor's stacking context with the marker so later siblings
    // cannot paint over it; sticky headers at 20 still win.
    if (!element.hasAttribute('data-lattice-comment-z')) {
      element.setAttribute('data-lattice-comment-z', element.style.zIndex || '');
      element.style.zIndex = COMMENT_Z;
    }
  };

  const releaseHost = (host) => {
    const parent = host.parentElement;
    host.remove();
    if (!parent || !parent.hasAttribute('data-lattice-comment-z')) return;
    parent.style.zIndex = parent.getAttribute('data-lattice-comment-z') || '';
    parent.removeAttribute('data-lattice-comment-z');
    parent.classList.remove('is-lattice-comment-open');
  };

  // Open popovers live on a body-level layer so they can sit above the page
  // without dragging every marker through neighbouring sections.
  let popoverLayer;
  const ensurePopoverLayer = () => {
    if (popoverLayer) return popoverLayer;
    popoverLayer = document.createElement('div');
    popoverLayer.className = 'lattice-comment-popover-layer';
    const root = popoverLayer.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css + '.popover{pointer-events:auto}';
    const mount = document.createElement('div');
    mount.className = 'popover-mount';
    root.append(style, mount);
    popoverLayer.style.cssText =
      `position:fixed;inset:0;z-index:${POPOVER_Z};pointer-events:none`;
    document.body.append(popoverLayer);
    return popoverLayer;
  };
  const popoverMount = () => ensurePopoverLayer().shadowRoot.querySelector('.popover-mount');
  const clearPopoverLayer = () => {
    if (!popoverLayer) return;
    popoverMount().replaceChildren();
  };

  // Open popovers leave the marker and sit in the viewport. Without this they
  // scroll with the anchor and slide under the reader chrome (or off the top
  // of the iframe). Stay clear of sticky master headers (template <header>,
  // live counters, …) so the panel never hides behind the bar it sits under.
  const POP_EDGE = 10;
  const stickyTopEdge = () => {
    let bottom = POP_EDGE;
    document.querySelectorAll('header, .live').forEach((node) => {
      const style = getComputedStyle(node);
      if (style.position !== 'sticky' && style.position !== 'fixed') return;
      const rect = node.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top > 80) return;
      bottom = Math.max(bottom, Math.ceil(rect.bottom) + POP_EDGE);
    });
    return bottom;
  };
  const clearPopoverPin = (popover) => {
    if (!popover) return;
    popover.style.position = '';
    popover.style.top = '';
    popover.style.left = '';
    popover.style.right = '';
    popover.style.maxHeight = '';
  };
  const pinPopoverToMarker = (marker, popover) => {
    if (!popover || popover.hidden || !marker || matchMedia('(max-width:560px)').matches) {
      clearPopoverPin(popover);
      return;
    }
    const markerRect = marker.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const topEdge = stickyTopEdge();
    const maxH = Math.max(160, vh - topEdge - POP_EDGE);
    popover.style.maxHeight = maxH + 'px';
    popover.style.position = 'fixed';
    popover.style.right = 'auto';
    const popW = popover.offsetWidth || 352;
    const popH = Math.min(popover.offsetHeight || 120, maxH);
    let top = markerRect.top - 8;
    top = Math.max(topEdge, Math.min(top, vh - popH - POP_EDGE));
    // Prefer the existing left-of-marker placement (CSS right:38px on the host).
    let left = markerRect.right - 38 - popW;
    if (left < POP_EDGE) left = markerRect.left + 38;
    left = Math.max(POP_EDGE, Math.min(left, vw - popW - POP_EDGE));
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';
  };
  const pinOpenPopovers = () => {
    if (openSelector) {
      const host = markerHosts.get(openSelector);
      const marker = host && host.shadowRoot && host.shadowRoot.querySelector('.marker');
      const popover = popoverLayer && popoverMount().querySelector('.popover');
      if (marker && popover) pinPopoverToMarker(marker, popover);
    }
    if (cursorHost && newThreadSelector) {
      const marker = cursorHost.shadowRoot && cursorHost.shadowRoot.querySelector('.marker');
      const popover = cursorHost.shadowRoot && cursorHost.shadowRoot.querySelector('.popover');
      if (marker && popover) {
        // Cursor host is already fixed; keep the composer beside the "+" tip.
        const markerRect = marker.getBoundingClientRect();
        const hostRect = cursorHost.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const topEdge = stickyTopEdge();
        const maxH = Math.max(160, vh - topEdge - POP_EDGE);
        popover.style.maxHeight = maxH + 'px';
        popover.style.position = 'absolute';
        popover.style.right = 'auto';
        const popW = popover.offsetWidth || 352;
        const popH = Math.min(popover.offsetHeight || 120, maxH);
        let top = markerRect.top - 8;
        top = Math.max(topEdge, Math.min(top, vh - popH - POP_EDGE));
        let left = markerRect.right - 38 - popW;
        if (left < POP_EDGE) left = markerRect.left + 38;
        left = Math.max(POP_EDGE, Math.min(left, vw - popW - POP_EDGE));
        popover.style.top = (top - hostRect.top) + 'px';
        popover.style.left = (left - hostRect.left) + 'px';
      }
    }
  };
  let pinRaf = 0;
  const schedulePin = () => {
    if (pinRaf) return;
    pinRaf = requestAnimationFrame(() => {
      pinRaf = 0;
      pinOpenPopovers();
    });
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
      `position:fixed;left:0;top:0;display:none;width:28px;height:28px;z-index:${COMMENT_Z}`;
    // Composing lifts this host to POPOVER_Z in renderCursorMarker so the
    // new-thread card clears neighbour markers the same way the layer does.
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
    const first = items[0] && liveComments(items[0])[0];
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
    const count = items.reduce((total, item) => total + Math.max(0, liveComments(item).length - 1), 0);
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

  const summarizeThreads = () =>
    threads.filter(threadIsLive).map((thread) => {
      const comments = liveComments(thread);
      const root = comments[0] || {};
      const created = Number(root.created) || 0;
      const updated = Number(root.updated) || 0;
      return {
        id: thread.id,
        selector: thread.selector,
        status: thread.status || 'open',
        author: root.author || '',
        body: root.body || '',
        created,
        edited: Boolean(root.edited) || (updated > created && created > 0),
        replies: Math.max(0, comments.length - 1),
        reactions: (root.reactions || []).map((reaction) => ({
          emoji: reaction.emoji,
          count: reaction.count,
        })),
      };
    });

  const notifyCount = () => {
    const items = summarizeThreads();
    const count = items.length;
    // Always tell in-document listeners (outline rail). The parent badge is a
    // separate channel used only when this page is framed by the dashboard.
    document.dispatchEvent(new CustomEvent('lattice:comment-count', {
      detail: { count, threads: items },
    }));
    if (isEmbedded) {
      window.parent.postMessage({
        type: 'lattice:comment-count',
        count,
        threads: items,
      }, location.origin);
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
    add.innerHTML = ICONS.smile;
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
      replyBtn.innerHTML = ICONS.reply;
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
    if (comment.deleted) return null;
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
    if (comment.edited || Number(comment.updated) > Number(comment.created)) {
      const edited = document.createElement('span');
      edited.className = 'edited';
      edited.textContent = 'edited';
      head.append(author, time, edited);
    } else {
      head.append(author, time);
    }
    const body = document.createElement('p');
    body.textContent = comment.body;
    main.append(head);

    if (editingCommentID === comment.id) {
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
      main.append(reactionStrip(thread, comment, { canReply: !isReply }));
    }

    if (comment.can_edit && editingCommentID !== comment.id) {
      const menuOpen = openCommentMenuID === comment.id;
      const actions = document.createElement('div');
      actions.className = 'comment-actions' + (menuOpen ? ' is-open' : '');
      const trigger = document.createElement('button');
      trigger.className = 'comment-menu-trigger';
      trigger.type = 'button';
      trigger.textContent = '•••';
      trigger.setAttribute('aria-label', 'Comment actions');
      trigger.setAttribute('aria-expanded', String(menuOpen));
      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        openCommentMenuID = menuOpen ? '' : comment.id;
        deletingCommentID = '';
        commentActionError = undefined;
        render();
      });
      actions.append(trigger);

      if (menuOpen) {
        const menu = document.createElement('div');
        menu.className = 'comment-menu';
        menu.setAttribute('role', 'menu');
        if (deletingCommentID === comment.id) {
          menu.classList.add('is-confirm');
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
            notifyCount();
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
              notifyCount();
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
        // Re-render replaces the node under the cursor, so :hover is gone until
        // the next mousemove. Keep focus on the menu so it stays usable.
        queueMicrotask(() => {
          menu.querySelector('button')?.focus();
        });
      }
      head.append(actions);
    }
    row.append(avatar(comment.author), main);
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
    send.innerHTML = ICONS.send;
    send.setAttribute('aria-label', placeholder);
    let error;
    const clearError = () => {
      if (!error) return;
      error.remove();
      error = undefined;
    };
    const showError = (message) => {
      if (!error) {
        error = document.createElement('div');
        error.className = 'error';
        form.append(error);
      }
      error.textContent = message;
    };
    area.addEventListener('input', () => {
      send.disabled = !area.value.trim();
      area.style.height = '28px';
      area.style.height = Math.min(area.scrollHeight, 110) + 'px';
    });
    area.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (!area.value.trim()) return;
      form.requestSubmit();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = area.value.trim();
      if (!body) return;
      send.disabled = true;
      clearError();
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
          showError(cause.message || 'Could not save comment');
          send.disabled = false;
        }
      }
    });
    box.append(area, send);
    form.append(avatar('You'), box);
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
      resolve.innerHTML = ICONS.check;
      resolve.title = resolved ? 'Reopen this thread' : 'Mark this thread resolved';
      resolve.setAttribute('aria-label', resolved ? 'Reopen this thread' : 'Mark this thread resolved');
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
      const comments = liveComments(thread);
      const [first, ...replies] = comments;
      if (!first) return;
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

      const root = commentRow(thread, first, false);
      if (root) section.append(root);
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
        if (expanded) {
          replies.forEach((comment) => {
            const row = commentRow(thread, comment, true);
            if (row) section.append(row);
          });
        }
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
    // the box sits pinned under the scrollable thread list so it stays reachable.
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
    const foot = document.createElement('div');
    foot.className = 'pop-foot' + (items.length ? ' has-threads' : '');
    foot.append(fresh.form);
    if (commentActionError?.id === selector) {
      const error = document.createElement('div');
      error.className = 'action-error';
      error.textContent = commentActionError.message;
      foot.append(error);
    }
    if (isComposing || !items.length) queueMicrotask(() => fresh.area.focus());
    box.append(head);
    if (items.length) box.append(body);
    box.append(foot);
    return box;
  };

  // An anchor's own marker: the count, pinned to the element. The open popover
  // is portaled to a body-level layer so it clears page chrome under the sticky
  // master header.
  const renderMarker = (selector, element, items) => {
    const host = markerHosts.get(selector) || makeHost(selector, element);
    placeHost(host, element);
    const open = openSelector === selector;
    host.classList.toggle('is-open', open);
    element.classList.toggle('is-lattice-comment-open', open);
    const wrap = host.shadowRoot.querySelector('.marker-wrap');
    const layerPop = popoverLayer && popoverMount().querySelector('.popover');
    const scrolled = (open && layerPop
      ? layerPop.querySelector('.pop-body')?.scrollTop
      : wrap.querySelector('.pop-body')?.scrollTop) || 0;
    wrap.replaceChildren();
    const button = document.createElement('button');
    button.className = 'marker';
    button.type = 'button';
    button.textContent = String(items.length);
    button.setAttribute('aria-label', `${items.length} discussion threads`);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasOpen = openSelector === selector;
      closePopovers();
      openSelector = wasOpen ? '' : selector;
      render();
    });
    wrap.append(button, preview(items));
    if (open) {
      const box = popover(selector, items, composingSelector === selector, true);
      popoverMount().replaceChildren(box);
      if (scrolled) {
        const body = box.querySelector('.pop-body');
        if (body) body.scrollTop = scrolled;
      }
    } else if (!openSelector) {
      clearPopoverLayer();
    }
  };

  // The cursor marker: the "+" that follows the pointer, and the composer for a
  // brand-new thread, frozen wherever you clicked.
  const renderCursorMarker = () => {
    const host = ensureCursorHost();
    const composing = Boolean(newThreadSelector);
    const visible = commentMode && (Boolean(cursorTarget) || composing);
    host.style.display = visible ? 'block' : 'none';
    // New-thread composer stays on this host (not the portal layer). Lift it
    // above neighbour markers while composing; drop back when only tracking.
    host.style.zIndex = composing ? POPOVER_Z : COMMENT_Z;
    const wrap = host.shadowRoot.querySelector('.marker-wrap');
    wrap.replaceChildren();
    if (!visible) return;
    const button = document.createElement('button');
    button.className = 'marker is-new';
    button.type = 'button';
    button.tabIndex = -1;
    button.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
    button.setAttribute('aria-hidden', 'true');
    wrap.append(button);
    if (composing) wrap.append(popover(newThreadSelector, [], true, true));
  };

  const closePopovers = () => {
    openSelector = '';
    composingSelector = '';
    newThreadSelector = '';
    resetCommentActions();
    clearPopoverLayer();
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
      element.classList.toggle('is-lattice-comment-open', openSelector === selector);
      // Highlight overlays (::after) and markers need a containing block on
      // every target, including ones with no threads yet. Sticky stays sticky.
      if (commentMode) ensurePositioned(element);
      const items = threadsFor(selector);
      if (!items.length) return;
      anchored.add(selector);
      renderMarker(selector, element, items);
    });
    // A thread that was deleted, or an anchor the page no longer has, leaves a
    // marker behind pointing at nothing.
    markerHosts.forEach((host, selector) => {
      if (anchored.has(selector)) return;
      releaseHost(host);
      markerHosts.delete(selector);
    });
    if (openSelector && !anchored.has(openSelector)) {
      openSelector = '';
      clearPopoverLayer();
    }
    renderCursorMarker();
    reportTheme();
    schedulePin();
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

  // Hex accent from the summary (theme.accent) or the user's config, else ink.
  const HEX_ACCENT = /^#[0-9a-f]{6}$/i;
  const parseAccent = (raw) => {
    const value = String(raw || '').trim();
    return HEX_ACCENT.test(value) ? value.toLowerCase() : '';
  };
  const configAccent = () => parseAccent(script && script.dataset.accent);

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
    const accent = parseAccent(value('--accent', '')) || configAccent() || theme['--ink'];
    theme['--accent'] = accent;
    document.documentElement.style.setProperty('--lattice-accent', accent);
    const scheme = schemeFor(theme['--paper'], rootStyle.colorScheme);
    [...markerHosts.values(), cursorHost, popoverLayer].forEach((host) => {
      if (!host) return;
      Object.entries(theme).forEach(([name, color]) => host.style.setProperty(name, color));
      host.style.colorScheme = scheme;
    });
    if (isEmbedded) {
      window.parent.postMessage({
        type: 'lattice:document-theme',
        background: theme['--paper'],
        color: theme['--ink'],
        accent,
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
    const insideComments = event.composedPath().some((node) =>
      node.classList && (
        node.classList.contains('lattice-comment-marker') ||
        node.classList.contains('lattice-comment-popover-layer') ||
        node.classList.contains('popover')
      ));
    if (!insideComments && (openSelector || newThreadSelector)) {
      closePopovers();
      render();
      return;
    }
    if (openCommentMenuID || deletingCommentID) {
      const insideMenu = event.composedPath().some((node) =>
        node.classList && node.classList.contains('comment-actions'));
      if (!insideMenu) {
        openCommentMenuID = '';
        deletingCommentID = '';
        commentActionError = undefined;
        render();
      }
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (openCommentMenuID || editingCommentID || deletingCommentID) {
        resetCommentActions();
        render();
      } else if (openSelector || newThreadSelector) {
        closePopovers();
        render();
      } else if (commentMode) {
        exitCommentMode();
      }
      return;
    }

    // Dashboard reader shortcuts: focus lives in this iframe while reading, so
    // forward letter keys to the parent chrome (Comment / Share / Download).
    // Hosted pages own their own shortcuts in the chrome bridge instead.
    if (window.parent === window || window.latticeChrome) return;
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    let action = '';
    if (event.code === 'KeyC' && !event.shiftKey) action = 'comment';
    else if (event.code === 'KeyS' && event.shiftKey) action = 'share';
    else if (event.code === 'KeyD' && event.shiftKey) action = 'download';
    if (!action) return;
    event.preventDefault();
    window.parent.postMessage({ type: 'lattice:shortcut', action }, location.origin);
  });

  // Capture so nested scroll containers inside the summary still re-pin.
  addEventListener('scroll', schedulePin, true);
  addEventListener('resize', schedulePin);

  addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === 'lattice:comment-mode') {
      if (event.data.active === false) exitCommentMode();
      else if (event.data.active === true) enterCommentMode();
      else commentMode ? exitCommentMode() : enterCommentMode();
    }
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

  // Open an anchor's threads from outside the bridge - the outline rail hands a
  // reader straight to the comment they clicked in the index. Scrolling is part
  // of the job: an anchor five screens down would otherwise open a popover
  // nobody can see. Returns false when the selector no longer resolves, so a
  // caller can fall back instead of silently doing nothing.
  const openAnchor = (selector, options = {}) => {
    if (!selector) return false;
    let element = null;
    try {
      element = document.querySelector(selector);
    } catch {
      return false;
    }
    if (!element) return false;
    closePopovers();
    openSelector = selector;
    if (options.thread) expandedThreads.add(options.thread);
    render();
    if (options.scroll !== false) {
      element.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      });
    }
    schedulePin();
    return true;
  };

  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'lattice:comment-open') return;
    openAnchor(String(event.data.selector || ''), {
      thread: event.data.thread ? String(event.data.thread) : '',
    });
  });

  window.lattice = Object.assign(window.lattice || {}, {
    comments: {
      list: () => threads.slice(),
      refresh,
      start: enterCommentMode,
      stop: exitCommentMode,
      open: openAnchor,
    },
  });

  reportTheme();
  refresh().catch(() => {});
  document.dispatchEvent(new CustomEvent('lattice:comments-ready', { detail: window.lattice.comments }));
})();
