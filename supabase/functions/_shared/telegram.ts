// Pure helpers shared by the Supabase Edge Functions and the browser bundle.
// No Deno or Supabase imports are allowed here: src/chat.ts imports this file.

export const MAX_TELEGRAM_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = 4096;
export const OUTBOUND_EXTENSIONS = [
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg',
  'dwg', 'dxf', 'zip', 'rar', '7z', 'tar', 'gz',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'odt', 'ods',
] as const;
export const OUTBOUND_ACCEPT = OUTBOUND_EXTENSIONS.map(extension => `.${extension}`).join(',');

export type ChatSender = 'client' | 'operator';
export type ChatFileType = 'text' | 'document' | 'photo' | 'voice';
export type IncomingFileType = Exclude<ChatFileType, 'text'>;

export interface ChatMessage {
  id: string;
  customerId: string;
  chatId: string;
  sender: ChatSender;
  text: string;
  fileUrl: string | null;
  fileType: ChatFileType | null;
  fileName: string | null;
  fileSize: number | null;
  storagePath: string | null;
  isRead: boolean;
  createdAt: string;
  telegramMessageId: number | null;
}

export interface TelegramFileRef {
  fileId: string;
  fileUniqueId: string | null;
  fileName: string;
  mimeType: string;
  fileType: IncomingFileType;
  fileSize: number;
}

export interface IncomingMessage {
  updateId: number;
  chatId: string;
  telegramMessageId: number;
  text: string;
  file: TelegramFileRef | null;
  startPayload: string | null;
  replyToMessageId: number | null;
  sentAt: string;
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null);
const string = (value: unknown): string => (typeof value === 'string' ? value : '');
const safeInteger = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const mimeExtensions: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'application/pdf': '.pdf',
};

function extensionFromMime(mime: string, fallback: string): string {
  return mimeExtensions[mime] ?? fallback;
}

/** Extracts the client's message, ignoring bots, groups, edits and service events. */
export function parseTelegramUpdate(input: unknown): IncomingMessage | null {
  const update = record(input);
  const message = record(update?.message);
  if (!update || !message) return null;
  const chat = record(message.chat);
  const from = record(message.from);
  if (!chat || chat.type !== 'private') return null;
  if (from?.is_bot === true) return null;
  const chatId = string(chat.id) || (typeof chat.id === 'number' ? String(chat.id) : '');
  if (!/^-?\d{5,20}$/.test(chatId)) return null;
  const updateId = safeInteger(update.update_id);
  const telegramMessageId = safeInteger(message.message_id);
  if (updateId === null || telegramMessageId === null) return null;
  const seconds = typeof message.date === 'number' && Number.isFinite(message.date) ? message.date : Date.now() / 1000;
  const sentAt = new Date(seconds * 1000).toISOString();
  const rawText = string(message.text) || string(message.caption);
  const text = rawText.slice(0, MAX_MESSAGE_LENGTH).trim();
  const startPayload = string(message.text).startsWith('/start')
    ? (string(message.text).split(/\s+/)[1] ?? '').trim().slice(0, 64)
    : null;
  const file = parseFile(message, telegramMessageId);
  if (!file && !text) return null;
  const replyToMessageId = safeInteger(record(message.reply_to_message)?.message_id);
  return { updateId, chatId, telegramMessageId, text, file, startPayload, replyToMessageId, sentAt };
}

function parseFile(message: Json, messageId: number): TelegramFileRef | null {
  const document = record(message.document);
  if (document) {
    const mimeType = string(document.mime_type) || 'application/octet-stream';
    const name = sanitizeFileName(string(document.file_name) || `document-${messageId}${extensionFromMime(mimeType, '.bin')}`);
    const fileId = string(document.file_id);
    if (!fileId) return null;
    return {
      fileId, fileUniqueId: string(document.file_unique_id) || null, fileName: name,
      mimeType, fileType: 'document', fileSize: Math.max(0, Number(document.file_size) || 0),
    };
  }
  const photos = Array.isArray(message.photo) ? message.photo.map(record).filter((photo): photo is Json => !!photo) : [];
  if (photos.length) {
    const photo = photos.reduce((largest, current) => (Number(current.file_size) || 0) > (Number(largest.file_size) || 0) ? current : largest);
    const fileId = string(photo.file_id);
    if (!fileId) return null;
    return {
      fileId, fileUniqueId: string(photo.file_unique_id) || null, fileName: `photo-${messageId}.jpg`,
      mimeType: 'image/jpeg', fileType: 'photo', fileSize: Math.max(0, Number(photo.file_size) || 0),
    };
  }
  const voice = record(message.voice);
  if (voice) {
    const fileId = string(voice.file_id);
    if (!fileId) return null;
    return {
      fileId, fileUniqueId: string(voice.file_unique_id) || null, fileName: `voice-${messageId}.ogg`,
      mimeType: string(voice.mime_type) || 'audio/ogg', fileType: 'voice', fileSize: Math.max(0, Number(voice.file_size) || 0),
    };
  }
  return null;
}

