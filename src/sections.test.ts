import { describe, expect, it } from 'vitest';
import { defaultPanel, normalizeRoute, panelsFor, parseHash, routeHash } from './sections';

describe('section panels', () => {
  it('splits sales into orders and customers panels', () => {
    expect(panelsFor('orders', true).map(panel => panel.id)).toEqual(['buyurtmalar', 'mijozlar']);
  });

  it('gives a worker no salary panels', () => {
    expect(panelsFor('people', false)).toEqual([]);
  });

  it('offers the salary balance panel to the director only', () => {
    expect(panelsFor('people', true).map(panel => panel.id)).toEqual(['xodimlar', 'stavkalar', 'oylik', 'davomat']);
    expect(panelsFor('people', false)).toEqual([]);
  });

  it('adds the monthly expense panel to the cash section', () => {
    expect(panelsFor('cash', true).map(panel => panel.id)).toContain('xarajatlar');
    expect(defaultPanel('cash', true)).toBe('kassa');
  });

  it('adds the director console panel to the cash section', () => {
    expect(panelsFor('cash', true).map(panel => panel.id)).toContain('pult');
    expect(defaultPanel('cash', true)).toBe('kassa');
  });

  it('returns no panels for single-page sections', () => {
    expect(panelsFor('dashboard', true)).toEqual([]);
    expect(panelsFor('logistics', true)).toEqual([]);
  });

  it('uses the first panel as the section default', () => {
    expect(defaultPanel('warehouse', true)).toBe('tasniflagich');
    expect(defaultPanel('dashboard', true)).toBe('');
    expect(defaultPanel('people', false)).toBe('');
  });

  it('adds the defect journal panel for the director only', () => {
    expect(panelsFor('production', true).map(panel => panel.id)).toEqual(['doska', 'brak']);
    expect(defaultPanel('production', true)).toBe('doska');
    expect(panelsFor('production', false)).toEqual([]);
    expect(defaultPanel('production', false)).toBe('');
  });
});

describe('hash routes', () => {
  it('parses a section with a panel', () => {
    expect(parseHash('#/warehouse/qoldiqlar')).toEqual({ section: 'warehouse', panel: 'qoldiqlar' });
  });

  it('parses a section without a panel', () => {
    expect(parseHash('#/warehouse')).toEqual({ section: 'warehouse', panel: '' });
  });

  it('ignores empty hashes', () => {
    expect(parseHash('')).toBeNull();
    expect(parseHash('#')).toBeNull();
    expect(parseHash('#/')).toBeNull();
  });

  it('builds shareable hashes', () => {
    expect(routeHash({ section: 'cash', panel: 'hisobotlar' })).toBe('#/cash/hisobotlar');
    expect(routeHash({ section: 'dashboard', panel: '' })).toBe('#/dashboard');
  });

  it('builds the director console hash', () => {
    expect(routeHash({ section: 'cash', panel: 'pult' })).toBe('#/cash/pult');
  });
});

describe('route normalization', () => {
  it('falls back to the first allowed section for a foreign hash', () => {
    expect(normalizeRoute({ section: 'settings', panel: 'baza' }, ['production'], false)).toEqual({ section: 'production', panel: '' });
  });

  it('falls back to the default section when the hash is empty', () => {
    expect(normalizeRoute(null, ['dashboard', 'orders'], true)).toEqual({ section: 'dashboard', panel: '' });
  });

  it('repairs an unknown panel inside a known section', () => {
    expect(normalizeRoute({ section: 'orders', panel: 'nope' }, ['orders'], true)).toEqual({ section: 'orders', panel: 'buyurtmalar' });
  });

  it('keeps an allowed route untouched', () => {
    expect(normalizeRoute({ section: 'people', panel: 'stavkalar' }, ['people'], true)).toEqual({ section: 'people', panel: 'stavkalar' });
  });

  it('drops a panel that the role cannot see', () => {
    expect(normalizeRoute({ section: 'people', panel: 'stavkalar' }, ['people'], false)).toEqual({ section: 'people', panel: '' });
  });

  it('moves a worker off a stale salary hash back to production', () => {
    expect(normalizeRoute({ section: 'people', panel: 'mening-hisobim' }, ['production'], false)).toEqual({ section: 'production', panel: '' });
  });
});
