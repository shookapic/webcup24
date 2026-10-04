// Grounded-feet and canopy-camera captures for the Santé clinic. node tools/qa/clinic-feet.mjs <base> <outDir>
//  A/B: avatar standing on the 0.12 m apron slab (beside the steps) versus on plain ground, same low staged camera (blockers off for these staged shots only).
//  C/D: the REAL player camera (blockers active) under the canopy at a steep downward and a steep upward pitch; settled camera position is recorded.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { landmarks } from '../../world/src/layout.js';
const [base, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const L = landmarks.find((l) => l.id === 'hospital');
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 700 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  const { user } = await (await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
});
await page.goto(`${base}/monde/?debug&fps=60`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(1.5); });
const out = [];
// A/B: low staged camera next to the feet
for (const [name, x] of [['A-feet-on-apron', L.x - 5.8], ['B-feet-on-ground', L.x - 16]]) {
  const r = await page.evaluate(async ({ x, z }) => {
    const tn = window.__tn; const b = tn.ecctrl.body;
    tn.freecam = true; tn.realBlockers ??= tn.controls.colliderMeshes; tn.controls.colliderMeshes = [];
    b.setTranslation({ x, y: 1.2, z }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    await tn.run(1.5);
    const p = b.translation();
    tn.controls.setLookAt(p.x - 2.6, 0.45, p.z - 1.3, p.x, 0.5, p.z, false);
    await tn.run(0.4);
    return { body: [p.x, p.y, p.z] };
  }, { x, z: L.z - 4.5 });
  await page.screenshot({ path: `${outDir}/${name}.png` });
  out.push({ name, ...r });
  console.log('shot', name, 'body y', r.body[1].toFixed(3));
}
// C/D: real camera, blockers active, under the canopy
await page.evaluate(async () => { const tn = window.__tn; tn.freecam = false; tn.controls.colliderMeshes = tn.realBlockers; });
for (const [name, polar] of [['C-canopy-steep-down', 0.35], ['D-canopy-steep-up', 2.5]]) {
  const r = await page.evaluate(async ({ x, z, polar }) => {
    const tn = window.__tn; const b = tn.ecctrl.body;
    b.setTranslation({ x, y: 1.2, z }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    tn.controls.rotateAzimuthTo(-Math.PI / 2, false); tn.controls.rotatePolarTo(polar, false);
    await tn.run(1.5);
    tn.controls.rotatePolarTo(polar, false); await tn.run(0.6);
    const c = tn.controls.getPosition(new tn.THREE.Vector3()), t = tn.controls.getTarget(new tn.THREE.Vector3());
    return { camera: [c.x, c.y, c.z], target: [t.x, t.y, t.z], blockers: (tn.controls.colliderMeshes ?? []).length, canopyBlocker: (tn.controls.colliderMeshes ?? []).some((m) => { m.updateMatrixWorld(true); const k = new tn.THREE.Box3().setFromObject(m); return Math.abs(k.min.y - 2.85) < 0.05 && Math.abs(k.max.y - 6.25) < 0.05 && Math.abs((k.min.x + k.max.x) / 2 - x + 0.4) < 6; }) };
  }, { x: L.x - 5.4, z: L.z, polar });
  await page.screenshot({ path: `${outDir}/${name}.png` });
  out.push({ name, polar, ...r });
  const valid = r.blockers > 0 && r.canopyBlocker;
  out.at(-1).valid = valid;
  console.log(valid ? 'shot' : 'INVALID shot', name, 'camera', r.camera.map((v) => v.toFixed(2)).join(','), 'blockers', r.blockers, 'canopy blocker present', r.canopyBlocker);
}
writeFileSync(`${outDir}/feet-camera-report.json`, JSON.stringify({ hospitalAt: [L.x, L.z], canopyUndersideY: 2.85, results: out }, null, 2));
await browser.close();
