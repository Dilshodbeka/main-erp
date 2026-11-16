import { describe, expect, it } from 'vitest';
import { swipeDecision } from './swipe';

describe('swipe', () => {
  it('раскрывает действия при свайпе влево дальше порога', () => {
    expect(swipeDecision(-61)).toBe('reveal');
    expect(swipeDecision(-120, 80)).toBe('reveal');
  });

  it('не раскрывает ниже порога и при свайпе вправо', () => {
    expect(swipeDecision(-59)).toBe('none');
    expect(swipeDecision(40)).toBe('none');
    expect(swipeDecision(-60)).toBe('reveal');
  });
});
