// District tour: teleports the player to a vantage point per district and screenshots at deterministic frames.
// node tools/qa/tour.mjs <base> <outDir> [width=1440] [height=900] [only=name1,name2]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const [base, outDir, width = '1440', height = '900', only = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
// name, player x, z, camera azimuth (0 = camera on +z side looking -z), distance, polar angle
const views = [
  ['spawn', 0, 1, 0, 9, 1.2],
  ['mairie', 0, -8, 0, 11, 1.25],
  ['sante', 24, -3, -Math.PI / 2, 10, 1.25],
  ['marche', -26, -3, Math.PI / 2, 10, 1.25],
  ['habitat', -30, -26, Math.PI / 2, 10, 1.25],
  ['sud', 4, 40, 0, 10, 1.25],
  ['tram-side', 0, 2, 0, 16, 1.5],
  ['tram', 9, -9, 0.6, 6, 0.95],
];
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: Number(width), height: Number(height) });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const failed = [];
page.on('requestfailed', (r) => failed.push(r.url()));
page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
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
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(2); });
for (const [name, x, z, az, dist, polar] of views) {
  if (only && !only.split(',').includes(name)) continue;
  await page.evaluate(async ({ x, z, az, dist, polar }) => {
    const tn = window.__tn;
    const b = tn.ecctrl.body;
    b.setTranslation({ x, y: 1.2, z }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    tn.controls.rotateAzimuthTo(az, false);
    tn.controls.rotatePolarTo(polar, false);
    tn.controls.dollyTo(dist, false);
    await tn.run(1.5);
  }, { x, z, az, dist, polar });
  console.log(name, JSON.stringify(await page.evaluate(() => { const s = window.__tn.samples.at(-1); return { dist: window.__tn.controls.distance, cam: [s.cx, s.cz].map((v) => v.toFixed(1)), player: [s.x, s.z].map((v) => v.toFixed(1)) }; })));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
}
await browser.close();
console.log('failed requests:', failed.length ? failed : 'none');
