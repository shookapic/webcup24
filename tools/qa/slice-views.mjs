// Same-camera captures of the GLB vertical slice (town hall, street lamp, bench, colony tree) for before/after comparison.
// node tools/qa/slice-views.mjs <base> <outDir> [quality=high] [width=1280] [height=800]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const [base, outDir, quality = 'high', width = '1280', height = '800'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
// name, eye [x, y, z], target [x, y, z]
const views = [
  ['1-plaza-wide', [0, 3.2, 9], [0, 3.0, -16]],
  ['2-townhall-front', [3, 2.0, -2], [0, 4.5, -27]],
  ['3-townhall-three-quarter', [-13, 6.5, 3], [-2, 5.5, -27]],
  ['4-bench-and-lamp', [4.2, 1.5, -6.2], [9.5, 0.9, -2.2]],
  ['5-tree-and-lamp-avenue', [0, 1.8, 11], [1, 3.2, 38]],
  ['6-plaza-trees', [-4, 1.6, 6], [-11, 3.2, -10]],
];
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: Number(width), height: Number(height) });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  const { user } = await (await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
});
await page.goto(`${base}/monde/?debug&fps=30&quality=${quality}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(1.5); tn.freecam = true; });
for (const [name, eye, target] of views) {
  await page.evaluate(async ({ eye, target }) => {
    const tn = window.__tn;
    tn.ecctrl.body.setTranslation({ x: 60, y: 1.2, z: 60 }, true); // park the avatar out of every frame
    tn.controls.setLookAt(...eye, ...target, false);
    await tn.run(0.6);
  }, { eye, target });
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
}
await browser.close();
