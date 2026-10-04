// Render-vs-collision alignment: for every building the rendered mesh bounds must match its collision footprint (centre within 0.35 m, width/depth/height within 0.3 m),
// so doors, labels, NPC routes and walls agree with what is drawn. (Catches the kit's exported root offset of [2, 0, 1.5].)
// node tools/qa/building-check.mjs <base>
import puppeteer from 'puppeteer-core';
const [base] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
});
await page.goto(base + '/monde/?debug&fps=30', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(1); });
const rows = await page.evaluate(() => {
  const tn = window.__tn;
  return [...tn.buildingObjects].map(([b, group]) => {
    group.updateMatrixWorld(true);
    const box = new tn.THREE.Box3().setFromObject(group);
    const turned = Math.round(Math.abs(b.ry) / (Math.PI / 2)) % 2 === 1;
    const fp = tn.footprintOf(b);
    return { model: b.model, x: b.x, z: b.z, fw: fp.w, fd: fp.d, fh: fp.h, cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2, w: box.max.x - box.min.x, d: box.max.z - box.min.z, h: box.max.y - box.min.y, turned };
  });
});
let bad = 0;
for (const r of rows) {
  const dc = Math.hypot(r.cx - r.x, r.cz - r.z);
  const dw = Math.abs(r.w - r.fw), dd = Math.abs(r.d - r.fd), dh = Math.abs(r.h - r.fh);
  const ok = dc <= 0.35 && dw <= 0.3 && dd <= 0.3 && dh <= 0.3; // rendered bounds == collision footprint (centre and width/depth/height)
  if (!ok) bad++;
  console.log(ok ? 'PASS' : 'FAIL', r.model, `at ${r.x},${r.z}`, `centre offset ${dc.toFixed(2)} m`, `rendered ${r.w.toFixed(1)}x${r.d.toFixed(1)}x${r.h.toFixed(1)} vs footprint ${r.fw.toFixed(1)}x${r.fd.toFixed(1)}x${r.fh.toFixed(1)}`);
}
// Authored landmarks: rendered bounds must sit inside / match the union of their collision footprints (hall + wings + canopy pillars).
const landmarks = await page.evaluate(() => {
  const tn = window.__tn;
  return [...(tn.landmarkObjects ?? [])].map(([l, group]) => {
    group.updateMatrixWorld(true);
    const box = new tn.THREE.Box3().setFromObject(group);
    return { id: l.id, x: l.x, z: l.z, min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z], footprints: tn.footprintsNear(l) };
  });
});
for (const l of landmarks) {
  const fx0 = Math.min(...l.footprints.map((f) => f.x - f.w / 2)), fx1 = Math.max(...l.footprints.map((f) => f.x + f.w / 2));
  const fz0 = Math.min(...l.footprints.map((f) => f.z - f.d / 2)), fz1 = Math.max(...l.footprints.map((f) => f.z + f.d / 2));
  const dx = Math.max(Math.abs(l.min[0] - fx0), Math.abs(l.max[0] - fx1)), dz = Math.max(Math.abs(l.min[2] - fz0), Math.abs(l.max[2] - fz1));
  const ok = dx <= 0.9 && dz <= 0.9 && l.min[1] >= -0.01;
  if (!ok) bad++;
  console.log(ok ? 'PASS' : 'FAIL', `landmark ${l.id} at ${l.x},${l.z}`, `x ${l.min[0].toFixed(1)}..${l.max[0].toFixed(1)} (footprints ${fx0.toFixed(1)}..${fx1.toFixed(1)}), z ${l.min[2].toFixed(1)}..${l.max[2].toFixed(1)} (${fz0.toFixed(1)}..${fz1.toFixed(1)}), height ${l.max[1].toFixed(1)} m`);
}
console.log(bad ? `FAILURES (${bad})` : `ALL PASS (${rows.length} buildings + ${landmarks.length} landmark)`);
await browser.close();
process.exit(bad ? 1 : 0);
