import { describe, expect, it } from 'vitest';
import * as shared from '../supabase/functions/_shared/telegram';
import {
  MAX_TELEGRAM_FILE_BYTES, MAX_MESSAGE_LENGTH, chatFileKind, constantTimeEqual, isStoragePathAllowed, isStorageReadAllowed,
  mapMessageRow, normalizeChatId, operationUnitLabel, parseTelegramUpdate, sanitizeFileName, storagePathFor,
  validateOutboundFile,
} from '../supabase/functions/_shared/telegram';
import { unitLabel } from './i18n';

const base = (message: Record<string, unknown>) => ({
  update_id: 1001,
  message: {
    message_id: 77,
    date: 1_793_350_800,
    chat: { id: 700100001, type: 'private' },
    from: { id: 700100001, is_bot: false, first_name: 'Aziza' },
    ...message,
  },
});

describe('parseTelegramUpdate', () => {
  it('reads a private text message', () => {
    const parsed = parseTelegramUpdate(base({ text: 'Assalomu alaykum' }));
    expect(parsed).toMatchObject({
      updateId: 1001, chatId: '700100001', telegramMessageId: 77,
      text: 'Assalomu alaykum', file: null, startPayload: null,
    });
    expect(parsed?.sentAt).toBe('2026-10-30T09:00:00.000Z');
  });

  it('ignores groups, bots and deleted-message updates', () => {
    expect(parseTelegramUpdate({ ...base({ text: 'hi' }), message: { ...base({ text: 'hi' }).message, chat: { id: -100123, type: 'group' } } })).toBeNull();
    expect(parseTelegramUpdate(base({ from: { is_bot: true }, text: 'bot' }))).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, edited_message: base({ text: 'edited' }).message })).toBeNull();
    expect(parseTelegramUpdate(base({ photo: [], caption: '' }))).toBeNull();
  });

  it('keeps the caption and largest photo', () => {
    const parsed = parseTelegramUpdate(base({
      caption: 'Eshik eskizi', photo: [{ file_id: 'small', file_size: 100 }, { file_id: 'big', file_size: 900, file_unique_id: 'u1' }],
    }));
    expect(parsed?.text).toBe('Eshik eskizi');
    expect(parsed?.file).toMatchObject({ fileId: 'big', fileType: 'photo', fileName: 'photo-77.jpg', fileSize: 900 });
  });

  it('reads documents and voice notes without text', () => {
    const document = parseTelegramUpdate(base({ document: { file_id: 'doc1', file_name: 'chizma.dwg', mime_type: 'application/acad', file_size: 2048 } }));
    expect(document?.text).toBe('');
    expect(document?.file).toMatchObject({ fileId: 'doc1', fileName: 'chizma.dwg', fileType: 'document', mimeType: 'application/acad' });
    const voice = parseTelegramUpdate(base({ voice: { file_id: 'v1', mime_type: 'audio/ogg', file_size: 4096, duration: 3 } }));
    expect(voice?.file).toMatchObject({ fileId: 'v1', fileType: 'voice', fileName: 'voice-77.ogg' });
  });

  it('exposes a /start deep-link payload', () => {
    expect(parseTelegramUpdate(base({ text: '/start abc123' }))?.startPayload).toBe('abc123');
    expect(parseTelegramUpdate(base({ text: '/start' }))?.startPayload).toBe('');
  });
});

