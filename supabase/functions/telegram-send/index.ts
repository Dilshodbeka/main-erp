// Authenticated CRM -> Telegram actions. Deploy with platform JWT verification on.
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME (without @).
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  chatFileKind,
  isStoragePathAllowed,
  isStorageReadAllowed,
  normalizeChatId,
  sanitizeFileName,
  validateOutboundFile,
} from '../_shared/telegram.ts';
import { sessionUserId } from '../_shared/session.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const botUsername = (Deno.env.get('TELEGRAM_BOT_USERNAME') ?? '').replace(/^@/, '');
const apiBase = (Deno.env.get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org').replace(/\/+$/, '');
const linkTtlMs = 24 * 60 * 60 * 1000;

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400, detail = '') {
    super(detail || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

interface Profile { id: string; company_id: string; role: string; name: string }
interface Customer { id: string; name: string; telegram_chat_id: string | null }
interface Body {
  action?: string;
  customerId?: string;
  orderId?: string;
  text?: string;
  chatId?: string;
  storagePath?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  caption?: string;
}

function mapTelegramError(description: string): string {
  const value = description.toLowerCase();
  if (value.includes('blocked')) return 'telegram_blocked';
  if (value.includes('chat not found')) return 'telegram_chat_not_found';
  if (value.includes('not enough rights') || value.includes('forbidden')) return 'telegram_forbidden';
  if (value.includes('too large') || value.includes('too big')) return 'file_too_large';
  return 'telegram_api_error';
}

async function telegram<T>(method: string, payload: Record<string, unknown> | FormData): Promise<T> {
  const response = await fetch(`${apiBase}/bot${botToken}/${method}`, {
    method: 'POST',
    ...(payload instanceof FormData ? { body: payload } : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
  if (!response.ok || !data?.ok) {
    throw new ApiError(mapTelegramError(data?.description ?? ''), 502, 'Telegram rejected the request');
  }
  return data.result as T;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadCustomer(admin: SupabaseClient, companyId: string, customerId: string | undefined): Promise<Customer> {
  if (!customerId || !uuidPattern.test(customerId)) throw new ApiError('customer_not_found', 404);
  const { data, error } = await admin.from('erp_customers')
    .select('id, name, telegram_chat_id')
    .eq('company_id', companyId).eq('id', customerId).maybeSingle();
  if (error) throw databaseError(error.code);
  if (!data) throw new ApiError('customer_not_found', 404);
  return data as Customer;
}

function databaseError(code?: string): ApiError {
  if (code === '42P01' || code === 'PGRST205') return new ApiError('table_missing', 500);
  return new ApiError('telegram_api_error', 500);
}

async function insertMessage(admin: SupabaseClient, row: Record<string, unknown>) {
  const { data, error } = await admin.from('erp_messages').insert(row).select('*').single();
  if (error) throw databaseError(error.code);
  return data;
}

async function loadOrder(admin: SupabaseClient, companyId: string, orderId: string, customerId: string) {
  if (!uuidPattern.test(orderId)) throw new ApiError('order_not_found', 404);
  const { data, error } = await admin.from('erp_orders')
    .select('id, number, customer_id')
    .eq('company_id', companyId).eq('id', orderId).maybeSingle();
  if (error) throw databaseError(error.code);
  if (!data || data.customer_id !== customerId) throw new ApiError('order_not_found', 404);
  return data as { id: string; number: string; customer_id: string };
}

async function insertOrderMessage(admin: SupabaseClient, row: Record<string, unknown>) {
  const { data, error } = await admin.from('erp_order_messages').insert(row).select('*').single();
  if (error) throw new ApiError('order_chat_failed', 500, error.message);
  return data;
}

async function handle(body: Body, profile: Profile, admin: SupabaseClient): Promise<Record<string, unknown>> {
  const action = body.action;
  if (!action) throw new ApiError('invalid_body', 400);

  if (action === 'mark-read') {
    await loadCustomer(admin, profile.company_id, body.customerId);
    const { error } = await admin.from('erp_messages').update({ is_read: true })
      .eq('company_id', profile.company_id).eq('client_id', body.customerId).eq('is_read', false);
    if (error) throw databaseError(error.code);
    return { ok: true };
  }

  if (action === 'file-url') {
    const path = String(body.storagePath ?? '');
    if (!isStorageReadAllowed(path, profile.company_id)) throw new ApiError('storage_path_denied', 403);
    const { data, error } = await admin.storage.from('telegram-files').createSignedUrl(path, 600);
    if (error || !data?.signedUrl) throw new ApiError('file_not_found', 404);
    return { ok: true, url: data.signedUrl };
  }

  if (action === 'create-link') {
    const customer = await loadCustomer(admin, profile.company_id, body.customerId);
    if (customer.telegram_chat_id) throw new ApiError('already_linked', 409);
    if (!botUsername) throw new ApiError('telegram_not_configured', 500);
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
      const expiresAt = new Date(Date.now() + linkTtlMs).toISOString();
      const { data, error } = await admin.from('erp_customers')
        .update({ telegram_link_code: code, telegram_link_expires_at: expiresAt })
        .eq('company_id', profile.company_id).eq('id', customer.id).is('telegram_chat_id', null)
        .select('id');
      if (error) {
        if (error.code === '23505') continue;
        throw databaseError(error.code);
      }
      if (!data?.length) throw new ApiError('already_linked', 409);
      return { ok: true, code, url: `https://t.me/${botUsername}?start=${code}`, expiresAt };
    }
    throw new ApiError('link_code_invalid', 503);
  }

  if (action === 'link') {
    const chatId = normalizeChatId(body.chatId);
    if (!chatId) throw new ApiError('invalid_chat_id', 400);
    const customer = await loadCustomer(admin, profile.company_id, body.customerId);
    if (customer.telegram_chat_id === chatId) return { ok: true };
    if (customer.telegram_chat_id) throw new ApiError('already_linked', 409);
    const taken = await admin.from('erp_customers').select('id')
      .eq('telegram_chat_id', chatId).neq('id', customer.id).maybeSingle();
    if (taken.error) throw databaseError(taken.error.code);
    if (taken.data) throw new ApiError('telegram_chat_taken', 409);
    const updated = await admin.from('erp_customers')
      .update({ telegram_chat_id: chatId, telegram_link_code: null, telegram_link_expires_at: null })
      .eq('company_id', profile.company_id).eq('id', customer.id).is('telegram_chat_id', null)
      .select('id');
    if (updated.error) {
      if (updated.error.code === '23505') throw new ApiError('telegram_chat_taken', 409);
      throw databaseError(updated.error.code);
    }
    if (!updated.data?.length) throw new ApiError('already_linked', 409);
    return { ok: true };
  }

  if (action === 'unlink') {
    const customer = await loadCustomer(admin, profile.company_id, body.customerId);
    const { error } = await admin.from('erp_customers')
      .update({ telegram_chat_id: null, telegram_link_code: null, telegram_link_expires_at: null })
      .eq('company_id', profile.company_id).eq('id', customer.id);
    if (error) throw databaseError(error.code);
    return { ok: true };
  }

  const customer = await loadCustomer(admin, profile.company_id, body.customerId);
  const chatId = customer.telegram_chat_id;
  if (!chatId) throw new ApiError('no_chat_link', 409);

  if (action === 'send-text') {
    const text = String(body.text ?? '').trim();
    if (!text) throw new ApiError('empty_message', 400);
    if (text.length > 4096) throw new ApiError('message_too_long', 400);
    const order = body.orderId ? await loadOrder(admin, profile.company_id, body.orderId, customer.id) : null;
    const sent = await telegram<{ message_id: number; date: number }>('sendMessage', {
      chat_id: chatId, text: order ? `${order.number}: ${text}`.slice(0, 4096) : text,
      link_preview_options: { is_disabled: true },
    });
    const createdAt = new Date(sent.date * 1000).toISOString();
    const row = await insertMessage(admin, {
      company_id: profile.company_id, client_id: customer.id, telegram_chat_id: chatId,
      sender: 'operator', text, file_url: null, file_type: 'text', file_name: null, file_size: null,
      storage_path: null, is_read: true, telegram_message_id: sent.message_id,
      created_at: createdAt,
    });
    const orderMessage = order ? await insertOrderMessage(admin, {
      company_id: profile.company_id, order_id: order.id, author_kind: profile.role,
      author_profile_id: profile.id, author_name: profile.name, text, channel: 'telegram',
      telegram_message_id: sent.message_id, created_at: createdAt,
    }) : null;
    return { ok: true, message: row, orderMessage };
  }

  if (action === 'send-file') {
    const path = String(body.storagePath ?? '');
    if (!isStoragePathAllowed(path, profile.company_id)) throw new ApiError('storage_path_denied', 403);
    const fileName = sanitizeFileName(String(body.fileName || path.split('/').pop() || 'file'));
    const size = Number(body.fileSize);
    const allowed = validateOutboundFile({ name: fileName, size });
    if (!allowed.ok) throw new ApiError(allowed.code, 400);
    const download = await admin.storage.from('telegram-files').download(path);
    if (download.error || !download.data) throw new ApiError('file_not_found', 404);
    const caption = String(body.caption ?? '').trim().slice(0, 1024);
    const form = new FormData();
    form.append('chat_id', chatId);
    if (caption) form.append('caption', caption);
    form.append('document', download.data, fileName);
    const sent = await telegram<{ message_id: number; date: number }>('sendDocument', form);
    const row = await insertMessage(admin, {
      company_id: profile.company_id, client_id: customer.id, telegram_chat_id: chatId,
      sender: 'operator', text: caption, file_url: null,
      file_type: chatFileKind({ name: fileName, mime: String(body.mimeType ?? download.data.type ?? '') }),
      file_name: fileName, file_size: download.data.size, storage_path: path,
      is_read: true, telegram_message_id: sent.message_id,
      created_at: new Date(sent.date * 1000).toISOString(),
    });
    return { ok: true, message: row };
  }

  throw new ApiError('invalid_action', 400);
}

serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  if (!supabaseUrl || !serviceKey || !botToken) {
    return json({ ok: false, code: 'telegram_not_configured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new ApiError('auth_missing', 401);
    const auth = await admin.auth.getUser(token);
    if (auth.error) throw new ApiError('auth_invalid', 401);
    const userId = auth.user?.id || sessionUserId(token);
    if (!uuidPattern.test(userId)) throw new ApiError('auth_invalid', 401, 'Session subject is missing');
    const profileResult = await admin.from('erp_profiles')
      .select('id, company_id, role, name').eq('id', userId).maybeSingle();
    if (profileResult.error) throw databaseError(profileResult.error.code);
    const profile = profileResult.data as Profile | null;
    if (!profile) throw new ApiError('profile_missing', 403);
    if (profile.role !== 'admin') throw new ApiError('access_denied', 403);
    let body: Body;
    try { body = await request.json() as Body; } catch { throw new ApiError('invalid_body', 400); }
    return json(await handle(body, profile, admin));
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    console.error('Telegram send failed', error instanceof Error ? error.name : 'unknown');
    return json({ ok: false, code: 'telegram_api_error' }, 502);
  }
});
