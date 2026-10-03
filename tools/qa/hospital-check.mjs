// Santé clinic integration checks: compound collider vs the model, porch/door approach with the real player, jump under the canopy, roof reachability,
// camera blockers, NPC route + rail clearance, annex gaps. node tools/qa/hospital-check.mjs <base>
import puppeteer from 'puppeteer-core';
import { footprints, landmarks, pathNodes, pathLinks, lines, buildings, footprintOf } from '../../world/src/layout.js';
const [base] = process.argv.slice(2);
let bad = 0;
const check = (name, ok, info) => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name, info ?? ''); };
const L = landmarks.find((l) => l.id === 'hospital');
const boxes = footprints.filter((f) => f.landmark === 'hospital');

// --- pure data: clearances from the committed layout
const rect = (f) => [f.x - f.w / 2, f.x + f.w / 2, f.z - f.d / 2, f.z + f.d / 2];
const dist = (px, pz, [x0, x1, z0, z1]) => Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(z0 - pz, 0, pz - z1));
const segRectMin = (a, b, r) => { let m = 1e9; for (let t = 0; t <= 1; t += 0.01) m = Math.min(m, dist(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r)); return m; };
const hosp = [Math.min(...boxes.map((f) => rect(f)[0])), Math.max(...boxes.map((f) => rect(f)[1])), Math.min(...boxes.map((f) => rect(f)[2])), Math.max(...boxes.map((f) => rect(f)[3]))];
let routeMin = 1e9;
for (const [a, list] of Object.entries(pathLinks)) for (const b of list) routeMin = Math.min(routeMin, segRectMin(pathNodes[a], pathNodes[b], hosp));
check('NPC routes keep >= 1.5 m from the clinic envelope', routeMin >= 1.5, `min ${routeMin.toFixed(2)} m`);
let railMin = 1e9;
for (const line of Object.values(lines)) for (let i = 1; i < line.path.length; i++) railMin = Math.min(railMin, segRectMin(line.path[i - 1], line.path[i], hosp));
check('rails stay >= 3 m (horizontal) from the clinic envelope; rail y 9.2 vs roof 7.75 = 1.45 m vertical gap', railMin >= 3, `min ${railMin.toFixed(2)} m`);
for (const b of buildings.filter((b) => b.model.startsWith('hangar') && Math.abs(b.x - 40) < 1)) {
  const r = rect(footprintOf(b));
  const gapZ = Math.max(r[2] - hosp[3], hosp[2] - r[3]);
  check(`annex at ${b.x},${b.z} does not overlap the clinic (gap along z)`, gapZ >= 1.5, `${gapZ.toFixed(2)} m`);
}
const mouth = [L.x - 5.4, L.z]; // porch mouth: between the piers, local z 5.4 (door side faces world -x)
check('porch mouth ground point is outside every ground-level collider', !boxes.some((f) => !f.y && f.h > 1 && dist(mouth[0], mouth[1], rect(f)) < 0.01), `point ${mouth}`);

