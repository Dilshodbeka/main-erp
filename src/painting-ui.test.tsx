import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OperationRateEditor } from './components/QuickEditors';
import type { Item, Operation } from './types';

const items: Item[] = [{
  id: 'paint', name: 'Bo‘yoq', unit: 'litr', minQty: 0, cost: 100, customerId: null,
  kind: 'material', salePrice: 0, lastPurchasePrice: 0, materialCost: 100, laborCost: 0, category: '06.01',
}];

function render(operation: Operation): string {
  return renderToStaticMarkup(createElement(OperationRateEditor, {
    operation, items, busy: false, close: () => {}, save: async () => {},
  }));
}

const squareMeter: Operation = {
  id: 'op', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0,
  machineId: null, employeeIds: ['e1'], active: true, autoAccept: true,
  norms: [{ itemId: 'paint', qtyPerM2: 0.2 }],
};

describe('operation norms editor', () => {
  it('shows the norms section for a squareMeter operation', () => {
    const html = render(squareMeter);
    expect(html).toContain('Norma');
    expect(html).toContain('value="0.2"');
    expect(html).toContain('Bo‘yoq');
  });
  it('hides the norms section for a piece operation', () => {
    const html = render({ ...squareMeter, unit: 'piece', norms: [] });
    expect(html).not.toContain('1 m² uchun norma');
  });
});