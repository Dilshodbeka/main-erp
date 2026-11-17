import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { MAIN_WAREHOUSE_ID } from './warehouse-default';
import { WarehouseSelect } from './components/WarehousePicker';
import { WarehouseSettings } from './components/WarehouseSettings';

const workshop = { id: 'w2', name: 'Sex ombori', active: true };

describe('warehouse selector visibility', () => {
  it('stays hidden while the company has a single warehouse', () => {
    const html = renderToStaticMarkup(createElement(WarehouseSelect, {
      warehouses: emptyState().warehouses, value: MAIN_WAREHOUSE_ID, onChange: () => {},
    }));
    expect(html).toBe('');
  });

  it('lists every active shelf once a second one exists', () => {
    const html = renderToStaticMarkup(createElement(WarehouseSelect, {
      warehouses: [...emptyState().warehouses, workshop], value: MAIN_WAREHOUSE_ID, onChange: () => {}, label: 'Qaysi ombordan',
    }));
    expect(html).toContain('Qaysi ombordan');
    expect(html).toContain('Asosiy ombor');
    expect(html).toContain('Sex ombori');
  });
});

describe('warehouse settings panel', () => {
  it('offers rename, deactivate and create', () => {
    const state = { ...emptyState(), warehouses: [...emptyState().warehouses, workshop] };
    const html = renderToStaticMarkup(createElement(WarehouseSettings, { state, busy: false, run: async () => true }));
    expect(html).toContain('Ombor qo‘shish');
    expect(html).toContain('Sex ombori');
    expect(html).toContain('Faol');
  });
});
