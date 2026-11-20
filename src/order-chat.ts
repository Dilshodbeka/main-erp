import { ChatError, callFunction } from './chat';
import { mode, supabase } from './repository';
import type { Actor } from './types';

export const ORDER_MESSAGE_LIMIT = 4096;
const STORE_KEY = 'aliya-erp-order-chat-v1';
const CHANGE_EVENT = 'aliya-order-chat-change';

export type OrderAuthorKind = 'admin' | 'worker' | 'client';

export interface OrderChatMessage {
  id: string;
  orderId: string;
  authorKind: OrderAuthorKind;
  authorProfileId: string | null;
  authorName: string;
  text: string;
  channel: 'app' | 'telegram';
  createdAt: string;
}

export interface DemoOrderChat {
  version: 1;
  messages: OrderChatMessage[];
  reads: Record<string, Record<string, string>>;
}

export interface OrderChatAuthor { id: string; name: string; kind: 'admin' | 'worker' }

export function orderAuthorLabel(kind: OrderAuthorKind): string {
  if (kind === 'admin') return 'Menejer';
  if (kind === 'worker') return 'Ispolateli';
  return 'Klient';
}
interface StampOptions { now: Date; id: () => string }

export type OrderChatEvent =
  | { type: 'refresh' }
  | { type: 'incoming'; orderId: string; authorKind: OrderAuthorKind; authorProfileId: string | null; preview: string };

export function emptyOrderChat(): DemoOrderChat {
  return { version: 1, messages: [], reads: {} };
}

function cleanText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new ChatError('message_empty');
  if (trimmed.length > ORDER_MESSAGE_LIMIT) throw new ChatError('message_too_long');
  return trimmed;
}

export function demoOrderMessages(chat: DemoOrderChat, orderId: string): OrderChatMessage[] {
  return chat.messages
    .filter(row => row.orderId === orderId)
    .slice()
    .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));
}

export function demoOrderSend(
  chat: DemoOrderChat, orderId: string, author: OrderChatAuthor, text: string, options: StampOptions,
): DemoOrderChat {
  const message: OrderChatMessage = {
    id: options.id(), orderId, authorKind: author.kind, authorProfileId: author.id,
    authorName: author.name, text: cleanText(text), channel: 'app', createdAt: options.now.toISOString(),
  };
  return { ...chat, messages: [...chat.messages, message] };
}

export function demoOrderIncoming(
  chat: DemoOrderChat, orderId: string, authorName: string, text: string, options: StampOptions,
): DemoOrderChat {
  const message: OrderChatMessage = {
    id: options.id(), orderId, authorKind: 'client', authorProfileId: null,
    authorName: authorName.trim() || 'Mijoz', text: cleanText(text), channel: 'telegram',
    createdAt: options.now.toISOString(),
  };
  return { ...chat, messages: [...chat.messages, message] };
}

export function demoOrderMarkRead(chat: DemoOrderChat, profileId: string, orderId: string, now: Date): DemoOrderChat {
  const mine = { ...(chat.reads[profileId] ?? {}), [orderId]: now.toISOString() };
  return { ...chat, reads: { ...chat.reads, [profileId]: mine } };
}

export function demoOrderOverview(chat: DemoOrderChat, profileId: string): Record<string, number> {
  const pointers = chat.reads[profileId] ?? {};
  const unread: Record<string, number> = {};
  for (const row of chat.messages) {
    if (row.authorProfileId === profileId) continue;
    const lastRead = pointers[row.orderId];
    if (lastRead && row.createdAt <= lastRead) continue;
    unread[row.orderId] = (unread[row.orderId] ?? 0) + 1;
  }
  return unread;
}

export function mapOrderMessageRow(row: Record<string, unknown>): OrderChatMessage {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    authorKind: String(row.author_kind) as OrderAuthorKind,
    authorProfileId: row.author_profile_id ? String(row.author_profile_id) : null,
    authorName: String(row.author_name),
    text: String(row.text),
    channel: row.channel === 'telegram' ? 'telegram' : 'app',
    createdAt: String(row.created_at),
  };
}

function normalizeDemo(value: unknown): DemoOrderChat {
  const candidate = value as Partial<DemoOrderChat> | null;
  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.messages) || typeof candidate.reads !== 'object') {
    throw new Error('Unsupported order chat store');
  }
  return { version: 1, messages: candidate.messages, reads: candidate.reads ?? {} };
}

