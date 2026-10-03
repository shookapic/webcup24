// World loading cost under an explicit network profile: requests, transferred bytes (encoded), time to scene visible / playable,
// cold (empty cache) and warm (reload with the HTTP cache). node tools/qa/load.mjs <base> <out.json> [profile=slow4g] [mode=user|guest]
// Profiles (CDP Network.emulateNetworkConditions): fast = unthrottled, slow4g = 1.6 Mbit/s + 150 ms RTT, slow3g = 400 kbit/s + 400 ms RTT.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const [base, out, profile = 'slow4g', mode = 'user'] = process.argv.slice(2);
const profiles = {
  fast: null,
  slow4g: { offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  slow3g: { offline: false, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8, latency: 400 },
};
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 1200000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function visit(context, label) {
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const client = await page.createCDPSession();
  await client.send('Network.enable');
  if (profiles[profile]) await client.send('Network.emulateNetworkConditions', profiles[profile]);
  const requests = new Map();
  client.on('Network.requestWillBeSent', (e) => requests.set(e.requestId, { url: e.request.url, type: e.type, bytes: 0, fromCache: false }));
  client.on('Network.responseReceived', (e) => { const r = requests.get(e.requestId); if (r) { r.status = e.response.status; r.fromCache = Boolean(e.response.fromDiskCache || e.response.fromServiceWorker); r.encoding = e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'] || 'identity'; } });
  client.on('Network.loadingFinished', (e) => { const r = requests.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
  const t0 = Date.now();
  await page.goto(`${base}/monde/?debug`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const marks = { domContentLoaded: Date.now() - t0 };
  await page.waitForFunction(() => window.__tn?.gl && window.__tn.gl.info.render.frame > 3, { timeout: 300000, polling: 50 });
  marks.sceneVisible = Date.now() - t0;
  if (mode === 'user') {
    await page.waitForFunction(() => window.__tn?.ecctrl, { timeout: 300000, polling: 50 });
    marks.playable = Date.now() - t0;
  }
  await new Promise((r) => setTimeout(r, 1500)); // let late requests (models/textures) finish
  const list = [...requests.values()].filter((r) => r.url.startsWith(base));
  const total = list.reduce((sum, r) => sum + r.bytes, 0);
  const byType = {};
  for (const r of list) { byType[r.type] = byType[r.type] ?? { n: 0, bytes: 0 }; byType[r.type].n++; byType[r.type].bytes += r.bytes; }
  const result = { label, ...marks, requests: list.length, transferredKB: Math.round(total / 1024), cachedRequests: list.filter((r) => r.fromCache || r.bytes === 0).length, byType, biggest: list.sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((r) => ({ url: r.url.replace(base, ''), KB: Math.round(r.bytes / 1024), encoding: r.encoding })) };
  await page.close();
  return result;
}

// login once in a normal context so /api/me returns a user (mode=user); cold = incognito context with the same cookies
const setup = await browser.createBrowserContext();
const setupPage = await setup.newPage();
await setupPage.goto(`${base}/`, { waitUntil: 'networkidle0' });
let cookies = [];
if (mode === 'user') {
  await setupPage.evaluate(async () => {
    const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
    await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
    const { user } = await (await fetch('/api/me')).json();
    localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
  });
  cookies = await setupPage.cookies();
}
const origin = new URL(base).origin;
const cold = await browser.createBrowserContext();
if (cookies.length) { const p = await cold.newPage(); await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' }); await p.setCookie(...cookies); await p.evaluate(async () => { const { user } = await (await fetch('/api/me')).json(); localStorage.setItem(`world-seen-alerts:${user?.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i))); }); await p.close(); }
void origin;
const coldResult = await visit(cold, `cold ${profile} ${mode}`);
const warmResult = await visit(cold, `warm ${profile} ${mode}`);
console.log(JSON.stringify(coldResult));
console.log(JSON.stringify(warmResult));
writeFileSync(out, JSON.stringify({ profile, mode, cold: coldResult, warm: warmResult }, null, 2));
await browser.close();
