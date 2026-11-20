import { describe, expect, it } from 'vitest';
import {
  ORDER_MESSAGE_LIMIT,
  demoOrderIncoming,
  demoOrderMarkRead,
  demoOrderMessages,
  demoOrderOverview,
  demoOrderSend,
  emptyOrderChat,
  mapOrderMessageRow,
  orderAuthorLabel,
} from './order-chat';

const now = new Date('2026-11-20T09:00:00.000Z');
const counter = () => { let n = 0; return () => `m-${++n}`; };
const admin = { id: 'p-admin', name: 'Egasi', kind: 'admin' as const };
const worker = { id: 'p-worker', name: 'Usta', kind: 'worker' as const };

describe('order chat demo model', () => {
  it('stores a sent message with its author and trims the text', () => {
    const chat = demoOrderSend(emptyOrderChat(), 'o1', admin, '  Eshik tayyor  ', { now, id: counter() });
    expect(demoOrderMessages(chat, 'o1')).toEqual([{
      id: 'm-1', orderId: 'o1', authorKind: 'admin', authorProfileId: 'p-admin',
      authorName: 'Egasi', text: 'Eshik tayyor', channel: 'app',
      createdAt: '2026-11-20T09:00:00.000Z',
    }]);
  });

  it('rejects empty and oversized messages', () => {
    expect(() => demoOrderSend(emptyOrderChat(), 'o1', admin, '   ', { now, id: counter() })).toThrow();
    expect(() => demoOrderSend(emptyOrderChat(), 'o1', admin, 'x'.repeat(ORDER_MESSAGE_LIMIT + 1), { now, id: counter() })).toThrow();
  });

  it('keeps messages of different orders apart and sorts by time', () => {
    let chat = demoOrderSend(emptyOrderChat(), 'o1', admin, 'birinchi', { now, id: counter() });
    chat = demoOrderSend(chat, 'o2', admin, 'boshqa', { now, id: counter() });
    chat = demoOrderSend(chat, 'o1', worker, 'ikkinchi', { now: new Date('2026-11-20T10:00:00.000Z'), id: counter() });
    expect(demoOrderMessages(chat, 'o1').map(row => row.text)).toEqual(['birinchi', 'ikkinchi']);
    expect(demoOrderMessages(chat, 'o2').map(row => row.text)).toEqual(['boshqa']);
  });

  it('counts only other people’s new messages and resets on mark read', () => {
    let chat = demoOrderSend(emptyOrderChat(), 'o1', admin, 'o‘zim', { now, id: counter() });
    chat = demoOrderIncoming(chat, 'o1', 'Mijoz', 'Salom', { now: new Date('2026-11-20T09:05:00.000Z'), id: counter() });
    chat = demoOrderSend(chat, 'o2', worker, 'usta xabari', { now: new Date('2026-11-20T09:06:00.000Z'), id: counter() });
    expect(demoOrderOverview(chat, 'p-admin')).toEqual({ o1: 1, o2: 1 });
    chat = demoOrderMarkRead(chat, 'p-admin', 'o1', new Date('2026-11-20T09:10:00.000Z'));
    expect(demoOrderOverview(chat, 'p-admin')).toEqual({ o2: 1 });
    expect(demoOrderOverview(chat, 'p-worker')).toEqual({ o1: 2 });
  });

  it('marks a mirrored client message with the client kind and no profile', () => {
    const chat = demoOrderIncoming(emptyOrderChat(), 'o1', 'Mijoz', 'Qachon tayyor?', { now, id: counter() });
    expect(demoOrderMessages(chat, 'o1')[0]).toMatchObject({
      authorKind: 'client', authorProfileId: null, authorName: 'Mijoz', channel: 'telegram',
    });
  });

  it('labels the author kind in Uzbek Latin', () => {
    expect(orderAuthorLabel('admin')).toBe('Menejer');
    expect(orderAuthorLabel('worker')).toBe('Ispolateli');
    expect(orderAuthorLabel('client')).toBe('Klient');
  });

  it('maps a database row to the message shape', () => {
    expect(mapOrderMessageRow({
      id: 'r1', order_id: 'o1', author_kind: 'worker', author_profile_id: 'p-worker',
      author_name: 'Usta', text: 'Tayyor', channel: 'app', created_at: '2026-11-20T09:00:00+00:00',
    })).toEqual({
      id: 'r1', orderId: 'o1', authorKind: 'worker', authorProfileId: 'p-worker',
      authorName: 'Usta', text: 'Tayyor', channel: 'app', createdAt: '2026-11-20T09:00:00+00:00',
    });
  });
});
