// Same-camera captures of the Santé clinic for before/after comparison (hospital integration).
// node tools/qa/clinic-views.mjs <base> <outDir> [quality=high] [width=1280] [height=800]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const [base, outDir, quality = 'high', width = '1280', height = '800'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
// name, eye [x, y, z], target [x, y, z]
const views = [
  ['1-clinic-front', [24, 2.4, -6], [40, 3.2, -6]],
  ['2-clinic-three-quarter', [26, 5.5, 6], [40, 3.5, -7]],
  ['3-clinic-player-height', [30, 1.7, -3.2], [38, 1.6, -6]],
  ['4-clinic-rail-view', [28, 9.8, -3], [40, 4.5, -6]],
  ['5-clinic-back', [54, 4.5, -2], [40, 3.5, -6]],
  ['6-clinic-annexes', [32, 12, -6], [40, 1.5, -6]],
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
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(1.5); tn.freecam = true; tn.controls.colliderMeshes = []; });
// Staged architecture captures only: the free camera must sit exactly where requested, so camera blockers are disabled for these shots (the real player
// camera and its blockers are untouched elsewhere). Every shot records the settled camera position/target against the request; a mismatch marks it INVALID.
const report = [];
for (const [name, eye, target] of views) {
  const got = await page.evaluate(async ({ eye, target }) => {
    const tn = window.__tn;
    tn.ecctrl.body.setTranslation({ x: 60, y: 1.2, z: 60 }, true); // park the avatar out of every frame
    tn.controls.setLookAt(...eye, ...target, false);
    await tn.run(0.6);
    const p = tn.controls.getPosition(new tn.THREE.Vector3()), t = tn.controls.getTarget(new tn.THREE.Vector3());
    return { eye: [p.x, p.y, p.z], target: [t.x, t.y, t.z], blockers: (tn.controls.colliderMeshes ?? []).length };
  }, { eye, target });
  const d = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  const valid = d(got.eye, eye) < 0.05 && d(got.target, target) < 0.05 && got.blockers === 0;
  report.push({ name, requested: { eye, target }, settled: { eye: got.eye.map((v) => +v.toFixed(3)), target: got.target.map((v) => +v.toFixed(3)) }, blockersActive: got.blockers, valid });
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(valid ? 'shot' : 'INVALID shot', name);
}
writeFileSync(`${outDir}/camera-report.json`, JSON.stringify({ quality, viewport: [Number(width), Number(height)], report }, null, 2));
await browser.close();
