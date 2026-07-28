import { getCurrentLocale, translateLabel } from './locale';

/**
 * Behaviour for the reader miniatures in the margin panels. Each one answers
 * the sentence next to it: the thread opens on its line, the CLI prints the
 * exchange, the ticks survive a reopen, the poll stays blind until the room is
 * done, and the page repaints on save without losing its outline.
 *
 * Nothing here creates elements. Everything the demos need is in the markup, so
 * the panels still read with JavaScript off, and Astro's scoped styles apply.
 */

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A touch screen has no hover to lend, so anything the cursor gets for free —
 * the peek card, the word "click" — has to be handed to the tap instead.
 */
const coarse = window.matchMedia('(hover: none)').matches;

const label = (text: string) => translateLabel(text, getCurrentLocale());

/**
 * One observer decides which demo is on screen, in both modes: the pinned
 * carousel clips the panels it is not showing, and the stacked list scrolls
 * them past. A demo that plays to an empty room is worse than no demo.
 */
const VISIBLE_EVENT = 'demo:visible';

const watch = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const root = entry.target as HTMLElement;
      const visible = entry.isIntersecting;
      root.dataset.visible = String(visible);
      if (visible) root.dispatchEvent(new CustomEvent(VISIBLE_EVENT));
    }
  },
  { threshold: 0.45 },
);

function initThreads(root: HTMLElement): void {
  const marker = root.querySelector<HTMLButtonElement>('[data-demo-marker]');
  const anchor = root.querySelector<HTMLElement>('[data-demo-anchor]');
  const pop = root.querySelector<HTMLElement>('[data-demo-pop]');
  const resolve = root.querySelector<HTMLButtonElement>('[data-demo-resolve]');
  const close = root.querySelector<HTMLButtonElement>('[data-demo-close]');
  const status = root.querySelector<HTMLElement>('[data-demo-status]');
  const count = root.querySelector<HTMLElement>('[data-demo-count]');
  const form = root.querySelector<HTMLFormElement>('[data-demo-compose]');
  const input = root.querySelector<HTMLInputElement>('[data-demo-input]');
  const send = root.querySelector<HTMLButtonElement>('[data-demo-send]');
  const mine = root.querySelector<HTMLElement>('[data-demo-mine]');
  const mineBody = root.querySelector<HTMLElement>('[data-demo-mine-body]');
  if (!marker || !anchor || !pop) return;

  /**
   * On a phone the card floats over the panel rather than into a slot the
   * layout reserved for it, so it starts closed and the marker is the
   * invitation. Anywhere else the open thread is the whole point of the panel.
   */
  const compact = window.matchMedia('(max-width: 560px)');

  root.dataset.resolved = 'false';

  /**
   * The card opens at its marker, which on a phone would hang it off the bottom
   * of the screen. So it slides up by exactly as much as it overhangs, keeping
   * a hand's width of panel under it, and never climbs past the panel's top.
   */
  const FLOOR = 80;
  const HEADROOM = 16;

  const place = () => {
    pop.style.top = '';
    if (root.dataset.open !== 'true' || !compact.matches) return;

    const panel = root.closest('.margin-panel') ?? root;
    const bounds = panel.getBoundingClientRect();
    const line = anchor.getBoundingClientRect();
    const natural = pop.offsetTop;
    const overflow =
      line.top + natural + pop.getBoundingClientRect().height - (bounds.bottom - FLOOR);
    if (overflow <= 0) return;

    pop.style.top = `${Math.max(bounds.top + HEADROOM - line.top, natural - overflow)}px`;
  };

  const setOpen = (open: boolean) => {
    root.dataset.open = String(open);
    marker.setAttribute('aria-expanded', String(open));
    place();
  };

  setOpen(!compact.matches);
  window.addEventListener('resize', place, { passive: true });
  compact.addEventListener('change', () => setOpen(!compact.matches));

  marker.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(root.dataset.open !== 'true');
  });
  anchor.addEventListener('click', (event) => {
    if (pop.contains(event.target as Node)) return;
    setOpen(root.dataset.open !== 'true');
  });

  close?.addEventListener('click', () => setOpen(false));

  resolve?.addEventListener('click', () => {
    const resolved = root.dataset.resolved !== 'true';
    root.dataset.resolved = String(resolved);
    resolve.setAttribute('aria-pressed', String(resolved));
    if (status) status.textContent = label(resolved ? 'resolved · costs' : 'open · costs');
  });

  // Reactions: a chip counts everyone else's, plus yours when you add it.
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-demo-chip]'));
  const picker = root.querySelector<HTMLElement>('[data-demo-picker]');
  const react = root.querySelector<HTMLButtonElement>('[data-demo-react]');

  const paint = (chip: HTMLButtonElement) => {
    const base = Number(chip.dataset.base ?? 0);
    const isMine = chip.getAttribute('aria-pressed') === 'true';
    const total = base + (isMine ? 1 : 0);
    chip.classList.toggle('is-mine', isMine);
    chip.hidden = total === 0;
    const counter = chip.querySelector<HTMLElement>('[data-demo-chip-count]');
    if (counter) counter.textContent = String(total);
  };

  const toggleChip = (chip: HTMLButtonElement) => {
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    paint(chip);
  };

  chips.forEach((chip) => {
    // The seeded chip is already yours, so its base excludes you.
    if (chip.getAttribute('aria-pressed') === 'true') {
      chip.dataset.base = String(Math.max(0, Number(chip.dataset.base ?? 0) - 1));
    }
    paint(chip);
    chip.addEventListener('click', () => toggleChip(chip));
  });

  const setPicker = (open: boolean) => {
    if (picker) picker.hidden = !open;
    react?.setAttribute('aria-expanded', String(open));
  };

  react?.addEventListener('click', (event) => {
    event.stopPropagation();
    setPicker(picker?.hidden ?? false);
  });

  root.querySelectorAll<HTMLButtonElement>('[data-demo-pick]').forEach((pick) => {
    pick.addEventListener('click', () => {
      const chip = chips.find((one) => one.dataset.emoji === pick.dataset.emoji);
      if (chip && chip.getAttribute('aria-pressed') !== 'true') toggleChip(chip);
      setPicker(false);
    });
  });

  document.addEventListener('click', (event) => {
    if (!react?.contains(event.target as Node) && !picker?.contains(event.target as Node)) {
      setPicker(false);
    }
  });

  // Replying is the point of the card, so the composer is a real one.
  const replyAction = root.querySelector<HTMLButtonElement>('[data-demo-reply-action]');
  replyAction?.addEventListener('click', () => input?.focus());

  if (send) send.disabled = true;
  input?.addEventListener('input', () => {
    if (send) send.disabled = input.value.trim().length === 0;
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input?.value.trim();
    if (!text || !mine || !mineBody) return;
    mineBody.textContent = text;
    mine.hidden = false;
    if (count) count.textContent = '3';
    if (input) input.value = '';
    if (send) send.disabled = true;
  });
}

