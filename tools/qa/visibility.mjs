// Polling while the tab is hidden: counts /api requests per endpoint during 8 s hidden and the time to the first refresh after resume.
// node tools/qa/visibility.mjs <base>
import puppeteer from 'puppeteer-core';
const [base] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 300000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
});
await page.goto(base + '/monde/?debug', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.ecctrl, { timeout: 60000 });
const log = [];
page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) log.push({ t: Date.now(), path: u.pathname, method: r.method() }); });
const setHidden = (hidden) => page.evaluate((hidden) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
await new Promise((r) => setTimeout(r, 3000));
log.length = 0;
await setHidden(true);
const hiddenFrom = Date.now();
await new Promise((r) => setTimeout(r, 8000));
const during = log.filter((e) => e.t >= hiddenFrom);
const count = (list) => list.reduce((acc, e) => { const k = `${e.method} ${e.path}`; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
console.log('while hidden (8 s):', JSON.stringify(count(during)));
const resumeAt = Date.now();
await setHidden(false);
await new Promise((r) => setTimeout(r, 1500));
const after = log.filter((e) => e.t >= resumeAt);
const presence = after.find((e) => e.path === '/api/presence');
console.log('after resume:', JSON.stringify(count(after)), 'first presence refresh after', presence ? presence.t - resumeAt : 'never', 'ms');
const worldDuring = during.filter((e) => e.path === '/api/presence').length;
console.log(worldDuring === 0 && presence && presence.t - resumeAt < 500 ? 'PASS world presence polling pauses while hidden and refreshes immediately on resume' : 'FAIL');
await browser.close();
process.exit(worldDuring === 0 && presence && presence.t - resumeAt < 500 ? 0 : 1);
