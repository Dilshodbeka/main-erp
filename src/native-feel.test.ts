import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PULL_TRIGGER, canStartPull, pullDistance } from './pull-refresh';
import { SHEET_CLOSE_DISTANCE, isSheetLayout, shouldCloseSheet } from './sheet-drag';

describe('pull to refresh', () => {
  it('follows the finger with resistance and has a ceiling', () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(60)).toBe(30);
    expect(pullDistance(PULL_TRIGGER * 2)).toBe(PULL_TRIGGER);
    expect(pullDistance(5000)).toBe(110);
  });
  it('starts only at the top, with one finger and no open layer', () => {
    expect(canStartPull(0, 1, false)).toBe(true);
    expect(canStartPull(40, 1, false)).toBe(false);
    expect(canStartPull(0, 2, false)).toBe(false);
    expect(canStartPull(0, 1, true)).toBe(false);
  });
});

describe('bottom sheet', () => {
  it('is a phone-only layout', () => {
    expect(isSheetLayout(390)).toBe(true);
    expect(isSheetLayout(1280)).toBe(false);
  });
  it('closes on a long drag or a quick flick, springs back otherwise', () => {
    expect(shouldCloseSheet(SHEET_CLOSE_DISTANCE, 900)).toBe(true);
    expect(shouldCloseSheet(60, 80)).toBe(true);
    expect(shouldCloseSheet(60, 900)).toBe(false);
    expect(shouldCloseSheet(10, 10)).toBe(false);
  });
});

describe('native.css', () => {
  const css = readFileSync(new URL('./native.css', import.meta.url), 'utf8');
  it('pads loose panel content and honours reduced motion', () => {
    expect(css).toContain('.panel>h3{padding:18px var(--panel-x)');
    expect(css).toContain('.panel>.subtle-note');
    expect(css).toContain('prefers-reduced-motion:reduce');
  });
  it('introduces no purple', () => {
    expect(css).not.toMatch(/purple|violet|#[89a-f][0-5][c-f]\b/i);
  });
});
