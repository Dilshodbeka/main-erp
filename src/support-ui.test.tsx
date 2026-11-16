import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cssRules, phoneRules, pixelValues } from './mobileStyle';
import { GuideFab, GuidePanel } from './components/Guide';
import { SupportList, SupportNew, SupportPanel, SupportQuestions, SupportThread, type SupportProps } from './components/Support';
import type { PageGuide } from './guide';
import { DEMO_COMPANY_ID } from './migrations';
import { supportFaq } from './support-faq';
import type { Actor, Command, SupportTicket } from './types';

const worker: Actor = { id: 'worker-1', name: 'Kamol', role: 'worker', companyId: DEMO_COMPANY_ID };
const admin: Actor = { id: 'owner', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
const display: Actor = { id: 'tv', name: 'TV', role: 'display', companyId: DEMO_COMPANY_ID };

function ticket(id: string, authorId: string, lastRole: 'worker' | 'admin', status: 'open' | 'closed' = 'open', text = 'Savol'): SupportTicket {
  return {
    id, authorId, authorName: authorId === worker.id ? worker.name : 'Xodim', authorRole: 'worker', status,
    createdAt: '2026-11-12T08:00:00.000Z', updatedAt: '2026-11-12T09:00:00.000Z',
    closedAt: status === 'closed' ? '2026-11-12T09:30:00.000Z' : null,
    closedByName: status === 'closed' ? admin.name : null,
    messages: [
      { id: `${id}-m1`, authorId, authorName: 'Xodim', authorRole: 'worker', at: '2026-11-12T08:00:00.000Z', text, context: { page: 'orders', revision: 4, sync: 'offline', pending: 2, build: 'dev', errors: ['Xato [son]'] } },
      { id: `${id}-m2`, authorId: lastRole === 'admin' ? admin.id : authorId, authorName: lastRole === 'admin' ? admin.name : 'Xodim', authorRole: lastRole, at: '2026-11-12T09:00:00.000Z', text: 'Javob', context: null },
    ],
  };
}

const ownUnread = ticket('t-own', worker.id, 'admin');
const foreign = ticket('t-foreign', 'worker-2', 'worker');
const closed = ticket('t-closed', worker.id, 'worker', 'closed');

function props(actor: Actor, tickets: SupportTicket[] = [ownUnread, foreign, closed]): SupportProps {
  return {
    tickets, actor, build: 'dev', page: 'dashboard', revision: 7, sync: 'online', pending: 1,
    errors: ['Xato 1234'], seen: {}, onSeen: () => {}, run: async (_command: Command) => true,
  };
}

const guide = {
  page: 'dashboard', title: 'Umumiy ko‘rinish', purpose: 'Buyurtma bering', outcome: 'Tayyor',
  steps: [],
} as unknown as PageGuide;

describe('Support panel SSR', () => {
  it('renders eight FAQ questions for everyone', () => {
    const html = renderToStaticMarkup(createElement(SupportQuestions, {}));
    expect(supportFaq).toHaveLength(8);
    for (const item of supportFaq) expect(html).toContain(item.question);
  });

  it('hides foreign tickets from a worker and shows the unread marker', () => {
    const html = renderToStaticMarkup(createElement(SupportPanel, { support: props(worker) }));
    expect(html).toContain('Murojaatlar');
    expect(html).toContain('Yangi murojaat');
    expect(html).toContain('t-own');
    expect(html).not.toContain('t-foreign');
    expect(html).toContain('Yangi javob');
  });

  it('shows a worker an answered ticket the owner already closed, without switching filters', () => {
    const html = renderToStaticMarkup(createElement(SupportPanel, {
      support: props(worker, [ticket('t-answered', worker.id, 'admin', 'closed')]),
    }));
    expect(html).toContain('t-answered');
    expect(html).toContain('Yangi javob');
    expect(html).toContain('Hammasi');
  });

  it('defaults the owner list to open tickets and offers all filters', () => {
    const list = renderToStaticMarkup(createElement(SupportList, {
      tickets: [ownUnread, foreign, closed], actor: admin, filter: 'open', seen: {},
      onFilter: () => {}, onOpen: () => {}, onCreate: () => {},
    }));
    expect(list).toContain('Barcha murojaatlar');
    expect(list).toContain('Ochiq');
    expect(list).toContain('Yopilgan');
    expect(list).toContain('Hammasi');
    expect(list).toContain('t-own');
    expect(list).toContain('t-foreign');
    expect(list).not.toContain('t-closed');
  });

  it('shows an empty worker list with the approved copy', () => {
    const html = renderToStaticMarkup(createElement(SupportPanel, { support: { ...props(worker), tickets: [] } }));
    expect(html).toContain('Hozircha murojaatlar yo‘q. Muammo bo‘lsa, «Yangi murojaat» orqali yozing.');
  });

  it('renders an open thread with diagnostics and the owner close button', () => {
    const html = renderToStaticMarkup(createElement(SupportThread, {
      ticket: ownUnread, actor: admin, onBack: () => {}, run: async () => true,
    }));
    expect(html).toContain('Diagnostika');
    expect(html).not.toContain('support-context-compose');
    expect(html).toContain('Xato [son]');
    expect(html).toContain('Javob yozing…');
    expect(html).toContain('>Yopish<');
    expect(html).not.toContain('Murojaat yopilgan.');
  });

  it('renders the closed note and reopen hint without the close button', () => {
    const html = renderToStaticMarkup(createElement(SupportThread, {
      ticket: { ...ownUnread, status: 'closed', closedAt: '2026-11-12T09:30:00.000Z', closedByName: admin.name },
      actor: admin, onBack: () => {}, run: async () => true,
    }));
    expect(html).toContain('Yopilgan: Egasi');
    expect(html).toContain('Murojaat yopilgan. Javob yozsangiz, u qayta ochiladi.');
    expect(html).not.toContain('>Yopish<');
  });

  it('never offers close to a worker', () => {
    const html = renderToStaticMarkup(createElement(SupportThread, {
      ticket: ownUnread, actor: worker, onBack: () => {}, run: async () => true,
    }));
    expect(html).not.toContain('>Yopish<');
  });

  it('keeps the display screen read-only', () => {
    const html = renderToStaticMarkup(createElement(SupportPanel, { support: props(display) }));
    expect(html).toContain('Bu ekranda murojaat yuborish o‘chirilgan.');
    expect(html).not.toContain('support-compose');
  });

  it('offers a fresh ticket the auto-collected diagnostics without raw numbers', () => {
    const html = renderToStaticMarkup(createElement(SupportNew, {
      support: props(worker), onCancel: () => {}, onCreated: () => {},
    }));
    expect(html).toContain('Yangi murojaat');
    expect(html).toContain('Muammoni yozing');
    expect(html).toContain('Avtomatik ma’lumot');
    expect(html).toContain('support-context-compose');
    expect(html).toContain('>dashboard<');
    expect(html).toContain('>Onlayn<');
    expect(html).toContain('Xato [son]');
    expect(html).not.toContain('1234');
    expect(html).toContain('>Yuborish<');
    expect(html).toContain('>Bekor qilish<');
  });

  it('defaults the owner panel to open tickets while a worker still sees closed ones', () => {
    const ownerView = renderToStaticMarkup(createElement(SupportPanel, { support: props(admin, [ownUnread, closed]) }));
    expect(ownerView).toContain('t-own');
    expect(ownerView).not.toContain('t-closed');

    const allTickets = renderToStaticMarkup(createElement(SupportList, {
      tickets: [ownUnread, closed], actor: admin, filter: 'all', seen: {},
      onFilter: () => {}, onOpen: () => {}, onCreate: () => {},
    }));
    expect(allTickets).toContain('t-closed');

    const workerView = renderToStaticMarkup(createElement(SupportPanel, { support: props(worker, [ownUnread, closed]) }));
    expect(workerView).toContain('t-closed');
  });
});

describe('Guide integration SSR', () => {
  it('keeps two tabs without support', () => {
    const html = renderToStaticMarkup(createElement(GuidePanel, { guide, onAction: () => {}, close: () => {} }));
    expect(html).toContain('Qadamlar');
    expect(html).toContain('Qo‘llanma');
    expect(html).not.toContain('Murojaat');
  });

  it('adds the third tab with an alert badge', () => {
    const html = renderToStaticMarkup(createElement(GuidePanel, {
      guide, onAction: () => {}, close: () => {}, support: props(worker),
    }));
    expect(html).toContain('Murojaat');
    expect(html).toContain('guide-tab-badge');
  });

  it('marks the assistant button with an alert dot', () => {
    const lit = renderToStaticMarkup(createElement(GuideFab, { remaining: 0, alert: true, onClick: () => {} }));
    expect(lit).toContain('guide-dot');
    const quiet = renderToStaticMarkup(createElement(GuideFab, { remaining: 0, onClick: () => {} }));
    expect(quiet).not.toContain('guide-dot');
  });
});

describe('assistant button placement', () => {
  const fab = [...cssRules(readFileSync(new URL('./styles.css', import.meta.url), 'utf8'))]
    .filter(rule => rule.media === '' && rule.selector === '.guide-fab')
    .at(-1);

  it('keeps the button floating above the page', () => {
    expect(fab?.body).toContain('position:fixed');
  });
});

describe('phone tap targets', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const chip = phoneRules(css).filter(rule => rule.selector === '.support-chip').at(-1);
  const question = phoneRules(css).filter(rule => rule.selector === '.support-faq summary').at(-1);

  it('raises filter chips to 44px inside the existing phone breakpoint', () => {
    expect(pixelValues(chip?.body ?? '', 'min-height').at(-1)).toBeGreaterThanOrEqual(44);
    expect(chip?.media).toBe('@media(max-width:700px)');
  });

  it('raises FAQ questions to a 44px tap zone', () => {
    expect(pixelValues(question?.body ?? '', 'min-height').at(-1)).toBeGreaterThanOrEqual(44);
    expect(question?.media).toBe('@media(max-width:700px)');
  });

  it('raises the new-ticket diagnostics toggle but leaves the in-thread one compact', () => {
    const compose = phoneRules(css).filter(rule => rule.selector === '.support-context-compose summary').at(-1);
    const thread = cssRules(css).filter(rule => rule.media === '' && rule.selector === '.support-context summary').at(-1);
    expect(pixelValues(compose?.body ?? '', 'min-height').at(-1)).toBeGreaterThanOrEqual(44);
    expect(compose?.media).toBe('@media(max-width:700px)');
    expect(pixelValues(thread?.body ?? '', 'min-height')).toEqual([24]);
  });
});

describe('App support wiring', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

  it('passes clamped, actor-filtered support props with the seen callback', () => {
    expect(app).toContain('Math.min(PENDING_MAX, sync.pending.length)');
    expect(app).toContain('onSeen: markSeen');
    expect(app).toContain('visibleTickets(state.tickets, actor)');
    expect(app).toContain('alert={supportAlertCount > 0}');
    expect(app).toContain('seen: supportSeen');
  });

  it('attaches the newest diagnostics, not the oldest kept ones', () => {
    expect(app).toContain('listDiagnostics(localStorage).slice(0, ERRORS_MAX)');
  });
});
