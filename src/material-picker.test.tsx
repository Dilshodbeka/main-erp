import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MaterialPicker, MaterialPickerPanel } from './components/MaterialPicker';
import type { MaterialGroup } from './order-editor';
import type { Item } from './types';

const item = (id: string, name: string, unit = 'm', patch: Partial<Item> = {}): Item => ({
  id, name, unit, minQty: 0, cost: 0, customerId: null, kind: 'material', salePrice: 0,
  lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: null, ...patch,
});

const groups: MaterialGroup[] = [
  { category: '01.01 · LDSP', items: [item('ldsp', 'KPLA 16 mm', 'list')] },
  { category: '03.01 · Alyuminiy profil', items: [item('alum', 'Alum profil', 'm', { kind: 'blank' })] },
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
    expect(html).toContain('class="material-option selected"');
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
    expect(html).toContain('class="material-option selected"');
  });
});
