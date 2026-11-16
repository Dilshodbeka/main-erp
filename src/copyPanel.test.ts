import { describe, expect, it } from 'vitest';
import { ageText, copyBanner, isConfirmed, previewRows } from './copyPanel';

const NOW = '2026-11-04T12:00:00.000Z';
const meta = (exportedAt: string) => ({ key: `companies/c/${exportedAt}.json`, exportedAt, revision: 7, bytes: 74_000 });

describe('copy panel age text', () => {
  it('names hours, days and months', () => {
    expect(ageText('2026-11-04T07:00:00.000Z', NOW)).toBe('5 soat oldin');
    expect(ageText('2026-11-01T12:00:00.000Z', NOW)).toBe('3 kun oldin');
    expect(ageText('2026-09-04T12:00:00.000Z', NOW)).toBe('2 oy oldin');
  });

  it('says the time is unknown instead of a negative age', () => {
    expect(ageText('2026-11-05T12:00:00.000Z', NOW)).toBe('vaqti noma’lum');
    expect(ageText('', NOW)).toBe('vaqti noma’lum');
  });
});

describe('copy panel banner', () => {
  it('warns when the cloud holds no copy yet', () => {
    const banner = copyBanner(null, NOW);
    expect(banner.tone).toBe('warn');
    expect(banner.text).toMatch(/hali nusxa yo‘q/i);
  });

  it('shows an ok banner with the age while the copy is fresh', () => {
    const banner = copyBanner(meta('2026-11-04T07:00:00.000Z'), NOW);
    expect(banner.tone).toBe('ok');
    expect(banner.text).toContain('5 soat oldin');
  });

  it('warns once the copy is older than the freshness window', () => {
    const banner = copyBanner(meta('2026-11-02T12:00:00.000Z'), NOW);
    expect(banner.tone).toBe('warn');
    expect(banner.text).toContain('2 kun oldin');
    expect(banner.text).toContain('36');
  });

  it('uses uzbek words, not cyrillic', () => {
    expect(copyBanner(meta('2026-11-04T07:00:00.000Z'), NOW).text).not.match(/[\u0400-\u04FF]/);
  });
});

describe('copy panel restore gate', () => {
  it('accepts only the exact typed confirmation word', () => {
    expect(isConfirmed('TIKLASH')).toBe(true);
    expect(isConfirmed(' TIKLASH ')).toBe(true);
    expect(isConfirmed('tiklash')).toBe(false);
    expect(isConfirmed('')).toBe(false);
  });
});

describe('copy panel sandbox preview', () => {
  it('lists non-empty tables alphabetically with their row counts', () => {
    const rows = previewRows({ erp_orders: 2, erp_customers: 5, erp_audit: 0 });
    expect(rows).toEqual([
      { table: 'erp_customers', rows: 5 },
      { table: 'erp_orders', rows: 2 },
    ]);
  });

  it('totals the rows a restore would write', () => {
    expect(previewRows({ erp_orders: 2, erp_customers: 5, erp_audit: 0 }).reduce((sum, row) => sum + row.rows, 0)).toBe(7);
  });
});
