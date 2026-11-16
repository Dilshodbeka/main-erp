import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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
});`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
export default defineConfig({
  plugins: [react(), offlineShell()],
  define: { __BUILD_ID__: JSON.stringify(new Date().toISOString()) },
  server: { port: 5173, strictPort: true },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/.parked-*/**', '**/.superpowers/**'] },
});
