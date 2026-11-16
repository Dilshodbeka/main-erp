import {
  MAX_MESSAGE_LENGTH,
  chatFileKind,
  mapMessageRow,
  normalizeChatId,
  sanitizeFileName,
  storagePathFor,
  validateOutboundFile,
  type ChatFileType,
  type ChatMessage,
  type ChatSender,
} from '../supabase/functions/_shared/telegram';
import { mode, readDemo, supabase } from './repository';
import type { Customer } from './types';

export type { ChatMessage, ChatFileType, ChatSender };

export const DEMO_FILE_LIMIT = 1024 * 1024;
const DEMO_BOT_URL = 'https://t.me/aliya_erp_demo_bot';
const CHAT_KEY = 'aliya-erp-telegram-v1';
const CHANGE_EVENT = 'aliya-chat-change';
const LINK_TTL_MS = 24 * 60 * 60 * 1000;

export interface ChatOverview {
  linked: Record<string, string>;
  unread: Record<string, number>;
  totalUnread: number;
}

export interface ChatLinkInfo { code: string; url: string; expiresAt: string }

export interface DemoThread {
  chatId: string | null;
  linkCode: string | null;
  linkExpiresAt: string | null;
  messages: ChatMessage[];
}

export interface DemoChat { version: 1; threads: Record<string, DemoThread> }

export type ChatEvent = { type: 'refresh' } | { type: 'incoming'; message: ChatMessage };

export class ChatError extends Error {
  code: string;
  constructor(code: string, detail = '') {
    super(detail || code);
    this.name = 'ChatError';
    this.code = code;
  }
}

interface SeedOptions { now: Date; id: () => string }
interface MessageOptions { now: Date; id: () => string }
interface OutboundFile {
  name: string;
  size: number;
  mime: string;
  fileUrl: string;
  caption?: string;
}

const minutesBefore = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const cloneThread = (thread: DemoThread): DemoThread => ({ ...thread, messages: [...thread.messages] });

