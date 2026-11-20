import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperationSelect } from './components/OperationSelect';
import { money } from './ui';
import type { Machine, Operation } from './types';

const op = (id: string, name: string, machineId: string | null, salePrice = 0): Operation => ({
  id, name, unit: 'piece', salePrice, workerRate: 0,
  standardMinutes: 0, machineId, employeeIds: [], active: true, autoAccept: true, norms: [],
});

const machines: Machine[] = [
  { id: 'm2', name: 'Kromka', hourlyRevenueTarget: 0, active: true },
  { id: 'm1', name: 'Nesting', hourlyRevenueTarget: 0, active: true },
];

const operations: Operation[] = [
  op('o1', 'Kesish', 'm1', 45_000),
  op('o2', 'Aktar', 'm1', 12_000),
  op('o3', 'Kromka yopishtrish', 'm2'),
  op('o4', 'Yig’ish', null),
];

const render = (props: Partial<Parameters<typeof OperationSelect>[0]> = {}) => renderToStaticMarkup(createElement(OperationSelect, {
  operations, machines, value: '', onChange: () => {}, ariaLabel: 'Amal 1', ...props,
}));

describe('OperationSelect', () => {
  it('keeps the placeholder as the first option', () => {
    const html = render();
    expect(html.startsWith('<select')).toBe(true);
    expect(html.indexOf('Bosqichni tanlang')).toBeLessThan(html.indexOf('<optgroup'));
  });

  it('renders one optgroup per machine, unassigned first, with the group count', () => {
    const html = render();
    expect(html).toContain('<optgroup label="Dastgohsiz · 1 ta">');
    expect(html).toContain('<optgroup label="Kromka · 1 ta">');
    expect(html).toContain('<optgroup label="Nesting · 2 ta">');
    expect(html.match(/<optgroup/g)).toHaveLength(3);
    expect(html.indexOf('Dastgohsiz · 1 ta')).toBeLessThan(html.indexOf('Kromka · 1 ta'));
    expect(html.indexOf('Kromka · 1 ta')).toBeLessThan(html.indexOf('Nesting · 2 ta'));
  });

  it('sorts the operations alphabetically inside each group', () => {
    const html = render();
    expect(html.indexOf('value="o2"')).toBeLessThan(html.indexOf('value="o1"'));
  });

  it('shows the sale price only when the caller asks for it', () => {
    expect(render({ withPrice: true })).toContain(`Aktar · ${money(12_000)}`);
    expect(render()).toContain('>Aktar<');
  });

  it('renders every operation exactly once', () => {
    const html = render();
    for (const row of operations) expect(html.match(new RegExp(`value="${row.id}"`, 'g'))).toHaveLength(1);
  });
});
