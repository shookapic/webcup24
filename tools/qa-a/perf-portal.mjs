// F57-F60: measured proxies for the portal's weight and work, in real Chrome (puppeteer-core), on a disposable server.
// It records what a visitor, a resident and an agent actually download and do on the main journeys under an EXPLICIT slow profile
// (network + 4x CPU slowdown), cold and warm, and how many API requests a page makes in a minute while visible and while hidden.
// These are proxies (bytes, requests, main-thread time). They are not carbon figures and not a certification.
// Needs: npm i --no-save puppeteer-core. Usage: node tools/qa-a/perf-portal.mjs <label> [--out file.json]
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const label = process.argv[2] || 'run';
const outIndex = process.argv.indexOf('--out');
const outFile = outIndex > 0 ? process.argv[outIndex + 1] : null;
const dataDir = mkdtempSync(join(tmpdir(), 'terra-perf-'));
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'a.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profiles = {
  'slow-3g': { latency: 400, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8, cpu: 4, note: '400 kbit/s, 400 ms round trip, CPU 4x slower' },
  'slow-4g': { latency: 150, downloadThroughput: 1600 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, cpu: 4, note: '1.6 Mbit/s, 150 ms round trip, CPU 4x slower' },
};

const staffOut = spawnSync(process.execPath, ['create-staff.mjs', 'agent@perf.test', 'Agent Perf', 'agent'], { cwd: root, env, encoding: 'utf8' });
const agentPassword = /conserver : (\S+)/.exec(staffOut.stdout)[1];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
await wait(1500);
const call = async (path, method = 'GET', body, cookie = '') => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { data: await response.json().catch(() => ({})), cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0], status: response.status };
};
const resident = await call('/api/auth/register', 'POST', { name: 'Zoé Perf', email: 'zoe@perf.test', password: 'password-long-1' });
const agent = await call('/api/auth/login', 'POST', { email: 'agent@perf.test', password: agentPassword });
// realistic content: a few requests, an announcement, a booked-able slot
for (const subject of ['Lampadaire cassé', 'Question sur les horaires', 'Dépôt sauvage rue du Port']) await call('/api/messages', 'POST', { subject, body: 'Un message de test assez long pour ressembler à un vrai message.', kind: subject.startsWith('Question') ? 'contact' : 'incident', location: 'Rue du Port' }, resident.cookie);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
const kinds = (url, type) => (/\/api\//.test(url) ? 'api' : /\.js(\?|$)/.test(url) || type === 'Script' ? 'js' : /\.css(\?|$)/.test(url) || type === 'Stylesheet' ? 'css' : type === 'Document' ? 'html' : type === 'Image' ? 'image' : type === 'Font' ? 'font' : 'other');

async function session(cookie, profile) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  if (cookie) await page.setCookie({ name: 'tn_session', value: cookie.split('=')[1], url: base });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  const log = { requests: new Map(), api: [] };
  cdp.on('Network.requestWillBeSent', (event) => { log.requests.set(event.requestId, { url: event.request.url, type: event.type, at: Date.now(), bytes: 0, status: 0, cached: false }); });
  cdp.on('Network.responseReceived', (event) => { const r = log.requests.get(event.requestId); if (r) { r.status = event.response.status; r.type = event.type; r.fromCache = event.response.fromDiskCache || event.response.fromMemoryCache; } });
  cdp.on('Network.loadingFinished', (event) => { const r = log.requests.get(event.requestId); if (r) r.bytes = event.encodedDataLength; });
  return { context, page, cdp, log, throttle: async () => { await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.downloadThroughput, uploadThroughput: profile.uploadThroughput }); await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu }); } };
}
const summarize = (log) => {
  const rows = [...log.requests.values()].filter((r) => r.url.startsWith(base));
  const by = {};
  for (const r of rows) { const k = kinds(r.url, r.type); by[k] ||= { requests: 0, bytes: 0 }; by[k].requests++; by[k].bytes += r.bytes; }
  return { requests: rows.length, bytes: rows.reduce((sum, r) => sum + r.bytes, 0), notModified: rows.filter((r) => r.status === 304).length, by };
};
const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter((m) => ['ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize', 'Nodes'].includes(m.name)).map((m) => [m.name, m.name.endsWith('Duration') ? Math.round(m.value * 1000) : Math.round(m.value)]));

