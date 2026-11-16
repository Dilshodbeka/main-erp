import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './domain';
import { translateError } from './i18n';
import { DEMO_COMPANY_ID } from './migrations';
import { createDemo } from './seed';
import { OperationRateEditor } from './components/QuickEditors';
import { TaskActionButton } from './components/TaskActionButton';
import { DefectJournal } from './components/DefectJournal';
import { WorkReview } from './components/WorkReview';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

// «Mijozning 8 fasadini bo‘yash» — производство с planned 8 и выданными материалами; сид уже принял первый этап.
function submitted() {
  let state = createDemo(admin);
  for (const operation of state.operations) operation.autoAccept = false;
  const orderId = state.orders.find(row => row.title === 'Mijozning 8 fasadini bo‘yash')!.id;
  const taskId = state.orders.find(row => row.id === orderId)!.route[0].id;
  state = run(state, { type: 'work.start', orderId, taskId });
  state = run(state, { type: 'work.submit', orderId, taskId, qty: 3, note: '' });
  const order = state.orders.find(row => row.id === orderId)!;
  return { state, order, task: order.route[0] };
}

describe('owner review UI', () => {
  it('ships painting operations with owner acceptance on', () => {
    const state = createDemo(admin);
    expect(state.operations.find(row => row.name === 'Jilolash')).toMatchObject({ autoAccept: false });
    expect(state.operations.find(row => row.name === 'Bo‘yash')).toMatchObject({ autoAccept: false });
  });

  it('turns the submitted stage into an active accept button', () => {
    const { task } = submitted();
    const html = renderToStaticMarkup(createElement(TaskActionButton, {
      task, busy: false, available: false, onReview: () => {}, onSubmit: () => {},
    }));
    expect(html).toContain('<button class="primary">Qabul qilish</button>');
    expect(html).not.toContain('disabled');
  });

  it('renders the review modal with defect fields and facts', () => {
    const { state, order, task } = submitted();
    const html = renderToStaticMarkup(createElement(WorkReview, {
      state, orderId: order.id, taskId: task.id, busy: false, close: () => {}, save: async () => {},
    }));
    expect(html).toContain(`Qabul — ${task.name} · ${order.number}`);
    for (const label of [
      'Topshirilgan', 'Qolgan', 'Birlik tannarxi', 'Qabulda tannarxga tushadi', 'Brakda sarflangan material',
      'Brak miqdori', 'Brak sababi', 'Sifat nuqsoni', 'Boshqa', 'Qabul qilish',
    ]) expect(html).toContain(label);
  });

  it('renders the manual acceptance switch for an operation', () => {
    const { state } = submitted();
    const jilolash = state.operations.find(row => row.name === 'Jilolash')!;
    const manual = renderToStaticMarkup(createElement(OperationRateEditor, {
      operation: jilolash, items: state.items, busy: false, close: () => {}, save: async () => {},
    }));
    expect(manual).toContain('Natijani egasi qabul qiladi');
    expect(manual).toContain('checked=""');
    const automatic = renderToStaticMarkup(createElement(OperationRateEditor, {
      operation: { ...jilolash, autoAccept: true }, items: state.items, busy: false, close: () => {}, save: async () => {},
    }));
    expect(automatic).not.toContain('checked');
  });

  it('translates the new defect errors', () => {
    expect(translateError('Defect reason is required')).toBe('Brak sababini tanlang.');
    expect(translateError('Review must be plain')).toBe('Qabul qilishda brak maydonlari bo‘lishi mumkin emas.');
    expect(translateError('Nothing to reject')).toBe('Brak miqdori nolga teng bo‘lishi mumkin emas.');
  });
});

describe('defect journal', () => {
  function paintingRejected() {
    let state = createDemo(admin);
    const order = state.orders.find(row => row.title === 'Fasadlarni bo‘yash · 12 m²')!;
    const task = order.route[0];
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = run(state, { type: 'order.issue', orderId: order.id });
    state = run(state, { type: 'work.accept', orderId: order.id, taskId: task.id });
    state = run(state, { type: 'work.start', orderId: order.id, taskId: task.id });
    state = run(state, { type: 'work.submit', orderId: order.id, taskId: task.id, qty: 12, note: '' });
    const report = state.reports.find(row => row.taskId === task.id && row.status === 'submitted')!;
    state = run(state, { type: 'work.review', reportId: report.id, accept: false, defectQty: 3, reason: 'quality' });
    return { state, order };
  }

  it('renders the defect journal row and totals', () => {
    const { state, order } = paintingRejected();
    const html = renderToStaticMarkup(createElement(DefectJournal, { state }));
    for (const text of [
      'Brak tarixi', order.number, 'Jilolash', 'Sex ustasi', '3 m²', 'Sifat nuqsoni',
      'Abraziv doira P120', 'Brak (m²)', 'Material qiymati', 'Eng ko‘p brak',
    ]) expect(html).toContain(text);
  });
});