export function sanitizeFileName(name: string, fallback = 'file'): string {
  const cleaned = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

export function validateOutboundFile(file: { name: string; size: number }): { ok: true } | { ok: false; code: 'empty_file' | 'file_too_large' | 'file_type_not_allowed' } {
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, code: 'empty_file' };
  if (file.size > MAX_TELEGRAM_FILE_BYTES) return { ok: false, code: 'file_too_large' };
  if (!OUTBOUND_EXTENSIONS.includes(fileExtension(file.name) as typeof OUTBOUND_EXTENSIONS[number])) return { ok: false, code: 'file_type_not_allowed' };
  return { ok: true };
}

export function chatFileKind(file: { name: string; mime: string }): Exclude<ChatFileType, 'text' | 'voice'> {
  return file.mime.toLowerCase().startsWith('image/') ? 'photo' : 'document';
}

const pathSegment = (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, '');

export function storagePathFor(companyId: string, direction: 'inbound' | 'outbound', chatId: string, uniqueId: string | number, fileName: string): string {
  const company = pathSegment(companyId);
  const unique = pathSegment(String(uniqueId));
  const name = sanitizeFileName(fileName).replace(/\s+/g, '_');
  return direction === 'outbound'
    ? `${company}/outbound/${unique}-${name}`
    : `${company}/inbound/${pathSegment(chatId)}/${unique}-${name}`;
}

export function isStoragePathAllowed(path: string, companyId: string): boolean {
  if (!path || path.includes('..') || path.includes('\\') || path.includes('//')) return false;
  return path.startsWith(`${pathSegment(companyId)}/outbound/`);
}

/** Signed reads cover both directions, but never cross the company prefix. */
export function isStorageReadAllowed(path: string, companyId: string): boolean {
  if (!path || path.includes('..') || path.includes('\\') || path.includes('//')) return false;
  const prefix = `${pathSegment(companyId)}/`;
  return path.startsWith(`${prefix}outbound/`) || path.startsWith(`${prefix}inbound/`);
}

/** Chat ids are private numeric Telegram ids, never usernames or phone numbers. */
export function normalizeChatId(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const value = String(input).trim();
  return /^-?\d{5,20}$/.test(value) ? value : null;
}

export function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function mapMessageRow(row: Record<string, unknown>): ChatMessage {
  const fileType = row.file_type;
  return {
    id: String(row.id),
    customerId: String(row.client_id),
    chatId: String(row.telegram_chat_id),
    sender: row.sender === 'operator' ? 'operator' : 'client',
    text: string(row.text),
    fileUrl: string(row.file_url) || null,
    fileType: fileType === 'document' || fileType === 'photo' || fileType === 'voice' || fileType === 'text' ? fileType : null,
    fileName: string(row.file_name) || null,
    fileSize: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
    storagePath: string(row.storage_path) || null,
    isRead: row.is_read === true,
    createdAt: string(row.created_at) || new Date().toISOString(),
    telegramMessageId: row.telegram_message_id === null || row.telegram_message_id === undefined ? null : Number(row.telegram_message_id),
  };
}

/** Telegram caption is capped at 1024 characters even though message text allows 4096. */
export function captionFor(text: string): string {
  return text.trim().slice(0, 1024);
}

const operationUnits: Record<string, string> = {
  sheet: 'list', meter: 'm', squareMeter: 'm²', piece: 'dona', hole: 'teshik', minute: 'daq.', hour: 'soat',
};

export function operationUnitLabel(unit: string): string {
  return operationUnits[unit] ?? unit;
}
