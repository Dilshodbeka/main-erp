// Owner-only account management: list, create, reset password, delete worker/TV logins.
// Deploy with platform JWT verification on. Secret: SUPABASE_SERVICE_ROLE_KEY (server-side only).
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

interface Actor { id: string; company_id: string; name: string; role: string }
interface Employee { id: string; name: string; active: boolean }
interface Profile { id: string; name: string; role: string; employee_id: string | null; permissions: string[]; scope_workshop_ids: string[]; scope_warehouse_ids: string[] }
interface Body {
  action?: string;
  role?: string;
  employeeId?: string | null;
  name?: string;
  email?: string;
  password?: string;
  userId?: string;
  permissions?: unknown;
  scopeWorkshopIds?: unknown;
  scopeWarehouseIds?: unknown;
}

// Mirror of src/permissions.ts PERMISSION_KEYS — server-side whitelist for stored permissions.
const PERMISSION_KEYS = [
  'orders.view_all', 'orders.create', 'orders.edit_own', 'orders.edit_all', 'orders.launch',
  'orders.issue_materials', 'orders.cancel', 'customers.claim', 'customers.assign',
  'payments.customer', 'cash.view', 'cash.post', 'cash.reverse', 'purchases.view',
  'purchases.create', 'purchases.receive', 'suppliers.pay', 'warehouse.view', 'warehouse.count',
  'warehouse.transfer', 'cost.view', 'production.view_all', 'work.review', 'defects.view',
  'salaries.view', 'salaries.pay', 'reports.view', 'shipments.view', 'shipments.create',
  'shipments.deliver', 'settings.catalog', 'settings.access',
];

function stringArray(value: unknown, code: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ApiError(code, 400);
  return value.map(item => String(item));
}

function permissionsArray(value: unknown): string[] {
  const list = stringArray(value, 'invalid_permissions');
  const allowed = new Set(PERMISSION_KEYS);
  const result: string[] = [];
  for (const item of list) {
    if (!allowed.has(item)) throw new ApiError('invalid_permissions', 400);
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The platform verifies the session JWT before the function runs. This reads its
// subject only when getUser(token) returns neither a user nor an error, which
// happens for valid sessions on some deployments.
function tokenSubject(token: string): string {
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { sub?: unknown; role?: unknown };
    if (claims.role !== undefined && claims.role !== 'authenticated') return '';
    return typeof claims.sub === 'string' && uuidPattern.test(claims.sub) ? claims.sub : '';
  } catch {
    return '';
  }
}

function requiredId(value: string | undefined | null, code: string): string {
  if (!value || !uuidPattern.test(value)) throw new ApiError(code, 400);
  return value;
}

function requiredPassword(value: string | undefined): string {
  const password = String(value ?? '');
  if (password.length < 8) throw new ApiError('weak_password', 400);
  if (password.length > 72) throw new ApiError('password_too_long', 400);
  return password;
}

function databaseError(code?: string): ApiError {
  if (code === '42P01' || code === 'PGRST205') return new ApiError('table_missing', 500);
  if (code === '23505') return new ApiError('employee_linked', 409);
  return new ApiError('database_error', 500);
}

async function emailsById(admin: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw databaseError(error.code);
    const users = data?.users ?? [];
    for (const user of users) map.set(user.id, user.email ?? '');
    if (users.length < 200) break;
  }
  return map;
}

async function audit(admin: SupabaseClient, actor: Actor, action: string, entityId: string, command: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await admin.from('erp_metadata').select('revision').eq('company_id', actor.company_id).maybeSingle();
    if (current.error) { console.error('Access audit metadata failed', current.error.code); return; }
    const revision = Number(current.data?.revision ?? 0);
    const next = revision + 1;
    const updated = await admin.from('erp_metadata').update({ revision: next })
      .eq('company_id', actor.company_id).eq('revision', revision).select('revision');
    if (updated.error) { console.error('Access audit revision failed', updated.error.code); return; }
    if (!updated.data?.length) continue;
    const inserted = await admin.from('erp_audit').insert({
      company_id: actor.company_id, request_id: crypto.randomUUID(),
      actor_user_id: actor.id, actor_id: actor.id, actor_name: actor.name,
      action, entity_id: entityId, command, expected_revision: revision, revision: next,
    });
    if (inserted.error) { console.error('Access audit insert failed', inserted.error.code); return; }
    return;
  }
  console.error('Access audit gave up after revision conflicts');
}

async function targetProfile(admin: SupabaseClient, actor: Actor, userId: string): Promise<Profile> {
  const result = await admin.from('erp_profiles')
    .select('id, name, role, employee_id').eq('id', userId).eq('company_id', actor.company_id).maybeSingle();
  if (result.error) throw databaseError(result.error.code);
  const profile = result.data as Profile | null;
  if (!profile) throw new ApiError('account_not_found', 404);
  if (profile.role === 'admin') throw new ApiError('admin_protected', 403);
  return profile;
}

