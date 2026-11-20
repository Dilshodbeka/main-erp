// Telegram Bot API webhook. Deploy without platform JWT verification:
//   supabase functions deploy telegram-webhook --no-verify-jwt
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET.
// Optional: OWNER_TELEGRAM_IDS (comma-separated Telegram user ids) turns on the owner report bot;
// OWNER_BOT_ACTIONS=1 additionally allows order actions from the bot (off = reports only).
// TIMEPAY_TOKEN enables the attendance report (/davomat).
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  MAX_TELEGRAM_FILE_BYTES,
  constantTimeEqual,
  parseTelegramUpdate,
  sanitizeFileName,
  storagePathFor,
  type IncomingMessage,
  type TelegramFileRef,
} from '../_shared/telegram.ts';
import { clockMinutes, fetchAttendance, ownerErrorText, ownerNeedsAttendance, ownerNeedsState, ownerReply, parseOwnerIds } from '../_shared/owner-bot.generated.js';
import { adminClientFor, adminSnapshotFor, linkOwnerChat, ownerOfChat } from '../_shared/owner-access.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const ownerIds = parseOwnerIds(Deno.env.get('OWNER_TELEGRAM_IDS'));
const ownerActions = Deno.env.get('OWNER_BOT_ACTIONS') === '1';
const timepayToken = Deno.env.get('TIMEPAY_TOKEN') ?? '';
const apiBase = (Deno.env.get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org').replace(/\/+$/, '');

let admin: SupabaseClient | null = null;
const client = () => {
  if (!admin) {
    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

class TelegramError extends Error {
  constructor(message: string) { super(message); this.name = 'TelegramError'; }
}

async function telegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiBase}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
  if (!response.ok || !data?.ok) throw new TelegramError(data?.description || `Telegram HTTP ${response.status}`);
  return data.result as T;
}

async function reply(chatId: string, text: string) {
  try {
    await telegram('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
  } catch {
    // A reply to an unlinked or blocked chat is best effort.
  }
}

// ── Owner bot ───────────────────────────────────────────────────────────────
// An owner chat is either listed in OWNER_TELEGRAM_IDS (the first, single-company setup) or linked
// by a company's owner with "/ulash CODE" from the settings screen. Reports are computed by the
// same domain code as the web app from that company's admin snapshot, so numbers cannot diverge.
const access = { url: supabaseUrl, serviceKey, anonKey };

type OwnerSnapshot = { actor?: unknown; state?: { revision?: number } } | null;

/** Stable per update and step, so a Telegram redelivery replays the same erp_execute request. */
async function requestIdFor(incoming: IncomingMessage, step: number): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(`owner-bot:${incoming.chatId}:${incoming.updateId}:${step}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const tashkentToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());

async function ownerAnswer(incoming: IncomingMessage, companyId: string | null): Promise<{ text: string; keyboard: string[][] }> {
  const input = incoming.startPayload !== null ? '/start' : incoming.text;
  if (!ownerNeedsState(input)) return ownerReply(input, null);
  const today = tashkentToday();
  // Timepay is configured by one server secret, so it belongs to the legacy (platform owner's) company only.
  if (timepayToken && companyId === null && ownerNeedsAttendance(input)) {
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    try {
      const data = await fetchAttendance(timepayToken, today, fetch);
      return ownerReply(input, null, today, ownerActions, { data, nowMinutes: clockMinutes(clock) });
    } catch (error) {
      console.error('Timepay failed', error instanceof Error ? error.message : 'unknown');
      return { text: '🕘 Timepay javob bermadi. Token va ruxsatlarni tekshiring (xodimlar, kelish/ketish, grafiklar).', keyboard: [] };
    }
  }
  let snapshot = await adminSnapshotFor(client(), access, companyId) as OwnerSnapshot;
  const answer = ownerReply(input, snapshot, today, ownerActions);
  if (!answer.commands?.length) return answer;
  // A confirmed action: run its commands in order, each against the revision the previous one returned.
  const scoped = await adminClientFor(client(), access, companyId);
  for (let step = 0; step < answer.commands.length; step += 1) {
    const executed = await scoped.rpc('erp_execute', {
      p_request_id: await requestIdFor(incoming, step),
      p_expected_revision: snapshot?.state?.revision ?? -1,
      p_command: answer.commands[step],
    });
    if (executed.error) {
      console.error('Owner bot command failed', executed.error.code);
      return { text: ownerErrorText(executed.error.message ?? ''), keyboard: answer.keyboard };
    }
    snapshot = executed.data as OwnerSnapshot;
  }
  const followUp = answer.followUp ? `\n\n${ownerReply(answer.followUp, snapshot, today, ownerActions).text}` : '';
  return { text: `${answer.text}${followUp}`, keyboard: answer.keyboard };
}

async function handleOwner(incoming: IncomingMessage, companyId: string | null) {
  let answer: { text: string; keyboard: string[][] };
  try {
    answer = await ownerAnswer(incoming, companyId);
  } catch (error) {
    console.error('Owner bot failed', error instanceof Error ? error.message : 'unknown');
    answer = { text: 'Hisobotni olishda xatolik. Birozdan keyin qayta urinib ko‘ring.', keyboard: [] };
  }
  try {
    await telegram('sendMessage', {
      chat_id: incoming.chatId,
      text: answer.text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(answer.keyboard.length
        ? { reply_markup: { keyboard: answer.keyboard.map(row => row.map(text => ({ text }))), resize_keyboard: true, is_persistent: true } }
        : {}),
    });
  } catch (error) {
    console.error('Owner bot reply failed', error instanceof Error ? error.name : 'unknown');
  }
}

async function handleStart(incoming: IncomingMessage) {
  const payload = incoming.startPayload ?? '';
  if (!payload) {
    await reply(incoming.chatId, 'Assalomu alaykum! Bu bot korxona mijozlari bilan aloqa uchun. Mijoz kartasidan bir martalik havola oling.');
    return;
  }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(payload)) {
    await reply(incoming.chatId, 'Havola kodi noto‘g‘ri. CRM’dan yangi havola oling.');
    return;
  }
  const lookup = await client()
    .from('erp_customers')
    .select('id, company_id, telegram_chat_id, telegram_link_expires_at')
    .eq('telegram_link_code', payload)
    .maybeSingle();
  if (lookup.error) {
    console.error('Telegram link lookup failed', lookup.error.code);
    await reply(incoming.chatId, 'Xatolik. Keyinroq qayta urinib ko‘ring.');
    return;
  }
  if (lookup.data) {
    await bindCustomer(lookup.data, incoming.chatId);
    return;
  }
  await reply(incoming.chatId, 'Havola topilmadi yoki muddati tugagan. CRM’dan yangi havola oling.');
}

async function bindCustomer(customer: {
  id: string; company_id: string; telegram_chat_id: string | null; telegram_link_expires_at: string | null;
}, chatId: string) {
  const expiresAt = customer.telegram_link_expires_at ? Date.parse(customer.telegram_link_expires_at) : 0;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await client().from('erp_customers')
      .update({ telegram_link_code: null, telegram_link_expires_at: null })
      .eq('id', customer.id).eq('company_id', customer.company_id);
    await reply(chatId, 'Havola muddati tugagan. CRM’dan yangi havola oling.');
    return;
  }
  if (customer.telegram_chat_id) {
    if (customer.telegram_chat_id !== chatId) {
      await reply(chatId, 'Bu havola boshqa Telegram chatga bog‘langan. CRM’dan yangi havola oling.');
      return;
    }
    await client().from('erp_customers')
      .update({ telegram_link_code: null, telegram_link_expires_at: null })
      .eq('id', customer.id).eq('company_id', customer.company_id);
    await reply(chatId, 'Bu chat allaqachon bog‘langan.');
    return;
  }
  const taken = await client()
    .from('erp_customers').select('id')
    .eq('telegram_chat_id', chatId).neq('id', customer.id).maybeSingle();
  if (taken.data) {
    await reply(chatId, 'Bu Telegram chat boshqa mijozga bog‘langan. CRM’dan yangi havola oling.');
    return;
  }
  const updated = await client().from('erp_customers')
    .update({
      telegram_chat_id: chatId,
      telegram_link_code: null,
      telegram_link_expires_at: null,
    })
    .eq('id', customer.id).eq('company_id', customer.company_id).is('telegram_chat_id', null)
    .select('id');
  if (updated.error) {
    if (updated.error.code === '23505') {
      await reply(chatId, 'Bu Telegram chat allaqachon boshqa mijozga bog‘langan.');
      return;
    }
    throw updated.error;
  }
  if (!updated.data?.length) {
    await reply(chatId, 'Havola allaqachon ishlatilgan. CRM’dan yangi havola oling.');
    return;
  }
  await reply(chatId, '✅ Telegram bog‘landi. Endi shu oynadan korxona bilan yozishishingiz mumkin.');
}

const ORDER_THREAD_WINDOW_MS = 72 * 60 * 60 * 1000;

async function orderIdForIncoming(
  companyId: string, customerId: string, replyToMessageId: number | null,
): Promise<string | null> {
  const base = () => client().from('erp_order_messages')
    .select('order_id, erp_orders!inner(customer_id)')
    .eq('company_id', companyId)
    .eq('erp_orders.customer_id', customerId);
  if (replyToMessageId !== null) {
    const byReply = await base().eq('telegram_message_id', replyToMessageId).maybeSingle();
    if (byReply.error) console.error('Order chat reply lookup failed', byReply.error.code);
    else if (byReply.data) return byReply.data.order_id;
  }
  const since = new Date(Date.now() - ORDER_THREAD_WINDOW_MS).toISOString();
  const latest = await base().gte('created_at', since)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (latest.error) {
    console.error('Order chat fallback lookup failed', latest.error.code);
    return null;
  }
  return latest.data?.order_id ?? null;
}

/** Best effort: the chat table may not exist until the migration is applied. */
async function mirrorOrderMessage(
  customer: { id: string; company_id: string; name: string }, incoming: IncomingMessage, text: string,
) {
  if (!text) return;
  try {
    const orderId = await orderIdForIncoming(customer.company_id, customer.id, incoming.replyToMessageId);
    if (!orderId) return;
    const { error } = await client().from('erp_order_messages').insert({
      company_id: customer.company_id,
      order_id: orderId,
      author_kind: 'client',
      author_profile_id: null,
      author_name: customer.name,
      text,
      channel: 'telegram',
      telegram_message_id: incoming.telegramMessageId,
      created_at: incoming.sentAt,
    });
    if (error) console.error('Order chat mirror failed', error.code);
  } catch (error) {
    console.error('Order chat mirror failed', error instanceof Error ? error.name : 'unknown');
  }
}

async function storeInboundFile(
  companyId: string, chatId: string, updateId: number, messageId: string,
  file: TelegramFileRef,
) {
  try {
    const info = await telegram<{ file_path?: string; file_size?: number }>('getFile', { file_id: file.fileId });
    if (!info?.file_path) throw new TelegramError('Telegram did not return a file path');
    const response = await fetch(`${apiBase}/file/bot${botToken}/${info.file_path}`);
    if (!response.ok) throw new TelegramError(`Telegram file download HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_TELEGRAM_FILE_BYTES) {
      await client().from('erp_messages')
        .update({ file_size: MAX_TELEGRAM_FILE_BYTES, text: `${file.fileName} — fayl 20 MB dan katta, yuklab olinmadi`.slice(0, 4096) })
        .eq('id', messageId);
      return;
    }
    const path = storagePathFor(companyId, 'inbound', chatId, updateId, file.fileName || sanitizeFileName(info.file_path));
    const upload = await client().storage.from('telegram-files').upload(path, bytes, {
      contentType: file.mimeType || 'application/octet-stream',
      upsert: false,
    });
    if (upload.error) throw upload.error;
    const signed = await client().storage.from('telegram-files').createSignedUrl(path, 60 * 60 * 24 * 7);
    await client().from('erp_messages')
      .update({ storage_path: path, file_url: signed.data?.signedUrl ?? null, file_size: bytes.byteLength })
      .eq('id', messageId);
  } catch (error) {
    // Never log the bot token or the download URL; the row stays visible with metadata.
    console.error('Telegram file processing failed', error instanceof Error ? error.name : 'unknown');
  }
}

