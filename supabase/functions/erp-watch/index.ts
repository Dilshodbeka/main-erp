// Scheduled watcher ("nazoratchi"): checks the ERP for stuck orders, missed dates, old debts and low
// stock, and sends the owner one Telegram digest with what is new. Called by pg_cron (see
// scripts/watch-cron.sql). Deploy without platform JWT verification:
//   supabase functions deploy erp-watch --no-verify-jwt
// Secrets: WATCH_SECRET (shared with the cron job), TELEGRAM_BOT_TOKEN. Recipients: OWNER_TELEGRAM_IDS
// (first company) and every chat a company owner linked with /ulash (table erp_owner_chats).
// Optional: TIMEPAY_TOKEN adds attendance control (late, absent, left early) from Timepay.
// Web Push (after migration 20261202_push.sql): the same news goes to the owner's subscribed devices and
// workers get "a task is waiting for you"; server keys are created here on the first run.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { constantTimeEqual } from '../_shared/telegram.ts';
import { clockMinutes, fetchAttendance, parseOwnerIds, watchRun } from '../_shared/owner-bot.generated.js';
import { adminSnapshotFor, ownerTargets, type OwnerTarget } from '../_shared/owner-access.ts';
import { staffPass, staffSettings } from '../_shared/staff.ts';
import { companyDevices, deliverAll, pushCompanies, pushKeys, type PushKeys } from '../_shared/push.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const watchSecret = Deno.env.get('WATCH_SECRET') ?? '';
const timepayToken = Deno.env.get('TIMEPAY_TOKEN') ?? '';
const ownerIds = parseOwnerIds(Deno.env.get('OWNER_TELEGRAM_IDS'));
const apiBase = (Deno.env.get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org').replace(/\/+$/, '');
const timeZone = Deno.env.get('WATCH_TIME_ZONE') ?? 'Asia/Tashkent';
// Push services want a contact of the sender: an https address or mailto.
const pushSubject = Deno.env.get('PUSH_CONTACT') ?? supabaseUrl;

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let service: SupabaseClient | null = null;
const client = () => service ??= createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** Telegram caps a message at 4096 characters: split on line breaks well below that. */
function chunks(text: string, limit = 3800): string[] {
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > limit) { parts.push(current); current = ''; }
    current += (current ? '\n' : '') + line;
  }
  if (current) parts.push(current);
  return parts;
}

