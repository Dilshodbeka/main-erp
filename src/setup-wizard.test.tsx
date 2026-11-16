import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { nextDemoCommand } from './setup';
import { SetupWizard } from './components/SetupWizard';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'setup-admin', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
let seq = 0;
const run = (state: State, command: Command) =>
  applyCommand(state, { requestId: `wizard-${++seq}`, expectedRevision: state.revision, command }, admin);

function completed(): State {
  let state = emptyState();
  for (let i = 0; i < 32; i++) {
    const command = nextDemoCommand('order', state);
    if (!command) return state;
    state = run(state, command);
  }
  throw new Error('Demo seed did not settle');
}

const render = (state: State, overrides: { busy?: boolean; online?: boolean } = {}) => renderToStaticMarkup(createElement(SetupWizard, {
  state, busy: false, online: true, close: () => {}, runDemo: async () => true, manual: () => {}, ...overrides,
}));

describe('SetupWizard', () => {
  it('renders four pending steps with both choices and zero progress', () => {
    const html = render(emptyState());
    expect(html).toContain('Boshlang‘ich sozlash');
    expect(html).toContain('0 / 4 qadam tayyor');
    for (const title of ['Xodimlar', 'Materiallar', 'Operatsiyalar', 'Birinchi buyurtma']) expect(html).toContain(title);
    expect(html.match(/Qo‘lda kiritish/g)).toHaveLength(4);
    expect(html.match(/Demodan olish/g)).toHaveLength(4);
    expect(html).not.toContain('Tayyor');
    expect(html).not.toContain('Oflayn rejimda demo yuklanmaydi');
    expect(html).toContain('Yopish');
  });

  it('marks completed steps and hides demo buttons', () => {
    const html = render(completed());
    expect(html).toContain('4 / 4 qadam tayyor');
    expect(html.match(/>Tayyor</g)).toHaveLength(4);
    expect(html).not.toContain('Demodan olish');
    expect(html).not.toContain('Qo‘lda kiritish');
  });

  it('disables every demo loader offline and explains why', () => {
    const html = render(emptyState(), { online: false });
    expect(html).toContain('Oflayn rejimda demo yuklanmaydi');
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });

  it('disables all step buttons while busy', () => {
    const html = render(emptyState(), { busy: true });
    expect(html.match(/disabled=""/g)).toHaveLength(8);
  });
});
