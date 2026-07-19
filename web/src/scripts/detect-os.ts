export type DetectedOS = 'macos' | 'windows' | 'linux' | 'unknown';

export function detectOS(): DetectedOS {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
    platform?: string;
  };
  const hint = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent}`.toLowerCase();

  if (/iphone|ipad|ipod|mac os|macintosh|darwin|\bmac\b/.test(hint)) return 'macos';
  if (/win/.test(hint)) return 'windows';
  if (/android/.test(hint)) return 'linux';
  if (/linux|cros|x11/.test(hint)) return 'linux';
  return 'unknown';
}

export function initPlatform(os = detectOS()): DetectedOS {
  document.documentElement.dataset.os = os;
  return os;
}