function initTerminal(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>('[data-demo-run]');
  const buttonLabel = root.querySelector<HTMLElement>('[data-demo-run-label]');
  const lines = Array.from(root.querySelectorAll<HTMLElement>('[data-demo-line]'));
  if (!button || !lines.length) return;

  let timers: number[] = [];

  const clear = () => {
    timers.forEach((id) => window.clearTimeout(id));
    timers = [];
  };

  const run = () => {
    clear();
    lines.forEach((line) => line.classList.remove('is-shown'));
    if (buttonLabel) buttonLabel.textContent = label('Running');
    button.disabled = true;

    // A prompt line lands, then its output: the pause is what makes it read as
    // a session rather than as a block of text fading in.
    let delay = 0;
    lines.forEach((line, i) => {
      delay += i === 0 ? 0 : line.classList.contains('is-prompt') ? 420 : 180;
      timers.push(
        window.setTimeout(() => {
          line.classList.add('is-shown');
          if (i === lines.length - 1) {
            if (buttonLabel) buttonLabel.textContent = label('Run again');
            button.disabled = false;
          }
        }, delay),
      );
    });
  };

  if (reduce) {
    lines.forEach((line) => line.classList.add('is-shown'));
    if (buttonLabel) buttonLabel.textContent = label('Run again');
  } else {
    // Plays when the panel arrives, and replays every time it comes back.
    root.addEventListener(VISIBLE_EVENT, run);
  }

  button.addEventListener('click', run);
}

const STATE_KEY = 'lattice-demo-cuts';

/**
 * The claim is that a tick outlives the file, so the demo has to actually
 * store it. Lattice keeps this in the sidecar beside the report; a landing
 * page has localStorage, and the point survives the substitution: close the
 * tab, come back, the boxes are as you left them.
 */
