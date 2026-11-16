// Owner-only cloud copies: store the whole company in private KV, list it, verify it and restore it.
// Deploy with platform JWT verification on. Secrets: SUPABASE_SERVICE_ROLE_KEY, ERP_BACKUP_GATE_URL,
// ERP_BACKUP_GATE_SECRET. The browser never sees any of them and never talks to the storage directly.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { sessionUserId } from '../_shared/session.ts';
import {
  copyMetaFromKey,
  copyObjectKey,
  isCopyFresh,
  parseCopy,
  playbackCopy,
  selectCopiesToDelete,
  verifyCopy,
  type CompanyCopy,
  type CopyMeta,
} from '../_shared/backup.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const gateUrl = (Deno.env.get('ERP_BACKUP_GATE_URL') ?? '').replace(/\/+$/, '');
const gateSecret = Deno.env.get('ERP_BACKUP_GATE_SECRET') ?? '';
const CONFIRM_WORD = 'TIKLASH';

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

interface Profile { id: string; company_id: string; name: string; role: string }
interface Body { action?: string; state?: unknown; key?: string; expectedRevision?: number; confirm?: string }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function client() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

function gate(path: string, init: RequestInit = {}) {
  if (!gateUrl || !gateSecret) throw new ApiError('storage_unavailable', 503);
  return fetch(`${gateUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), 'x-erp-upload-secret': gateSecret },
  });
}

function companyPrefix(companyId: string): string {
  return `companies/${companyId}/`;
}

// Only this company's own objects are ever reachable, whatever the caller sends as a key.
function ownedKey(key: unknown, companyId: string): string {
  const value = String(key ?? '');
  if (!value.startsWith(companyPrefix(companyId)) || !value.endsWith('.json')) throw new ApiError('copy_invalid', 400);
  return value;
}

async function requireAdmin(request: Request): Promise<{ profile: Profile; db: ReturnType<typeof client> }> {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new ApiError('auth_missing', 401);
  const db = client();
  const auth = await db.auth.getUser(token);
  if (auth.error) throw new ApiError('auth_invalid', 401);
  const userId = auth.user?.id || sessionUserId(token);
  if (!uuidPattern.test(userId)) throw new ApiError('auth_invalid', 401, 'Session subject is missing');
  const profileResult = await db.from('erp_profiles').select('id, company_id, name, role').eq('id', userId).maybeSingle();
  if (profileResult.error) throw new ApiError('database_error', 500, profileResult.error.code ?? '');
  const profile = profileResult.data as Profile | null;
  if (!profile) throw new ApiError('profile_missing', 403);
  if (profile.role !== 'admin') throw new ApiError('access_denied', 403);
  return { profile, db };
}

async function storeCopy(db: ReturnType<typeof client>, companyId: string, state: unknown): Promise<CopyMeta> {
  const dumped = await db.rpc('erp_backup_dump', { p_company_id: companyId, p_state: state ?? null });
  if (dumped.error) throw new ApiError(dumped.error.code === 'P0002' ? 'company_missing' : 'database_error', 500, dumped.error.code ?? '');
  const copy = dumped.data as CompanyCopy;
  const problems = verifyCopy(copy, companyId).problems;
  if (problems.length) throw new ApiError('copy_invalid', 500, problems.join(' '));

  const text = JSON.stringify(copy);
  const key = copyObjectKey(copy.companyId, copy.exportedAt, copy.revision);
  const put = await gate(`/${key}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: text,
  });
  if (!put.ok) throw new ApiError('storage_unavailable', 502);
  return { key, exportedAt: copy.exportedAt, revision: copy.revision, bytes: text.length };
}

async function listCopies(companyId: string): Promise<CopyMeta[]> {
  const listed = await gate(`/__list?prefix=${encodeURIComponent(companyPrefix(companyId))}`);
  if (!listed.ok) throw new ApiError('storage_unavailable', 502);
  const objects = (await listed.json() as { objects?: { key: string; size: number }[] }).objects ?? [];
  const copies: CopyMeta[] = [];
  for (const object of objects) {
    if (!object.key.startsWith(companyPrefix(companyId))) continue;
    const fromKey = copyMetaFromKey(object.key);
    copies.push({ key: object.key, exportedAt: fromKey.exportedAt, revision: fromKey.revision, bytes: object.size });
  }
  return copies.sort((left, right) => right.exportedAt.localeCompare(left.exportedAt));
}

