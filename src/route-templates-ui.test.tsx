import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { createDemo } from './seed';
import { RouteTemplates } from './components/RouteTemplates';
import { OrderEditor } from './components/OrderEditor';
import type { Actor, Command, Order, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };
const run = (state: State, command: Command) =>
  applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);

describe('route templates catalog', () => {
  it('renders name, kind and stage count', () => {
    let state = createDemo(admin);
    state = run(state, { type: 'routeTemplate.create', name: 'Sinov xizmati', kind: 'service', stages: [{ operationId: state.operations[3].id }, { operationId: state.operations[4].id }] });
    const html = renderToStaticMarkup(createElement(RouteTemplates, { state, busy: false, run: async () => true }));
    expect(html).toContain('Marshrut shablonlari');
    expect(html).toContain('Yangi shablon');
    expect(html).toContain('Sinov xizmati');
    expect(html).toContain('Xizmat');
    expect(html).toContain('2 bosqich');
  });
});

const editorHtml = (state: State, orderId: string) => renderToStaticMarkup(createElement(OrderEditor, {
  state, order: state.orders.find(row => row.id === orderId)!, busy: false,
  close: () => {}, save: async () => {}, createCustomer: async () => null,
}));

describe('order editor templates', () => {
  it('offers only templates matching the position kind', () => {
    let state = createDemo(admin);
    state = run(state, { type: 'routeTemplate.create', name: 'Sinov xizmat', kind: 'service', stages: [{ operationId: state.operations[3].id }] });
    state = run(state, { type: 'routeTemplate.create', name: 'Sinov mahsulot', kind: 'product', stages: [{ operationId: state.operations[0].id }] });
    const order = state.orders.find(row => row.title === 'Mijozning 8 fasadini bo‘yash') as Order;
    const html = editorHtml(state, order.id);
    expect(html).toContain('Sinov xizmat');
    expect(html).not.toContain('Sinov mahsulot');
  });
});