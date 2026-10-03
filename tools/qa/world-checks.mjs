// B0 behaviour checks on the city scene at a deterministic frame rate (frameloop driven by window.__tn.run).
// Usage: node tools/qa/world-checks.mjs http://127.0.0.1:3100 [fps=60] [jitter=0]   (needs puppeteer-core, BROWSER=<chrome/edge>)
// jitter=1 makes frame times uneven (alternating 0.5x / 1.5x, plus a 100 ms hitch every 20 frames).
import puppeteer from 'puppeteer-core';
const [base, fps = '60', jitter = '0'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 1200000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' }) });
  await fetch('/api/me/avatar', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' }) });
  const { user } = await (await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 100 }, (_, i) => i)));
});
await page.goto(`${base}/monde/?debug&fps=${fps}${jitter === '1' ? '&jitter' : ''}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn && window.__tn.run, { timeout: 30000 });
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 40 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(2); });

const settle = () => new Promise((r) => setTimeout(r, 600)); // phone raise/lower runs on a real-time 300 ms timer
const run = (s) => page.evaluate((s) => window.__tn.run(s), s);
const pos = () => page.evaluate(() => { const t = window.__tn.ecctrl.body.translation(); const v = window.__tn.ecctrl.body.linvel(); return { x: t.x, y: t.y, z: t.z, speed: Math.hypot(v.x, v.z), vy: v.y }; });
const tele = (x, y, z) => page.evaluate((x, y, z) => { const b = window.__tn.ecctrl.body; b.setTranslation({ x, y, z }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); }, x, y, z);
const camYaw = () => page.evaluate(() => { const s = window.__tn.samples; return s[s.length - 1].camYaw; });
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// 1. real keyboard walks
let p0 = await pos(); await page.keyboard.down('KeyW'); await run(2); let p1 = await pos();
check('keyboard W walks', dist(p0, p1) > 5, { moved: dist(p0, p1).toFixed(2) });
// 2. blur clears; no walking until a fresh press
await page.evaluate(() => dispatchEvent(new Event('blur'))); await run(1.5); p0 = await pos(); await run(1.5); p1 = await pos();
check('blur stops and stays stopped (key still physically held)', p0.speed < 0.05 && dist(p0, p1) < 0.01, { speed: p0.speed.toFixed(3), drift: dist(p0, p1).toFixed(3) });
await page.keyboard.up('KeyW'); await page.keyboard.down('KeyW'); await run(1); p1 = await pos();
check('fresh press resumes', dist(p0, p1) > 2, { moved: dist(p0, p1).toFixed(2) });
// 3. hidden tab clears
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
await run(1.5); p0 = await pos(); await run(1);
p1 = await pos();
check('hidden tab stops', p0.speed < 0.05 && dist(p0, p1) < 0.01, { speed: p0.speed.toFixed(3) });
await page.evaluate(() => { delete document.hidden; }); await page.keyboard.up('KeyW');
// 4. phone open (T) locks input, close + fresh press resumes
await page.keyboard.press('KeyT'); await settle(); await run(0.3); p0 = await pos();
await page.keyboard.down('KeyW'); await run(1.5); p1 = await pos();
check('phone open ignores movement keys', dist(p0, p1) < 0.05, { moved: dist(p0, p1).toFixed(3) });
await page.keyboard.up('KeyW'); await page.keyboard.press('KeyT'); await settle(); await run(0.3);
await page.keyboard.down('KeyW'); await run(1); p1 = await pos(); await page.keyboard.up('KeyW');
check('phone closed, fresh press walks', dist(p0, p1) > 2, { moved: dist(p0, p1).toFixed(2) });
// 5. jump once per press even with Space held (key repeat)
await run(1); await tele(0, 1, 8); await run(1);
await page.keyboard.down('Space'); await page.keyboard.down('Space'); await page.keyboard.down('Space');
let takeoffs = 0, wasAir = false, maxY = 0;
for (let i = 0; i < 24; i++) { await run(0.125); const p = await pos(); const air = p.y > 1.15; if (air && !wasAir) takeoffs++; wasAir = air; maxY = Math.max(maxY, p.y); }
await page.keyboard.up('Space');
check('jump once per press while held', takeoffs === 1 && maxY > 1.5, { takeoffs, maxY: maxY.toFixed(2) });
// 6. wall: Habitat block spans x -27..-21, z -43..-37. Approach its south face diagonally, expect slide not stick/cross.
const yaw = await camYaw();
const fx = Math.sin(yaw), fz = Math.cos(yaw);
const combos = [['KeyW'], ['KeyS'], ['KeyA'], ['KeyD'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyS', 'KeyA'], ['KeyS', 'KeyD']];
const dirOf = (keys) => { let x = 0, z = 0; for (const k of keys) { if (k === 'KeyW') { x += fx; z += fz; } if (k === 'KeyS') { x -= fx; z -= fz; } if (k === 'KeyA') { x += fz; z -= fx; } if (k === 'KeyD') { x -= fz; z += fx; } } const l = Math.hypot(x, z); return [x / l, z / l]; };
const want = [-0.7071, -0.7071];
const best = combos.map((k) => ({ k, d: dirOf(k) })).sort((a, b) => b.d[0] * want[0] + b.d[1] * want[1] - (a.d[0] * want[0] + a.d[1] * want[1]))[0];
await tele(-20, 1, -30); await run(0.5);
for (const k of best.k) await page.keyboard.down(k);
await run(4); const w = await pos();
for (const k of best.k) await page.keyboard.up(k);
check('wall stops at south face (-36.7 <= z <= -36)', w.z >= -36.7 && w.z <= -36, { z: w.z.toFixed(2) });
check('wall slides along face (x < -22)', w.x < -22, { x: w.x.toFixed(2), keys: best.k.join('+') });
// 7. camera retracts against the wall
await tele(-24, 1, -36.4); await page.evaluate(() => window.__tn.controls.rotateAzimuthTo(Math.PI, false)); await run(1.5);
const cam = await page.evaluate(() => { const s = window.__tn.samples; const q = s[s.length - 1]; return { cx: q.cx, cz: q.cz, x: q.x, z: q.z }; });
const camDist = Math.hypot(cam.cx - cam.x, cam.cz - cam.z);
check('camera pulled in at wall (< 6 m of 7)', camDist < 6, { camDist: camDist.toFixed(2) });
// 8. bounds respawn
await tele(0, -20, 0); await run(0.2); let r = await pos();
check('fall below world respawns', r.y > 0 && dist(r, { x: 0, z: 8 }) < 1.5, { x: r.x.toFixed(1), y: r.y.toFixed(1), z: r.z.toFixed(1) });
await tele(400, 1, 0); await run(0.2); r = await pos();
check('outside bounds respawns', dist(r, { x: 0, z: 8 }) < 1.5, { x: r.x.toFixed(1), z: r.z.toFixed(1) });
await tele(74, 1, 0);
for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) { await page.keyboard.down(k); await run(3); await page.keyboard.up(k); }
r = await pos(); check('boundary wall holds', Math.abs(r.x) < 76 && Math.abs(r.z) < 76, { x: r.x.toFixed(1), z: r.z.toFixed(1) });
// 9. wheel
await page.keyboard.press('KeyV'); await run(1);
await page.mouse.move(480, 270); for (let i = 0; i < 5; i++) await page.mouse.wheel({ deltaY: 400 }); await run(1);
const d = await page.evaluate(() => window.__tn.controls.distance);
check('FPS wheel does not zoom out', d < 0.05, { distance: d });
await page.keyboard.press('KeyV'); await run(1.5);
for (let i = 0; i < 8; i++) await page.mouse.wheel({ deltaY: 600 }); await run(1);
const dt = await page.evaluate(() => window.__tn.controls.distance);
check('TPS wheel clamps (2.5..14)', dt <= 14.01 && dt >= 2.49, { distance: dt.toFixed(2) });
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILURES', `@${fps}Hz jitter=${jitter}`);
process.exit(results.every(Boolean) ? 0 : 1);
