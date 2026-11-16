import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './mobileStyle';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const rules = cssRules(css);

function ruleAt(selector: string, media = '') {
  return [...rules].reverse().find(rule => rule.media === media && rule.selector.split(',').map(token => token.trim()).includes(selector));
}

describe('shortage notice layout', () => {
  it('keeps the deficit list readable inside the production band', () => {
    expect(ruleAt('.shortage')?.body).toContain('font-size:11px');
    expect(ruleAt('.shortage')?.body).toContain('width:100%');
  });

  it('makes the list a full-width child of the wrapped material band', () => {
    expect(ruleAt('.material-warning>.shortage')?.body).toContain('flex-basis:100%');
  });

  it('spans the material chip across the editor row tracks', () => {
    expect(ruleAt('.shortage-chip')?.body).toContain('grid-column:1 / -1');
  });

  it('keeps the navigation links a phone-height tap target', () => {
    expect(ruleAt('.shortage-links .text-button', '@media(max-width:700px)')?.body).toContain('min-height:44px');
  });

  it('stops the band rule from pushing the deficit links to the right edge', () => {
    expect(ruleAt('.material-warning .shortage-links button')?.body).toContain('margin-left:0');
  });
});