describe('file safety', () => {
  it('sanitizes names and never returns a path', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFileName('  oshxona:eskiz?.pdf ')).toBe('oshxona_eskiz_.pdf');
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('a'.repeat(300)).length).toBe(120);
  });

  it('allows drawings, images, pdf and archives but not executables', () => {
    expect(validateOutboundFile({ name: 'chizma.DWG', size: 1024 })).toEqual({ ok: true });
    expect(validateOutboundFile({ name: 'rasm.png', size: 1024 })).toEqual({ ok: true });
    expect(validateOutboundFile({ name: 'hisob.pdf', size: 1024 })).toEqual({ ok: true });
    expect(validateOutboundFile({ name: 'loyiha.zip', size: 1024 })).toEqual({ ok: true });
    expect(validateOutboundFile({ name: 'virus.exe', size: 1024 })).toEqual({ ok: false, code: 'file_type_not_allowed' });
    expect(validateOutboundFile({ name: 'katta.pdf', size: MAX_TELEGRAM_FILE_BYTES + 1 })).toEqual({ ok: false, code: 'file_too_large' });
    expect(validateOutboundFile({ name: 'bosh.pdf', size: 0 })).toEqual({ ok: false, code: 'empty_file' });
    expect(chatFileKind({ name: 'rasm.jpg', mime: 'image/jpeg' })).toBe('photo');
    expect(chatFileKind({ name: 'chizma.dwg', mime: 'application/acad' })).toBe('document');
  });

  it('confines outbound uploads to the caller company prefix', () => {
    const path = storagePathFor('company-1', 'outbound', '7001', 'abc', 'chizma.dwg');
    expect(path).toBe('company-1/outbound/abc-chizma.dwg');
    expect(isStoragePathAllowed(path, 'company-1')).toBe(true);
    expect(isStoragePathAllowed(path, 'company-2')).toBe(false);
    expect(isStoragePathAllowed('company-1/outbound/../secret', 'company-1')).toBe(false);
    expect(isStoragePathAllowed('company-1/inbound/demo.pdf', 'company-1')).toBe(false);
    expect(storagePathFor('c1', 'inbound', '-7001', 55, 'a b.pdf')).toBe('c1/inbound/-7001/55-a_b.pdf');
  });

  it('allows reads only inside the caller company folders', () => {
    expect(isStorageReadAllowed('company-1/inbound/-7001/55-a.pdf', 'company-1')).toBe(true);
    expect(isStorageReadAllowed('company-1/outbound/abc-a.pdf', 'company-1')).toBe(true);
    expect(isStorageReadAllowed('company-2/inbound/-7001/55-a.pdf', 'company-1')).toBe(false);
    expect(isStorageReadAllowed('company-1/other/abc-a.pdf', 'company-1')).toBe(false);
    expect(isStorageReadAllowed('company-1/inbound/../company-2/a.pdf', 'company-1')).toBe(false);
    expect(isStorageReadAllowed('', 'company-1')).toBe(false);
  });

  it('normalizes private numeric chat ids', () => {
    expect(normalizeChatId(' 700100001 ')).toBe('700100001');
    expect(normalizeChatId('-1001234567890')).toBe('-1001234567890');
    expect(normalizeChatId(700100001)).toBe('700100001');
    for (const bad of ['@aliya', '+998901234567', '1234', '1'.repeat(21), '700 100', null]) {
      expect(normalizeChatId(bad)).toBeNull();
    }
  });

  it('compares webhook secrets without early exit on length mismatch', () => {
    expect(constantTimeEqual('secret-token', 'secret-token')).toBe(true);
    expect(constantTimeEqual('secret-token', 'secret-tokeN')).toBe(false);
    expect(constantTimeEqual('', 'secret')).toBe(false);
  });
});

describe('mapMessageRow', () => {
  it('converts a database row to the chat shape', () => {
    const message = mapMessageRow({
      id: 'm1', company_id: 'c1', client_id: 'cl1', telegram_chat_id: '7001', sender: 'client',
      text: 'Salom', file_url: null, file_type: 'text', file_name: null, file_size: null,
      storage_path: null, is_read: false, created_at: '2026-10-30T09:00:00.000Z', telegram_message_id: 4,
    });
    expect(message).toEqual({
      id: 'm1', customerId: 'cl1', chatId: '7001', sender: 'client', text: 'Salom',
      fileUrl: null, fileType: 'text', fileName: null, fileSize: null, storagePath: null,
      isRead: false, createdAt: '2026-10-30T09:00:00.000Z', telegramMessageId: 4,
    });
  });
});

describe('shared copy keeps one dictionary with the app', () => {
  it('has no worker messaging left for the bot to send', () => {
    expect(Object.keys(shared).filter(name => name.toLowerCase().includes('worker'))).toEqual([]);
  });

  it('keeps unknown operation codes readable instead of inventing a unit', () => {
    for (const unit of ['sheet', 'meter', 'squareMeter', 'piece', 'hole', 'minute', 'hour'] as const) {
      expect(operationUnitLabel(unit)).toBe(unitLabel(unit));
    }
    expect(operationUnitLabel('kilogram')).toBe('kilogram');
  });
});
