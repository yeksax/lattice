// Lattice outline rail. Injected at response time, never written into the
// summary. The document's own headings become ticks on the left edge; hovering
// one opens a peek card with the heading, the prose that follows it, and the
// discussion threads anchored inside that stretch of the page. The card is a
// real surface, not a tooltip - the pointer can travel into it, scroll the
// thread list, and click through to a section or to one comment.
(() => {
  'use strict';

  const script = document.currentScript || document.getElementById('lattice-outline');
  const jumpOffset = Number(script && script.dataset.offset) || 84; // sticky headers eat the top
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let entries = [];       // one per heading, in document order
  let buckets = [];       // entries[i] ↔ buckets[i]: the threads living under it
  let activeIndex = -1;   // what the reader is looking at
  let peekIndex = -1;     // what the pointer is asking about
  let closeTimer = 0;

  const css = `
    :host{all:initial;color-scheme:light;--ink:#171717;--ink-2:#565656;--muted:#8c8c8c;--paper:#fff;--sub:#f5f5f4;--line:#e6e6e3;--accent:var(--ink);--accent-hover:color-mix(in srgb,var(--accent) 82%,#000);--accent-soft:color-mix(in srgb,var(--accent) 12%,transparent);font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    *{box-sizing:border-box}button{font:inherit;color:inherit}
    /* Host owns the stacking context (z-index:18); layer just fills the viewport. */
    .layer{position:absolute;inset:0;pointer-events:none}
    .rail{position:absolute;left:6px;top:50%;translate:0 -50%;display:flex;flex-direction:column;align-items:flex-start;gap:5px;max-height:78vh;padding:10px 14px 10px 10px;overflow:hidden auto;scrollbar-width:none;pointer-events:auto}
    .rail::-webkit-scrollbar{display:none}
    .tick{position:relative;display:flex;align-items:center;gap:0;height:9px;padding:0;border:0;background:none;cursor:pointer}
    .tick::before{content:"";position:absolute;inset:-3px -8px}
    .bar{display:block;width:10px;height:2px;border-radius:1px;background:var(--muted);opacity:.42;transition:background-color 160ms cubic-bezier(.2,0,0,1),width 130ms cubic-bezier(.2,0,0,1),opacity 160ms cubic-bezier(.2,0,0,1)}
    .rail:hover .bar,.rail:focus-within .bar{opacity:.72}
    .tick:hover,.tick:focus-visible,.tick.is-peeked{outline:none}
    .tick.is-active .bar,.tick:hover .bar,.tick.is-peeked .bar,.tick:focus-visible .bar{opacity:1;background:var(--ink)}
    /* In-screen section with comments: the accent lives on the bar. */
    .tick.has-comments.is-active .bar{background:var(--accent)}
    .dot{display:block;flex:0 0 auto;width:4px;height:4px;margin-left:5px;border-radius:50%;background:var(--accent);transform:translateX(0) scale(1);transform-origin:center;opacity:1;pointer-events:none;transition:transform 240ms cubic-bezier(.2,.8,.2,1),opacity 200ms cubic-bezier(.2,0,0,1),margin-left 240ms cubic-bezier(.2,.8,.2,1)}
    /* Keep the box; slide + shrink into the bar tip so it reads as absorbed. */
    .tick.has-comments.is-active .dot{margin-left:0;opacity:0;transform:translateX(-9px) scale(0)}
    .card{position:absolute;left:78px;z-index:1;display:flex;flex-direction:column;width:min(310px,calc(100vw - 100px));max-height:min(420px,calc(100vh - 24px));padding:0;border-radius:12px;background:var(--paper);color:var(--ink);box-shadow:0 0 0 1px var(--line),0 2px 6px #0001,0 18px 48px #0002;opacity:0;visibility:hidden;pointer-events:none;transform:translateX(-4px) scale(.985);transform-origin:left center;transition:opacity 160ms cubic-bezier(.2,0,0,1),transform 180ms cubic-bezier(.2,0,0,1),visibility 160ms}
    .card.is-open{opacity:1;visibility:visible;pointer-events:auto;transform:none}
    /* The pointer travels diagonally from a 2px tick to the card; without this
       bridge over the gap the card closes halfway there. It stops short of the
       rail on purpose - an open card that covers the ticks is a card you cannot
       hover past to reach the next section. */
    .card::before{content:"";position:absolute;top:0;bottom:0;left:-12px;width:12px}
    .card-head{flex:0 0 auto;width:100%;padding:12px 14px 10px;border:0;border-radius:12px 12px 0 0;background:none;text-align:left;cursor:pointer}
    .card-head:hover,.card-head:focus-visible{background:var(--sub);outline:none}
    .card-head:active{scale:.995}
    .kicker{display:flex;align-items:center;gap:6px;margin-bottom:3px;color:var(--muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase}
    .kicker .label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .count{flex:0 0 auto;display:inline-flex;align-items:center;gap:3px;height:16px;padding:0 6px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:10px;letter-spacing:0;font-variant-numeric:tabular-nums}
    .title{margin:0;font-size:13px;font-weight:600;line-height:1.35;color:var(--ink)}
    .body{display:-webkit-box;overflow:hidden;margin:5px 0 0;color:var(--ink-2);font-size:12px;line-height:1.5;-webkit-box-orient:vertical;-webkit-line-clamp:4}
    .threads{flex:1 1 auto;min-height:0;overflow:auto;padding:6px;border-top:1px solid var(--line)}
    .thread{display:grid;grid-template-columns:20px 1fr;gap:8px;width:100%;padding:7px 8px;border:0;border-radius:8px;background:none;text-align:left;cursor:pointer}
    .thread:hover,.thread:focus-visible{background:var(--sub);outline:none}
    .thread:active{scale:.985}
    .avatar{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--ink);color:var(--paper);font-size:9px;text-transform:uppercase}
    .thread-main{min-width:0}
    .thread-head{display:flex;align-items:baseline;gap:6px;color:var(--muted);font-size:10.5px}
    .thread-head b{min-width:0;overflow:hidden;color:var(--ink);font-size:11.5px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
    .thread-head .more{flex:0 0 auto;margin-left:auto}
    .thread p{display:-webkit-box;overflow:hidden;margin:1px 0 0;color:var(--ink-2);font-size:11.5px;line-height:1.4;-webkit-box-orient:vertical;-webkit-line-clamp:2}
    .thread.is-resolved .avatar{background:var(--muted)}
    .thread.is-resolved p,.thread.is-resolved .thread-head b{opacity:.6}
    @media(prefers-color-scheme:dark){:host{color-scheme:dark;--ink:#f2f2f2;--ink-2:#b5b5b5;--muted:#777;--paper:#171717;--sub:#242424;--line:#303030;--accent-hover:color-mix(in srgb,var(--accent) 78%,#fff);--accent-soft:color-mix(in srgb,var(--accent) 22%,transparent)}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  `;

  const host = document.createElement('div');
  host.className = 'lattice-outline';
  // Own stacking context so the peek clears comment anchors (z-index:15)
  // without fighting sticky master headers (z-index:20).
  host.style.cssText = 'position:fixed;inset:0;z-index:18;pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const layer = document.createElement('div');
  layer.className = 'layer';
  const rail = document.createElement('nav');
  rail.className = 'rail';
  rail.setAttribute('aria-label', 'Section index');
  const card = document.createElement('div');
  card.className = 'card';
  layer.append(rail, card);
  root.append(style, layer);

  // innerText, not textContent: a legend built out of inline spans reads as
  // "95 hoje16 com" through textContent, and as the line the reader sees
  // through innerText. Hidden content dropping out of the preview is the right
  // answer too - a collapsed <details> is not what the section is about.
  const text = (node) => {
    if (!node) return '';
    const raw = typeof node.innerText === 'string' ? node.innerText : node.textContent;
    return (raw || '').replace(/\s+/g, ' ').trim();
  };
  const initials = (name) => (name || '?').trim().slice(0, 1).toUpperCase();

  // A summary's eyebrow ("02 — where the time goes") sits right before the
  // heading and already says what the section is. Reuse it instead of inventing
  // a label, and fall back to nothing rather than to "h2".
  const kickerFor = (head) => {
    const previous = head.previousElementSibling;
    if (!previous) return '';
    if (!previous.matches('.eyebrow,.kicker,.k,.tag,.lbl')) return '';
    const label = text(previous);
    return label.length <= 48 ? label : '';
  };

  // Charts, tables and metric tiles are made of labels: "8 2 4 · ago set out"
  // is what their text content reads like, and pasting that into the card
  // teaches a reader nothing. Prose is what answers the heading.
  const proseSelector = 'p,li,blockquote,dd';
  const notProse = 'figure,table,.tblwrap,.chart,.flow,.ba,.metric,.metrics,pre,code,.eyebrow,.lbl,.k,.val';

  const proseIn = (node, into) => {
    if (node.matches(proseSelector) && !node.matches(notProse) && !node.closest(notProse)) {
      const chunk = text(node);
      if (chunk.length >= 16) into.push(chunk);
      return;
    }
    if (node.matches(notProse)) return;
    node.querySelectorAll(proseSelector).forEach((child) => {
      if (child.closest(notProse)) return;
      const chunk = text(child);
      if (chunk.length >= 16) into.push(chunk);
    });
  };

  // The prose under a heading, up to the next indexed one. Walk forward through
  // siblings and climb out of the containing section when they run out, so a
  // heading buried in a wrapper still reaches the content that follows it.
  const previewFor = (head, next) => {
    const prose = [];
    const raw = [];
    let scope = head;
    let node = head.nextElementSibling;
    let guard = 0;
    while (guard++ < 400) {
      while (!node) {
        scope = scope.parentElement;
        if (!scope || scope === document.body || scope === document.documentElement) break;
        node = scope.nextElementSibling;
      }
      if (!node) break;
      if (next && (node === next || node.contains(next))) break;
      if (!node.matches('script,style,template,noscript,.lattice-comment-marker,.lattice-outline')) {
        proseIn(node, prose);
        const chunk = text(node);
        if (chunk) raw.push(chunk);
      }
      if (prose.join(' ').length > 420) break;
      node = node.nextElementSibling;
    }
    // A section that is only a chart still deserves a hint of what is in it.
    const out = prose.length ? prose.join(' ') : raw.join(' · ');
    return out.slice(0, 420);
  };

  const headings = () => {
    const found = [];
    document.querySelectorAll('h1,h2,h3,[data-lattice-outline-label]').forEach((element) => {
      if (element.closest('[data-lattice-outline="skip"]')) return;
      if (element.closest('header,nav,.lattice-outline')) return;
      if (!text(element) && !element.getAttribute('data-lattice-outline-label')) return;
      found.push(element);
    });
    return found;
  };

  const build = () => {
    const heads = headings();
    entries = heads.map((head, i) => ({
      head,
      level: Number((head.tagName.match(/^H(\d)$/i) || [, 2])[1]) || 2,
      title: head.getAttribute('data-lattice-outline-label') || text(head),
      kicker: kickerFor(head),
      preview: previewFor(head, heads[i + 1]),
      target: head.closest('section[id],[data-lattice-section],[id]') || head,
    }));
    buckets = entries.map(() => []);
  };

  // Which entry owns an element. A thread anchored on the section itself sits
  // *above* that section's heading in the tree, so containment is checked first;
  // everything else belongs to the last heading it comes after.
  const entryIndexFor = (element) => {
    for (let i = 0; i < entries.length; i++) {
      if (element === entries[i].head || element.contains(entries[i].head)) return i;
    }
    let found = -1;
    for (let i = 0; i < entries.length; i++) {
      const relation = element.compareDocumentPosition(entries[i].head);
      if (relation & Node.DOCUMENT_POSITION_PRECEDING) found = i;
      else break;
    }
    return found < 0 ? 0 : found;
  };

  const collectThreads = () => {
    buckets = entries.map(() => []);
    const api = window.lattice && window.lattice.comments;
    if (!api || !entries.length) return;
    api.list().forEach((thread) => {
      const live = (thread.comments || []).filter((comment) => !comment.deleted);
      if (!live.length) return;
      let element = null;
      try {
        element = document.querySelector(thread.selector);
      } catch {}
      if (!element) return;
      buckets[entryIndexFor(element)].push(thread);
    });
  };

  const jumpTo = (element) => {
    const top = element.getBoundingClientRect().top + scrollY - jumpOffset;
    scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  // Clicking a comment in the index should land on the thread, not near it. The
  // comment bridge knows how to open an anchor's popover; scrolling is the
  // fallback for a page served by an older bridge that has no `open`.
  const openThread = (thread) => {
    const api = window.lattice && window.lattice.comments;
    if (api && typeof api.open === 'function' && api.open(thread.selector, { thread: thread.id })) {
      closePeek(true);
      return;
    }
    let element = null;
    try {
      element = document.querySelector(thread.selector);
    } catch {}
    if (element) jumpTo(element);
    closePeek(true);
  };

  const threadRow = (thread) => {
    const comments = (thread.comments || []).filter((comment) => !comment.deleted);
    const first = comments[0] || {};
    const row = document.createElement('button');
    row.className = 'thread' + (thread.status === 'resolved' ? ' is-resolved' : '');
    row.type = 'button';

    const mark = document.createElement('span');
    mark.className = 'avatar';
    mark.textContent = initials(first.author);

    const main = document.createElement('span');
    main.className = 'thread-main';
    const head = document.createElement('span');
    head.className = 'thread-head';
    const who = document.createElement('b');
    who.textContent = first.author || 'someone';
    head.append(who);
    if (thread.status === 'resolved') {
      const state = document.createElement('span');
      state.textContent = 'resolved';
      head.append(state);
    }
    if (comments.length > 1) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = '+' + (comments.length - 1);
      head.append(more);
    }
    const body = document.createElement('p');
    body.textContent = first.body || '';
    main.append(head, body);

    row.append(mark, main);
    row.addEventListener('click', () => openThread(thread));
    return row;
  };

  const renderCard = (index) => {
    const entry = entries[index];
    if (!entry) return;
    const items = buckets[index] || [];
    card.replaceChildren();

    const head = document.createElement('button');
    head.className = 'card-head';
    head.type = 'button';
    if (entry.kicker || items.length) {
      const kicker = document.createElement('div');
      kicker.className = 'kicker';
      if (entry.kicker) {
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = entry.kicker;
        kicker.append(label);
      }
      if (items.length) {
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = items.length + (items.length === 1 ? ' comment' : ' comments');
        kicker.append(count);
      }
      head.append(kicker);
    }
    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = entry.title;
    head.append(title);
    if (entry.preview) {
      const body = document.createElement('p');
      body.className = 'body';
      body.textContent = entry.preview;
      head.append(body);
    }
    head.addEventListener('click', () => {
      jumpTo(entry.target);
      closePeek(true);
    });
    card.append(head);

    if (items.length) {
      const list = document.createElement('div');
      list.className = 'threads';
      items.forEach((thread) => list.append(threadRow(thread)));
      card.append(list);
    }
  };

  const placeCard = (tick) => {
    const rect = tick.getBoundingClientRect();
    // Measured, not assumed: the rail is as wide as the deepest tick plus its
    // comment dot, and the card has to clear all of it.
    card.style.left = Math.round(rail.getBoundingClientRect().right + 18) + 'px';
    card.style.top = '0px';
    const height = card.getBoundingClientRect().height;
    const wanted = rect.top + rect.height / 2 - Math.min(height, innerHeight - 24) / 2;
    const top = Math.max(12, Math.min(wanted, innerHeight - height - 12));
    card.style.top = top + 'px';
  };

  const openPeek = (index) => {
    clearTimeout(closeTimer);
    if (index === peekIndex && card.classList.contains('is-open')) return;
    peekIndex = index;
    collectThreads();
    paintCommentMarks();
    renderCard(index);
    card.classList.add('is-open');
    const tick = rail.children[index];
    if (tick) placeCard(tick);
    paintTicks();
  };

  const closePeek = (now) => {
    clearTimeout(closeTimer);
    const shut = () => {
      peekIndex = -1;
      card.classList.remove('is-open');
      paintTicks();
    };
    if (now) shut();
    else closeTimer = setTimeout(shut, 220);
  };

  // Every tick is the same length at rest - the rail is a ruler, not a tree,
  // and a heading three levels down is not three times less of a place to go.
  // Length is spent on the pointer instead: the bars near it swell, so the one
  // you are about to hit is the one that is easiest to hit.
  const REST = 10;
  const PEAK = 30;
  // At rest the current section still swells, and its immediate neighbours lean
  // into it - a small hill instead of a lone spike, so the rail reads as a place
  // in a sequence rather than one marked tick among identical ones.
  const SETTLED = 18;
  const SETTLED_SPREAD = 1.1;
  let pointerY = null;

  // Exponential decay, not a bell: the peak stays sharp on the tick under the
  // pointer and the neighbours fall away fast, which is what makes the rail
  // read as pointing rather than as one big hover state. Scaled to the measured
  // pitch of the rail rather than to a pixel guess.
  const reach = () => {
    const first = rail.children[0];
    const second = rail.children[1];
    if (!first || !second) return 13;
    const pitch = second.getBoundingClientRect().top - first.getBoundingClientRect().top;
    return Math.max(10, pitch) * 0.9;
  };

  const paintWidths = () => {
    const decay = reach();
    [...rail.children].forEach((tick, i) => {
      const bar = tick.firstElementChild;
      if (!bar) return;
      let width = REST;
      if (pointerY !== null) {
        const box = tick.getBoundingClientRect();
        const distance = Math.abs(pointerY - (box.top + box.height / 2));
        const falloff = Math.exp(-distance / decay);
        width = REST + (PEAK - REST) * falloff;
      }
      // The section being read keeps a length of its own, so the rail still
      // says where you are once the pointer leaves - and so does the one whose
      // card is open, which the pointer has by then walked away from. The hill
      // is measured in ticks, not pixels, so it survives an uneven rail.
      [activeIndex, peekIndex].forEach((center) => {
        if (center === null || center < 0) return;
        const settled = REST + (SETTLED - REST) * Math.exp(-Math.abs(i - center) / SETTLED_SPREAD);
        width = Math.max(width, settled);
      });
      bar.style.width = Math.round(width) + 'px';
    });
  };

  const paintTicks = () => {
    [...rail.children].forEach((tick, i) => {
      tick.classList.toggle('is-active', i === activeIndex);
      tick.classList.toggle('is-peeked', i === peekIndex);
    });
    paintWidths();
  };

  // Dots are derived from buckets; keep existing ticks in sync when threads
  // arrive after the rail was first drawn (comments load async).
  const paintCommentMarks = () => {
    [...rail.children].forEach((tick, i) => {
      const has = (buckets[i] || []).length > 0;
      tick.classList.toggle('has-comments', has);
      const dot = tick.querySelector('.dot');
      if (has && !dot) {
        const node = document.createElement('span');
        node.className = 'dot';
        tick.append(node);
      } else if (!has && dot) {
        dot.remove();
      }
    });
  };

  const renderRail = () => {
    rail.replaceChildren();
    entries.forEach((entry, index) => {
      const tick = document.createElement('button');
      tick.className = 'tick';
      tick.type = 'button';
      tick.setAttribute('aria-label', entry.title);
      const bar = document.createElement('span');
      bar.className = 'bar';
      tick.append(bar);
      if ((buckets[index] || []).length) {
        tick.classList.add('has-comments');
        const dot = document.createElement('span');
        dot.className = 'dot';
        tick.append(dot);
      }
      tick.addEventListener('pointerenter', () => openPeek(index));
      tick.addEventListener('focus', () => openPeek(index));
      tick.addEventListener('click', () => {
        jumpTo(entry.target);
        closePeek(true);
      });
      rail.append(tick);
    });
    paintTicks();
  };

  // A breakpoint would be a guess about how wide the summary is. The margin the
  // document actually leaves on the left is the thing that decides whether a
  // rail fits, so measure it against the first heading and stand down when the
  // prose has nowhere else to go.
  const fits = () => {
    // One heading is a title, not an index. Two is a document worth a rail.
    if (entries.length < 2) return false;
    const first = entries[0].head.getBoundingClientRect();
    return first.left >= 74;
  };

  const applyVisibility = () => {
    const show = fits();
    host.style.display = show ? '' : 'none';
    if (!show) closePeek(true);
    return show;
  };

  const refresh = () => {
    build();
    collectThreads();
    applyVisibility();
    renderRail();
    if (peekIndex >= 0 && entries[peekIndex]) openPeek(peekIndex);
    else closePeek(true);
    spy();
  };

  // Scroll spy: the active section is the last heading that has passed the
  // reading line. Cheap enough to run on every frame the scroll asks for.
  let spyQueued = false;
  const spy = () => {
    const line = innerHeight * 0.28;
    let next = entries.length ? 0 : -1;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].head.getBoundingClientRect().top - line <= 0) next = i;
      else break;
    }
    if (next === activeIndex) return;
    activeIndex = next;
    paintTicks();
  };

  const scheduleSpy = () => {
    if (spyQueued) return;
    spyQueued = true;
    requestAnimationFrame(() => {
      spyQueued = false;
      spy();
      if (peekIndex >= 0 && rail.children[peekIndex]) placeCard(rail.children[peekIndex]);
    });
  };

  addEventListener('resize', applyVisibility);

  rail.addEventListener('pointermove', (event) => {
    pointerY = event.clientY;
    paintWidths();
  });
  rail.addEventListener('pointerleave', () => {
    pointerY = null;
    paintWidths();
    closePeek();
  });
  rail.addEventListener('pointerenter', (event) => {
    pointerY = event.clientY;
    paintWidths();
    clearTimeout(closeTimer);
  });
  card.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  card.addEventListener('pointerleave', () => closePeek());
  rail.addEventListener('focusout', (event) => {
    if (!rail.contains(event.relatedTarget) && !card.contains(event.relatedTarget)) closePeek();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && peekIndex >= 0) closePeek(true);
  });

  addEventListener('scroll', scheduleSpy, { passive: true, capture: true });
  addEventListener('resize', scheduleSpy);

  // The theme belongs to the document, not to this bridge - same tokens the
  // comment bridge reads, so the rail matches whatever the summary is wearing.
  const schemeFor = (background, fallback) => {
    if (fallback === 'light' || fallback === 'dark') return fallback;
    const match = String(background || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return 'light';
    const luminance = (0.2126 * match[1] + 0.7152 * match[2] + 0.0722 * match[3]) / 255;
    return luminance < 0.45 ? 'dark' : 'light';
  };

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
    theme['--accent'] = parseAccent(value('--accent', '')) || configAccent() || theme['--ink'];
    Object.entries(theme).forEach(([name, color]) => host.style.setProperty(name, color));
    host.style.colorScheme = schemeFor(theme['--paper'], rootStyle.colorScheme);
  };

  new MutationObserver(reportTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style', 'class'],
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reportTheme);

  // The comment bridge decorates the page constantly (markers, positioning
  // attributes). Only structural changes outside its own furniture are worth a
  // rebuild, and even those are coalesced.
  let rebuildTimer = 0;
  const scheduleRebuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(refresh, 250);
  };
  const ownFurniture = (node) =>
    node.nodeType === 1 &&
    (node.classList.contains('lattice-comment-marker') ||
      node.classList.contains('lattice-comment-popover-layer') ||
      node.classList.contains('lattice-outline'));

  new MutationObserver((records) => {
    const structural = records.some((record) =>
      [...record.addedNodes, ...record.removedNodes].some((node) => !ownFurniture(node)));
    if (structural) scheduleRebuild();
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('lattice:comment-count', () => {
    collectThreads();
    paintCommentMarks();
    if (peekIndex >= 0) renderCard(peekIndex);
  });
  document.addEventListener('lattice:comments-ready', () => {
    collectThreads();
    paintCommentMarks();
  });
  // A thread being written is a popover of its own; two floating surfaces over
  // the same anchor is one too many.
  document.addEventListener('lattice:comment-mode-state', (event) => {
    if (event.detail && event.detail.active) closePeek(true);
  });

  window.lattice = Object.assign(window.lattice || {}, {
    outline: {
      list: () => entries.map((entry, i) => ({
        title: entry.title,
        level: entry.level,
        comments: (buckets[i] || []).length,
      })),
      refresh,
      jump: (index) => {
        const entry = entries[index];
        if (!entry) return false;
        jumpTo(entry.target);
        return true;
      },
    },
  });

  document.body.append(host);
  reportTheme();
  refresh();
  document.dispatchEvent(new CustomEvent('lattice:outline-ready', { detail: window.lattice.outline }));
})();
