// Bottom-sheet behaviour for dialogs on phones: drag the header down to dismiss.
import type { RefObject, TouchEvent as ReactTouchEvent } from 'react';
import { useRef } from 'react';

export const SHEET_CLOSE_DISTANCE = 110;

/** Sheets only exist in the phone layout; on wider screens dialogs stay centred and fixed. */
export function isSheetLayout(width: number): boolean {
  return width <= 700;
}

/** Released past the threshold (or flicked fast) → close; otherwise the sheet springs back. */
export function shouldCloseSheet(distance: number, durationMs: number): boolean {
  if (distance >= SHEET_CLOSE_DISTANCE) return true;
  return distance > 40 && durationMs > 0 && distance / durationMs > 0.6;
}

export function useSheetDrag(sheet: RefObject<HTMLElement | null>, close: () => void) {
  const drag = useRef<{ y: number; at: number; distance: number } | null>(null);
  const apply = (distance: number) => {
    const node = sheet.current;
    if (node) node.style.transform = distance > 0 ? `translateY(${distance}px)` : '';
  };
  return {
    onTouchStart(event: ReactTouchEvent) {
      if (!isSheetLayout(window.innerWidth) || event.touches.length !== 1) return;
      drag.current = { y: event.touches[0].clientY, at: Date.now(), distance: 0 };
      sheet.current?.classList.remove('settling');
      sheet.current?.classList.add('dragging');
    },
    onTouchMove(event: ReactTouchEvent) {
      if (!drag.current) return;
      drag.current.distance = Math.max(0, event.touches[0].clientY - drag.current.y);
      apply(drag.current.distance);
    },
    onTouchEnd() {
      const state = drag.current;
      if (!state) return;
      drag.current = null;
      const node = sheet.current;
      node?.classList.remove('dragging');
      if (shouldCloseSheet(state.distance, Date.now() - state.at)) { close(); return; }
      node?.classList.add('settling');
      apply(0);
    },
  };
}
