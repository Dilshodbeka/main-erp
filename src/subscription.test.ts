import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FULL_ACCESS, OPTIONAL_MODULES, daysLeft, extendedUntil, loadSubscription, planLabel, subscriptionNotice, validUntil, visibleSections,
  type Subscription,
} from './subscription';
import { translateError } from './i18n';

const NOW = '2026-11-20T10:00:00.000Z';
const inDays = (days: number) => new Date(new Date(NOW).getTime() + days * 86_400_000).toISOString();
const sub = (over: Partial<Subscription>): Subscription => ({ ...FULL_ACCESS, plan: 'trial', trialEndsAt: inDays(14), ...over });

describe('subscription', () => {
  it('a lifetime plan has no end and no banner', () => {
    expect(validUntil(FULL_ACCESS)).toBeNull();
    expect(daysLeft(FULL_ACCESS, NOW)).toBeNull();
    expect(subscriptionNotice(FULL_ACCESS, NOW)).toBeNull();
  });

  it('counts trial days and warns near the end', () => {
    expect(daysLeft(sub({}), NOW)).toBe(14);
    expect(subscriptionNotice(sub({}), NOW)).toEqual({ tone: 'info', text: 'Sinov muddati: 14 kun qoldi.' });
    expect(subscriptionNotice(sub({ trialEndsAt: inDays(2) }), NOW)?.tone).toBe('warn');
  });

  it('paid-until wins over an old trial; a paid plan is quiet until the last week', () => {
    const paid = sub({ plan: 'paid', trialEndsAt: inDays(-30), paidUntil: inDays(20) });
    expect(validUntil(paid)).toBe(inDays(20));
    expect(subscriptionNotice(paid, NOW)).toBeNull();
    expect(subscriptionNotice(sub({ plan: 'paid', paidUntil: inDays(5), trialEndsAt: null }), NOW)?.text).toContain('5 kundan keyin');
  });

  it('expired and blocked companies get the read-only message', () => {
    const expired = subscriptionNotice(sub({ trialEndsAt: inDays(-1), active: false }), NOW);
    expect(expired?.tone).toBe('expired');
    expect(expired?.text).toContain('Sinov muddati tugadi');
    expect(subscriptionNotice(sub({ blocked: true, active: false }), NOW)?.text).toContain('to‘xtatilgan');
    expect(translateError('Subscription expired')).toContain('Obuna muddati tugagan');
  });

  it('only optional modules can be switched off', () => {
    const all = ['dashboard', 'orders', 'history', 'shops', 'production', 'warehouse', 'settings'];
    const limited = sub({ disabledModules: ['shops', 'history', 'orders', 'settings'] });
    expect(visibleSections(all, limited)).toEqual(['dashboard', 'orders', 'production', 'warehouse', 'settings']);
    expect(visibleSections(all, FULL_ACCESS)).toEqual(all);
    expect(OPTIONAL_MODULES.map(row => row.id)).not.toContain('orders');
  });

  it('extends from today, or from the current end if it is still ahead', () => {
    expect(extendedUntil(null, 30, NOW)).toBe(inDays(30));
    expect(extendedUntil(inDays(-10), 30, NOW)).toBe(inDays(30));
    expect(extendedUntil(inDays(10), 30, NOW)).toBe(inDays(40));
  });

  it('never blocks the app when the subscription cannot be read', async () => {
    expect(await loadSubscription(async () => { throw new Error('function erp_subscription does not exist'); })).toEqual(FULL_ACCESS);
    expect(await loadSubscription(async () => null)).toEqual(FULL_ACCESS);
    const read = await loadSubscription(async () => ({ plan: 'trial', trialEndsAt: inDays(3), active: true, disabledModules: ['shops'], platformAdmin: true } as Partial<Subscription>));
    expect(read.plan).toBe('trial');
    expect(read.disabledModules).toEqual(['shops']);
    expect(read.platformAdmin).toBe(true);
    expect(planLabel('paid')).toBe('Obuna');
  });
});

describe('platform migration', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261130_platform.sql', import.meta.url), 'utf8');
  it('keeps existing companies unlimited and gates writes through the audit trigger', () => {
    expect(sql).toContain("UPDATE public.erp_companies SET plan = 'lifetime' WHERE plan IS NULL");
    expect(sql).toContain('BEFORE INSERT ON public.erp_audit');
    expect(sql).toContain("NEW.action <> 'company.bootstrap'");
  });
  it('platform functions are closed to anonymous callers and check the platform admin', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(sql.match(/IF NOT public\.erp_is_platform_admin\(\) THEN RAISE EXCEPTION/g)?.length).toBe(2);
  });
});
