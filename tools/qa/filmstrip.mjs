// Filmstrip of the world at deterministic frames: N screenshots every `step` seconds (walk cycle / NPC travel evidence).
// node tools/qa/filmstrip.mjs <base> <outPrefix> [frames=6] [step=0.25] [keys=KeyW]  -> <outPrefix>-0.png ...
import puppeteer from 'puppeteer-core';
const [base, prefix, frames = '6', step = '0.25', keys = 'KeyW'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 520 });
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  const { user } = await (await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
});
await page.goto(base + '/monde/?debug&fps=30', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(2); tn.controls.rotateAzimuthTo(Math.PI / 2, false); tn.controls.dollyTo(5, false); await tn.run(0.5); });
for (const k of keys.split(',').filter(Boolean)) await page.keyboard.down(k);
for (let i = 0; i < Number(frames); i++) { await page.evaluate((s) => window.__tn.run(Number(s)), step); await page.screenshot({ path: `${prefix}-${i}.png` }); }
await browser.close();
