// Server-side access for the owner bot and the watcher, per company.
// A company is reached through its admin profile: erp_snapshot()/erp_execute() resolve the caller
// by auth.uid(), so a short-lived session is opened with a service-role magic link (never sent out).
// `companyId: null` means the legacy single-company setup driven by the OWNER_TELEGRAM_IDS secret.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export interface AccessConfig { url: string; serviceKey: string; anonKey: string }
export interface OwnerTarget { companyId: string | null; chatIds: string[] }

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const sessions = new Map<string, { token: string; expiresAt: number }>();

/** The admin profile that represents the company (for the legacy setup — the platform owner). */
async function adminProfileId(service: SupabaseClient, companyId: string | null): Promise<string> {
  if (companyId) {
    const row = await service.from('erp_profiles').select('id').eq('role', 'admin').eq('company_id', companyId).limit(1).maybeSingle();
    if (row.error || !row.data) throw new Error('owner_profile_missing');
    return row.data.id;
  }
  // Before the platform migration the table does not exist: fall back to the only admin.
  const platform = await service.from('erp_platform_admins').select('user_id').limit(1).maybeSingle();
  if (!platform.error && platform.data) return platform.data.user_id;
  const row = await service.from('erp_profiles').select('id').eq('role', 'admin').limit(1).maybeSingle();
  if (row.error || !row.data) throw new Error('owner_profile_missing');
  return row.data.id;
}

async function adminToken(service: SupabaseClient, config: AccessConfig, companyId: string | null): Promise<string> {
  const cacheKey = companyId ?? 'legacy';
  const cached = sessions.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  const user = await service.auth.admin.getUserById(await adminProfileId(service, companyId));
  const email = user.data.user?.email;
  if (user.error || !email) throw new Error('owner_email_missing');
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || !tokenHash) throw new Error('owner_link_failed');
  const verified = await createClient(config.url, config.anonKey || config.serviceKey, options).auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  const session = verified.data.session;
  if (verified.error || !session) throw new Error('owner_session_failed');
  sessions.set(cacheKey, { token: session.access_token, expiresAt: (session.expires_at ?? 0) * 1000 });
  return session.access_token;
}

/** A client that acts as the company's admin (RLS and command rules apply as in the web app). */
export async function adminClientFor(service: SupabaseClient, config: AccessConfig, companyId: string | null): Promise<SupabaseClient> {
  const token = await adminToken(service, config, companyId);
  return createClient(config.url, config.anonKey || config.serviceKey, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
}

export async function adminSnapshotFor(service: SupabaseClient, config: AccessConfig, companyId: string | null): Promise<unknown> {
  const snapshot = await (await adminClientFor(service, config, companyId)).rpc('erp_snapshot');
  if (snapshot.error) {
    sessions.delete(companyId ?? 'legacy');
    throw new Error('owner_snapshot_failed');
  }
  return snapshot.data;
}

/** Whose owner is writing: a legacy id from the secret, or a chat linked by a company's owner. */
export async function ownerOfChat(service: SupabaseClient, chatId: string, legacyIds: string[]): Promise<{ companyId: string | null } | null> {
  if (legacyIds.includes(chatId)) return { companyId: null };
  const row = await service.from('erp_owner_chats').select('company_id').eq('telegram_chat_id', chatId).maybeSingle();
  if (row.error || !row.data) return null; // also when the table is not created yet
  return { companyId: row.data.company_id };
}

/** "/ulash CODE" from the settings screen: binds this chat to the company that issued the code. */
export async function linkOwnerChat(service: SupabaseClient, code: string, chatId: string): Promise<boolean> {
  const found = await service.from('erp_owner_link_codes').select('company_id, profile_id, expires_at').eq('code', code.toUpperCase()).maybeSingle();
  if (found.error || !found.data || Date.parse(found.data.expires_at) <= Date.now()) return false;
  const saved = await service.from('erp_owner_chats').upsert(
    { telegram_chat_id: chatId, company_id: found.data.company_id, profile_id: found.data.profile_id },
    { onConflict: 'telegram_chat_id' },
  );
  if (saved.error) return false;
  await service.from('erp_owner_link_codes').delete().eq('code', code.toUpperCase());
  return true;
}

/** Everyone the watcher reports to: the legacy owner plus every company with a linked chat. */
export async function ownerTargets(service: SupabaseClient, legacyIds: string[]): Promise<OwnerTarget[]> {
  const targets: OwnerTarget[] = legacyIds.length ? [{ companyId: null, chatIds: legacyIds }] : [];
  const rows = await service.from('erp_owner_chats').select('company_id, telegram_chat_id');
  if (rows.error) return targets;
  const byCompany = new Map<string, string[]>();
  for (const row of rows.data ?? []) byCompany.set(row.company_id, [...(byCompany.get(row.company_id) ?? []), row.telegram_chat_id]);
  for (const [companyId, chatIds] of byCompany) targets.push({ companyId, chatIds });
  return targets;
}
