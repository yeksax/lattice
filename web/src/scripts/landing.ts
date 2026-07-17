import { wirePlatformCtas } from './detect-os';

wirePlatformCtas();

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const header = document.querySelector<HTMLElement>('.site-header');
const hero = document.querySelector<HTMLElement>('.hero');

if (header && hero) {
  const heroWatch = new IntersectionObserver(
    ([entry]) => {
      if (!entry) return;
      header.classList.toggle('is-solid', !entry.isIntersecting);
    },
    { rootMargin: '-64px 0px 0px 0px', threshold: 0 },
  );
  heroWatch.observe(hero);
}

if (!reduce) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  document.querySelectorAll('.hero .reveal').forEach((el) => el.classList.add('is-visible'));
} else {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
}

/* Shelf: hover picks one file out of the stack */
const shelf = document.querySelector<HTMLElement>('[data-shelf]');
if (shelf) {
  const items = [...shelf.querySelectorAll<HTMLElement>('.shelf-item')];
  const clear = () => {
    shelf.classList.remove('is-hot');
    items.forEach((item) => item.classList.remove('is-focus'));
  };
  const focusItem = (item: HTMLElement) => {
    shelf.classList.add('is-hot');
    items.forEach((el) => el.classList.toggle('is-focus', el === item));
  };
  items.forEach((item) => {
    item.addEventListener('pointerenter', () => focusItem(item));
    item.addEventListener('focus', () => focusItem(item));
  });
  shelf.addEventListener('pointerleave', clear);
  shelf.addEventListener('focusout', (e) => {
    if (!shelf.contains(e.relatedTarget as Node | null)) clear();
  });
}

/* Principles accordion */
document.querySelectorAll<HTMLElement>('[data-principle]').forEach((item, index) => {
  const btn = item.querySelector('.principle-trigger');
  if (index === 0) item.classList.add('is-open');
  btn?.addEventListener('click', () => {
    const open = item.classList.contains('is-open');
    document.querySelectorAll('[data-principle]').forEach((el) => el.classList.remove('is-open'));
    if (!open) item.classList.add('is-open');
  });
});

/* Loop verbs */
const loopCopy = {
  add: {
    cmd: 'lattice add report.html',
    explain: 'Symlink, metadata, full-text index. The file stays where you put it.',
  },
  open: {
    cmd: 'lattice open q3-review',
    explain: 'Dashboard or CLI. Source edits show up live in the open document.',
  },
  share: {
    cmd: 'lattice share q3-review',
    explain: 'One hosted snapshot. The rest of the library is unreachable by design.',
  },
} as const;

type Verb = keyof typeof loopCopy;

const loopCmd = document.querySelector('#loop-cmd');
const loopExplain = document.querySelector('#loop-explain');
let typeTimer = 0;

const typeCommand = (text: string) => {
  if (!loopCmd) return;
  window.clearTimeout(typeTimer);
  if (reduce) {
    loopCmd.textContent = text;
    return;
  }
  loopCmd.textContent = '';
  let i = 0;
  const tick = () => {
    loopCmd.textContent = text.slice(0, i);
    i += 1;
    if (i <= text.length) typeTimer = window.setTimeout(tick, 18);
  };
  tick();
};

document.querySelectorAll<HTMLElement>('[data-verb]').forEach((btn) => {
  const activate = () => {
    const key = btn.dataset.verb as Verb | undefined;
    if (!key || !(key in loopCopy)) return;
    const entry = loopCopy[key];
    document.querySelectorAll<HTMLElement>('[data-verb]').forEach((b) => {
      b.classList.toggle('is-active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    if (loopExplain) loopExplain.textContent = entry.explain;
    typeCommand(entry.cmd);
  };
  btn.addEventListener('pointerenter', activate);
  btn.addEventListener('focus', activate);
  btn.addEventListener('click', activate);
});

/* Copy install */
const copyBtn = document.querySelector<HTMLButtonElement>('[data-copy-install]');
const installCode = document.querySelector('#install-code');
if (copyBtn && installCode) {
  copyBtn.addEventListener('click', async () => {
    const label = copyBtn.querySelector('[data-copy-label]');
    try {
      await navigator.clipboard.writeText(installCode.textContent ?? '');
      if (label) label.textContent = 'Copied';
      window.setTimeout(() => {
        if (label) label.textContent = 'Copy';
      }, 1600);
    } catch {
      if (label) label.textContent = 'Failed';
    }
  });
}