const demoSketch = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#eff4e6"/><rect x="36" y="36" width="408" height="248" fill="none" stroke="#214c3c" stroke-width="4"/><text x="60" y="170" font-family="Arial" font-size="30" fill="#214c3c">Oshxona eskizi</text><text x="60" y="212" font-family="Arial" font-size="18" fill="#7e8a80">Demo ilova · 480 × 320</text></svg>',
)}`;

/** Deterministic in-memory seed used by demo mode and by the unit tests. */
export function demoSeed(customers: Customer[], options: SeedOptions): DemoChat {
  const threads: Record<string, DemoThread> = {};
  const make = (
    customerId: string, chatId: string, sender: ChatSender, text: string, minutes: number,
    extra: Partial<ChatMessage> = {},
  ): ChatMessage => ({
    id: options.id(), customerId, chatId, sender, text,
    fileUrl: null, fileType: 'text', fileName: null, fileSize: null, storagePath: null,
    isRead: true, createdAt: minutesBefore(options.now, minutes), telegramMessageId: null,
    ...extra,
  });
  const first = customers[0];
  if (first) {
    threads[first.id] = {
      chatId: '700100001', linkCode: null, linkExpiresAt: null,
      messages: [
        make(first.id, '700100001', 'client', 'Assalomu alaykum! Oshxona loyihasi bo‘yicha chizmani yubordim.', 180),
        make(first.id, '700100001', 'operator', 'Xush kelibsiz, Aziza! Chizmani oldik, o‘lchamlarni tekshiryapmiz.', 170),
        make(first.id, '700100001', 'client', 'Chizma ilova qilindi. Qachon tayyor bo‘ladi?', 15, {
          isRead: false, fileType: 'photo', fileName: 'oshxona-eskizi.svg', fileSize: 1536, fileUrl: demoSketch,
        }),
      ],
    };
  }
  const second = customers[1];
  if (second) {
    threads[second.id] = {
      chatId: '700100002', linkCode: null, linkExpiresAt: null,
      messages: [
        make(second.id, '700100002', 'client', 'Fasadlarni bo‘yash bo‘yicha kelishdik.', 1560),
        make(second.id, '700100002', 'operator', 'Ha, 8 fasad uchun 4 000 000 so‘m. Ertaga boshlaymiz.', 1500),
      ],
    };
  }
  return { version: 1, threads };
}

export function demoOverview(chat: DemoChat): ChatOverview {
  const linked: Record<string, string> = {};
  const unread: Record<string, number> = {};
  let totalUnread = 0;
  for (const [customerId, thread] of Object.entries(chat.threads)) {
    if (thread.chatId) linked[customerId] = thread.chatId;
    const count = thread.messages.filter(message => !message.isRead).length;
    if (count > 0) { unread[customerId] = count; totalUnread += count; }
  }
  return { linked, unread, totalUnread };
}

export function demoMessages(chat: DemoChat, customerId: string): ChatMessage[] {
  return [...(chat.threads[customerId]?.messages ?? [])]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function requireLinked(chat: DemoChat, customerId: string): DemoThread {
  const thread = chat.threads[customerId];
  if (!thread?.chatId) throw new ChatError('no_chat_link');
  return thread;
}

function append(chat: DemoChat, customerId: string, message: ChatMessage): DemoChat {
  const thread = chat.threads[customerId];
  return {
    ...chat,
    threads: { ...chat.threads, [customerId]: { ...thread, messages: [...thread.messages, message] } },
  };
}

function textMessage(
  chat: DemoChat, customerId: string, sender: ChatSender, text: string, options: MessageOptions,
): { chat: DemoChat; message: ChatMessage } {
  const thread = requireLinked(chat, customerId);
  const value = String(text).trim();
  if (!value) throw new ChatError('empty_message');
  if (value.length > MAX_MESSAGE_LENGTH) throw new ChatError('message_too_long');
  const message: ChatMessage = {
    id: options.id(), customerId, chatId: thread.chatId!, sender, text: value,
    fileUrl: null, fileType: 'text', fileName: null, fileSize: null, storagePath: null,
    isRead: sender === 'operator', createdAt: options.now.toISOString(), telegramMessageId: null,
  };
  return { chat: append(chat, customerId, message), message };
}

export function demoIncoming(chat: DemoChat, customerId: string, text: string, options: MessageOptions): DemoChat {
  return textMessage(chat, customerId, 'client', text, options).chat;
}

export function demoOutgoing(chat: DemoChat, customerId: string, text: string, options: MessageOptions): DemoChat {
  return textMessage(chat, customerId, 'operator', text, options).chat;
}

export function demoAttach(
  chat: DemoChat, customerId: string, sender: ChatSender, file: OutboundFile, options: MessageOptions,
): DemoChat {
  const thread = requireLinked(chat, customerId);
  if (!Number.isFinite(file.size) || file.size <= 0) throw new ChatError('empty_file');
  if (file.size > DEMO_FILE_LIMIT) throw new ChatError('demo_file_too_large');
  const text = String(file.caption ?? '').trim();
  if (text.length > MAX_MESSAGE_LENGTH) throw new ChatError('message_too_long');
  const message: ChatMessage = {
    id: options.id(), customerId, chatId: thread.chatId!, sender, text,
    fileUrl: file.fileUrl, fileType: chatFileKind({ name: file.name, mime: file.mime }),
    fileName: sanitizeFileName(file.name), fileSize: file.size, storagePath: null,
    isRead: sender === 'operator', createdAt: options.now.toISOString(), telegramMessageId: null,
  };
  return append(chat, customerId, message);
}

export function demoMarkRead(chat: DemoChat, customerId: string): DemoChat {
  const thread = chat.threads[customerId];
  if (!thread) return chat;
  return {
    ...chat,
    threads: {
      ...chat.threads,
      [customerId]: { ...thread, messages: thread.messages.map(message => message.isRead ? message : { ...message, isRead: true }) },
    },
  };
}

export function validateChatId(input: string): string | null {
  return normalizeChatId(input);
}

export function demoManualLink(chat: DemoChat, customerId: string, input: string): DemoChat {
  const chatId = validateChatId(input);
  if (!chatId) throw new ChatError('invalid_chat_id');
  for (const [id, thread] of Object.entries(chat.threads)) {
    if (id !== customerId && thread.chatId === chatId) throw new ChatError('telegram_chat_taken');
  }
  const thread = chat.threads[customerId] ?? { chatId: null, linkCode: null, linkExpiresAt: null, messages: [] };
  return {
    ...chat,
    threads: { ...chat.threads, [customerId]: { ...thread, chatId, linkCode: null, linkExpiresAt: null } },
  };
}

export function demoUnlink(chat: DemoChat, customerId: string): DemoChat {
  const thread = chat.threads[customerId];
  if (!thread) return chat;
  return {
    ...chat,
    threads: { ...chat.threads, [customerId]: { ...cloneThread(thread), chatId: null, linkCode: null, linkExpiresAt: null } },
  };
}

export function demoCreateLink(
  chat: DemoChat, customerId: string, options: { now: Date; code: string },
): { chat: DemoChat; link: ChatLinkInfo } {
  const thread = chat.threads[customerId] ?? { chatId: null, linkCode: null, linkExpiresAt: null, messages: [] };
  if (thread.chatId) throw new ChatError('already_linked');
  const code = String(options.code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (code.length < 16) throw new ChatError('link_code_invalid');
  const expiresAt = new Date(options.now.getTime() + LINK_TTL_MS).toISOString();
  return {
    chat: {
      ...chat,
      threads: { ...chat.threads, [customerId]: { ...thread, linkCode: code, linkExpiresAt: expiresAt } },
    },
    link: { code, url: `${DEMO_BOT_URL}?start=${code}`, expiresAt },
  };
}

const chatErrors: Record<string, string> = {
  telegram_not_configured: 'Telegram bot hali sozlanmagan. Server sozlamalarini tekshiring.',
  telegram_chat_not_found: 'Mijoz Telegram’da botni bloklagan yoki chat topilmadi.',
  telegram_blocked: 'Mijoz botni bloklagan. Xabar yetib bormadi.',
  telegram_forbidden: 'Bot mijoz bilan yozishga ruxsat olmagan.',
  telegram_chat_taken: 'Bu Telegram chat allaqachon boshqa mijozga bog‘langan.',
  invalid_chat_id: 'Telegram chat ID noto‘g‘ri. Faqat raqamlardan iborat ID kiriting.',
  no_chat_link: 'Avval mijozning Telegram chatini bog‘lang.',
  already_linked: 'Bu mijoz allaqachon Telegramga bog‘langan.',
  link_expired: 'Havola muddati tugagan. Yangi havola yarating.',
  link_code_invalid: 'Havola kodi noto‘g‘ri yaratildi. Qayta urinib ko‘ring.',
  empty_message: 'Xabar matni bo‘sh.',
  message_too_long: 'Xabar 4096 belgidan oshmasligi kerak.',
  empty_file: 'Bo‘sh faylni yuborish mumkin emas.',
  file_too_large: 'Fayl hajmi 20 MB dan oshmasligi kerak.',
  demo_file_too_large: 'Demo rejimida 1 MB gacha fayl yuborish mumkin. Bulut rejimida 20 MB.',
  file_type_not_allowed: 'Bu fayl turi qabul qilinmaydi. PDF, rasm, DWG/DXF yoki arxiv yuboring.',
  file_read_failed: 'Faylni o‘qib bo‘lmadi. Boshqa faylni tanlang.',
  upload_failed: 'Fayl serverga yuklanmadi. Internetni tekshirib qayta urinib ko‘ring.',
  table_missing: 'Telegram jadvallari topilmadi. Supabase’da supabase/telegram.sql skriptini qo‘llang.',
  access_denied: 'Bu amal faqat korxona egasi uchun. Hisobingiz rolini tekshiring.',
  auth_missing: 'Kirish toketi serverga yetib bormadi. Qaytadan kiring.',
  auth_invalid: 'Sessiya yaroqsiz. Chiqib, qaytadan kiring.',
  profile_missing: 'Hisobingiz korxonaga bog‘lanmagan. Egasi hisobiga qayta kiring.',
  session_missing: 'Sessiya tugagan. Qaytadan kiring.',
  network: 'Server bilan aloqa yo‘q. Internetni tekshiring.',
  telegram_api_error: 'Telegram API xatosi. Keyinroq qayta urinib ko‘ring.',
};

export function chatErrorText(input: string): string {
  return chatErrors[input] ?? input;
}

// ---------------------------------------------------------------------------
// Demo persistence
// ---------------------------------------------------------------------------

function normalizeDemoChat(value: unknown): DemoChat {
  const candidate = value as Partial<DemoChat> | null;
  if (!candidate || candidate.version !== 1 || !candidate.threads || typeof candidate.threads !== 'object') {
    throw new Error('Unsupported demo chat store');
  }
  return { version: 1, threads: candidate.threads };
}

function demoStore(): DemoChat {
  if (typeof localStorage === 'undefined') {
    return demoSeed(readDemo().customers, { now: new Date(), id: () => crypto.randomUUID() });
  }
  const raw = localStorage.getItem(CHAT_KEY);
  if (raw) {
    try { return normalizeDemoChat(JSON.parse(raw)); } catch { /* rebuild below */ }
  }
  const seeded = demoSeed(readDemo().customers, { now: new Date(), id: () => crypto.randomUUID() });
  localStorage.setItem(CHAT_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveDemoChat(chat: DemoChat, event: ChatEvent = { type: 'refresh' }) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(chat));
  window.dispatchEvent(new CustomEvent<ChatEvent>(CHANGE_EVENT, { detail: event }));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ChatError('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Cloud transport
// ---------------------------------------------------------------------------

interface FunctionReply { ok: boolean; code?: string; message?: unknown; [key: string]: unknown }

function chatErrorFrom(error: { code?: string; message: string }): ChatError {
  if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message)) {
    return new ChatError('table_missing', error.message);
  }
  if (error.code === '42501' || error.code === 'PGRST301' || error.code === 'PGRST302') {
    return new ChatError('access_denied', error.message);
  }
  return new ChatError('network', error.message);
}

async function callFunction(action: string, body: Record<string, unknown>): Promise<FunctionReply> {
  if (!supabase) throw new ChatError('telegram_not_configured');
  const { data: current } = await supabase.auth.getSession();
  const token = current.session?.access_token;
  if (!token) throw new ChatError('session_missing');
  const { data, error } = await supabase.functions.invoke('telegram-send', {
    body: { action, ...body },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    let reply: FunctionReply | null = null;
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context?.json) {
      try { reply = await context.json() as FunctionReply; } catch { reply = null; }
    }
    throw new ChatError(String(reply?.code || 'telegram_api_error'), String(reply?.message || error.message));
  }
  const reply = data as FunctionReply | null;
  if (!reply) throw new ChatError('telegram_api_error');
  if (reply.ok === false) throw new ChatError(String(reply.code || 'telegram_api_error'), String(reply.message || ''));
  return reply;
}

// ---------------------------------------------------------------------------
// Public repository API
// ---------------------------------------------------------------------------

export async function chatOverview(_companyId: string): Promise<ChatOverview> {
  if (mode === 'demo') return demoOverview(demoStore());
  const customers = await supabase!.from('erp_customers').select('id, telegram_chat_id');
  if (customers.error) throw chatErrorFrom(customers.error);
  const linked: Record<string, string> = {};
  for (const row of customers.data ?? []) {
    const chatId = (row as { telegram_chat_id?: string | null }).telegram_chat_id;
    if (chatId) linked[String((row as { id: string }).id)] = String(chatId);
  }
  const messages = await supabase!.from('erp_messages').select('client_id').eq('is_read', false);
  if (messages.error) throw chatErrorFrom(messages.error);
  const unread: Record<string, number> = {};
  let totalUnread = 0;
  for (const row of messages.data ?? []) {
    const id = String((row as { client_id: string }).client_id);
    unread[id] = (unread[id] ?? 0) + 1;
    totalUnread++;
  }
  return { linked, unread, totalUnread };
}

export async function chatMessages(customerId: string): Promise<ChatMessage[]> {
  if (mode === 'demo') return demoMessages(demoStore(), customerId);
  const { data, error } = await supabase!
    .from('erp_messages').select('*').eq('client_id', customerId)
    .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(500);
  if (error) throw chatErrorFrom(error);
  return (data ?? []).map(row => mapMessageRow(row as Record<string, unknown>));
}

export async function chatSendText(customerId: string, text: string): Promise<ChatMessage> {
  if (mode === 'demo') {
    const next = demoOutgoing(demoStore(), customerId, text, { now: new Date(), id: () => crypto.randomUUID() });
    const message = demoMessages(next, customerId).at(-1)!;
    saveDemoChat(next);
    return message;
  }
  const reply = await callFunction('send-text', { customerId, text });
  return mapMessageRow(reply.message as Record<string, unknown>);
}

export async function chatSendFile(
  companyId: string, customerId: string, file: File, caption = '',
): Promise<ChatMessage> {
  const allowed = validateOutboundFile({ name: file.name, size: file.size });
  if (!allowed.ok) throw new ChatError(allowed.code);
  if (mode === 'demo') {
    const fileUrl = await readFileAsDataUrl(file);
    const next = demoAttach(demoStore(), customerId, 'operator', {
      name: file.name, size: file.size, mime: file.type || 'application/octet-stream', fileUrl, caption,
    }, { now: new Date(), id: () => crypto.randomUUID() });
    const message = demoMessages(next, customerId).at(-1)!;
    saveDemoChat(next);
    return message;
  }
  const path = storagePathFor(companyId, 'outbound', '', crypto.randomUUID(), file.name);
  const upload = await supabase!.storage.from('telegram-files').upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  });
  if (upload.error) throw new ChatError('upload_failed', upload.error.message);
  const reply = await callFunction('send-file', {
    customerId, storagePath: path, fileName: file.name, fileSize: file.size,
    mimeType: file.type || 'application/octet-stream', caption,
  });
  return mapMessageRow(reply.message as Record<string, unknown>);
}

export async function chatMarkRead(customerId: string): Promise<void> {
  if (mode === 'demo') { saveDemoChat(demoMarkRead(demoStore(), customerId)); return; }
  await callFunction('mark-read', { customerId });
}

export async function chatCreateLink(_companyId: string, customerId: string): Promise<ChatLinkInfo> {
  if (mode === 'demo') {
    const result = demoCreateLink(demoStore(), customerId, {
      now: new Date(), code: crypto.randomUUID().replace(/-/g, '').slice(0, 24),
    });
    saveDemoChat(result.chat);
    return result.link;
  }
  const reply = await callFunction('create-link', { customerId });
  return { code: String(reply.code), url: String(reply.url), expiresAt: String(reply.expiresAt) };
}

export async function chatLinkManual(customerId: string, chatId: string): Promise<void> {
  if (mode === 'demo') { saveDemoChat(demoManualLink(demoStore(), customerId, chatId)); return; }
  await callFunction('link', { customerId, chatId });
}

export async function chatUnlink(customerId: string): Promise<void> {
  if (mode === 'demo') { saveDemoChat(demoUnlink(demoStore(), customerId)); return; }
  await callFunction('unlink', { customerId });
}

export async function chatFileUrl(message: ChatMessage): Promise<string | null> {
  if (mode === 'demo') return message.fileUrl;
  if (message.storagePath) {
    const reply = await callFunction('file-url', { storagePath: message.storagePath });
    return String(reply.url);
  }
  return message.fileUrl;
}

export async function demoSimulateIncoming(customerId: string, text = 'Assalomu alaykum! Buyurtma bo‘yicha savolim bor.'): Promise<ChatMessage> {
  if (mode !== 'demo') throw new ChatError('demo_only');
  const next = demoIncoming(demoStore(), customerId, text, { now: new Date(), id: () => crypto.randomUUID() });
  const message = demoMessages(next, customerId).at(-1)!;
  saveDemoChat(next, { type: 'incoming', message });
  return message;
}

export function subscribeChat(companyId: string, onEvent: (event: ChatEvent) => void): () => void {
  if (mode === 'demo') {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<ChatEvent>).detail;
      onEvent(detail ?? { type: 'refresh' });
    };
    const storage = (event: StorageEvent) => { if (event.key === CHAT_KEY) onEvent({ type: 'refresh' }); };
    window.addEventListener(CHANGE_EVENT, changed);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, changed);
      window.removeEventListener('storage', storage);
    };
  }
  const channel = supabase!
    .channel(`erp-chat-${companyId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'erp_messages', filter: `company_id=eq.${companyId}`,
    }, payload => onEvent({ type: 'incoming', message: mapMessageRow(payload.new as Record<string, unknown>) }))
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'erp_messages', filter: `company_id=eq.${companyId}`,
    }, () => onEvent({ type: 'refresh' }))
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

export function playChatChime() {
  if (typeof window === 'undefined') return;
  const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Audio) return;
  const context = new Audio();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(660, context.currentTime + 0.12);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.28);
  oscillator.onended = () => { void context.close(); };
}
