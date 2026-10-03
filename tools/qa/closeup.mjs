// Front close-up of the player at deterministic frames (visual check of avatar/animation).
// node tools/qa/closeup.mjs <base> <out.png> [keys e.g. KeyW] [seconds=1] [dist=4]
import puppeteer from 'puppeteer-core';
const [base, out, keys = '', seconds = '1', dist = '4'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 700 });
page.on('console', (m) => m.text().startsWith('atlas') && console.log(m.text())); page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  const { user } = await (await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
});
await page.goto(base + '/monde/?debug&fps=30' + (process.env.EXTRA || ''), { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
await page.evaluate(async (dist) => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(2); tn.controls.rotateAzimuthTo(Math.PI + 0.5, false); tn.controls.dollyTo(Number(dist), false); await tn.run(1); }, dist);
for (const k of keys.split(',').filter(Boolean)) await page.keyboard.down(k);
await page.evaluate((s) => window.__tn.run(Number(s)), seconds);
await page.screenshot({ path: out });
await browser.close();
