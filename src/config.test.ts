import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('deployment configuration', () => {
  it('keeps service role secrets out of the public env example', async () => {
    const env = await read('../.env.example');
    expect(env).toContain('VITE_SUPABASE_URL=');
    expect(env).toContain('VITE_SUPABASE_ANON_KEY=');
    expect(env).not.toMatch(/SERVICE_ROLE|SECRET|PASSWORD/i);
    const keys = [...env.matchAll(/^([A-Z0-9_]+)=/gm)].map(match => match[1]);
    expect(keys).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
  });

  it('serves deep links through the SPA fallback with security headers on Vercel', async () => {
    const config = JSON.parse(await read('../vercel.json')) as {
      rewrites: { source: string; destination: string }[];
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    expect(config.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
    const headers = Object.fromEntries(config.headers.flatMap(entry => entry.headers.map(header => [header.key, header.value])));
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
  });

  it('serves deep links through the SPA fallback on Netlify', async () => {
    const redirects = (await read('../public/_redirects')).trim();
    expect(redirects).toBe('/* /index.html 200');
  });
});
