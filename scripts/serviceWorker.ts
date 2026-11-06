export function serviceWorkerSource(build: string, assets: string[]) {
  return `
const BUILD = ${JSON.stringify(build)};
const CACHE = 'bari-khata-' + BUILD;
const ASSETS = ${JSON.stringify(assets)};
const clientBuilds = new Map();
async function pruneCaches() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // Unknown and older tabs still need their cached lazy-loaded chunks.
  if (clients.some(client => clientBuilds.get(client.id) !== BUILD)) return;
  for (const name of await caches.keys())
    if (name.startsWith('bari-khata-') && name !== CACHE) await caches.delete(name);
}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path => new Request(path, { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'REQUEST_CLIENT_BUILD' });
    await pruneCaches();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLIENT_BUILD' && event.source?.id && typeof event.data.build === 'string') {
    clientBuilds.set(event.source.id, event.data.build);
    event.waitUntil(pruneCaches());
  }
});
async function asset(request, pathname) {
  const current = await caches.open(CACHE);
  const cached = await current.match(pathname);
  if (cached) return cached;
  if (pathname.startsWith('/assets/')) {
    for (const name of await caches.keys()) {
      if (name.startsWith('bari-khata-') && name !== CACHE) {
        const previous = await (await caches.open(name)).match(pathname);
        if (previous) return previous;
      }
    }
  }
  return fetch(request);
}
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/release.json') return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html')).then(cached => cached || fetch(request)));
  } else if (ASSETS.includes(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(request, url.pathname));
  }
});`;
}
