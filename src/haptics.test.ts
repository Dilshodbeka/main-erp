import { describe, expect, it } from 'vitest';
import { haptic, hapticPattern } from './haptics';

describe('haptics', () => {
  it('возвращает паттерны для каждого вида', () => {
    expect(hapticPattern('tap')).toEqual([15]);
    expect(hapticPattern('success')).toEqual([20, 30, 20]);
    expect(hapticPattern('warning')).toEqual([40, 40, 40]);
  });

  it('вызывает vibrate с паттерном, когда он доступен', () => {
    const calls: number[][] = [];
    haptic('success', pattern => { calls.push(pattern); return true; });
    expect(calls).toEqual([[20, 30, 20]]);
  });

  it('тихо пропускает, когда vibrate отсутствует', () => {
    expect(() => haptic('tap', undefined)).not.toThrow();
  });
});
