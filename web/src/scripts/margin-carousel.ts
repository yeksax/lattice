import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/** The frame travels; the text inside it lags, then catches up. */
const SLIDE = 0.52;
const LAG = 30;

/**
 * One flick should move one panel, so the momentum tail after it is absorbed.
 * The tail is swallowed for a fixed window rather than "until the wheel goes
 * quiet": kinetic scrolling can run for seconds, and a reader who keeps
 * pushing never produces the quiet moment a gap-only rule waits for.
 *
 * The window is shorter than the slide on purpose. A reader in a hurry can
 * overtake the animation, and the tweens overwrite each other cleanly.
 */
const GESTURE_GAP = 140;
const GESTURE_COOLDOWN = 500;
const KEY_COOLDOWN = 320;
const WHEEL_FLOOR = 4;

/** Keys the pinned carousel owns; every one of them would otherwise scroll. */
const KEYS = new Set([
  'ArrowRight',
  'ArrowDown',
  'PageDown',
  ' ',
  'ArrowLeft',
  'ArrowUp',
  'PageUp',
  'Home',
  'End',
]);

/**
 * Pin the section and advance one panel per wheel or swipe, at every width.
 * Reduced motion keeps the static stacked list.
 */
export function initMarginCarousel(): void {
  const root = document.querySelector<HTMLElement>('[data-margin-carousel]');
  if (!root) return;

  const track = root.querySelector<HTMLElement>('[data-margin-track]');
  const panels = gsap.utils.toArray<HTMLElement>('[data-margin-panel]', root);
  const ticks = gsap.utils.toArray<HTMLButtonElement>('[data-margin-tick]', root);
  if (!track || panels.length < 2) return;

  // Index, heading and copy of each panel, in the order they should arrive.
  const fades = panels.map((panel) =>
    gsap.utils.toArray<HTMLElement>('[data-margin-fade]', panel),
  );

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The rail changes orientation across this line, so the pin is rebuilt there.
  const desktop = window.matchMedia('(min-width: 768px)');

  // A phone resizes every time the URL bar slides away. Left alone, ScrollTrigger
  // recalculates the pin mid-gesture and the panels jump.
  ScrollTrigger.config({ ignoreMobileResize: true });

  let pin: ScrollTrigger | null = null;
  let listeners: AbortController | null = null;
  let current = 0;
  let locked = false;
  let lastWheel = 0;
  let openAt = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchFree = false;

  const header = document.querySelector<HTMLElement>('.site-header');
  const last = panels.length - 1;

  /** While the carousel holds the viewport, the header gets out of the way:
      the panels are a full screen each and have no room to share. */
  const setLocked = (value: boolean) => {
    locked = value;
    root.classList.toggle('is-locked', value);
    document.body.classList.toggle('is-margin-locked', value);
    header?.classList.toggle('is-clear', value);
    header?.classList.toggle('is-gone', value);
  };

  const setActive = (index: number) => {
    panels.forEach((panel, i) => panel.classList.toggle('is-active', i === index));
    ticks.forEach((tick, i) => tick.setAttribute('aria-current', String(i === index)));
  };

  const panelWidth = () => panels[0]?.getBoundingClientRect().width || window.innerWidth;

  const goTo = (index: number): boolean => {
    if (index < 0 || index > last || index === current) return false;

    const direction = index > current ? 1 : -1;
    const leaving = current;
    current = index;
    setActive(index);

    // Content moves against the frame, so the panels read as depth rather than
    // as one flat sheet sliding.
    gsap.to(fades[leaving], {
      opacity: 0,
      x: -LAG * direction,
      duration: 0.3,
      ease: 'power2.in',
      overwrite: true,
    });
    gsap.fromTo(
      fades[index],
      { opacity: 0, x: LAG * direction },
      {
        opacity: 1,
        x: 0,
        duration: 0.6,
        ease: 'power3.out',
        stagger: 0.06,
        delay: 0.14,
        overwrite: true,
      },
    );
    gsap.to(track, {
      x: -index * panelWidth(),
      duration: SLIDE,
      ease: 'power3.inOut',
      overwrite: true,
    });
    return true;
  };

  const leave = (direction: 1 | -1) => {
    if (!pin) return;
    setLocked(false);
    // Jump past the pin so normal scrolling resumes.
    pin.scroll(direction > 0 ? pin.end + 1 : Math.max(0, pin.start - 1));
  };

  const step = (direction: 1 | -1) => {
    if (direction > 0) {
      if (current < last) goTo(current + 1);
      else leave(1);
      return;
    }
    if (current > 0) goTo(current - 1);
    else leave(-1);
  };

  const teardown = () => {
    listeners?.abort();
    listeners = null;
    pin?.kill();
    pin = null;
    setLocked(false);
    openAt = 0;
    current = 0;
    gsap.set(track, { clearProps: 'transform' });
    gsap.set(fades.flat(), { clearProps: 'opacity,transform' });
    root.classList.add('is-static');
    panels.forEach((panel) => panel.classList.remove('is-active'));
    ticks.forEach((tick) => tick.removeAttribute('aria-current'));
  };

  /**
   * Below this the tallest panel stops fitting one screen, and a pinned panel
   * has no way to scroll inside itself: the card would hang off the bottom.
   * A phone held sideways and the shortest phones get the stacked list.
   */
  const tooShort = () => window.matchMedia('(max-height: 660px)').matches;

  const setup = () => {
    teardown();

    if (reduce.matches || tooShort()) return;

    root.classList.remove('is-static');
    setActive(0);
    gsap.set(track, { x: 0 });
    fades.forEach((group, i) => gsap.set(group, { opacity: i === 0 ? 1 : 0, x: 0 }));

    pin = ScrollTrigger.create({
      trigger: root,
      start: 'top top',
      // The wheel handler absorbs every gesture once the carousel is locked, so
      // this range is not scroll runway for the panels: it is the margin for
      // error before the lock takes hold. A fast fling can carry momentum past
      // a short pin before onEnter fires, so keep a few screens of it, well
      // under the one-screen-per-panel the section used to reserve.
      end: () => `+=${window.innerHeight * 3}`,
      pin: true,
      anticipatePin: 1,
      onEnter: () => setLocked(true),
      onEnterBack: () => setLocked(true),
      onLeave: () => setLocked(false),
      onLeaveBack: () => setLocked(false),
      // Reloading the page inside the section never fires onEnter, and the
      // carousel would sit there unlocked: no capture, and a header standing on
      // top of the panel it is supposed to have left.
      onRefresh: (self) => setLocked(self.isActive),
    });

    setLocked(pin.isActive);

    listeners = new AbortController();
    const { signal } = listeners;

    window.addEventListener(
      'wheel',
      (event: WheelEvent) => {
        if (!locked) return;

        // Absorb every wheel tick while the carousel owns the page.
        event.preventDefault();

        const now = event.timeStamp;
        // A pause means the hand left the trackpad: the next push is a new
        // gesture and counts immediately, however long the cooldown had left.
        if (now - lastWheel > GESTURE_GAP) openAt = 0;
        lastWheel = now;
        if (now < openAt) return;

        const delta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (Math.abs(delta) < WHEEL_FLOOR) return;

        openAt = now + GESTURE_COOLDOWN;
        step(delta > 0 ? 1 : -1);
      },
      { passive: false, signal },
    );

    window.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (!locked) return;
        // Space and the page keys would scroll straight out of the pin.
        const owned = KEYS.has(event.key);
        if (!owned) return;
        event.preventDefault();
        if (event.timeStamp < openAt) return;
        openAt = event.timeStamp + KEY_COOLDOWN;

        switch (event.key) {
          case 'ArrowRight':
          case 'ArrowDown':
          case 'PageDown':
          case ' ':
            step(1);
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
          case 'PageUp':
            step(-1);
            break;
          case 'Home':
            goTo(0);
            break;
          case 'End':
            goTo(last);
            break;
        }
      },
      { signal },
    );

    /* A phone commits to scrolling on the first touchmove it is allowed to
       keep, and never gives the gesture back. So every move is swallowed while
       the carousel is locked, and the threshold below only decides when a
       swallowed gesture has travelled far enough to count as one panel.

       The exception is a sideways drag inside the terminal miniature, which
       has its own overflow to scroll. */
    const scrollsSideways = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('[data-demo-term]'));

    root.addEventListener(
      'touchstart',
      (event: TouchEvent) => {
        const touch = event.touches[0];
        touchStartX = touch?.clientX ?? 0;
        touchStartY = touch?.clientY ?? 0;
        touchFree = false;
      },
      { passive: true, signal },
    );

    root.addEventListener(
      'touchmove',
      (event: TouchEvent) => {
        if (!locked || touchFree) return;

        const touch = event.touches[0];
        const x = touch?.clientX ?? touchStartX;
        const y = touch?.clientY ?? touchStartY;
        const dx = touchStartX - x;
        const dy = touchStartY - y;

        // Decided once, on the first move of the gesture that has a direction.
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8 && scrollsSideways(event.target)) {
          touchFree = true;
          return;
        }

        event.preventDefault();

        // Up or left carries the panels forward, whichever way the hand moved.
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        if (Math.abs(delta) < 36) return;
        if (event.timeStamp < openAt) return;

        openAt = event.timeStamp + GESTURE_COOLDOWN;
        touchStartX = x;
        touchStartY = y;
        step(delta > 0 ? 1 : -1);
      },
      { passive: false, signal },
    );

    ticks.forEach((tick, i) => {
      tick.addEventListener('click', () => goTo(i), { signal });
    });
  };

  setup();
  desktop.addEventListener('change', setup);
  reduce.addEventListener('change', setup);

  const coarse = window.matchMedia('(hover: none)');
  let width = window.innerWidth;

  window.addEventListener(
    'resize',
    () => {
      if (root.classList.contains('is-static')) return;
      const changedWidth = window.innerWidth !== width;
      width = window.innerWidth;
      // On a phone a height-only resize is the URL bar sliding away, not a new
      // layout, and rebuilding the pin for it throws the panel off mid-swipe.
      if (!changedWidth && coarse.matches) return;
      gsap.set(track, { x: -current * panelWidth() });
      ScrollTrigger.refresh();
    },
    { passive: true },
  );
}
