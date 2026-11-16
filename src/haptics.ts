export type HapticKind = 'tap' | 'success' | 'warning';

const PATTERNS: Record<HapticKind, number[]> = {
  tap: [15],
  success: [20, 30, 20],
  warning: [40, 40, 40],
};

export function hapticPattern(kind: HapticKind): number[] {
  return PATTERNS[kind];
}

export function haptic(
  kind: HapticKind,
  vibrate: ((pattern: number[]) => boolean) | undefined =
    typeof navigator !== 'undefined' ? navigator.vibrate?.bind(navigator) : undefined,
): void {
  if (!vibrate) return;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  try { vibrate(PATTERNS[kind]); } catch { /* noop */ }
}
