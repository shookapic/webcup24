// F93 / F94: a small service worker so the essentials stay readable when the network or the server is down: the page shell and the PUBLIC lists (alerts and official messages,
// services, places with their phone numbers and hours, transport, the orientation index) are kept after each successful visit and shown, clearly marked with the date they
// were saved, when a request fails or takes too long. It never stores anything that depends on who is signed in (/api/me, messages, appointments, anything not listed
// below), never answers a write, and cannot make an action work offline: those say that a connection is needed.
const CACHE = 'tn-essential-v1';
const SHELL = ['/', '/styles.css', '/app.js', '/i18n.js', '/favicon.svg'];
const OPPORTUNISTIC = new Set(['/i18n-en.js', '/orientation.js', '/orientation.css', '/participation.js', '/participation.css']);
const PUBLIC_API = new Set(['/api/announcements', '/api/services', '/api/places', '/api/transports', '/api/orientation/index']);
const WAIT_MS = 6000; // on a very slow connection the saved copy is shown after this long, while the fresh one keeps loading and is saved for next time

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  // only this feature's own older caches are removed
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('tn-essential-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

const keep = async (cache, request, response) => {
  const headers = new Headers(response.headers);
  headers.set('X-Terra-Stored-At', String(Date.now()));
  await cache.put(request, new Response(await response.clone().blob(), { status: response.status, statusText: response.statusText, headers }));
};
const saved = async (cache, request) => {
  const hit = await cache.match(request); // the exact URL, query included
  if (!hit) return null;
  const headers = new Headers(hit.headers);
  headers.set('X-Terra-Cache', 'stale');
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
};

async function answer(request) {
  const cache = await caches.open(CACHE);
  // a public page or list that answers with a server error (5xx) is treated like an outage: the saved copy is shown when there is one
  const network = fetch(request).then(async (response) => {
    if (response.ok) await keep(cache, request, response);
    else if (response.status >= 500) { const copy = await saved(cache, request); if (copy) return copy; }
    return response;
  });
  const slow = new Promise((resolve) => setTimeout(() => resolve(null), WAIT_MS));
  try {
    const first = await Promise.race([network, slow]);
    if (first) return first;
    return (await saved(cache, request)) || network; // too slow: the saved copy now (if there is one), the fresh one is still being saved
  } catch {
    return (await saved(cache, request)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (SHELL.includes(url.pathname) || OPPORTUNISTIC.has(url.pathname) || PUBLIC_API.has(url.pathname)) event.respondWith(answer(request));
});
