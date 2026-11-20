import { createClient } from '@supabase/supabase-js';
import { applyCommand } from './domain';
import { DEMO_COMPANY_ID, migrateState } from './migrations';
import { disablePush } from './push';
import { createDemo } from './seed';
import { createSync, emptyCache, TransportError, type Pending, type Snapshot, type SyncCache } from './sync';
import type { Actor, Command, Envelope, State } from './types';

const storageKey = 'aliya-erp-demo-v1';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export const mode = supabase ? 'cloud' : 'demo';
export const demoAdmin: Actor = { id: '00000000-0000-4000-8000-000000000001', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
const changeEvent = 'aliya-sync-change';
let activeKey: string | null = null;

function readCache(cacheKey: string): SyncCache {
  const raw = localStorage.getItem(cacheKey);
  return raw ? JSON.parse(raw) : emptyCache();
}
function writeCache(cacheKey: string, cache: SyncCache) {
  localStorage.setItem(cacheKey, JSON.stringify(cache));
  window.dispatchEvent(new Event(changeEvent));
}
async function lock<T>(name: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Xavfsiz hisob uchun Web Locks va HTTPS qo‘llaydigan zamonaviy brauzer kerak.');
  return navigator.locks.request(name, action);
}
async function rpc(name: string, params?: Record<string, unknown>): Promise<Snapshot> {
  let response;
  try { response = await supabase!.rpc(name, params); }
  catch (error) { throw new TransportError(error instanceof Error ? error.message : 'Server bilan aloqa yo‘q', 'network'); }
  if (response.error) {
    const error = response.error;
    const access = ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error.code) || response.status === 401 || response.status === 403;
    const rejected = !!error.code || (response.status >= 400 && response.status < 500);
    throw new TransportError(error.message, access ? 'access' : rejected ? 'rejected' : 'network');
  }
  return response.data;
}
async function cloudEngine() {
  const { data, error } = await supabase!.auth.getSession();
  if (!data.session) throw new Error(error?.message || 'Hisobingizga kiring.');
  const cacheKey = `aliya-erp-cloud:${url}:${data.session.user.id}`;
  activeKey = cacheKey;
  return createSync({
    read: () => readCache(cacheKey), write: cache => writeCache(cacheKey, cache),
    lock: action => lock(cacheKey, action), online: () => navigator.onLine,
    fetch: () => rpc('erp_snapshot'),
    send: envelope => rpc('erp_execute', { p_request_id: envelope.requestId, p_expected_revision: envelope.expectedRevision, p_command: envelope.command }),
  });
}

export function readDemo(): State {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    const initial = createDemo(demoAdmin);
    localStorage.setItem(storageKey, JSON.stringify(initial));
    return initial;
  }
  return migrateState(JSON.parse(raw));
}

export async function snapshot(): Promise<Snapshot> {
  if (!supabase) return lock(storageKey, async () => ({ state: readDemo(), actor: demoAdmin }));
  return (await cloudEngine()).snapshot();
}

export async function bootstrapCompany(name: string, call: typeof rpc = rpc): Promise<Snapshot> {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 160) throw new Error('Korxona nomi 2 dan 160 belgigacha bo‘lishi kerak');
  await call('erp_bootstrap_company', { p_name: trimmed });
  return call('erp_snapshot');
}

export async function execute(state: State, command: Command, actor: Actor): Promise<Snapshot & { queued: boolean }> {
  if (supabase) return (await cloudEngine()).submit(state, command, actor);
  const envelope: Envelope = { requestId: crypto.randomUUID(), expectedRevision: state.revision, command };
  return lock(storageKey, async () => {
    const next = applyCommand(readDemo(), envelope, actor);
    localStorage.setItem(storageKey, JSON.stringify(next));
    return { state: next, actor, queued: false };
  });
}

export function syncStatus(): { online: boolean; pending: Pending[]; savedAt: number } {
  const cache = activeKey ? readCache(activeKey) : emptyCache();
  return { online: navigator.onLine, pending: cache.pending, savedAt: cache.savedAt };
}
export function onSyncChange(fn: () => void): () => void {
  const storage = (event: StorageEvent) => { if (event.key === activeKey) fn(); };
  window.addEventListener(changeEvent, fn);
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(changeEvent, fn); window.removeEventListener('online', fn); window.removeEventListener('offline', fn); window.removeEventListener('storage', storage); };
}
export async function discardPending(requestId: string) { await (await cloudEngine()).discard(requestId); }
export async function retryPending(requestId: string) { return (await cloudEngine()).retryRejected(requestId); }
export async function signOut() {
  if (syncStatus().pending.length) throw new Error('Avval navbatni sinxronlang yoki yuborilmagan amallarni bekor qiling.');
  if (activeKey) {
    const cacheKey = activeKey;
    await lock(cacheKey, async () => {
      if (readCache(cacheKey).pending.length) throw new Error('Sinxronlanmagan amallar bor. Avval navbatni hal qiling.');
      localStorage.removeItem(cacheKey);
    });
    activeKey = null;
  }
  // The next person on this device must not receive this account's notifications.
  await disablePush(supabase!).catch(() => undefined);
  await supabase!.auth.signOut();
}

export function onLocalChange(fn: () => void): () => void {
  const handler = (event: StorageEvent) => { if (event.key === storageKey) fn(); };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
export function exportData(state: State) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `aliya-erp-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
export async function freshDemo(): Promise<State> {
  return lock(storageKey, async () => {
    const next = createDemo(demoAdmin);
    localStorage.setItem(storageKey, JSON.stringify(next));
    return next;
  });
}