async function readCopy(companyId: string, key: string): Promise<CompanyCopy> {
  const fetched = await gate(`/${key}`);
  if (fetched.status === 404) throw new ApiError('copy_missing', 404);
  if (!fetched.ok) throw new ApiError('storage_unavailable', 502);
  let copy: CompanyCopy;
  try {
    copy = parseCopy(await fetched.text());
  } catch (error) {
    throw new ApiError('copy_invalid', 400, (error as Error).message);
  }
  const problems = verifyCopy(copy, companyId).problems;
  if (problems.length) throw new ApiError('copy_invalid', 400, problems.join(' '));
  return copy;
}

async function pruneCopies(companyId: string, copies: CopyMeta[], now: string): Promise<string[]> {
  const doomed = selectCopiesToDelete(copies, now);
  for (const key of doomed) {
    const removed = await gate(`/${ownedKey(key, companyId)}`, { method: 'DELETE' });
    if (!removed.ok) console.error('Copy prune failed', removed.status);
  }
  return doomed;
}

async function currentRevision(db: ReturnType<typeof client>, companyId: string): Promise<number> {
  const row = await db.from('erp_metadata').select('revision').eq('company_id', companyId).maybeSingle();
  if (row.error) throw new ApiError('database_error', 500, row.error.code ?? '');
  return Number(row.data?.revision ?? 0);
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!supabaseUrl || !serviceKey) return json({ ok: false, code: 'not_configured', message: 'Edge Function secrets are missing' }, 500);

  let body: Body = {};
  try {
    body = await request.json() as Body;
  } catch {
    return json({ ok: false, code: 'bad_request', message: 'JSON body required' }, 400);
  }

  try {
    const { profile, db } = await requireAdmin(request);
    const companyId = profile.company_id;
    const action = String(body.action ?? '');
    const now = new Date().toISOString();

    if (action === 'put') {
      const copy = await storeCopy(db, companyId, body.state);
      const doomed = await pruneCopies(companyId, await listCopies(companyId), now);
      return json({ ok: true, copy, pruned: doomed.length });
    }

    if (action === 'list') {
      const copies = await listCopies(companyId);
      return json({ ok: true, copies, fresh: isCopyFresh(copies[0]?.exportedAt ?? null, now) });
    }

    if (action === 'get') {
      const copy = await readCopy(companyId, ownedKey(body.key, companyId));
      return json({ ok: true, document: copy });
    }

    if (action === 'verify') {
      const copy = await readCopy(companyId, ownedKey(body.key, companyId));
      const problems = [...verifyCopy(copy, companyId).problems, ...playbackCopy(copy).problems];
      const revision = await currentRevision(db, companyId);
      if (Number(copy.revision) > revision) problems.push(`nusxa versiyasi ${String(copy.revision)} joriy ${String(revision)} dan yangi — bu nusxa keyinroq holatni ko‘rsatadi.`);
      return json({ ok: true, verified: { ok: !problems.length, problems } });
    }

    if (action === 'restore') {
      if (String(body.confirm ?? '') !== CONFIRM_WORD) throw new ApiError('confirm_mismatch', 400);
      const copy = await readCopy(companyId, ownedKey(body.key, companyId));
      const playback = playbackCopy(copy);
      if (!playback.ok) throw new ApiError('copy_invalid', 400, playback.problems.join(' '));
      const expected = Number(body.expectedRevision);
      const live = await currentRevision(db, companyId);
      if (!Number.isInteger(expected) || expected !== live) {
        throw new ApiError('revision_conflict', 409, `Company is at ${String(live)}, copy expects ${String(expected)}`);
      }
      // The state block is the browser's view of the live company, which the check above
      // just proved is current, so the safety copy is itself a restorable copy.
      const safetyCopy = await storeCopy(db, companyId, body.state);
      const restored = await db.rpc('erp_backup_restore', { p_payload: copy, p_expected_revision: expected });
      if (restored.error) {
        const code = restored.error.code === '40001' ? 'revision_conflict' : restored.error.code === '22023' ? 'copy_invalid' : 'database_error';
        throw new ApiError(code, code === 'revision_conflict' ? 409 : code === 'copy_invalid' ? 400 : 500, restored.error.message ?? '');
      }
      const result = restored.data as { revision?: number; totalRows?: number };
      return json({ ok: true, revision: Number(result.revision ?? 0), restoredRows: Number(result.totalRows ?? 0), safetyCopy });
    }

    return json({ ok: false, code: 'bad_request', message: `Unknown action: ${action || '(none)'}` }, 400);
  } catch (error) {
    if (error instanceof ApiError) return json({ ok: false, code: error.code, message: error.message }, error.status);
    console.error('erp-backup failed', (error as Error).message);
    return json({ ok: false, code: 'server_error', message: 'Unexpected server error' }, 500);
  }
});
