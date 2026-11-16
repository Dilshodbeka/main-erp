// Private KV gate for Aliya ERP company copies. Deployed as its own Worker (wrangler.backup.jsonc),
// separate from the site Worker so publishing the app can never expose or break the storage.
// Every call needs the shared x-erp-upload-secret header; only the erp-backup Edge Function has it,
// so the namespace stays unreachable from browsers and accepts nothing outside companies/<uuid>/.

interface Env {
  ERP_BACKUP: KVNamespace;
  UPLOAD_SECRET: string;
}

const companyKey = /^companies\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+\.json$/i;

// KV rejects a value over 25 MiB, so the gate refuses earlier instead of failing mid-write.
const MAX_BYTES = 20 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// KV list returns the size only inside the metadata we wrote, so read it back defensively.
const storedBytes = (entry: KVNamespaceListKey<unknown, string>): number => {
  const metadata = entry.metadata;
  if (typeof metadata === 'object' && metadata !== null && 'bytes' in metadata) return Number((metadata as { bytes?: unknown }).bytes ?? 0);
  return Number((entry as { size?: number }).size ?? 0);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') return json({ ok: true });

    const supplied = request.headers.get('x-erp-upload-secret') ?? '';
    if (!env.UPLOAD_SECRET || supplied !== env.UPLOAD_SECRET) return json({ ok: false, error: 'forbidden' }, 403);

    if (url.pathname === '/__list') {
      const prefix = url.searchParams.get('prefix') ?? '';
      if (!/^companies\/[0-9a-f-]+\/$/i.test(prefix)) return json({ ok: false, error: 'bad prefix' }, 400);
      const objects: { key: string; size: number }[] = [];
      let cursor: string | undefined;
      let complete = false;
      while (!complete) {
        const page = await env.ERP_BACKUP.list({ prefix, limit: 1000, cursor });
        for (const entry of page.keys) objects.push({ key: entry.key, size: storedBytes(entry) });
        cursor = page.cursor;
        complete = page.list_complete;
      }
      return json({ ok: true, objects });
    }

    const key = decodeURIComponent(url.pathname.slice(1));
    if (!companyKey.test(key)) return json({ ok: false, error: 'bad key' }, 400);

    if (request.method === 'PUT') {
      const contentLength = Number(request.headers.get('content-length') ?? 0);
      if (contentLength > MAX_BYTES) return json({ ok: false, error: 'too_large' }, 413);
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_BYTES) return json({ ok: false, error: 'too_large' }, 413);
      await env.ERP_BACKUP.put(key, body, { metadata: { bytes: body.byteLength } });
      return json({ ok: true, key, size: body.byteLength });
    }

    if (request.method === 'GET') {
      const value = await env.ERP_BACKUP.get(key, 'arrayBuffer');
      if (!value.value) return json({ ok: false, error: 'not_found' }, 404);
      return new Response(value.value, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    if (request.method === 'DELETE') {
      await env.ERP_BACKUP.delete(key);
      return json({ ok: true, deleted: key });
    }

    return json({ ok: false, error: 'method_not_allowed' }, 405);
  },
} satisfies ExportedHandler<Env>;