function readState(): string[] {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeState(keys: string[]): void {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(keys));
  } catch {
    // Private browsing: the ticks still work for this visit.
  }
}

function initState(root: HTMLElement): void {
  const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('[data-demo-check]'));
  const total = root.querySelector<HTMLElement>('[data-demo-total]');
  const reopen = root.querySelector<HTMLButtonElement>('[data-demo-reopen]');
  if (!boxes.length || !total) return;

  const renderTotal = () => {
    const sum = boxes.reduce(
      (acc, box) => acc + (box.checked ? Number(box.dataset.cost ?? 0) : 0),
      0,
    );
    total.textContent = `$${sum.toLocaleString(getCurrentLocale())}`;
  };

  const restore = () => {
    const saved = readState();
    boxes.forEach((box) => {
      box.checked = saved.includes(box.dataset.key ?? '');
    });
    renderTotal();
  };

  boxes.forEach((box) => {
    box.addEventListener('change', () => {
      writeState(boxes.filter((one) => one.checked).map((one) => one.dataset.key ?? ''));
      renderTotal();
    });
  });

  restore();

  // Reopening reads the file again: the boxes go blank for a beat, then come
  // back from storage. Watching them return is the proof.
  reopen?.addEventListener('click', () => {
    if (reduce) {
      restore();
      return;
    }
    root.dataset.reopening = 'true';
    boxes.forEach((box) => {
      box.checked = false;
    });
    renderTotal();
    window.setTimeout(() => {
      restore();
      root.dataset.reopening = 'false';
    }, 360);
  });
}

function initPoll(root: HTMLElement): void {
  const box = root.querySelector<HTMLElement>('[data-demo-pollbox]');
  const options = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-demo-opt]'));
  const answered = root.querySelector<HTMLElement>('[data-demo-answered]');
  const hint = root.querySelector<HTMLElement>('[data-demo-hint]');
  if (!box || !options.length) return;

  let mine = -1;

  const render = () => {
    const voted = mine >= 0;
    const counts = options.map(
      (option, i) => Number(option.dataset.votes ?? 0) + (i === mine ? 1 : 0),
    );
    const cast = counts.reduce((a, b) => a + b, 0);

    if (answered) answered.textContent = String(cast);
    box.classList.toggle('is-revealed', voted);
    if (hint) {
      const asked = voted
        ? coarse
          ? 'Tap again to change your vote'
          : 'Click again to change your vote'
        : coarse
          ? 'Tap to vote'
          : 'Click to vote';
      hint.textContent = label(asked);
    }

    options.forEach((option, i) => {
      const share = cast ? Math.round((counts[i] / cast) * 100) : 0;
      option.setAttribute('aria-pressed', String(i === mine));
      const fill = option.querySelector<HTMLElement>('[data-demo-fill]');
      const pct = option.querySelector<HTMLElement>('[data-demo-pct]');
      if (fill) fill.style.width = voted ? `${share}%` : '0%';
      if (pct) pct.textContent = voted ? `${share}%` : '-';
    });
  };

  options.forEach((option, i) => {
    option.addEventListener('click', () => {
      mine = mine === i ? -1 : i;
      render();
    });
  });

  render();
}