// --- browser: real player, real colliders
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
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
// teleport, aim the camera along `az`, hold forward (optionally jump) and sample the body every 0.1 s
const walk = (start, az, seconds, jump = false) => page.evaluate(async ({ start, az, seconds, jump }) => {
  const tn = window.__tn; const b = tn.ecctrl.body;
  b.setTranslation({ x: start[0], y: start[1], z: start[2] }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true);
  tn.controls.rotateAzimuthTo(az, false); await tn.run(0.5);
  const rows = [];
  for (let t = 0; t < seconds; t += 0.1) { await tn.run(0.1, { forward: true, backward: false, leftward: false, rightward: false, run: false, jump }); const p = b.translation(); rows.push([p.x, p.y, p.z]); }
  return rows;
}, { start, az, seconds, jump });
// follow waypoints like a player: re-aim the camera at the next waypoint every 0.1 s, hold forward, log the body
const follow = (start, waypoints, maxSeconds = 20) => page.evaluate(async ({ start, waypoints, maxSeconds }) => {
  const tn = window.__tn; const b = tn.ecctrl.body;
  b.setTranslation({ x: start[0], y: 1.2, z: start[1] }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true);
  await tn.run(0.4);
  const rows = []; let i = 0;
  for (let t = 0; t < maxSeconds && i < waypoints.length; t += 0.1) {
    const p = b.translation(); const [wx, wz] = waypoints[i];
    if (Math.hypot(wx - p.x, wz - p.z) < 0.4) { i++; continue; }
    tn.controls.rotateAzimuthTo(Math.atan2(-(wx - p.x), -(wz - p.z)), false);
    await tn.run(0.1, { forward: true, backward: false, leftward: false, rightward: false, run: false, jump: false });
    rows.push([p.x, p.y, p.z]);
  }
  const p = b.translation(); rows.push([p.x, p.y, p.z]);
  return { rows, reached: i };
}, { start, waypoints, maxSeconds });
const shot = (name) => page.screenshot({ path: `docs/qa-captures/clinic-after/${name}.png` });
const doorX = L.x - 4.5675; // door anchor (declared contract); the doors face world -x
// 1. the bench at (31.5,-6) stands on the straight line to the door (the old stop-side axis): prove it, then walk a realistic route around it
const straight = await follow([26, -6], [[doorX, -6]], 9);
check('straight line along z=-6 from x=26 is stopped by the bench at x 31.5 (known obstacle, not the clinic)', straight.rows.at(-1)[0] < 31.2 && straight.reached === 0, `stops at x ${straight.rows.at(-1)[0].toFixed(2)}`);
async function routeAndDirect(label) {
  const route = await follow([30, 0.5], [[32.6, -3.6], [34.2, -6], [doorX, -6]], 16);
  if (label === '') await shot('route-end');
  check(`${label}realistic route from the Santé stop area, around the bench, up the steps and to the doors`, route.rows.at(-1)[0] >= doorX - 0.5, `end x ${route.rows.at(-1)[0].toFixed(2)} z ${route.rows.at(-1)[2].toFixed(2)} (door face x ${doorX.toFixed(2)}), ${route.rows.length} samples, body y ${Math.min(...route.rows.map((r) => r[1])).toFixed(2)}..${Math.max(...route.rows.map((r) => r[1])).toFixed(2)}, end y ${route.rows.at(-1)[1].toFixed(2)}`);
  const direct = await follow([33, -6], [[doorX, -6]], 8); // the doorway waypoint is the door face itself: the player ends against it (capsule radius 0.35)
  check(`${label}short direct segment from beyond the bench through the porch to the doors`, direct.rows.at(-1)[0] >= doorX - 0.5, `end x ${direct.rows.at(-1)[0].toFixed(3)}, body y ${Math.min(...direct.rows.map((r) => r[1])).toFixed(2)}..${Math.max(...direct.rows.map((r) => r[1])).toFixed(2)}, end y ${direct.rows.at(-1)[1].toFixed(2)}`);
}
await routeAndDirect('');
if (process.env.ROUTE_REPEATS) { for (let i = 1; i <= Number(process.env.ROUTE_REPEATS); i++) await routeAndDirect(`repeat ${i}: `); }
if (process.env.ROUTE_ONLY) { await browser.close(); console.log(bad ? `FAILURES (${bad})` : 'ALL PASS (route only)'); process.exit(bad ? 1 : 0); }
// 2. jumping under the canopy: only samples horizontally under the soffit (local z 4.5675..6.2175 -> world x 33.78..35.43) count
const jumpUnder = await walk([L.x - 5.4, 1.3, L.z], -Math.PI / 2, 4, true);
const under = jumpUnder.filter((r) => r[0] > L.x - 6.2175 + 0.35 && r[0] < L.x - 4.5675 - 0.0 && Math.abs(r[2] - L.z) < 2);
const topUnder = Math.max(...under.map((r) => r[1])) + 0.75; // capsule centre + half height 0.4 + radius 0.35
check('jumping under the canopy: head (capsule top) never above the visual soffit 2.95 m', topUnder <= 2.95, `${under.length}/${jumpUnder.length} samples under the soffit, max head ${topUnder.toFixed(3)} m, x range ${Math.min(...under.map((r) => r[0])).toFixed(2)}..${Math.max(...under.map((r) => r[0])).toFixed(2)}`);
// 3. roof: attempts from several reachable faces; the highest the body gets must not exceed a free jump (no ledge, no ramp, no climb)
const open = Math.max(...(await walk([L.x - 16, 1.3, L.z + 12], -Math.PI / 2, 2, true)).map((r) => r[1]));
console.log('INFO free jump apex (body y, open ground):', open.toFixed(2), 'm; roof 6.0 (wings) / 6.25 (centre) / 7.75 (plant room)');
const roofTries = [['west wing face', [L.x - 12, 1.2, L.z - 3], -Math.PI / 2], ['east wing face', [L.x - 12, 1.2, L.z + 3.5], -Math.PI / 2], ['rear', [L.x + 14, 1.2, L.z], Math.PI / 2], ['side +z', [L.x, 1.2, L.z + 11], Math.PI], ['side -z', [L.x + 1, 1.2, L.z - 10], 0]];
for (const [name, start, az] of roofTries) {
  const rows = await walk(start, az, 7, true);
  const top = Math.max(...rows.map((r) => r[1]));
  check(`limited attempt: walking + jumping into the ${name} gains no height beyond a free jump`, top <= open + 0.1, `max body y ${top.toFixed(2)} m vs free jump ${open.toFixed(2)} m (5 face attempts only, not every possible climb)`);
}
const blockers = await page.evaluate((x) => {
  const tn = window.__tn; const out = [];
  for (const m of tn.controls.colliderMeshes ?? []) { m.updateMatrixWorld(true); const b = new tn.THREE.Box3().setFromObject(m); if (b.max.x > x - 8 && b.min.x < x + 8 && b.min.z < 9 && b.max.z > -14) out.push([b.min.y, b.max.y]); }
  return out;
}, L.x);
check('camera blockers include the overhead canopy (y 2.85..6.25) and the ground-level wings', blockers.some(([a, b]) => Math.abs(a - 2.85) < 0.05 && Math.abs(b - 6.25) < 0.05) && blockers.filter(([a]) => a < 0.01).length >= 3, `${blockers.length} blockers near the clinic`);
await browser.close();
console.log(bad ? `FAILURES (${bad})` : 'ALL PASS');
process.exit(bad ? 1 : 0);