serve(async request => {
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  if (!supabaseUrl || !serviceKey || !botToken || !webhookSecret) {
    return json({ ok: false, code: 'telegram_not_configured' }, 500);
  }
  const provided = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!constantTimeEqual(provided, webhookSecret)) return json({ ok: false }, 401);

  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ ok: true }); }
  const incoming = parseTelegramUpdate(payload);
  if (!incoming) return json({ ok: true });

  try {
    const linkCode = /^\/ulash\s+([A-Za-z0-9]{8})$/.exec(incoming.text.trim());
    if (linkCode) {
      const linked = await linkOwnerChat(client(), linkCode[1], incoming.chatId);
      if (linked) await handleOwner({ ...incoming, text: '/start', startPayload: null }, (await ownerOfChat(client(), incoming.chatId, ownerIds))?.companyId ?? null);
      else await reply(incoming.chatId, 'Kod noto‘g‘ri yoki muddati o‘tgan. Sozlamalardan yangi kod oling.');
      return json({ ok: true });
    }
    const owner = await ownerOfChat(client(), incoming.chatId, ownerIds);
    if (owner) {
      await handleOwner(incoming, owner.companyId);
      return json({ ok: true });
    }
    if (incoming.startPayload !== null) {
      await handleStart(incoming);
      return json({ ok: true });
    }

    const lookup = await client()
      .from('erp_customers').select('id, company_id, name')
      .eq('telegram_chat_id', incoming.chatId).maybeSingle();
    if (lookup.error) {
      console.error('Telegram customer lookup failed', lookup.error.code);
      return json({ ok: true });
    }
    if (!lookup.data) {
      await reply(incoming.chatId, 'Bu chat korxona mijoziga bog‘lanmagan. CRM’dagi mijoz kartasidan bir martalik havola oling.');
      return json({ ok: true });
    }
    const customer = lookup.data;
    const oversized = incoming.file ? incoming.file.fileSize > MAX_TELEGRAM_FILE_BYTES : false;
    const note = oversized ? '\n[Fayl 20 MB dan katta — yuklab olinmadi]' : '';
    const text = `${incoming.text}${note}`.trim().slice(0, 4096);

    const inserted = await client().from('erp_messages').insert({
      company_id: customer.company_id,
      client_id: customer.id,
      telegram_chat_id: incoming.chatId,
      sender: 'client',
      text,
      file_url: null,
      file_type: incoming.file && !oversized ? incoming.file.fileType : 'text',
      file_name: incoming.file?.fileName ?? null,
      file_size: incoming.file ? Math.min(incoming.file.fileSize, MAX_TELEGRAM_FILE_BYTES) : null,
      storage_path: null,
      telegram_message_id: incoming.telegramMessageId,
      telegram_update_id: incoming.updateId,
      is_read: false,
      created_at: incoming.sentAt,
    }).select('id').single();
    if (inserted.error) {
      if (inserted.error.code === '23505') return json({ ok: true, duplicate: true });
      console.error('Telegram message insert failed', inserted.error.code);
      return json({ ok: false }, 500);
    }
    const orderText = text || (incoming.file?.fileType === 'photo' ? '[Rasm]'
      : incoming.file?.fileType === 'voice' ? '[Ovozli xabar]'
        : incoming.file ? `[Fayl: ${incoming.file.fileName}]` : '');
    await mirrorOrderMessage(customer, incoming, orderText);
    if (incoming.file && !oversized) {
      const task = storeInboundFile(
        customer.company_id, incoming.chatId, incoming.updateId, inserted.data.id, incoming.file,
      );
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(task);
      else await task;
    }
    return json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook failed', error instanceof Error ? error.name : 'unknown');
    // Always acknowledge to stop Telegram retry storms; failures stay in function logs.
    return json({ ok: true });
  }
});