function initReader(root: HTMLElement): void {
  const sections = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-demo-section]'));
  const title = root.querySelector<HTMLElement>('[data-demo-section-title]');
  const figure = root.querySelector<HTMLElement>('[data-demo-figure]');
  const save = root.querySelector<HTMLButtonElement>('[data-demo-save]');
  const caps = Array.from(root.querySelectorAll<HTMLElement>('[data-demo-cap]'));
  const peek = root.querySelector<HTMLElement>('[data-demo-peek]');
  const peekTitle = root.querySelector<HTMLElement>('[data-demo-peek-title]');
  const peekBody = root.querySelector<HTMLElement>('[data-demo-peek-body]');
  const peekCount = root.querySelector<HTMLElement>('[data-demo-peek-count]');
  const peekThreads = root.querySelector<HTMLElement>('[data-demo-peek-threads]');
  const reader = root.querySelector<HTMLElement>('.dm-reader');

  const peekRows = Array.from(root.querySelectorAll<HTMLElement>('[data-demo-peek-row]'));

  type Row = { initial: string; name: string; body: string };

  // Hovering a bar peeks into its section without leaving the one you are in.
  let peeking: HTMLElement | null = null;

  const showPeek = (tick: HTMLElement) => {
    if (!peek || !reader) return;
    peeking = tick;
    let rows: Row[] = [];
    try {
      rows = JSON.parse(tick.dataset.rows ?? '[]') as Row[];
    } catch {
      rows = [];
    }

    if (peekTitle) peekTitle.textContent = label(tick.dataset.label ?? '');
    if (peekBody) peekBody.textContent = label(tick.dataset.excerpt ?? '');
    if (peekCount) {
      peekCount.textContent = String(rows.length);
      peekCount.hidden = rows.length === 0;
    }
    if (peekThreads) peekThreads.hidden = rows.length === 0;

    peekRows.forEach((element, i) => {
      const row = rows[i];
      element.hidden = !row;
      if (!row) return;
      const initial = element.querySelector<HTMLElement>('[data-demo-row-initial]');
      const author = element.querySelector<HTMLElement>('[data-demo-row-name]');
      const body = element.querySelector<HTMLElement>('[data-demo-row-body]');
      if (initial) initial.textContent = row.initial;
      if (author) author.textContent = row.name;
      if (body) body.textContent = label(row.body);
    });

    const top = tick.getBoundingClientRect().top - reader.getBoundingClientRect().top;
    peek.style.top = `${Math.max(0, top - 14)}px`;
    peek.hidden = false;
  };

  const hidePeek = () => {
    peeking = null;
    if (peek) peek.hidden = true;
  };

  const rail = root.querySelector<HTMLElement>('.dm-rail');

  sections.forEach((section) => {
    section.addEventListener('click', () => {
      sections.forEach((other) => other.setAttribute('aria-current', String(other === section)));
      if (title) title.textContent = label(section.dataset.label ?? '');
      // On a touch screen the tap has to do the hovering as well: it moves to
      // the section and opens its card, and taps it shut again.
      if (coarse) {
        if (peeking === section) hidePeek();
        else showPeek(section);
      }
    });

    // A touch pointer is destroyed on release, so pointerenter/leave would only
    // flash the card. The tap above owns it instead.
    if (coarse) return;
    section.addEventListener('pointerenter', () => showPeek(section));
    section.addEventListener('focus', () => showPeek(section));
    section.addEventListener('blur', hidePeek);
  });

  if (coarse) {
    document.addEventListener('click', (event) => {
      const target = event.target as Node;
      if (rail?.contains(target) || peek?.contains(target)) return;
      hidePeek();
    });
  } else {
    rail?.addEventListener('pointerleave', hidePeek);
    peek?.addEventListener('pointerleave', hidePeek);
  }

  // Saving the file repaints the page in place. The outline keeps its position,
  // which is the part worth showing.
  const figures = ['$2,030', '$2,145', '$1,890'];
  let revision = 0;
  save?.addEventListener('click', () => {
    revision = (revision + 1) % figures.length;
    if (reduce) {
      if (figure) figure.textContent = figures[revision];
      return;
    }
    root.dataset.reloading = 'true';
    window.setTimeout(() => {
      if (figure) figure.textContent = figures[revision];
      root.dataset.reloading = 'false';
    }, 220);
  });

  const hit = (cap: HTMLElement) => {
    cap.classList.add('is-hit');
    window.setTimeout(() => cap.classList.remove('is-hit'), 320);
  };

  caps.forEach((cap) => cap.addEventListener('click', () => hit(cap)));

  // A touch device hides the legend, and lighting up something nobody can see
  // is not worth a listener on every keystroke of the page.
  if (coarse) return;

  // The shortcuts are real keys in the reader, so they answer to real keys
  // here too, but only while this panel is the one on screen.
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (root.dataset.visible !== 'true') return;
    const cap = caps.find(
      (item) => item.dataset.code === event.code && (item.dataset.shift === 'true') === event.shiftKey,
    );
    if (cap) hit(cap);
  });
}

export function initMarginDemos(): void {
  document.querySelectorAll<HTMLElement>('[data-demo]').forEach((root) => {
    watch.observe(root);
    switch (root.dataset.demo) {
      case 'threads':
        initThreads(root);
        break;
      case 'terminal':
        initTerminal(root);
        break;
      case 'state':
        initState(root);
        break;
      case 'poll':
        initPoll(root);
        break;
      case 'reader':
        initReader(root);
        break;
    }
  });
}
