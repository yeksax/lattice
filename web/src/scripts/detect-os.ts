export type DetectedOS = 'macos' | 'windows' | 'linux' | 'unknown';

function platformHint(): string {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
    platform?: string;
  };
  return `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent}`;
}

export function detectOS(): DetectedOS {
  const hint = platformHint().toLowerCase();

  if (/iphone|ipad|ipod|mac os|macintosh|darwin|\bmac\b/.test(hint)) {
    return 'macos';
  }
  if (/win/.test(hint)) return 'windows';
  if (/android/.test(hint)) return 'linux';
  if (/linux|cros|x11/.test(hint)) return 'linux';
  return 'unknown';
}

type CtaConfig = {
  label: string;
  href: string;
  soon: boolean;
  icon: string;
};

const ctaByOs: Record<DetectedOS, CtaConfig> = {
  macos: {
    label: 'Download for macOS',
    href: '/download',
    soon: false,
    icon: 'ph-apple-logo',
  },
  windows: {
    label: 'Windows soon',
    href: '/download',
    soon: true,
    icon: 'ph-windows-logo',
  },
  linux: {
    label: 'Linux soon',
    href: '/download',
    soon: true,
    icon: 'ph-linux-logo',
  },
  unknown: {
    label: 'Download',
    href: '/download',
    soon: false,
    icon: 'ph-download-simple',
  },
};

/** Wire any [data-platform-cta] buttons to the detected OS. */
export function wirePlatformCtas(os = detectOS()): DetectedOS {
  const config = ctaByOs[os];

  document.querySelectorAll<HTMLAnchorElement>('[data-platform-cta]').forEach((el) => {
    el.href = config.href;
    el.classList.toggle('is-soon', config.soon);
    if (config.soon) {
      el.setAttribute('aria-disabled', 'false');
    }

    const label = el.querySelector('[data-platform-cta-label]');
    if (label) label.textContent = config.label;

    const icon = el.querySelector('[data-platform-cta-icon]');
    if (icon) {
      icon.className = `ph ${config.icon}`;
      icon.setAttribute('aria-hidden', 'true');
    }
  });

  document.querySelectorAll<HTMLElement>('[data-platform-mac-only]').forEach((el) => {
    el.hidden = os !== 'macos' && os !== 'unknown';
  });

  document.documentElement.dataset.os = os;
  return os;
}
