import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mobileTapTargetIssues, readabilityIssues, tinyTextSelectors, phoneStyleIssues } from './mobileStyle';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('phone readability floor', () => {
  it('keeps every label at 11px or larger, micro labels at 10px', () => {
    expect(readabilityIssues(css)).toEqual([]);
  });

  it('has no text at all below 10px', () => {
    expect(tinyTextSelectors(css, 10)).toEqual([]);
  });
});

describe('phone form and shell', () => {
  it('lets phones render fields at 16px and mind the home indicator', () => {
    expect(phoneStyleIssues(css, html)).toEqual([]);
  });
});

describe('phone tap targets', () => {
  it('never shrinks a control below 44px on a phone', () => {
    expect(mobileTapTargetIssues(css)).toEqual([]);
  });
});
