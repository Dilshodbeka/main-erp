import type { AccessAccount, AccessDraft } from './access';
import { supabase } from './repository';

export class AccessError extends Error {
  code: string;
  constructor(code: string, message = '') {
    super(message || code);
    this.name = 'AccessError';
    this.code = code;
  }
}

interface FunctionReply {
  ok?: boolean;
  code?: string;
  message?: unknown;
  accounts?: AccessAccount[];
}

async function call(body: Record<string, unknown>): Promise<FunctionReply> {
  if (!supabase) throw new AccessError('not_configured');
  const { data: current } = await supabase.auth.getSession();
  const token = current.session?.access_token;
  if (!token) throw new AccessError('session_missing');
  const { data, error } = await supabase.functions.invoke('erp-access', {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    let reply: FunctionReply | null = null;
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context?.json) {
      try { reply = await context.json() as FunctionReply; } catch { reply = null; }
    }
    throw new AccessError(String(reply?.code || 'network'), String(reply?.message || error.message));
  }
  const reply = data as FunctionReply | null;
  if (!reply) throw new AccessError('network');
  if (reply.ok === false) throw new AccessError(String(reply.code || 'network'), String(reply.message || ''));
  return reply;
}

export async function listAccounts(): Promise<AccessAccount[]> {
  const reply = await call({ action: 'list' });
  return Array.isArray(reply.accounts) ? reply.accounts : [];
}

export async function createAccount(draft: AccessDraft): Promise<void> {
  await call({
    action: 'create',
    role: draft.role,
    employeeId: draft.role === 'worker' ? draft.employeeId : null,
    name: draft.role === 'display' ? draft.displayName.trim() : '',
    email: draft.email.trim(),
    password: draft.password,
    permissions: draft.permissions,
    scopeWorkshopIds: draft.scopeWorkshopIds,
    scopeWarehouseIds: draft.scopeWarehouseIds,
  });
}

export async function resetAccountPassword(userId: string, password: string): Promise<void> {
  await call({ action: 'reset-password', userId, password });
}

export async function deleteAccount(userId: string): Promise<void> {
  await call({ action: 'delete', userId });
}
