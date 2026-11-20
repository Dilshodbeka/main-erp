import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './mobileStyle';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const rules = cssRules(css);

function ruleAt(selector: string, media = '') {
  return [...rules].reverse().find(rule => rule.media === media && rule.selector.split(',').map(token => token.trim()).includes(selector));
}

describe('notification blocks', () => {
  it('draws a warning mark on every warning that brings no icon of its own', () => {
    const body = ruleAt('.warning:not(.has-icon)::before')?.body;
    expect(body).toContain('mask');
    expect(body).toContain('data:image/svg+xml');
  });

  it('draws an info mark on every note that brings no icon of its own', () => {
    const body = ruleAt('.info-note:not(.has-icon)::before')?.body;
    expect(body).toContain('mask');
    expect(body).toContain('data:image/svg+xml');
  });

  it('boxes the material deficit list like every other system card', () => {
    const body = ruleAt('.shortage')?.body ?? '';
    expect(body).toContain('border-radius:10px');
    expect(body).toContain('padding:13px 15px');
  });

  it('keeps the deficit list flat inside the already coloured material band', () => {
    const body = ruleAt('.material-warning>.shortage')?.body ?? '';
    expect(body).toContain('padding:0');
    expect(body).toContain('border:0');
  });

  it('reads a bare status line in a form at note size, not the browser default', () => {
    expect(ruleAt('.form-body>p:not([class])')?.body).toContain('font-size:12px');
  });
});
