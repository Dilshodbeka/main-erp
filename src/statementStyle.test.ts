import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './mobileStyle';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const rules = cssRules(css);
const wide = '@media(min-width:701px)';
const roomy = '@media(min-width:1200px)';

function ruleAt(selector: string, media = '') {
  return [...rules].reverse().find(rule => rule.media === media && rule.selector.split(',').map(token => token.trim()).includes(selector));
}

describe('finance statement panel compactness', () => {
  it('sits report tiles inside the panel margins without growing them', () => {
    expect(ruleAt('.statement-metrics')?.body).toContain('padding-inline:23px');
    expect(ruleAt('.statement-metrics .metric')?.body).toContain('padding:13px 15px');
    expect(ruleAt('.statement-metrics .metric')?.body).toContain('min-height:0');
    expect(ruleAt('.statement-metrics .metric>strong')?.body).toContain('font-size:19px');
    expect(ruleAt('.statement-metrics', '@media(max-width:700px)')?.body).toContain('padding-inline:16px');
  });

  it('leaves the shared settings rows and metric tiles untouched', () => {
    expect(ruleAt('.settings-facts')?.body).toContain('padding:0 23px 22px');
    expect(ruleAt('.metric')?.body).toContain('padding:20px 21px');
    expect(ruleAt('.metric')?.body).toContain('min-height:136px');
  });

  it('gives the open-row button a fixed column and keeps figures on one line', () => {
    expect(ruleAt('.statement-report th.chevron', wide)?.body).toContain('width:56px');
    expect(ruleAt('.statement-report td.chevron', wide)?.body).toContain('width:56px');
    expect(ruleAt('.statement-report th.right', wide)?.body).toContain('white-space:nowrap');
    expect(ruleAt('.statement-report td.right', wide)?.body).toContain('white-space:nowrap');
    expect(ruleAt('.statement-report td', wide)?.body).toContain('padding-block:13px');
  });

  it('tints the opened row only where a row is still a row', () => {
    expect(ruleAt('.statement-report tr.expanded', wide)?.body).toContain('background:#f1f5ec');
    expect(rules.filter(rule => rule.selector.includes('.statement-report') && rule.media !== '' && rule.media !== wide)).toEqual([]);
  });

  it('turns the opened statement into a tinted card holding white tables', () => {
    expect(ruleAt('.statement-detail.statement-detail-report')?.body).toContain('background:#f8faf5');
    expect(ruleAt('.statement-detail.statement-detail-report')?.body).toContain('padding:16px');
    expect(ruleAt('.statement-detail.statement-detail-report .table-scroll')?.body).toContain('background:#fff');
    expect(ruleAt('.statement-detail.statement-detail-report .empty', wide)?.body).toContain('padding:18px 12px');
  });

  it('puts payments and shipments side by side once there is room', () => {
    expect(ruleAt('.statement-detail.statement-detail-report', roomy)?.body).toContain('grid-template-columns:minmax(0,1fr) minmax(0,1fr)');
    expect(ruleAt('.statement-detail-report>.statement-head', roomy)?.body).toContain('grid-column:1/-1');
  });
});
