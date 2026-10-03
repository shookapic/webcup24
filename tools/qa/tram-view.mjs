// Tram geometry evidence: freezes a tram at chosen arc positions and measures + screenshots the consist against the rail.
// node tools/qa/tram-view.mjs <base> <outDir> [width=1100] [height=700]
// Prints, per case, each car's world position, lateral offset from the line and bottom-of-car height versus the rail top.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const [base, outDir, width = '1100', height = '700'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
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
await page.goto(base + '/monde/?debug&fps=30', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(1); });
// case: [name, code, arc position or 'start'|'end'|'corner:n'|'stop:n', camera offset side (+1/-1)]
const cases = [['T1-straight', 'T1', 'mid', 1], ['T1-corner', 'T1', 'corner:1', 1], ['T1-station', 'T1', 'stop:1', 1], ['T1-end', 'T1', 'end', 1], ['T1-start', 'T1', 'start', 1], ['T2-straight', 'T2', 'mid', -1], ['T2-corner', 'T2', 'corner:2', 1], ['T2-end', 'T2', 'end', -1]];
for (const [name, code, where, side] of cases) {
  const info = await page.evaluate(async ({ code, where, side }) => {
    const tn = window.__tn;
    const t = tn.trams[code];
    const { state, total, stopArcs, geom, range } = t;
    const cum = geom.cum;
    const arcAt = (w) => (w === 'mid' ? range[0] + (range[1] - range[0]) * 0.3 : w === 'start' ? range[0] : w === 'end' ? range[1] : w.startsWith('corner') ? cum[Number(w.split(':')[1])] : stopArcs[Number(w.split(':')[1])]);
    state.s = arcAt(where);
    state.dwell = 1e6;
    state.dir = where === 'end' ? 1 : where === 'start' ? -1 : 1;
    await tn.run(0.2);
    const cars = tn.carsOf(code).map((c) => c.getWorldPosition(new c.position.constructor()).toArray());
    const head = cars[0];
    tn.freecam = true;
    const lead = cars[0];
    const dx = cars[2][0] - cars[0][0], dz = cars[2][2] - cars[0][2];
    // camera 11 m to the side of the consist centre (perpendicular to the lead-rear chord), at rail height, looking at the centre
    const len = Math.hypot(dx, dz) || 1;
    const cx = cars[1][0], cz = cars[1][2];
    const px = (-dz / len) * 16 * side, pz = (dx / len) * 16 * side;
    tn.controls.setLookAt(cx + px, 4.5, cz + pz, cx, 6.4, cz, false);
    await tn.run(0.3);
    void lead;
    const THREE = tn.THREE;
    const boxes = tn.carsOf(code).map((c) => { const b = new THREE.Box3().setFromObject(c); return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(2)); });
    return { cars, boxes, arc: state.s, total };
  }, { code, where, side });
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(name, JSON.stringify({ arc: info.arc.toFixed(1), cars: info.cars.map((c) => c.map((v) => +v.toFixed(2))) }), 'boxes[minx,miny,minz,maxx,maxy,maxz]', JSON.stringify(info.boxes));
}
await browser.close();
