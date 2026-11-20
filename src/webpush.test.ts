import { createECDH, randomBytes, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — the reference implementation ships without types; used only to prove interoperability
import ece from 'http_ece';
import { encryptPush, fromBase64Url, generateVapidKeys, pushGone, pushRequest, toBase64Url, vapidAuthorization } from './webpush';

const b64 = (buffer: Buffer) => buffer.toString('base64url');

describe('web push', () => {
  it('base64url round-trips', () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255, 1]);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
  });

  it('a browser (reference aes128gcm decoder) can read the encrypted message', async () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const auth = randomBytes(16);
    const text = 'Nazorat: ORD-0007 muddati o‘tgan — «Tabiiy eman» oshxonasi';
    const body = await encryptPush(b64(browser.getPublicKey()), b64(auth), new TextEncoder().encode(text));
    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: browser, authSecret: auth });
    expect(plain.toString('utf8')).toBe(text);
  });

  it('every message uses a fresh salt and key', async () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const auth = b64(randomBytes(16));
    const payload = new TextEncoder().encode('bir xil matn');
    const first = await encryptPush(b64(browser.getPublicKey()), auth, payload);
    const second = await encryptPush(b64(browser.getPublicKey()), auth, payload);
    expect(toBase64Url(first)).not.toBe(toBase64Url(second));
  });

  it('VAPID header carries a token signed by the server key for the push service origin', async () => {
    const keys = await generateVapidKeys();
    expect(fromBase64Url(keys.publicKey)).toHaveLength(65);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:owner@example.com', 1_800_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(match[4]).toBe(keys.publicKey);
    const claims = JSON.parse(Buffer.from(match[2], 'base64url').toString('utf8'));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'mailto:owner@example.com' });
    const publicKey = await webcrypto.subtle.importKey('raw', fromBase64Url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromBase64Url(match[3]), new TextEncoder().encode(`${match[1]}.${match[2]}`));
    expect(valid).toBe(true);
  });

  it('builds a complete request for the push service', async () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const auth = randomBytes(16);
    const keys = await generateVapidKeys();
    const request = await pushRequest({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x', p256dh: b64(browser.getPublicKey()), auth: b64(auth) },
      { title: 'Yangi topshiriq', body: 'ORD-0001 · Kesish' }, keys, 'mailto:a@b.uz', 1_800_000_000);
    expect(request.url).toBe('https://updates.push.services.mozilla.com/wpush/v2/x');
    expect(request.headers['content-encoding']).toBe('aes128gcm');
    expect(request.headers.ttl).toBe('43200');
    expect(request.headers.authorization).toMatch(/^vapid t=/);
    const plain = ece.decrypt(Buffer.from(request.body), { version: 'aes128gcm', privateKey: browser, authSecret: auth });
    expect(JSON.parse(plain.toString('utf8'))).toEqual({ title: 'Yangi topshiriq', body: 'ORD-0001 · Kesish' });
  });

  it('knows when a subscription is dead', () => {
    expect(pushGone(410)).toBe(true);
    expect(pushGone(404)).toBe(true);
    expect(pushGone(201)).toBe(false);
    expect(pushGone(429)).toBe(false);
  });
});
