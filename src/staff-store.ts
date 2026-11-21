// "Davomat va KPI" screen: reads and changes what the Telegram bot collects (migration 20261208).
import type { SupabaseClient } from '@supabase/supabase-js';
import { STAFF_DEFAULTS, type StaffCase, type StaffSettings } from './staff-control';

export const STAFF_BOT_URL = 'https://t.me/aliya_sotuv_bot';

export interface StaffLinkRow { employeeId: string; linked: boolean; timepayId: number | null }
export interface AdvanceRow { id: string; employeeId: string; name: string; amount: number; reason: string; status: 'pending' | 'approved' | 'rejected'; account: 'cash' | 'bank' | null; createdAt: string }
export interface StaffOverview { settings: StaffSettings; saved: boolean; links: StaffLinkRow[]; cases: StaffCase[]; advances: AdvanceRow[] }

const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') as Record<string, unknown>[] : [];
const number = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** The RPC answer → typed rows; anything unexpected is dropped, never guessed. */
export function parseOverview(raw: unknown): StaffOverview {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stored = data.settings && typeof data.settings === 'object' ? data.settings as Record<string, unknown> : null;
  const settings: StaffSettings = stored ? {
    enabled: stored.enabled !== false, base: number(stored.base, STAFF_DEFAULTS.base), perMinute: number(stored.perMinute, STAFF_DEFAULTS.perMinute),
    forgotFree: number(stored.forgotFree, STAFF_DEFAULTS.forgotFree), forgotFine: number(stored.forgotFine, STAFF_DEFAULTS.forgotFine),
    directorName: typeof stored.directorName === 'string' ? stored.directorName : '',
  } : { ...STAFF_DEFAULTS };
  const kinds = ['late', 'early', 'no_out'], statuses = ['asked', 'claimed', 'approved', 'fined', 'warned'];
  return {
    settings, saved: stored !== null,
    links: list(data.links).map(row => ({ employeeId: String(row.employeeId), linked: row.linked === true, timepayId: row.timepayId === null || row.timepayId === undefined ? null : number(row.timepayId) })),
    cases: list(data.cases).filter(row => kinds.includes(String(row.kind)) && statuses.includes(String(row.status))).map(row => ({
      id: String(row.id), timepayId: number(row.timepayId), employeeId: typeof row.employeeId === 'string' ? row.employeeId : null, name: String(row.name ?? ''),
      workDate: String(row.workDate), kind: row.kind as StaffCase['kind'], atMinutes: number(row.atMinutes), minutes: number(row.minutes), final: row.final === true,
      status: row.status as StaffCase['status'], claim: (['leave', 'forgot', 'late'].includes(String(row.claim)) ? row.claim : null) as StaffCase['claim'],
      fine: number(row.fine), code: String(row.code ?? ''), pings: number(row.pings), pingedAt: null, escalated: row.escalated === true,
    })),
    advances: list(data.advances).map(row => ({
      id: String(row.id), employeeId: String(row.employeeId), name: String(row.name ?? ''), amount: number(row.amount), reason: String(row.reason ?? ''),
      status: (['approved', 'rejected'].includes(String(row.status)) ? row.status : 'pending') as AdvanceRow['status'],
      account: row.account === 'cash' || row.account === 'bank' ? row.account : null, createdAt: String(row.createdAt ?? ''),
    })),
  };
}

export async function loadStaffOverview(supabase: SupabaseClient, month: string): Promise<StaffOverview> {
  const reply = await supabase.rpc('erp_staff_overview', { p_month: month });
  if (reply.error) throw new Error(reply.error.message);
  return parseOverview(reply.data);
}

export async function saveStaffSettings(supabase: SupabaseClient, settings: StaffSettings): Promise<void> {
  const reply = await supabase.rpc('erp_kpi_settings_set', { p_enabled: settings.enabled, p_base: settings.base, p_per_minute: settings.perMinute,
    p_forgot_free: settings.forgotFree, p_forgot_fine: settings.forgotFine, p_director_name: settings.directorName });
  if (reply.error) throw new Error(reply.error.message);
}

/** A one-time link the employee opens in Telegram (valid for 7 days). */
export async function staffLink(supabase: SupabaseClient, employeeId: string): Promise<string> {
  const reply = await supabase.rpc('erp_staff_link_code', { p_employee_id: employeeId });
  if (reply.error || typeof reply.data !== 'string') throw new Error(reply.error?.message ?? 'Havola olinmadi');
  return `${STAFF_BOT_URL}?start=${reply.data}`;
}

export async function staffUnlink(supabase: SupabaseClient, employeeId: string): Promise<void> {
  const reply = await supabase.rpc('erp_staff_unlink', { p_employee_id: employeeId });
  if (reply.error) throw new Error(reply.error.message);
}

export async function decideCase(supabase: SupabaseClient, caseId: string, approve: boolean): Promise<void> {
  const reply = await supabase.rpc('erp_attendance_decide', { p_case_id: caseId, p_approve: approve });
  if (reply.error) throw new Error(reply.error.message);
}

/** "2026-11" → the month before it. */
export function previousMonth(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
}
