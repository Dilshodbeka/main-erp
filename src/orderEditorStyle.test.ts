import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules, phoneRules } from './mobileStyle';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const rules = cssRules(css);

function ruleAt(selector: string, media = '') {
  return [...rules].reverse().find(rule => rule.media === media && rule.selector.split(',').map(token => token.trim()).includes(selector));
}

describe('order editor layout regressions', () => {
  it('lets the position dialog override the generic wide-dialog width', () => {
    expect(ruleAt('.dialog.wide.dialog-positions')?.body).toContain('width:min(1080px,100%)');
  });

  it('gives operation and executor wrapper readable halves of every non-phone route', () => {
    expect(ruleAt('.route-editor')?.body).toContain('grid-template-columns:20px repeat(11,minmax(0,1fr))');
    expect(ruleAt('.route-editor>select:nth-of-type(1)')?.body).toContain('grid-column:2 / span 4');
    expect(ruleAt('.route-editor>.route-executor')?.body).toContain('grid-column:6 / span 6');
    expect(ruleAt('.route-editor>.route-executor')?.body).toContain('display:flex');
    expect(ruleAt('.route-executor select')?.body).toContain('flex:1');
    expect(ruleAt('.route-editor>.route-rate')?.body).toContain('grid-column:4 / span 3');
    expect(ruleAt('.route-editor>.route-amount')?.body).toContain('grid-column:7 / span 3');
  });

  it('puts narrow-phone amounts and actions on their own full-width rows', () => {
    const media = '@media(max-width:380px)';
    expect(ruleAt('.route-editor>.route-amount', media)?.body).toContain('grid-column:2 / span 2');
    expect(ruleAt('.route-editor>.route-tools', media)?.body).toContain('grid-row:5');
    expect(ruleAt('.route-editor>.route-tools', media)?.body).toContain('grid-column:2 / span 2');
  });

  it('wraps the worker rate note instead of overflowing a narrow-phone route', () => {
    expect(ruleAt('.route-rate small', '@media(max-width:380px)')?.body).toContain('white-space:normal');
  });

  it('reserves the full delete-button width in a phone material row', () => {
    const material = phoneRules(css).filter(rule =>
      rule.selector.split(',').map(token => token.trim()).includes('.material-editor')
      && rule.body.includes('grid-template-columns'),
    ).at(-1);
    const tracks = /grid-template-columns:([^;}]+)/.exec(material?.body ?? '')?.[1]?.trim().split(/\s+/);
    expect(tracks?.at(-1)).toBe('44px');
  });

  it('raises desktop route and material fields to 13px', () => {
    expect(ruleAt('.dialog-positions .editor-line select')?.body).toContain('font-size:13px');
    expect(ruleAt('.dialog-positions .editor-line input')?.body).toContain('font-size:13px');
  });
});