async function send(chatId: string, text: string, keyboard?: string[][]): Promise<boolean> {
  let delivered = true;
  for (const part of chunks(text)) {
    const response = await fetch(`${apiBase}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
        ...(keyboard?.length ? { reply_markup: { keyboard: keyboard.map(row => row.map(label => ({ text: label }))), resize_keyboard: true, is_persistent: true } } : {}) }),
    });
    if (!response.ok) delivered = false;
  }
  return delivered;
}

function localClock(now: Date): { today: string; hour: number; minutes: number } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  const minutes = clockMinutes(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now));
  return { today, hour: Math.floor(minutes / 60), minutes };
}

/** Timepay being down or misconfigured must never stop the ERP checks. */
async function attendance(today: string, nowMinutes: number) {
  if (!timepayToken) return null;
  try {
    return { data: await fetchAttendance(timepayToken, today, fetch), nowMinutes };
  } catch (error) {
    console.error('Timepay failed', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

type Snapshot = { state?: { companyId?: string } } | null;

/** One company: check, send what is due to its owner chats and devices, remember what was sent. */
async function watchCompany(target: OwnerTarget, now: Date, dry: boolean, keys: PushKeys | null): Promise<Record<string, unknown>> {
  const snapshot = await adminSnapshotFor(client(), { url: supabaseUrl, serviceKey, anonKey }, target.companyId) as Snapshot;
  const companyId = snapshot?.state?.companyId;
  if (!companyId) throw new Error('company_missing');
  const { today, hour, minutes } = localClock(now);

  const stored = await client().from('erp_watch_sent').select('key, sent_at').eq('company_id', companyId);
  if (stored.error) throw new Error('watch_table_missing');
  const sent = Object.fromEntries((stored.data ?? []).map(row => [row.key, row.sent_at]));

  // Timepay is one server secret, so attendance belongs to the legacy (platform owner's) company.
  // With the attendance dialog switched on (migration 20261208) the bot asks the worker and the director
  // itself, so the plain "late / absent" notices would only repeat it.
  const dialog = target.companyId === null && timepayToken ? await staffSettings(client(), companyId) : null;
  const staff = target.companyId === null && !dialog?.enabled ? await attendance(today, minutes) : null;
  // Recommendations the owner already handled or postponed stay out of the morning digest.
  const marks = await client().from('erp_insights').select('key').eq('company_id', companyId).gt('hidden_until', now.toISOString());
  const result = watchRun(snapshot, sent, now.toISOString(), today, hour, staff, marks.error ? [] : (marks.data ?? []).map(row => row.key as string));
  const devices = keys ? await companyDevices(client(), companyId) : [];
  if (dry) return { companyId, dry: true, active: result.activeKeys.length, due: result.sentKeys.length, workers: result.workers.length, digest: result.digest?.text ?? null, devices: devices.length, text: result.text };

  // Situations that no longer exist are forgotten, so they are announced again if they come back.
  const gone = Object.keys(sent).filter(key => !result.activeKeys.includes(key));
  if (gone.length) await client().from('erp_watch_sent').delete().eq('company_id', companyId).in('key', gone);

  const announced: string[] = [];
  // Workers: "a task is waiting for you" — only to that worker's own devices.
  for (const notice of keys ? result.workers : []) {
    const own = devices.filter(device => device.employeeId === notice.employeeId);
    if (own.length && await deliverAll(client(), own, notice.message, keys!, pushSubject)) announced.push(notice.key);
  }
  // Owner: Telegram and the owner's devices; either channel reaching them counts as delivered.
  if (result.text) {
    const byTelegram = (await Promise.all(target.chatIds.map(id => send(id, result.text!)))).some(Boolean);
    const admins = devices.filter(device => device.role === 'admin');
    const byPush = Boolean(keys && result.push && admins.length && await deliverAll(client(), admins, result.push, keys, pushSubject));
    if (byTelegram || byPush) announced.push(...result.sentKeys);
  }
  if (result.digest) {
    const byTelegram = (await Promise.all(target.chatIds.map(id => send(id, result.digest!.text)))).some(Boolean);
    const admins = devices.filter(device => device.role === 'admin');
    const byPush = Boolean(keys && admins.length && await deliverAll(client(), admins, result.digest.push, keys, pushSubject));
    if (byTelegram || byPush) announced.push(result.digest.key);
  }
  if (announced.length) {
    await client().from('erp_watch_sent').upsert(
      announced.map(key => ({ company_id: companyId, key, sent_at: now.toISOString() })),
      { onConflict: 'company_id,key' },
    );
  }
  return { companyId, sent: announced.length, active: result.activeKeys.length, devices: devices.length };
}

/** Files of cancelled orders' chats: removed from storage, then forgotten. Never blocks the watcher. */
async function purgeChatTrash(): Promise<number> {
  try {
    const rows = await client().from('erp_order_chat_trash').select('path').limit(500);
    if (rows.error || !rows.data?.length) return 0;
    const paths = rows.data.map(row => row.path as string);
    const removed = await client().storage.from('order-chat').remove(paths);
    if (removed.error) return 0;
    await client().from('erp_order_chat_trash').delete().in('path', paths);
    return paths.length;
  } catch {
    return 0;
  }
}

serve(async request => {
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  if (!supabaseUrl || !serviceKey || !botToken || !watchSecret) return json({ ok: false, code: 'watch_not_configured' }, 500);
  if (!constantTimeEqual(request.headers.get('x-watch-secret') ?? '', watchSecret)) return json({ ok: false }, 401);
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const now = new Date();
  // "?staff=1" — the frequent pass (every 2 minutes): attendance questions and KPI only.
  if (new URL(request.url).searchParams.get('staff') === '1') {
    try {
      const { today, minutes } = localClock(now);
      const chats = (await ownerTargets(client(), ownerIds)).find(target => target.companyId === null)?.chatIds ?? ownerIds;
      return json({ ok: true, ...(await staffPass(client(), timepayToken, chats, send, { today, minutes, nowIso: now.toISOString() }, dry)) });
    } catch (error) {
      console.error('Staff pass failed', error instanceof Error ? error.message : 'unknown');
      return json({ ok: false, code: 'staff_pass_failed' });
    }
  }
  const results: Record<string, unknown>[] = [];
  const keys = await pushKeys(client());
  const seen = new Set<string>();
  const run = async (target: OwnerTarget) => {
    // Companies are independent: one failing must not silence the others.
    try {
      const row = await watchCompany(target, now, dry, keys);
      seen.add(String(row.companyId));
      results.push(row);
    } catch (error) {
      console.error('Watcher failed', error instanceof Error ? error.message : 'unknown');
      results.push({ companyId: target.companyId, error: error instanceof Error ? error.message : 'unknown' });
    }
  };
  const targets = await ownerTargets(client(), ownerIds);
  for (const target of targets) await run(target);
  // Companies that use only browser notifications (no Telegram chat linked).
  if (keys) {
    const linked = new Set(targets.map(target => target.companyId));
    for (const companyId of await pushCompanies(client())) {
      if (!seen.has(companyId) && !linked.has(companyId)) await run({ companyId, chatIds: [] });
    }
  }
  const purged = dry ? 0 : await purgeChatTrash();
  return json({ ok: results.every(row => !row.error), companies: results.length, purgedFiles: purged, results });
});
