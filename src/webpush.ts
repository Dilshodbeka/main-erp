// Web Push without third-party services: VAPID (RFC 8292) and payload encryption (RFC 8291, aes128gcm)
// on WebCrypto only, so the same code runs in the Edge Function (Deno) and in tests (Node).
const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const normal = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

const source = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

/** The server's identity for push services: the public key goes to browsers, the private one never leaves the server. */
export interface VapidKeys { publicKey: string; privateKey: JsonWebKey }

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: toBase64Url(raw), privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}

/** `Authorization` header that proves to the push service who is sending (valid for 12 hours). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowSeconds: number): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, source(encoder.encode(`${header}.${claims}`))));
  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, material: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', source(material), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: source(salt), info: source(info) }, key, length * 8));
}

/** Encrypts a message for one browser subscription (its p256dh key and auth secret, base64url). */
export async function encryptPush(p256dh: string, auth: string, payload: Uint8Array): Promise<Uint8Array> {
  const receiverPublic = fromBase64Url(p256dh);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const receiverKey = await crypto.subtle.importKey('raw', source(receiverPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, local.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await hkdf(fromBase64Url(auth), shared, concat(encoder.encode('WebPush: info\0'), receiverPublic, senderPublic), 32);
  const contentKey = await hkdf(salt, material, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, material, encoder.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', source(contentKey), 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (only) record.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: source(nonce) }, aes, source(concat(payload, new Uint8Array([2])))));
  const head = new Uint8Array(21);
  head.set(salt);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = senderPublic.length;
  return concat(head, senderPublic, cipher);
}

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export interface PushRequest { url: string; headers: Record<string, string>; body: Uint8Array }

/** Everything needed for `fetch(url, { method: 'POST', headers, body })` to deliver one notification. */
export async function pushRequest(target: PushTarget, message: unknown, keys: VapidKeys, subject: string, nowSeconds: number, ttlSeconds = 12 * 3600): Promise<PushRequest> {
  return {
    url: target.endpoint,
    headers: {
      authorization: await vapidAuthorization(target.endpoint, keys, subject, nowSeconds),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(ttlSeconds),
      urgency: 'normal',
    },
    body: await encryptPush(target.p256dh, target.auth, encoder.encode(JSON.stringify(message))),
  };
}

/** Push services answer 404/410 when the browser subscription no longer exists: it must be deleted. */
export const pushGone = (status: number): boolean => status === 404 || status === 410;

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

/** The server posts only to real browser push services — never to an arbitrary address a client supplied. */
export function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.port && PUSH_HOSTS.some(host => host.test(url.hostname));
  } catch { return false; }
}
