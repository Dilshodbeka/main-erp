import type { State } from './types';
import { supabase } from './repository';
import { isCopyFresh, type CompanyCopy, type CopyMeta } from '../supabase/functions/_shared/backup';

export class CloudBackupError extends Error {
  code: string;
  constructor(code: string, message = '') {
    super(message || code);
    this.name = 'CloudBackupError';
    this.code = code;
  }
}

export const CONFIRM_WORD = 'TIKLASH';

interface Reply {
  ok?: boolean;
  code?: string;
  message?: unknown;
  copy?: CopyMeta;
  copies?: CopyMeta[];
  document?: CompanyCopy;
  verified?: { ok: boolean; problems: string[] };
  revision?: number;
  safetyCopy?: CopyMeta | null;
}

async function call(body: Record<string, unknown>): Promise<Reply> {
  if (!supabase) throw new CloudBackupError('not_configured');
  const { data: current } = await supabase.auth.getSession();
  const token = current.session?.access_token;
  if (!token) throw new CloudBackupError('session_missing');
  const { data, error } = await supabase.functions.invoke('erp-backup', {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    let reply: Reply | null = null;
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context?.json) {
      try { reply = await context.json() as Reply; } catch { reply = null; }
    }
    throw new CloudBackupError(String(reply?.code || 'network'), String(reply?.message || error.message));
  }
  const reply = data as Reply | null;
  if (!reply) throw new CloudBackupError('network');
  if (reply.ok === false) throw new CloudBackupError(String(reply.code || 'network'), String(reply.message || ''));
  return reply;
}

export async function createCloudCopy(state: State): Promise<CopyMeta> {
  const reply = await call({ action: 'put', state });
  if (!reply.copy) throw new CloudBackupError('network');
  return reply.copy;
}

export interface CloudStatus { copies: CopyMeta[]; latest: CopyMeta | null; fresh: boolean }

export async function listCloudCopies(now: string = new Date().toISOString()): Promise<CloudStatus> {
  const reply = await call({ action: 'list' });
  const copies = Array.isArray(reply.copies) ? [...reply.copies] : [];
  copies.sort((left, right) => right.exportedAt.localeCompare(left.exportedAt));
  const latest = copies[0] ?? null;
  return { copies, latest, fresh: isCopyFresh(latest?.exportedAt ?? null, now) };
}

export interface DailyCopyResult { ran: boolean; fresh: boolean; copy?: CopyMeta }

export async function ensureDailyCopy(state: State, now: string = new Date().toISOString()): Promise<DailyCopyResult> {
  const status = await listCloudCopies(now);
  if (status.fresh) return { ran: false, fresh: true };
  const copy = await createCloudCopy(state);
  return { ran: true, fresh: false, copy };
}

export async function readCloudCopy(key: string): Promise<CompanyCopy> {
  const reply = await call({ action: 'get', key });
  if (!reply.document) throw new CloudBackupError('network');
  return reply.document;
}

export async function verifyCloudCopy(key: string): Promise<{ ok: boolean; problems: string[] }> {
  const reply = await call({ action: 'verify', key });
  if (!reply.verified) throw new CloudBackupError('network');
  return reply.verified;
}

export interface RestoreResult { revision: number; safetyCopy: CopyMeta | null }

export async function restoreCloudCopy(input: { key: string; expectedRevision: number; confirm: string; state: State }): Promise<RestoreResult> {
  if (input.confirm !== CONFIRM_WORD) throw new CloudBackupError('confirm_mismatch');
  const reply = await call({
    action: 'restore',
    key: input.key,
    expectedRevision: input.expectedRevision,
    confirm: input.confirm,
    state: input.state,
  });
  return { revision: Number(reply.revision ?? 0), safetyCopy: reply.safetyCopy ?? null };
}

const ERRORS: Record<string, string> = {
  not_configured: 'Bulut saqlani sozlanmagan. Supabase ulanishini tekshiring.',
  session_missing: 'Sessiya topilmadi. Chiqib, qaytadan kiring.',
  access_denied: 'Bu amal faqat korxona egasi uchun.',
  confirm_mismatch: `Tasdiq uchun oyinga aynan “${CONFIRM_WORD}” deb yozing.`,
  revision_conflict: 'Siz tanlagan nusxa eskirgan: korxonada allaqachon yangi holat bor.',
  copy_invalid: 'Nusxa fayli buzilgan yoki to‘liq emas. Boshqa nusxani tanlang.',
  storage_unavailable: 'Bulut saqlagich javob bermadi. Internetni tekshirib, qayta urinib ko‘ring.',
  network: 'Server bilan bog‘lanib bo‘lmadi. Keyinroq qayta urinib ko‘ring.',
};

export function cloudBackupErrorText(code: string): string {
  return ERRORS[code] ?? code;
}
