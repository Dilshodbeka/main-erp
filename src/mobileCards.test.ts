import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pixelValues, phoneRules } from './mobileStyle';

const tableFiles = [
  'App.tsx',
  'health.tsx',
  'components/AccessPanel.tsx',
  'components/BackupPanel.tsx',
  'components/CashAnalytics.tsx',
  'components/CatalogSettings.tsx',
  'components/CustomerCard.tsx',
  'components/Diagnostics.tsx',
  'components/DirectorConsole.tsx',
  'components/ExpensePanel.tsx',
  'components/FinanceReports.tsx',
  'components/FinanceStatements.tsx',
  'components/ItemImport.tsx',
  'components/LoansPanel.tsx',
  'components/OrderHistory.tsx',
  'components/SalaryPanel.tsx',
  'components/SalesAnalytics.tsx',
  'components/WarehouseAnalytics.tsx',
  'components/WarehouseCatalog.tsx',
];

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('phone table cards', () => {
  it('turns rows into labelled cards only in the phone cascade', () => {
    const rules = phoneRules(css).filter(rule => rule.selector.includes('.cardable'));
    expect(rules.some(rule => rule.selector.includes('thead') && rule.body.includes('display:none'))).toBe(true);
    expect(rules.some(rule => rule.selector.includes('tr') && rule.body.includes('display:block'))).toBe(true);
    expect(rules.some(rule => rule.selector.includes('td::before') && rule.body.includes('content:attr(data-label)'))).toBe(true);
  });

  it('keeps card values bigger than raw table cells', () => {
    const cell = phoneRules(css).find(rule => rule.selector.trim().endsWith('.cardable td'));
    expect(cell).toBeDefined();
    expect(Math.max(...pixelValues(cell!.body, 'font-size'))).toBeGreaterThanOrEqual(13);
    const value = phoneRules(css).find(rule => rule.selector.trim().endsWith('.cardable td small'));
    expect(Math.max(...pixelValues(value!.body, 'font-size'))).toBeGreaterThanOrEqual(11);
  });

  for (const file of tableFiles) {
    it(`${file} opts every table in and labels every cell`, () => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      const wrappers = [...source.matchAll(/className="([^"]*table-scroll[^"]*)"/g)].map(match => match[1]);
      expect(wrappers.length).toBeGreaterThan(0);
      expect(wrappers.filter(classes => !classes.split(/\s+/).includes('cardable'))).toEqual([]);
      const unlabelled = [...source.matchAll(/<td\b[^>]*>/g)]
        .map(match => match[0])
        .filter(cell => !cell.includes('data-label='));
      expect(unlabelled).toEqual([]);
    });
  }
});
