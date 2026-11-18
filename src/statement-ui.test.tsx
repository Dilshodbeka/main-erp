import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinanceStatements, rowClass } from './components/FinanceStatements';
import { emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import type { Actor } from './types';

const admin: Actor = { id: 'owner', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
const source = readFileSync(new URL('./components/FinanceStatements.tsx', import.meta.url), 'utf8');
const count = (needle: string) => source.split(needle).length - 1;

describe('finance statement markup', () => {
  const html = renderToStaticMarkup(createElement(FinanceStatements, { state: emptyState(), actor: admin }));

  it('shows the period totals as report tiles, not settings rows', () => {
    expect(html).toContain('class="metrics statement-metrics"');
    expect(html).not.toContain('settings-facts');
  });

  it('gives every tab the same tiles and statement tables', () => {
    expect(count('className="metrics statement-metrics"')).toBe(3);
    expect(count('className="table-scroll cardable statement-report"')).toBe(3);
    expect(html).toContain('table-scroll cardable statement-report');
  });

  it('keeps the chevron column off the stretching path in both expandable tables', () => {
    expect(count('<th className="chevron" />')).toBe(2);
    expect(count('<td data-label="Batafsil" className="chevron">')).toBe(2);
  });

  it('wraps each expandable statement in the tinted detail card', () => {
    expect(count('className="statement-detail statement-detail-report"')).toBe(2);
  });

  it('tints only the row the reader opened', () => {
    expect(rowClass('c1', 'c1')).toBe('expanded');
    expect(rowClass('c1', 'c2')).toBe('');
    expect(rowClass(null, 'c1')).toBe('');
    expect(count('className={rowClass(expanded,')).toBe(2);
  });
});
