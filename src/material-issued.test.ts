import { describe, expect, it } from 'vitest';
import { isIssued } from './domain';

describe('isIssued', () => {
  it('treats a fresh row as not issued', () => {
    expect(isIssued({ qty: 5, issuedQty: 0 })).toBe(false);
  });

  it('treats a partially issued row as not issued', () => {
    expect(isIssued({ qty: 5, issuedQty: 3 })).toBe(false);
  });

  it('treats a fully issued row as issued', () => {
    expect(isIssued({ qty: 5, issuedQty: 5 })).toBe(true);
  });

  it('tolerates sub-milli overshoot from quantity arithmetic', () => {
    expect(isIssued({ qty: 5, issuedQty: 5.0000001 })).toBe(true);
  });
});
