import { describe, expect, it } from 'vitest';
import {
  ORDER_MESSAGE_LIMIT,
  demoOrderIncoming,
  demoOrderMarkRead,
  demoOrderMessages,
  demoOrderOverview,
  demoOrderSend,
  emptyOrderChat,
  mapOrderMessageRow, attachmentKind, safeFileName,
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
      kind: 'text', authorTitle: '', file: null,
    });
  });

  it('maps a system card and an attachment', () => {
    const system = mapOrderMessageRow({ id: 's1', order_id: 'o1', author_kind: 'system', author_profile_id: null, author_name: 'Tizim', text: '📋 Buyurtma ORD-0001', channel: 'app', kind: 'system', created_at: '2026-11-20T09:00:00+00:00' });
    expect(system.authorKind).toBe('system');
    expect(system.kind).toBe('system');
    expect(orderAuthorLabel('system')).toBe('Tizim');
    const voice = mapOrderMessageRow({ id: 'v1', order_id: 'o1', author_kind: 'worker', author_profile_id: 'p', author_name: 'Usta', author_title: 'Yig‘ish', text: 'ovoz.webm', channel: 'app', kind: 'voice', file_path: 'c/o1/x-ovoz.webm', file_name: 'ovoz.webm', file_mime: 'audio/webm', file_size: 2048, created_at: '2026-11-20T09:01:00+00:00' });
    expect(voice.authorTitle).toBe('Yig‘ish');
    expect(voice.file).toEqual({ path: 'c/o1/x-ovoz.webm', name: 'ovoz.webm', mime: 'audio/webm', size: 2048 });
  });

  it('classifies attachments and makes safe storage names', () => {
    expect(attachmentKind('image/jpeg')).toBe('image');
    expect(attachmentKind('video/mp4')).toBe('video');
    expect(attachmentKind('audio/webm')).toBe('voice');
    expect(attachmentKind('application/pdf')).toBe('file');
    expect(attachmentKind('video/webm', true)).toBe('voice');
    expect(safeFileName('Чертёж кухни (2).pdf')).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    expect(safeFileName('../../etc/passwd')).not.toContain('/');
    expect(safeFileName('…')).toBe('fayl');
  });
});
