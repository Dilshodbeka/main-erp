// Scheduled watcher ("nazoratchi"): checks the ERP for stuck orders, missed dates, old debts and low
// stock, and sends the owner one Telegram digest with what is new. Called by pg_cron (see
// scripts/watch-cron.sql). Deploy without platform JWT verification:
//   supabase functions deploy erp-watch --no-verify-jwt
// Secrets: WATCH_SECRET (shared with the cron job), OWNER_TELEGRAM_IDS, TELEGRAM_BOT_TOKEN.
// Optional: TIMEPAY_TOKEN adds attendance control (late, absent, left early) from Timepay.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { constantTimeEqual } from '../_shared/telegram.ts';
import { clockMinutes, fetchAttendance, parseOwnerIds, watchRun } from '../_shared/owner-bot.generated.js';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const watchSecret = Deno.env.get('WATCH_SECRET') ?? '';
const timepayToken = Deno.env.get('TIMEPAY_TOKEN') ?? '';
const ownerIds = parseOwnerIds(Deno.env.get('OWNER_TELEGRAM_IDS'));
const apiBase = (Deno.env.get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org').replace(/\/+$/, '');
const timeZone = Deno.env.get('WATCH_TIME_ZONE') ?? 'Asia/Tashkent';

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let service: SupabaseClient | null = null;
const client = () => service ??= createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** erp_snapshot() needs auth.uid(): open a short-lived session for the company's admin profile. */
async function adminSnapshot(): Promise<{ state?: { companyId?: string } } | null> {
  const profile = await client().from('erp_profiles').select('id').eq('role', 'admin').limit(1).maybeSingle();
  if (profile.error || !profile.data) throw new Error('owner_profile_missing');
  const user = await client().auth.admin.getUserById(profile.data.id);
  const email = user.data.user?.email;
  if (user.error || !email) throw new Error('owner_email_missing');
  const link = await client().auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || !tokenHash) throw new Error('owner_link_failed');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const verified = await createClient(supabaseUrl, anonKey || serviceKey, options).auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  const token = verified.data.session?.access_token;
  if (verified.error || !token) throw new Error('owner_session_failed');
  const scoped = createClient(supabaseUrl, anonKey || serviceKey, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
  const snapshot = await scoped.rpc('erp_snapshot');
  if (snapshot.error) throw new Error('owner_snapshot_failed');
  return snapshot.data;
}

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

async function send(chatId: string, text: string): Promise<boolean> {
  let delivered = true;
  for (const part of chunks(text)) {
    const response = await fetch(`${apiBase}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
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

serve(async request => {
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  if (!supabaseUrl || !serviceKey || !botToken || !watchSecret || !ownerIds.length) return json({ ok: false, code: 'watch_not_configured' }, 500);
  if (!constantTimeEqual(request.headers.get('x-watch-secret') ?? '', watchSecret)) return json({ ok: false }, 401);
  const dry = new URL(request.url).searchParams.get('dry') === '1';

  try {
    const snapshot = await adminSnapshot();
    const companyId = snapshot?.state?.companyId;
    if (!companyId) throw new Error('company_missing');
    const now = new Date();
    const { today, hour, minutes } = localClock(now);

    const stored = await client().from('erp_watch_sent').select('key, sent_at').eq('company_id', companyId);
    if (stored.error) throw new Error('watch_table_missing');
    const sent = Object.fromEntries((stored.data ?? []).map(row => [row.key, row.sent_at]));

    const result = watchRun(snapshot, sent, now.toISOString(), today, hour, await attendance(today, minutes));
    if (dry) return json({ ok: true, dry: true, active: result.activeKeys.length, due: result.sentKeys.length, text: result.text });

    // Situations that no longer exist are forgotten, so they are announced again if they come back.
    const gone = Object.keys(sent).filter(key => !result.activeKeys.includes(key));
    if (gone.length) await client().from('erp_watch_sent').delete().eq('company_id', companyId).in('key', gone);

    if (!result.text) return json({ ok: true, sent: 0, active: result.activeKeys.length });
    const delivered = (await Promise.all(ownerIds.map(id => send(id, result.text!)))).some(Boolean);
    if (delivered) {
      await client().from('erp_watch_sent').upsert(
        result.sentKeys.map(key => ({ company_id: companyId, key, sent_at: now.toISOString() })),
        { onConflict: 'company_id,key' },
      );
    }
    return json({ ok: delivered, sent: delivered ? result.sentKeys.length : 0, active: result.activeKeys.length });
  } catch (error) {
    console.error('Watcher failed', error instanceof Error ? error.message : 'unknown');
    return json({ ok: false, code: error instanceof Error ? error.message : 'unknown' }, 500);
  }
});
