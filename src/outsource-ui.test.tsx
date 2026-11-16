import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as AppModule from './App';
import { CatalogSettings } from './components/CatalogSettings';
import { OrderEditor } from './components/OrderEditor';
import { applyCommand, emptyState } from './domain';
import { createDemo } from './seed';
import type { Actor, Command, RouteLine, State, Status } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };
const run = (state: State, command: Command) =>
  applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);

const editorHtml = (state: State, orderId: string) => renderToStaticMarkup(createElement(OrderEditor, {
  state, order: state.orders.find(row => row.id === orderId)!, busy: false,
  close: () => {}, save: async () => {}, createCustomer: async () => null,
}));

type SupplierPayProps = {
  supplierId: string;
  orderId: string | null;
  category: 'supplier' | 'outsourcing';
  defaultNote: string;
  balance: number;
  suggested?: number;
  busy: boolean;
  close: () => void;
  save: (command: Command) => Promise<void>;
};

function renderSupplierPay(props: Partial<SupplierPayProps> = {}): string {
  const Form = (AppModule as unknown as { SupplierPayForm?: ComponentType<SupplierPayProps> }).SupplierPayForm;
  expect(Form).toBeTypeOf('function');
  return renderToStaticMarkup(createElement(Form!, {
    supplierId: 's1', orderId: 'o1', category: 'outsourcing', defaultNote: 'ORD-0042 · Autsors xizmati',
    balance: 200000, busy: false, close: () => {}, save: async () => {}, ...props,
  }));
}

describe('outsourcing UI', () => {
  it('shows the stage cost, not the executor payout, in the operation list', () => {
    const html = renderToStaticMarkup(createElement(CatalogSettings, {
      state: createDemo(admin), busy: false, run: async () => true,
      onAddEmployee: () => {}, onEditEmployee: () => {},
    }));
    expect(html).toContain('tannarx');
    expect(html).not.toContain('ijrochiga');
    expect(html).not.toContain('xodimga');
  });

  it('renders executor kind and contractor picker for an outsourced stage', () => {
    let state = createDemo(admin);
    state = run(state, { type: 'order.create', input: {
      kind: 'service', customerId: state.customers[0].id, title: 'Metall ish', qty: 1,
      price: 1200000, overhead: 0, dueDate: '2026-12-01', materials: [], advance: 0, account: 'cash',
      route: [{ operationId: state.operations[0].id, executorKind: 'supplier', employeeId: null,
        supplierId: state.suppliers[0].id, rate: 0, supplierCost: 600000 }],
    } });
    const html = editorHtml(state, state.orders.at(-1)!.id);
    expect(html).toContain('Ijrochi turi 1');
    expect(html).toContain('<option value="employee">Xodim</option>');
    expect(html).toContain('value="supplier"');
    expect(html).toContain('>Pudratchi</option>');
    expect(html).toContain('Pudratchi 1');
    expect(html).toContain('Pudratchi summasi');
    expect(html).toContain('aria-label="Pudratchi summasi 1"');
    expect(html).toContain('value="600000"');
    expect(html).not.toContain('ijrochiga');
  });

  it('caps an outsourcing payment at the accepted debt', () => {
    const html = renderSupplierPay();
    expect(html).toContain('Qarz');
    expect(html).toContain('max="200000"');
    expect(html).toContain('value="200000"');
    expect(html).toContain('ORD-0042 · Autsors xizmati');
    expect(html).toContain('Avans to‘loviga ruxsat');
  });

  it('drops the cap for an advance without a negative default', () => {
    const html = renderSupplierPay({ balance: -50000 });
    expect(html).toContain('Avans');
    expect(html).not.toMatch(/name="amount"[^>]*max=/);
    expect(html).not.toContain('value="-50000"');
  });

  it('labels a registry payment as a supplier payment', () => {
    const html = renderSupplierPay({ orderId: null, category: 'supplier', defaultNote: 'Metall usta · Xarid to‘lovi' });
    expect(html).toContain('Metall usta · Xarid to‘lovi');
  });

  it('prefills the payment with the stage sum the order carries', () => {
    expect(renderSupplierPay({ suggested: 150000 })).toContain('value="150000"');
    expect(renderSupplierPay({ suggested: 250000 })).toContain('value="200000"');
  });
});

type StageActionsProps = {
  task: RouteLine;
  orderStatus: Status;
  busy: boolean;
  onAccept: () => void;
  onPay: () => void;
};

function renderStageActions(props: Partial<StageActionsProps> & { task: RouteLine }): string {
  const Comp = (AppModule as unknown as { OutsourceStageActions?: ComponentType<StageActionsProps> }).OutsourceStageActions;
  expect(Comp).toBeTypeOf('function');
  return renderToStaticMarkup(createElement(Comp!, {
    orderStatus: 'production', busy: false, onAccept: () => {}, onPay: () => {}, ...props,
  }));
}

const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))![0];

describe('outsourced stage actions', () => {
  it('offers acceptance before the stage is completed', () => {
    const state = createDemo(admin);
    const order = state.orders.find(row => row.title === 'Metall karishlar')!;
    const html = renderStageActions({ task: order.route[0], orderStatus: order.status });
    expect(button(html, 'Ishni qabul qilish')).not.toContain('disabled');
    expect(button(html, 'Pudratchiga to‘lash')).not.toContain('disabled');
  });

  it('blocks accepting a supplier stage whose sum the order does not carry', () => {
    const state = createDemo(admin);
    const task = state.orders.find(row => row.title === 'Metall karishlar')!.route[0];
    const html = renderStageActions({ task: { ...task, rate: 0, supplierCost: 0 } });
    const accept = button(html, 'Ishni qabul qilish');
    expect(accept).toContain('disabled');
    expect(accept).toContain('title="Avval pudratchi summasini kiriting"');
    expect(button(html, 'Pudratchiga to‘lash')).not.toContain('disabled');
  });

  it('blocks acceptance after completion and both actions on a cancelled order', () => {
    const state = createDemo(admin);
    const task = state.orders.find(row => row.title === 'Metall karishlar')!.route[0];
    const done = renderStageActions({ task: { ...task, status: 'completed', completed: task.planned } });
    expect(button(done, 'Ishni qabul qilish')).toContain('disabled');
    const cancelled = renderStageActions({ task, orderStatus: 'cancelled' });
    expect(button(cancelled, 'Ishni qabul qilish')).toContain('disabled');
    expect(button(cancelled, 'Pudratchiga to‘lash')).toContain('disabled');
  });
});