async function journey(name, cookie, profileName, readySelector) {
  const profile = profiles[profileName];
  const s = await session(cookie, profile);
  await s.throttle();
  const result = { journey: name, profile: profileName };
  for (const phase of ['cold', 'warm']) {
    s.log.requests.clear();
    const started = Date.now();
    await s.page.goto(base + '/', { waitUntil: 'load', timeout: 180_000 });
    const loaded = Date.now() - started;
    await s.page.waitForSelector(readySelector, { timeout: 180_000 });
    const useful = Date.now() - started;
    await wait(2500);
    const nav = await s.page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), loadEvent: Math.round(n.loadEventEnd) }; });
    result[phase] = { ...summarize(s.log), loadMs: loaded, usefulContentMs: useful, ...nav, main: await metrics(s.cdp) };
  }
  await s.context.close();
  return result;
}

// API requests per minute while the page stays open, visible and hidden (hidden = the page reports document.hidden / visibilityState hidden)
async function steady(name, cookie, seconds) {
  const out = {};
  const pages = {};
  for (const mode of ['visible', 'hidden']) {
    const s = await session(cookie, { latency: 0, downloadThroughput: -1, uploadThroughput: -1, cpu: 1 });
    await s.page.goto(base + '/', { waitUntil: 'networkidle0' });
    await wait(1500);
    if (mode === 'hidden') {
      await s.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    }
    s.log.requests.clear();
    pages[mode] = s;
  }
  await wait(seconds * 1000);
  for (const mode of ['visible', 'hidden']) {
    const apis = [...pages[mode].log.requests.values()].filter((r) => /\/api\//.test(r.url));
    const byPath = {};
    for (const r of apis) { const p = new URL(r.url).pathname; byPath[p] = (byPath[p] || 0) + 1; }
    out[mode] = { seconds, apiRequests: apis.length, bytes: apis.reduce((sum, r) => sum + r.bytes, 0), byPath };
    await pages[mode].context.close();
  }
  return { journey: name, ...out };
}

const report = { label, at: new Date().toISOString(), tool: 'tools/qa-a/perf-portal.mjs', profiles: Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, v.note])), journeys: [], steady: [] };
try {
  for (const profileName of Object.keys(profiles)) {
    report.journeys.push(await journey('visitor home', '', profileName, '#services-list .service-card'));
    report.journeys.push(await journey('resident home (signed in)', resident.cookie, profileName, '#citizen-messages .message-card'));
    report.journeys.push(await journey('agent home (signed in)', agent.cookie, profileName, '#staff-messages .message-card'));
  }
  report.steady.push(await steady('visitor', '', 66));
  report.steady.push(await steady('resident', resident.cookie, 66));
  report.steady.push(await steady('agent', agent.cookie, 66));
} finally {
  await browser.close();
  server.kill();
  await wait(300);
  rmSync(dataDir, { recursive: true, force: true });
}
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`# perf-portal ${label} (${report.at})`);
for (const j of report.journeys) {
  for (const phase of ['cold', 'warm']) {
    const r = j[phase];
    console.log(`${j.profile.padEnd(8)} ${j.journey.padEnd(26)} ${phase.padEnd(4)} ${String(r.requests).padStart(3)} req ${kb(r.bytes).padStart(9)}  304:${r.notModified}  load ${String(r.loadMs).padStart(6)} ms  useful ${String(r.usefulContentMs).padStart(6)} ms  script ${r.main.ScriptDuration} ms  task ${r.main.TaskDuration} ms  | ${Object.entries(r.by).map(([k, v]) => `${k} ${v.requests}/${kb(v.bytes)}`).join('  ')}`);
  }
}
for (const s of report.steady) console.log(`steady ${s.journey.padEnd(9)} visible: ${s.visible.apiRequests} api req / ${s.visible.seconds}s (${kb(s.visible.bytes)})   hidden: ${s.hidden.apiRequests} api req / ${s.hidden.seconds}s (${kb(s.hidden.bytes)})`);
if (outFile) { writeFileSync(outFile, JSON.stringify(report, null, 2)); console.log('written', outFile); }
process.exit(0);
