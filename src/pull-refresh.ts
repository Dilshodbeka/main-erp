// Pull-to-refresh for the phone layout: drag the page down from the very top to reload data.
import { useEffect, useRef } from 'react';
import { haptic } from './haptics';

export const PULL_TRIGGER = 72;
const PULL_MAX = 110;

/** Finger travel → indicator travel: follows the finger with resistance and stops at PULL_MAX. */
export function pullDistance(deltaY: number): number {
  if (!(deltaY > 0)) return 0;
  return Math.min(PULL_MAX, Math.round(deltaY * 0.5));
}

/** A pull only starts at the top of the page, with one finger, and never over an open layer. */
export function canStartPull(scrollY: number, touches: number, layerOpen: boolean): boolean {
  return scrollY <= 0 && touches === 1 && !layerOpen;
}

const LAYERS = '.modal-backdrop,.drawer-overlay,.mobile-sheet,.chat-overlay,.sidebar.open';

/** Attach to a small indicator element; calls onRefresh once per completed pull. */
export function usePullToRefresh(onRefresh: () => void, busy: boolean) {
  const indicator = useRef<HTMLDivElement>(null);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const locked = useRef(busy);
  locked.current = busy;

  useEffect(() => {
    const node = indicator.current;
    if (!node) return;
    let startY: number | null = null;
    let distance = 0;
    const paint = (value: number, settle: boolean) => {
      node.classList.toggle('settling', settle);
      node.style.opacity = value > 0 ? String(Math.min(1, value / PULL_TRIGGER)) : '';
      node.style.transform = value > 0 ? `translateY(${value - 50}px) rotate(${value * 3}deg)` : '';
    };
    const start = (event: TouchEvent) => {
      startY = canStartPull(window.scrollY, event.touches.length, locked.current || !!document.querySelector(LAYERS))
        ? event.touches[0].clientY : null;
      distance = 0;
    };
    const move = (event: TouchEvent) => {
      if (startY === null) return;
      const next = pullDistance(event.touches[0].clientY - startY);
      if (next > 0 && distance < PULL_TRIGGER && next >= PULL_TRIGGER) haptic('tap');
      distance = next;
      paint(distance, false);
    };
    const end = () => {
      if (startY === null) return;
      startY = null;
      const fire = distance >= PULL_TRIGGER;
      distance = 0;
      if (!fire) { paint(0, true); return; }
      node.classList.add('spinning');
      paint(PULL_TRIGGER, true);
      refresh.current();
      window.setTimeout(() => { node.classList.remove('spinning'); paint(0, true); }, 700);
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, []);
  return indicator;
}
