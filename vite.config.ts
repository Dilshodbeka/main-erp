import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

export function assertDeployableBuild(env: Record<string, string | undefined>, allowDemo: string | undefined) {
  if (allowDemo === '1') return;
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) return;
  throw new Error(
    'Bulut manzili topilmadi: .env.local ichida VITE_SUPABASE_URL va VITE_SUPABASE_ANON_KEY bo‘lishi kerak. ' +
      'Namoyish yig‘masi tuzilmaydi (saytda demo rejim ochiladi). Faqat lokal demo uchun: ALLOW_DEMO_BUILD=1 npm run build.',
  );
}

function cloudGate(): Plugin {
  return {
    name: 'erp-cloud-build-gate',
    apply: 'build',
    configResolved(config) {
      assertDeployableBuild({ ...loadEnv(config.mode, config.envDir, 'VITE_'), ...process.env }, process.env.ALLOW_DEMO_BUILD);
    },
  };
}

function offlineShell(): Plugin {
  return {
    name: 'erp-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = ['index.html', ...Object.keys(bundle).filter(name => name !== 'index.html')];
      const version = assets.join('|');
      const source = `const assets = ${JSON.stringify(assets)}.map(name => new URL(name, self.registration.scope).href);
const cacheName = 'aliya-shell-' + ${JSON.stringify(version)};
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('aliya-shell-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(cacheName).then(cache => cache.match(assets[0]))));
  } else if (assets.includes(event.request.url)) {
    event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(event.request, { ignoreVary: true })) || fetch(event.request)));
  }
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { body: event.data ? event.data.text() : '' }; }
  const icon = new URL('icons/icon-192.png', self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(data.title || 'ALIYA ERP', { body: data.body || '', tag: data.tag || undefined, renotify: Boolean(data.tag), icon, badge: icon, data: { url: data.url || '' } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    for (const client of windows) {
      if (!client.url.startsWith(self.registration.scope)) continue;
      if ('navigate' in client) await client.navigate(target).catch(() => undefined);
      return client.focus();
    }
    return self.clients.openWindow(target);
  }));
});`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
function chunkOf(id: string): string | undefined {
  const path = id.split('\\').join('/');
  if (!path.includes('/node_modules/')) {
    if (path.includes('/src/locales/')) return undefined; // loaded on demand, only for that language
    if (path.includes('/src/components/')) return 'screens';
    if (/(^|\/)src\/(App|main)\.tsx$/.test(path)) return 'app';
    return path.includes('/src/') ? 'core' : undefined;
  }
  if (path.includes('/@supabase/')) return 'supabase';
  if (path.includes('/react-dom/') || path.includes('/react/') || path.includes('/scheduler/')) return 'react';
  if (path.includes('/lucide-react/')) return 'icons';
  return 'vendor';
}

export default defineConfig({
  plugins: [react(), cloudGate(), offlineShell()],
  define: { __BUILD_ID__: JSON.stringify(new Date().toISOString()) },
  build: { rollupOptions: { output: { manualChunks: chunkOf } } },
  server: { port: 5173, strictPort: true },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/.parked-*/**', '**/.superpowers/**'] },
});
