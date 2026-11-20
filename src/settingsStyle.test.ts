import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './mobileStyle';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const rules = cssRules(css);

function ruleAt(selector: string, media = '') {
  return [...rules].reverse().find(rule => rule.media === media && rule.selector.split(',').map(token => token.trim()).includes(selector));
}

describe('warehouse and workshop settings rows', () => {
  it('keeps the rename rows inside the card instead of across its border', () => {
    expect(ruleAt('.warehouse-settings')?.body).toContain('padding:0 23px 22px');
  });

  it('separates stacked rows so controls do not read as one block', () => {
    expect(ruleAt('.warehouse-settings')?.body).toContain('gap:12px');
  });

  it('follows the tighter phone inset every other panel body uses', () => {
    expect(ruleAt('.warehouse-settings', '@media(max-width:700px)')?.body).toContain('padding-inline:16px');
  });

  it('wins the cascade over the wide-screen padding it overrides', () => {
    expect([...rules].reverse().find(rule => rule.selector === '.warehouse-settings')?.media).toBe('@media(max-width:700px)');
  });
});
