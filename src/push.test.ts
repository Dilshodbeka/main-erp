import { describe, expect, it, vi } from 'vitest';
import { deviceLabel, disablePush, enablePush, iosNeedsInstall, pushStatus, PushError } from './push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36';
const YANDEX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 YaBrowser/24.6.0 Safari/537.36';

/** A fake browser: one service worker registration with a push manager. */
function browser(options: { permission?: NotificationPermission; subscribed?: boolean; registered?: boolean; userAgent?: string } = {}) {
  let current: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = options.subscribed
    ? { endpoint: 'https://fcm.googleapis.com/fcm/send/old', toJSON: () => ({}), unsubscribe: async () => { current = null; return true; } } : null;
  const pushManager = {
    getSubscription: async () => current,
    subscribe: vi.fn(async () => {
      current = { endpoint: 'https://fcm.googleapis.com/fcm/send/new', toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' } }), unsubscribe: async () => { current = null; return true; } };
      return current;
    }),
  };
  const env = {
    navigator: { userAgent: options.userAgent ?? ANDROID, serviceWorker: { getRegistration: async () => (options.registered === false ? undefined : { pushManager }) } },
    window: { PushManager: class {}, Notification: { permission: options.permission ?? 'default', requestPermission: async () => options.permission ?? 'granted' }, matchMedia: () => ({ matches: false }) },
  } as never;
  return { env, pushManager, endpoint: () => current?.endpoint ?? null };
}

function server(key: string | null = 'BPubKey', saveFails = false) {
  const calls: [string, unknown][] = [];
  const rpc = vi.fn(async (name: string, args?: unknown) => {
    calls.push([name, args]);
    if (name === 'erp_push_public_key') return { data: key, error: null };
    if (name === 'erp_push_subscribe') return saveFails ? { data: null, error: { message: 'x' } } : { data: 1, error: null };
    return { data: 0, error: null };
  });
  return { client: { rpc } as never, calls };
}

describe('notifications on the device', () => {
  it('names the device for the owner', () => {
    expect(deviceLabel(ANDROID)).toBe('Android · Chrome');
    expect(deviceLabel(IPHONE)).toBe('iPhone · Safari');
    expect(deviceLabel(YANDEX)).toBe('Windows · Yandex');
  });

  it('iPhone needs the app on the Home Screen first', async () => {
    expect(iosNeedsInstall(IPHONE, false, false)).toBe(true);
    expect(iosNeedsInstall(IPHONE, true, true)).toBe(false);
    expect(iosNeedsInstall(ANDROID, false, false)).toBe(false);
    const env = { navigator: { userAgent: IPHONE }, window: { matchMedia: () => ({ matches: false }) } } as never;
    expect(await pushStatus(env)).toBe('ios-install');
  });

  it('reports the state: unsupported, blocked, off, on', async () => {
    expect(await pushStatus(browser({ registered: false }).env)).toBe('unsupported');
    expect(await pushStatus(browser({ permission: 'denied' }).env)).toBe('blocked');
    expect(await pushStatus(browser().env)).toBe('off');
    expect(await pushStatus(browser({ subscribed: true }).env)).toBe('on');
  });

  it('subscribes the device and stores it on the server', async () => {
    const device = browser();
    const api = server();
    await enablePush(api.client, device.env);
    expect(device.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(api.calls.at(-1)).toEqual(['erp_push_subscribe', { p_endpoint: 'https://fcm.googleapis.com/fcm/send/new', p_p256dh: 'P', p_auth: 'A', p_label: 'Android · Chrome' }]);
    expect(await pushStatus(device.env)).toBe('on');
  });

  it('explains what is wrong instead of failing silently', async () => {
    await expect(enablePush(server(null).client, browser().env)).rejects.toThrow(/Server kaliti hali tayyor emas/);
    await expect(enablePush(server().client, browser({ permission: 'denied' }).env)).rejects.toBeInstanceOf(PushError);
    // the server refused to save → the browser subscription is rolled back
    const device = browser();
    await expect(enablePush(server('BPubKey', true).client, device.env)).rejects.toThrow(/saqlab bo‘lmadi/);
    expect(device.endpoint()).toBeNull();
  });

  it('turning off removes the device on the server and in the browser', async () => {
    const device = browser({ subscribed: true });
    const api = server();
    await disablePush(api.client, device.env);
    expect(api.calls).toEqual([['erp_push_unsubscribe', { p_endpoint: 'https://fcm.googleapis.com/fcm/send/old' }]]);
    expect(device.endpoint()).toBeNull();
    await disablePush(api.client, device.env); // nothing left: no extra calls
    expect(api.calls).toHaveLength(1);
  });
});
