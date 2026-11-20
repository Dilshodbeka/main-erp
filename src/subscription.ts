// Subscription layer for selling the system: plan and trial of the company, optional modules
// that can be switched off per company, and the platform (seller) panel API.
// The server enforces it (see migration 20261130_platform.sql); this file is the client view.
import { mode, supabase } from './repository';

export type Plan = 'trial' | 'paid' | 'lifetime';

export interface Subscription {
  plan: Plan;
  trialEndsAt: string | null;
  paidUntil: string | null;
  blocked: boolean;
  active: boolean;
  disabledModules: string[];
  platformAdmin: boolean;
}

/** Demo mode, and a database where the platform migration is not applied yet: nothing is limited. */
export const FULL_ACCESS: Subscription = {
  plan: 'lifetime', trialEndsAt: null, paidUntil: null, blocked: false, active: true, disabledModules: [], platformAdmin: false,
};

/** Sections a seller may switch off for a company. Everything else is the core and always stays. */
export const OPTIONAL_MODULES: { id: string; title: string }[] = [
  { id: 'advisor', title: 'Tavsiyalar markazi' },
  { id: 'history', title: 'Tarix va analitika' },
  { id: 'shops', title: 'Do‘konlar' },
  { id: 'series', title: 'Seriyalar va retseptlar' },
  { id: 'purchases', title: 'Ta’minot' },
  { id: 'logistics', title: 'Yetkazib berish' },
  { id: 'analytics', title: 'Hisobotlar' },
];
const OPTIONAL_IDS = new Set(OPTIONAL_MODULES.map(row => row.id));

/** Core sections cannot be hidden even if a stray id lands in the list. */
export function visibleSections(ids: string[], subscription: Subscription): string[] {
  return ids.filter(id => !(OPTIONAL_IDS.has(id) && subscription.disabledModules.includes(id)));
}

/** The later of the trial end and the paid-until date; null for a lifetime plan. */
export function validUntil(subscription: Subscription): string | null {
  if (subscription.plan === 'lifetime') return null;
  const dates = [subscription.trialEndsAt, subscription.paidUntil].filter((value): value is string => !!value);
  return dates.length ? dates.sort().at(-1)! : null;
}

/** Whole days left (rounded up); 0 when it ends today or is over; null for a lifetime plan. */
export function daysLeft(subscription: Subscription, nowIso: string): number | null {
  const until = validUntil(subscription);
  if (subscription.plan === 'lifetime') return null;
  if (!until) return 0;
  return Math.max(0, Math.ceil((new Date(until).getTime() - new Date(nowIso).getTime()) / 86_400_000));
}

export interface SubscriptionNotice { tone: 'info' | 'warn' | 'expired'; text: string }

/** The banner shown to the owner: trial countdown, a paid plan about to end, or an expired one. */
export function subscriptionNotice(subscription: Subscription, nowIso: string): SubscriptionNotice | null {
  if (subscription.blocked) return { tone: 'expired', text: 'Hisob to‘xtatilgan. Ma’lumotlarni ko‘rish mumkin, o‘zgartirish uchun sotuvchi bilan bog‘laning.' };
  if (subscription.plan === 'lifetime') return null;
  const left = daysLeft(subscription, nowIso) ?? 0;
  if (!subscription.active || left === 0) {
    return { tone: 'expired', text: subscription.plan === 'trial'
      ? 'Sinov muddati tugadi. Ma’lumotlar saqlangan — davom etish uchun obunani yoqing.'
      : 'Obuna muddati tugadi. Ma’lumotlar saqlangan — o‘zgartirish uchun obunani uzaytiring.' };
  }
  if (subscription.plan === 'trial') return { tone: left <= 3 ? 'warn' : 'info', text: `Sinov muddati: ${left} kun qoldi.` };
  if (left <= 7) return { tone: 'warn', text: `Obuna ${left} kundan keyin tugaydi.` };
  return null;
}

export function planLabel(plan: Plan): string {
  return plan === 'lifetime' ? 'Muddatsiz' : plan === 'paid' ? 'Obuna' : 'Sinov muddati';
}

type Raw = Partial<Subscription> | null;
function normalize(raw: Raw): Subscription {
  if (!raw || typeof raw !== 'object' || !raw.plan) return FULL_ACCESS;
  return {
    plan: raw.plan, trialEndsAt: raw.trialEndsAt ?? null, paidUntil: raw.paidUntil ?? null, blocked: raw.blocked === true,
    active: raw.active !== false, disabledModules: Array.isArray(raw.disabledModules) ? raw.disabledModules.map(String) : [],
    platformAdmin: raw.platformAdmin === true,
  };
}

async function readRemote(): Promise<Raw> {
  const { data, error } = await supabase!.rpc('erp_subscription');
  if (error) throw new Error(error.message);
  return data as Raw;
}

/** Never blocks the app: demo mode and an unreadable subscription both mean full access. */
export async function loadSubscription(read: () => Promise<Raw> = readRemote): Promise<Subscription> {
  if (mode === 'demo' && read === readRemote) return FULL_ACCESS;
  try { return normalize(await read()); }
  catch { return FULL_ACCESS; }
}

// ── Platform (seller) panel ────────────────────────────────────────────────
export interface PlatformCompany {
  id: string; name: string; phone: string; createdAt: string; ownerEmail: string | null;
  plan: Plan; trialEndsAt: string | null; paidUntil: string | null; blocked: boolean; active: boolean;
  disabledModules: string[]; note: string; users: number; orders: number; lastActivity: string | null;
}

export async function loadPlatformCompanies(): Promise<PlatformCompany[]> {
  const { data, error } = await supabase!.rpc('erp_platform_companies');
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformCompany[];
}

export interface PlatformChange { plan: Plan; paidUntil: string | null; blocked: boolean; disabledModules: string[]; note: string }

export async function savePlatformCompany(companyId: string, change: PlatformChange): Promise<PlatformCompany[]> {
  const { data, error } = await supabase!.rpc('erp_platform_company_set', {
    p_company: companyId, p_plan: change.plan, p_paid_until: change.paidUntil, p_blocked: change.blocked,
    p_disabled_modules: change.disabledModules, p_note: change.note,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformCompany[];
}

/** "Extend by N days": counts from today, or from the current paid-until date if it is still ahead. */
export function extendedUntil(current: string | null, days: number, nowIso: string): string {
  const base = Math.max(new Date(nowIso).getTime(), current ? new Date(current).getTime() : 0);
  return new Date(base + days * 86_400_000).toISOString();
}
