import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { money } from './ui';
import { MaterialPicker, MaterialPickerPanel } from './components/MaterialPicker';
import type { MaterialGroup } from './order-editor';
import type { Item } from './types';

const item = (id: string, name: string, unit = 'm', patch: Partial<Item> = {}): Item => ({
  id, name, unit, minQty: 0, cost: 0, customerId: null, kind: 'material', salePrice: 0,
  lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: null, ...patch,
});

const groups: MaterialGroup[] = [
  { category: '01.01 · LDSP', items: [item('ldsp', 'KPLA 16 mm', 'list', { cost: 120_000 })] },
  { category: '03.01 · Alyuminiy profil', items: [item('alum', 'Alum profil', 'm', { kind: 'blank', cost: 5_000 })] },
  { category: '02.01 · MDF', items: [item('mijoz', 'Mijoz LKDSP', 'list', { cost: 90_000, customerId: 'c1' })] },
];

const stockHint = (row: Item) => `erkin 18 ${row.unit}${row.kind === 'blank' ? ' · zagotovka' : ''}`;

describe('MaterialPicker', () => {
  it('shows the chosen material with its stock hint and keeps the panel closed', () => {
    const html = renderToStaticMarkup(createElement(MaterialPicker, {
      groups, value: 'alum', label: 'Material 1', describe: stockHint, onChange: () => {},
    }));
    expect(html).toContain('Alum profil');
    expect(html).toContain('erkin 18 m · zagotovka');
    expect(html).toContain('O‘zgartirish');
    expect(html).not.toContain('Material qidiruvi');
  });

  it('invites to search when nothing is chosen yet', () => {
    const html = renderToStaticMarkup(createElement(MaterialPicker, {
      groups, value: '', label: 'Material 1', describe: stockHint, onChange: () => {},
    }));
    expect(html).toContain('Materialni tanlang');
    expect(html).toContain('Nom bo‘yicha qidirish mumkin');
  });

  it('renders a locked value without opening a picker', () => {
    const html = renderToStaticMarkup(createElement(MaterialPicker, {
      groups, value: 'ldsp', label: 'Material 2', describe: stockHint, disabled: true, onChange: () => {},
    }));
    expect(html).toContain('class="material-picker-static"');
    expect(html).toContain('KPLA 16 mm');
    expect(html).not.toContain('aria-expanded');
  });

  it('groups the panel rows, counts them and marks the chosen one', () => {
    const html = renderToStaticMarkup(createElement(MaterialPickerPanel, {
      groups, value: 'alum', query: '', describe: stockHint, onQuery: () => {}, onPick: () => {},
    }));
    expect(html).toContain('01.01 · LDSP');
    expect(html).toContain('03.01 · Alyuminiy profil');
    expect(html).toContain('class="material-row selected"');
    expect(html).toContain('KPLA 16 mm');
  });

  it('filters the panel by the typed query and explains an empty result', () => {
    const html = renderToStaticMarkup(createElement(MaterialPickerPanel, {
      groups, value: '', query: 'alum', describe: stockHint, onQuery: () => {}, onPick: () => {},
    }));
    expect(html).toContain('Alum profil');
    expect(html).not.toContain('KPLA 16 mm');
    const empty = renderToStaticMarkup(createElement(MaterialPickerPanel, {
      groups, value: '', query: 'beton', describe: stockHint, onQuery: () => {}, onPick: () => {},
    }));
    expect(empty).toContain('Hech narsa topilmadi');
  });

  it('offers an explicit empty choice when the caller allows one', () => {
    const html = renderToStaticMarkup(createElement(MaterialPickerPanel, {
      groups, value: '', query: '', describe: stockHint, clearLabel: 'Asosiy materialsiz', onQuery: () => {}, onPick: () => {},
    }));
    expect(html).toContain('Asosiy materialsiz');
    expect(html).toContain('class="material-row selected"');
  });

  it('renders the panel as a cardable table with a price column', () => {
    const html = renderToStaticMarkup(createElement(MaterialPickerPanel, {
      groups, value: '', query: '', describe: stockHint, onQuery: () => {}, onPick: () => {},
    }));
    expect(html).toContain('table-scroll cardable');
    expect(html).toContain('<table class="material-table"');
    expect(html).toContain('>Tannarx</th>');
    expect(html).not.toContain('>Summa</th>');
    expect(html).toContain(`<td data-label="Tannarx" class="right">${money(120_000)}</td>`);
    expect(html).toContain('<td data-label="Holati">erkin 18 m · zagotovka</td>');
  });

  it('adds a Summa column that multiplies the price by the row quantity', () => {
    const html = renderToStaticMarkup(createElement(MaterialPickerPanel, {
      groups, value: '', query: '', describe: stockHint, qty: 3, onQuery: () => {}, onPick: () => {},
    }));
    expect(html).toContain('>Summa</th>');
    expect(html).toContain(`<td data-label="Summa" class="right">${money(360_000)}</td>`);
    expect(html).toContain(`<td data-label="Summa" class="right">${money(15_000)}</td>`);
    expect(html).toContain(`<td data-label="Summa" class="right">${money(0)}</td>`);
  });

  it('shows the row sum next to the chosen material in the closed button', () => {
    const html = renderToStaticMarkup(createElement(MaterialPicker, {
      groups, value: 'ldsp', label: 'Material 1', describe: stockHint, qty: 3, onChange: () => {},
    }));
    expect(html).toContain('erkin 18 list');
    expect(html).toContain(`summa ${money(360_000)}`);
  });
});
