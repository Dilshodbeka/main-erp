import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID } from './migrations';
import { OrderChat } from './components/OrderChat';
import type { Actor } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };

const render = (actor: Actor, customerId: string | null = null) => renderToStaticMarkup(createElement(OrderChat, {
  actor, orderId: 'order-1', customerId, customerName: customerId ? 'Mijoz' : null,
  refreshKey: 0, onChanged: () => {},
}));

describe('Order chat UI', () => {
  it('names the room participants and the composer', () => {
    const html = render(admin);
    expect(html).toContain('BUYURTMA CHATI');
    expect(html).toContain('Menejer');
    expect(html).toContain('Ispolateli');
    expect(html).toContain('Klient');
    expect(html).toContain('Xabar yozing');
  });

  it('tells the owner when a message goes through Telegram', () => {
    expect(render(admin, 'c-1')).toContain('Telegrami ulangan bo‘lsa');
    expect(render(admin, null)).toContain('ishtirokchilariga');
  });
});
