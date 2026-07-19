import { initPlatform, detectOS } from './detect-os';
import { getCurrentLocale, initLocale, translateLabel } from './locale';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type OS = ReturnType<typeof detectOS>;

function initHeader(): void {
  const header = document.querySelector<HTMLElement>('.site-header');
  const hero = document.querySelector<HTMLElement>('.hero');
  if (!header || !hero) return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      header.classList.toggle('is-solid', !entry.isIntersecting);
    },
    { rootMargin: '-80px 0px 0px 0px', threshold: 0 },
  );
  observer.observe(hero);
}

function initReveals(): void {
  if (reduce) {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );

  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  document.querySelectorAll('.hero .reveal').forEach((el) => el.classList.add('is-visible'));
}

function initCopy(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-copy-target]').forEach((btn) => {
    const code = document.querySelector<HTMLElement>(btn.dataset.copyTarget ?? '');
    if (!code) return;

    btn.addEventListener('click', async () => {
      const label = btn.querySelector('[data-copy-label]');
      try {
        await navigator.clipboard.writeText(code.textContent?.trim() ?? '');
        if (label) label.textContent = translateLabel('Copied', getCurrentLocale());
        window.setTimeout(() => {
          if (label) label.textContent = translateLabel('Copy', getCurrentLocale());
        }, 1600);
      } catch {
        if (label) label.textContent = translateLabel('Failed', getCurrentLocale());
      }
    });
  });
}

function initDownloadPage(): void {
  const labels: Record<OS, string> = {
    macos: "Looks like you're on macOS.",
    windows: "Looks like you're on Windows.",
    linux: "Looks like you're on Linux.",
    unknown: "We couldn't detect your system automatically.",
  };

  const appAvail: Record<OS, 'available' | 'soon'> = {
    macos: 'available',
    windows: 'soon',
    linux: 'soon',
    unknown: 'soon',
  };

  const os = detectOS();
  const detectEl = document.querySelector('#download-detect');
  if (detectEl) detectEl.textContent = labels[os];

  document.querySelectorAll<HTMLElement>('[data-os-app]').forEach((el) => {
    el.hidden = el.dataset.osApp !== appAvail[os];
  });

  document.querySelectorAll<HTMLElement>('[data-os-row]').forEach((row) => {
    row.classList.toggle('is-detected', row.dataset.osRow === os);
  });
}

initPlatform();
initDownloadPage();
initLocale();
initHeader();
initReveals();
initCopy();