function demoStore(): DemoOrderChat {
  if (typeof localStorage === 'undefined') return emptyOrderChat();
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    try { return normalizeDemo(JSON.parse(raw)); } catch { /* rebuild below */ }
  }
  const fresh = emptyOrderChat();
  localStorage.setItem(STORE_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveDemoChat(chat: DemoOrderChat, event: OrderChatEvent = { type: 'refresh' }) {
  localStorage.setItem(STORE_KEY, JSON.stringify(chat));
  window.dispatchEvent(new CustomEvent<OrderChatEvent>(CHANGE_EVENT, { detail: event }));
}

function fail(error: { code?: string; message: string }): ChatError {
  return new ChatError(String(error.code || 'order_chat_failed'), error.message);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function orderChatMessages(orderId: string): Promise<OrderChatMessage[]> {
  if (mode === 'demo') return demoOrderMessages(demoStore(), orderId);
  const { data, error } = await supabase!
    .from('erp_order_messages').select('*').eq('order_id', orderId)
    .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(500);
  if (error) throw fail(error);
  return (data ?? []).map(row => mapOrderMessageRow(row as Record<string, unknown>));
}

const DELIVERY_FALLBACK = new Set([
  'no_chat_link', 'telegram_blocked', 'telegram_chat_not_found', 'telegram_forbidden',
  'telegram_api_error', 'order_chat_failed',
]);

export async function orderChatSend(
  actor: Actor, orderId: string, text: string, customerId?: string | null,
): Promise<OrderChatMessage> {
  const body = cleanText(text);
  if (actor.role === 'display') throw new ChatError('message_forbidden');
  if (mode === 'demo') {
    const kind = actor.role === 'admin' ? 'admin' : 'worker';
    const next = demoOrderSend(demoStore(), orderId, { id: actor.id, name: actor.name, kind }, body,
      { now: new Date(), id: () => crypto.randomUUID() });
    const message = demoOrderMessages(next, orderId).at(-1)!;
    saveDemoChat(next);
    return message;
  }
  // Owner messages reach the client through Telegram; the message row mirrors back here.
  if (actor.role === 'admin' && customerId) {
    try {
      const reply = await callFunction('send-text', { customerId, text: body, orderId });
      const row = reply.orderMessage as Record<string, unknown> | null | undefined;
      if (row) return mapOrderMessageRow(row);
    } catch (error) {
      if (!(error instanceof ChatError) || !DELIVERY_FALLBACK.has(error.code)) throw error;
    }
  }
  const { data, error } = await supabase!.from('erp_order_messages').insert({
    company_id: actor.companyId, order_id: orderId, author_kind: actor.role,
    author_profile_id: actor.id, author_name: actor.name, text: body, channel: 'app',
  }).select().single();
  if (error) throw fail(error);
  return mapOrderMessageRow(data as Record<string, unknown>);
}

export async function orderChatMarkRead(actor: Actor, orderId: string): Promise<void> {
  if (mode === 'demo') {
    saveDemoChat(demoOrderMarkRead(demoStore(), actor.id, orderId, new Date()));
    return;
  }
  const { error } = await supabase!.from('erp_order_chat_reads').upsert({
    company_id: actor.companyId, order_id: orderId, profile_id: actor.id, last_read_at: new Date().toISOString(),
  }, { onConflict: 'company_id,order_id,profile_id' });
  if (error) throw fail(error);
}

export async function orderChatOverview(companyId: string, actor: Actor): Promise<Record<string, number>> {
  if (mode === 'demo') return demoOrderOverview(demoStore(), actor.id);
  void companyId;
  const { data, error } = await supabase!.rpc('erp_order_chat_overview');
  if (error) throw fail(error);
  const raw = (data ?? {}) as Record<string, unknown>;
  const unread: Record<string, number> = {};
  for (const [orderId, count] of Object.entries(raw)) unread[orderId] = Number(count) || 0;
  return unread;
}

export async function orderChatDemoIncoming(orderId: string, text = 'Assalomu alaykum, buyurtma bo‘yicha savolim bor.'): Promise<OrderChatMessage> {
  if (mode !== 'demo') throw new ChatError('demo_only');
  const next = demoOrderIncoming(demoStore(), orderId, 'Mijoz', text, { now: new Date(), id: () => crypto.randomUUID() });
  const message = demoOrderMessages(next, orderId).at(-1)!;
  saveDemoChat(next, { type: 'incoming', orderId, authorKind: 'client', authorProfileId: null, preview: message.text });
  return message;
}

export function subscribeOrderChat(companyId: string, onEvent: (event: OrderChatEvent) => void): () => void {
  if (mode === 'demo') {
    const changed = (event: Event) => onEvent((event as CustomEvent<OrderChatEvent>).detail ?? { type: 'refresh' });
    const storage = (event: StorageEvent) => { if (event.key === STORE_KEY) onEvent({ type: 'refresh' }); };
    window.addEventListener(CHANGE_EVENT, changed);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, changed);
      window.removeEventListener('storage', storage);
    };
  }
  const channel = supabase!
    .channel(`erp-order-chat-${companyId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'erp_order_messages', filter: `company_id=eq.${companyId}`,
    }, payload => {
      const row = payload.new as Record<string, unknown>;
      onEvent({
        type: 'incoming', orderId: String(row.order_id),
        authorKind: String(row.author_kind) as OrderAuthorKind,
        authorProfileId: row.author_profile_id ? String(row.author_profile_id) : null,
        preview: String(row.text ?? ''),
      });
    })
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}
