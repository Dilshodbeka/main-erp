// Web Push delivery for the watcher: server keys, the company's subscribed devices and sending.
// The crypto lives in src/webpush.ts (bundled into owner-bot.generated.js).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { allowedPushEndpoint, generateVapidKeys, pushGone, pushRequest } from './owner-bot.generated.js';

export interface PushKeys { publicKey: string; privateKey: JsonWebKey }
export interface Device { endpoint: string; p256dh: string; auth: string; role: string; employeeId: string | null }

let cached: PushKeys | null = null;

/** Server keys are created on the first run and kept in a table only the service role can read. */
export async function pushKeys(service: SupabaseClient): Promise<PushKeys | null> {
  if (cached) return cached;
  let row = await service.from('erp_push_keys').select('public_key, private_key').limit(1).maybeSingle();
  if (row.error) return null; // the push migration is not applied yet
  if (!row.data) {
    const fresh = await generateVapidKeys();
    await service.from('erp_push_keys').upsert({ id: true, public_key: fresh.publicKey, private_key: fresh.privateKey }, { onConflict: 'id', ignoreDuplicates: true });
    row = await service.from('erp_push_keys').select('public_key, private_key').limit(1).maybeSingle();
    if (row.error || !row.data) return null;
  }
  cached = { publicKey: row.data.public_key, privateKey: row.data.private_key as JsonWebKey };
  return cached;
}

/** Companies that have at least one subscribed device. */
export async function pushCompanies(service: SupabaseClient): Promise<string[]> {
  const rows = await service.from('erp_push_subscriptions').select('company_id');
  if (rows.error) return [];
  return [...new Set((rows.data ?? []).map(row => row.company_id as string))];
}

export async function companyDevices(service: SupabaseClient, companyId: string): Promise<Device[]> {
  const subscriptions = await service.from('erp_push_subscriptions').select('endpoint, p256dh, auth, user_id').eq('company_id', companyId);
  if (subscriptions.error || !subscriptions.data?.length) return [];
  const profiles = await service.from('erp_profiles').select('id, role, employee_id').eq('company_id', companyId);
  const byUser = new Map((profiles.data ?? []).map(row => [row.id as string, row]));
  return subscriptions.data.flatMap(row => {
    const profile = byUser.get(row.user_id as string);
    return profile ? [{ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth, role: profile.role as string, employeeId: (profile.employee_id as string | null) ?? null }] : [];
  });
}

/** Sends one notification to one device; a subscription the browser dropped is removed. */
export async function deliver(service: SupabaseClient, device: Device, message: unknown, keys: PushKeys, subject: string): Promise<boolean> {
  if (!allowedPushEndpoint(device.endpoint)) return false;
  try {
    const request = await pushRequest(device, message, keys, subject, Math.floor(Date.now() / 1000));
    const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body });
    if (pushGone(response.status)) await service.from('erp_push_subscriptions').delete().eq('endpoint', device.endpoint);
    return response.ok;
  } catch (error) {
    console.error('Push failed', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

export async function deliverAll(service: SupabaseClient, devices: Device[], message: unknown, keys: PushKeys, subject: string): Promise<boolean> {
  return (await Promise.all(devices.map(device => deliver(service, device, message, keys, subject)))).some(Boolean);
}
