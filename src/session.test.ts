import { describe, expect, it } from 'vitest';
import { sessionUserId } from '../supabase/functions/_shared/session';

const token = (claims: Record<string, unknown>) => {
  const encode = (value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
};

const USER_ID = '3f2a1b6c-9d4e-4f70-8a21-6b5c0d9e1f22';

describe('sessionUserId', () => {
  it('returns the subject of an authenticated session token', () => {
    expect(sessionUserId(token({ sub: USER_ID, role: 'authenticated', exp: 4_102_444_800 }))).toBe(USER_ID);
  });

  it('decodes unicode claims without throwing', () => {
    expect(sessionUserId(token({ sub: USER_ID, role: 'authenticated', user_metadata: { name: 'Do‘niyozova Mebel ᴍᴇʙᴇʟ ✓' } })))
      .toBe(USER_ID);
  });

  it('rejects the anon key token', () => {
    expect(sessionUserId(token({ sub: 'anon-key-id', role: 'anon' }))).toBe('');
  });

  it('rejects the service role token', () => {
    expect(sessionUserId(token({ sub: 'supabase', role: 'service_role' }))).toBe('');
  });

  it('rejects a subject that is not a user uuid', () => {
    expect(sessionUserId(token({ sub: 'not-a-uuid', role: 'authenticated' }))).toBe('');
  });

  it('rejects anything that is not a three-part token', () => {
    expect(sessionUserId('')).toBe('');
    expect(sessionUserId('garbage')).toBe('');
    expect(sessionUserId(`${token({ sub: USER_ID, role: 'authenticated' }).split('.')[0]}.x`)).toBe('');
  });
});
