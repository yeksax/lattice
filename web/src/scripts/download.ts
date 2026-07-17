import { wirePlatformCtas } from './detect-os';

const labels = {
  macos: "Looks like you're on macOS.",
  windows: "Looks like you're on Windows.",
  linux: "Looks like you're on Linux.",
  unknown: "We couldn't detect your system automatically.",
} as const;

const os = wirePlatformCtas();

const detectEl = document.querySelector('#download-detect');
if (detectEl) {
  detectEl.textContent = labels[os];
}

document.querySelectorAll<HTMLElement>('[data-os-panel]').forEach((panel) => {
  panel.hidden = panel.dataset.osPanel !== os;
});

document.querySelectorAll<HTMLElement>('[data-os-row]').forEach((row) => {
  row.classList.toggle('is-detected', row.dataset.osRow === os);
});
