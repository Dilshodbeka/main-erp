// Browser side of notifications: asks permission, subscribes this device and stores the subscription
// on the server. Sending is done by the watcher (erp-watch); see src/webpush.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { fromBase64Url } from './webpush';

export type PushStatus = 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on';

interface Env { navigator: Navigator; window: Window & typeof globalThis }

/** iPhone and iPad deliver web notifications only to an app added to the Home Screen. */
export function iosNeedsInstall(userAgent: string, standalone: boolean, hasPushManager: boolean): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) && !standalone && !hasPushManager;
}

async function registration(env: Env): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in env.navigator)) return null;
  return (await env.navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushStatus(env: Env = { navigator, window }): Promise<PushStatus> {
  const hasPush = 'PushManager' in env.window && 'Notification' in env.window;
  const standalone = env.window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  if (iosNeedsInstall(env.navigator.userAgent, standalone, hasPush)) return 'ios-install';
  if (!hasPush) return 'unsupported';
  const worker = await registration(env);
  if (!worker) return 'unsupported';
  if (env.window.Notification.permission === 'denied') return 'blocked';
  return (await worker.pushManager.getSubscription()) ? 'on' : 'off';
}

/** A short name of the device for the owner's eyes ("Android · Chrome"). */
export function deviceLabel(userAgent: string): string {
  const system = /Android/.test(userAgent) ? 'Android' : /iPhone|iPad|iPod/.test(userAgent) ? 'iPhone' : /Windows/.test(userAgent) ? 'Windows' : /Mac OS X/.test(userAgent) ? 'Mac' : /Linux/.test(userAgent) ? 'Linux' : 'Qurilma';
  const browser = /YaBrowser/.test(userAgent) ? 'Yandex' : /Edg\//.test(userAgent) ? 'Edge' : /OPR\//.test(userAgent) ? 'Opera' : /Firefox/.test(userAgent) ? 'Firefox' : /Chrome/.test(userAgent) ? 'Chrome' : /Safari/.test(userAgent) ? 'Safari' : 'brauzer';
  return `${system} · ${browser}`;
}

export class PushError extends Error {}

/** Turns notifications on for this device. Throws PushError with a text ready to show. */
export async function enablePush(supabase: SupabaseClient, env: Env = { navigator, window }): Promise<void> {
  const worker = await registration(env);
  if (!worker) throw new PushError('Bu brauzer bildirishnomalarni qo‘llamaydi.');
  const key = await supabase.rpc('erp_push_public_key');
  if (key.error) throw new PushError('Bildirishnomalar serverda hali sozlanmagan.');
  if (!key.data) throw new PushError('Server kaliti hali tayyor emas — nazoratchi birinchi marta ishga tushgach (15 daqiqa ichida) qayta urinib ko‘ring.');
  if ((await env.window.Notification.requestPermission()) !== 'granted') throw new PushError('Bildirishnomalarga ruxsat berilmadi. Brauzer sozlamalarida sayt uchun ruxsatni yoqing.');
  // A subscription made with an older server key cannot be reused.
  const old = await worker.pushManager.getSubscription();
  if (old) await old.unsubscribe().catch(() => undefined);
  const subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(String(key.data)) as unknown as BufferSource });
  const json = subscription.toJSON();
  const saved = await supabase.rpc('erp_push_subscribe', {
    p_endpoint: subscription.endpoint, p_p256dh: json.keys?.p256dh ?? '', p_auth: json.keys?.auth ?? '', p_label: deviceLabel(env.navigator.userAgent),
  });
  if (saved.error) {
    await subscription.unsubscribe().catch(() => undefined);
    throw new PushError('Qurilmani serverda saqlab bo‘lmadi. Qayta urinib ko‘ring.');
  }
}

export async function disablePush(supabase: SupabaseClient, env: Env = { navigator, window }): Promise<void> {
  const worker = await registration(env);
  const subscription = await worker?.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.rpc('erp_push_unsubscribe', { p_endpoint: subscription.endpoint });
  await subscription.unsubscribe().catch(() => undefined);
}
