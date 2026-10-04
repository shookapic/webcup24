// Bounded LOCAL concurrency probe of the world's polling (presence POST + GET, announcements) with the same jitter/backoff as the client.
// node tools/qa/presence-load.mjs <base> [clients=60] [seconds=20] [intervalMs=2000]      Disposable server only; never run against production.
import { firstDelay, nextDelay } from '../../world/src/polling.js';
const [base, clientsArg = '60', secondsArg = '20', intervalArg = '2000'] = process.argv.slice(2);
const N = Number(clientsArg), SECONDS = Number(secondsArg), INTERVAL = Number(intervalArg);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error('refusing: only a loopback base URL is allowed'); process.exit(2); }
const stamp = Date.now();
const timings = [], statuses = {};
const record = (name, ms, status) => { timings.push([name, ms]); statuses[status] = (statuses[status] ?? 0) + 1; };
async function timed(name, cookie, path, method = 'GET', body) {
  const start = performance.now();
  try {
    const response = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer();
    record(name, performance.now() - start, response.status);
    return { status: response.status, retryAfter: Number(response.headers.get('Retry-After')) || 0, headers: response.headers };
  } catch { record(name, performance.now() - start, 'network'); return { status: 0, retryAfter: 0 }; }
}
// register N disposable citizens (spread out so the host's sign-up throttle is not the thing measured)
const cookies = [];
for (let i = 0; i < N; i++) {
  const response = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Load ${i}`, email: `load${stamp}-${i}@example.org`, password: 'motdepasse-solide-123' }) });
  const set = response.headers.getSetCookie?.() ?? [];
  if (response.status === 201 || response.status === 200) cookies.push(set.map((c) => c.split(';')[0]).join('; '));
  else if (response.status === 429) break;
}
console.log(`registered ${cookies.length}/${N} disposable accounts`);
const end = Date.now() + SECONDS * 1000;
await Promise.all(cookies.map(async (cookie, i) => {
  let failures = 0;
  await new Promise((r) => setTimeout(r, firstDelay(INTERVAL)));
  while (Date.now() < end) {
    const post = await timed('presence.post', cookie, '/api/presence', 'POST', { x: (i % 20) * 3, z: Math.floor(i / 20) * 3, ry: 0 });
    const get = await timed('presence.get', cookie, '/api/presence');
    const news = await timed('announcements', cookie, '/api/announcements');
    const bad = [post, get, news].find((r) => r.status === 0 || r.status >= 429);
    failures = bad ? failures + 1 : 0;
    await new Promise((r) => setTimeout(r, nextDelay(INTERVAL, failures, { retryAfter: bad?.retryAfter ?? 0 })));
  }
}));
const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
const names = [...new Set(timings.map(([n]) => n))];
console.log(JSON.stringify({ base, clients: cookies.length, seconds: SECONDS, intervalMs: INTERVAL, requests: timings.length, rps: +(timings.length / SECONDS).toFixed(1), statuses,
  perRoute: Object.fromEntries(names.map((n) => { const t = timings.filter(([x]) => x === n).map(([, ms]) => ms); return [n, { n: t.length, p50: +pct(t, 0.5).toFixed(1), p95: +pct(t, 0.95).toFixed(1), max: +Math.max(...t).toFixed(1) }]; })) }, null, 2));
