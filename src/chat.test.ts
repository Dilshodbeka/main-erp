import { describe, expect, it } from 'vitest';
import {
  DEMO_FILE_LIMIT,
  chatErrorText,
  demoAttach,
  demoCreateLink,
  demoIncoming,
  demoManualLink,
  demoMarkRead,
  demoMessages,
  demoOutgoing,
  demoOverview,
  demoSeed,
  demoUnlink,
  validateChatId,
} from './chat';
import type { Customer } from './types';

const customers: Customer[] = [
  { id: 'c1', name: 'Aziza Karimova', phone: '', address: '', kind: 'customer', employeeId: null },
  { id: 'c2', name: '«Issiq uy» qahvaxonasi', phone: '', address: '', kind: 'shop', employeeId: null },
  { id: 'c3', name: 'Yangi mijoz', phone: '', address: '', kind: 'customer', employeeId: null },
];
const now = new Date('2026-10-30T10:00:00.000Z');
const counter = () => { let n = 0; return () => `id-${++n}`; };
const seed = () => demoSeed(customers, { now, id: counter() });

describe('demo chat model', () => {
  it('seeds linked conversations only for the first two customers', () => {
    const chat = seed();
    expect(Object.keys(chat.threads)).toEqual(['c1', 'c2']);
    expect(chat.threads.c1.chatId).toBe('700100001');
    expect(chat.threads.c2.chatId).toBe('700100002');
    expect(demoOverview(chat)).toEqual({
      linked: { c1: '700100001', c2: '700100002' },
      unread: { c1: 1 },
      totalUnread: 1,
    });
  });

  it('seeds chronological messages and keeps the last client message unread', () => {
    const chat = seed();
    const messages = demoMessages(chat, 'c1');
    expect(messages).toHaveLength(3);
    expect(messages.at(-1)).toMatchObject({
      sender: 'client',
      isRead: false,
      fileType: 'photo',
      fileName: 'oshxona-eskizi.svg',
    });
    const times = messages.map(message => Date.parse(message.createdAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(demoMessages(chat, 'c3')).toEqual([]);
    const ids = Object.values(chat.threads).flatMap(thread => thread.messages.map(message => message.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('appends an incoming message without mutating the previous store', () => {
    const chat = seed();
    const next = demoIncoming(chat, 'c1', '  Qachon tayyor bo‘ladi?  ', { now: new Date('2026-10-30T10:05:00.000Z'), id: () => 'in-1' });
    expect(demoMessages(next, 'c1').at(-1)).toMatchObject({
      id: 'in-1', sender: 'client', text: 'Qachon tayyor bo‘ladi?', isRead: false, fileType: 'text',
    });
    expect(demoOverview(next).unread.c1).toBe(2);
    expect(demoOverview(chat).unread.c1).toBe(1);
  });

  it('rejects empty, overlong and unlinked incoming messages', () => {
    const options = { now, id: () => 'x' };
    expect(() => demoIncoming(seed(), 'c1', '   ', options)).toThrow('empty_message');
    expect(() => demoIncoming(seed(), 'c1', 'x'.repeat(4097), options)).toThrow('message_too_long');
    expect(() => demoIncoming(seed(), 'c3', 'Salom', options)).toThrow('no_chat_link');
  });

  it('marks an operator reply as read and keeps the client unread count', () => {
    const next = demoOutgoing(seed(), 'c1', 'Ertaga tayyor bo‘ladi.', { now, id: () => 'out-1' });
    expect(demoMessages(next, 'c1').at(-1)).toMatchObject({ sender: 'operator', isRead: true });
    expect(demoOverview(next).unread.c1).toBe(1);
  });

  it('marks only the selected thread as read', () => {
    const chat = seed();
    const next = demoMarkRead(chat, 'c1');
    expect(demoOverview(next).unread.c1).toBeUndefined();
    expect(demoOverview(next).totalUnread).toBe(0);
    expect(demoMessages(next, 'c1').every(message => message.isRead)).toBe(true);
    expect(demoOverview(chat).unread.c1).toBe(1);
  });

  it('attaches validated documents and photos with a caption', () => {
    const options = { now, id: () => 'file-1' };
    const document = demoAttach(seed(), 'c1', 'operator', {
      name: 'oshxona-eskizi.pdf', size: 2048, mime: 'application/pdf',
      fileUrl: 'data:application/pdf;base64,AAAA', caption: '  Yangi chizma  ',
    }, options);
    expect(demoMessages(document, 'c1').at(-1)).toMatchObject({
      id: 'file-1', sender: 'operator', text: 'Yangi chizma', fileType: 'document',
      fileName: 'oshxona-eskizi.pdf', fileSize: 2048,
    });
    const photo = demoAttach(seed(), 'c1', 'operator', {
      name: 'rasm.png', size: 1024, mime: 'image/png', fileUrl: 'data:image/png;base64,AAAA',
    }, { now, id: () => 'file-2' });
    expect(demoMessages(photo, 'c1').at(-1)).toMatchObject({ fileType: 'photo', text: '' });
  });

  it('caps demo attachments at one megabyte and rejects empty files', () => {
    expect(DEMO_FILE_LIMIT).toBe(1024 * 1024);
    const options = { now, id: () => 'file' };
    expect(() => demoAttach(seed(), 'c1', 'operator', {
      name: 'katta.pdf', size: DEMO_FILE_LIMIT + 1, mime: 'application/pdf', fileUrl: 'data:',
    }, options)).toThrow('demo_file_too_large');
    expect(() => demoAttach(seed(), 'c1', 'operator', {
      name: 'bosh.pdf', size: 0, mime: 'application/pdf', fileUrl: 'data:',
    }, options)).toThrow('empty_file');
  });

  it('creates a one-time link code and refuses to link an existing chat', () => {
    const code = 'abcdefghijklmnopqrstuvwx';
    const result = demoCreateLink(seed(), 'c3', { now, code });
    expect(result.link).toEqual({
      code,
      url: `https://t.me/aliya_erp_demo_bot?start=${code}`,
      expiresAt: '2026-10-31T10:00:00.000Z',
    });
    expect(result.chat.threads.c3).toMatchObject({ chatId: null, linkCode: code });
    expect(() => demoCreateLink(seed(), 'c1', { now, code })).toThrow('already_linked');
  });

  it('links a manual chat id, refuses duplicates and unlinks without deleting history', () => {
    const linked = demoManualLink(seed(), 'c3', ' 700100003 ');
    expect(demoOverview(linked).linked.c3).toBe('700100003');
    expect(() => demoManualLink(linked, 'c2', '700100003')).toThrow('telegram_chat_taken');
    expect(() => demoManualLink(seed(), 'c3', '@aliya')).toThrow('invalid_chat_id');
    const unlinked = demoUnlink(linked, 'c3');
    expect(demoOverview(unlinked).linked.c3).toBeUndefined();
    expect(demoMessages(unlinked, 'c3')).toEqual([]);
  });

  it('validates private numeric chat ids', () => {
    expect(validateChatId(' 700100001 ')).toBe('700100001');
    expect(validateChatId('-1001234567890')).toBe('-1001234567890');
    for (const bad of ['@aliya', '+998901234567', '1234', '1'.repeat(21), '700 100']) {
      expect(validateChatId(bad)).toBeNull();
    }
  });

  it('translates chat error codes and passes unknown text through', () => {
    expect(chatErrorText('telegram_blocked')).toContain('bloklagan');
    expect(chatErrorText('file_too_large')).toContain('20 MB');
    expect(chatErrorText('some raw text')).toBe('some raw text');
  });

  it('explains a chat conflict as a customer matter, never a worker one', () => {
    expect(chatErrorText('telegram_chat_taken')).toContain('mijoz');
    expect(chatErrorText('telegram_chat_taken')).not.toContain('xodim');
    expect(chatErrorText('already_linked')).toContain('mijoz');
    expect(chatErrorText('employee_not_found')).toBe('employee_not_found');
  });

  it('separates a broken session from a real permission denial', () => {
    expect(chatErrorText('auth_invalid')).toContain('kiring');
    expect(chatErrorText('auth_missing')).toContain('kiring');
    expect(chatErrorText('profile_missing')).toContain('kiring');
    expect(chatErrorText('access_denied')).toContain('egasi');
  });
});