async function handle(body: Body, actor: Actor, admin: SupabaseClient): Promise<Record<string, unknown>> {
  const action = body.action;

  if (action === 'list') {
    const profiles = await admin.from('erp_profiles')
      .select('id, name, role, employee_id, permissions, scope_workshop_ids, scope_warehouse_ids').eq('company_id', actor.company_id);
    if (profiles.error) throw databaseError(profiles.error.code);
    const employees = await admin.from('erp_employees')
      .select('id, name').eq('company_id', actor.company_id);
    if (employees.error) throw databaseError(employees.error.code);
    const emails = await emailsById(admin);
    const employeeNames = new Map((employees.data as { id: string; name: string }[]).map(row => [row.id, row.name]));
    const accounts = (profiles.data as Profile[]).map(profile => ({
      id: profile.id,
      name: profile.name,
      email: emails.get(profile.id) ?? '',
      role: profile.role,
      employeeId: profile.employee_id,
      employeeName: profile.employee_id ? employeeNames.get(profile.employee_id) ?? null : null,
      permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
    }));
    return { ok: true, accounts };
  }

  if (action === 'create') {
    const role = body.role;
    if (role !== 'worker' && role !== 'display') throw new ApiError('invalid_role', 400);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!emailPattern.test(email) || email.length > 254) throw new ApiError('invalid_email', 400);
    const password = requiredPassword(body.password);
    const existing = await emailsById(admin);
    if ([...existing.values()].some(value => value.toLowerCase() === email)) throw new ApiError('email_taken', 409);
    let employee: Employee | null = null;
    let profileName = '';
    if (role === 'worker') {
      const employeeId = requiredId(body.employeeId, 'invalid_employee');
      const result = await admin.from('erp_employees')
        .select('id, name, active').eq('company_id', actor.company_id).eq('id', employeeId).eq('active', true).maybeSingle();
      if (result.error) throw databaseError(result.error.code);
      employee = result.data as Employee | null;
      if (!employee) throw new ApiError('invalid_employee', 400);
      const linked = await admin.from('erp_profiles')
        .select('id').eq('company_id', actor.company_id).eq('employee_id', employeeId).maybeSingle();
      if (linked.error) throw databaseError(linked.error.code);
      if (linked.data) throw new ApiError('employee_linked', 409);
      profileName = employee.name;
    } else {
      profileName = String(body.name ?? '').trim();
      if (profileName.length < 2 || profileName.length > 120) throw new ApiError('invalid_display_name', 400);
    }
    const created = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { name: profileName },
      app_metadata: { erp_role: role },
    });
    if (created.error) {
      const message = created.error.message.toLowerCase();
      if (message.includes('already') || message.includes('registered') || created.error.code === 'email_exists') {
        throw new ApiError('email_taken', 409);
      }
      if (message.includes('password')) throw new ApiError('weak_password', 400);
      throw new ApiError('auth_error', 500, created.error.message);
    }
    const userId = created.data.user?.id;
    if (!userId) throw new ApiError('auth_error', 500);
    const permissions = permissionsArray(body.permissions);
    const scopeWorkshopIds = stringArray(body.scopeWorkshopIds, 'invalid_scope');
    const scopeWarehouseIds = stringArray(body.scopeWarehouseIds, 'invalid_scope');
    const profile = await admin.from('erp_profiles').insert({
      id: userId, company_id: actor.company_id, name: profileName, role,
      employee_id: employee ? employee.id : null,
      permissions, scope_workshop_ids: scopeWorkshopIds, scope_warehouse_ids: scopeWarehouseIds,
    });
    if (profile.error) {
      await admin.auth.admin.deleteUser(userId);
      throw databaseError(profile.error.code);
    }
    await audit(admin, actor, 'access.create', userId, {
      type: 'access.create', role, employeeId: employee ? employee.id : null, email, permissions,
    });
    return { ok: true, account: { id: userId, name: profileName, email, role, employeeId: employee ? employee.id : null } };
  }

  if (action === 'reset-password') {
    const userId = requiredId(body.userId, 'invalid_user');
    const password = requiredPassword(body.password);
    await targetProfile(admin, actor, userId);
    const updated = await admin.auth.admin.updateUserById(userId, { password });
    if (updated.error) {
      const message = updated.error.message.toLowerCase();
      if (message.includes('password')) throw new ApiError('weak_password', 400);
      throw new ApiError('auth_error', 500);
    }
    await audit(admin, actor, 'access.password', userId, { type: 'access.password' });
    return { ok: true };
  }

  if (action === 'delete') {
    const userId = requiredId(body.userId, 'invalid_user');
    const profile = await targetProfile(admin, actor, userId);
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw new ApiError('auth_error', 500);
    await audit(admin, actor, 'access.delete', userId, { type: 'access.delete', role: profile.role });
    return { ok: true };
  }

  throw new ApiError('invalid_action', 400);
}

serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  if (!supabaseUrl || !serviceKey) return json({ ok: false, code: 'not_configured' }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new ApiError('auth_missing', 401);
    const auth = await admin.auth.getUser(token);
    if (auth.error) throw new ApiError('auth_invalid', 401, auth.error.message || 'auth_invalid');
    let userId = auth.user?.id ?? '';
    if (!userId) {
      const subject = tokenSubject(token);
      if (!subject) throw new ApiError('auth_invalid', 401, 'auth_user_missing');
      const byId = await admin.auth.admin.getUserById(subject);
      if (byId.error || !byId.data?.user) {
        throw new ApiError('auth_invalid', 401, byId.error?.message || 'auth_user_missing');
      }
      userId = byId.data.user.id;
      console.warn('Access session resolved by verified subject fallback');
    }
    const result = await admin.from('erp_profiles')
      .select('id, company_id, name, role').eq('id', userId).maybeSingle();
    if (result.error) throw databaseError(result.error.code);
    const actor = result.data as Actor | null;
    if (!actor) throw new ApiError('profile_missing', 403);
    if (actor.role !== 'admin') throw new ApiError('access_denied', 403);
    let body: Body;
    try { body = await request.json() as Body; } catch { throw new ApiError('invalid_body', 400); }
    return json(await handle(body, actor, admin));
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    console.error('Access management failed', error instanceof Error ? error.name : 'unknown');
    return json({ ok: false, code: 'access_error' }, 500);
  }
});
