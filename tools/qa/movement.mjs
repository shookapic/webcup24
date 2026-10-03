// Movement acceptance harness (roadmap §3). Needs: npm i --no-save puppeteer-core, a running server (npm start),
// BROWSER=<path to Chrome/Edge>. Usage: node tools/qa/movement.mjs http://127.0.0.1:3000 'scene=floor&fps=60' label '{"forward":true}'
import puppeteer from 'puppeteer-core';
const [base, query, label, inputJson = '{"forward":true}'] = process.argv.slice(2);
const input = JSON.parse(inputJson);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 1200000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console.error', m.text().slice(0, 200)));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' }) });
  await fetch('/api/me/avatar', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' }) });
  localStorage.setItem('world-seen-alerts', JSON.stringify(Array.from({ length: 100 }, (_, i) => i)));
});
await page.goto(`${base}/monde/?debug&${query}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn && window.__tn.run, { timeout: 30000 });
const result = await page.evaluate(async (input) => {
  const tn = window.__tn;
  for (let i = 0; i < 40 && tn.samples.length === 0; i++) await tn.run(0.5); // wait for physics chunk
  await tn.run(2);
  const a = tn.samples.length;
  await tn.run(10, input);
  const b = tn.samples.length;
  await tn.run(1.5);
  return { s: tn.samples.slice(a - 1), moveEnd: b - a + 1 };
}, input);
await browser.close();

const s = result.s, end = result.moveEnd;
const deg = (r) => (r * 180) / Math.PI;
const p0 = s[0];
const fx = Math.sin(p0.camYaw), fz = Math.cos(p0.camYaw); // camera forward on the ground
let dirX = fx, dirZ = fz;
if (input.backward) { dirX = -fx; dirZ = -fz; }
if (input.leftward || input.rightward) {
  const sign = input.rightward ? -1 : 1; // three.js: right = forward x up
  const lx = sign * fz, lz = -sign * fx;
  if (input.forward) { dirX = (fx + lx) / Math.SQRT2; dirZ = (fz + lz) / Math.SQRT2; } else { dirX = lx; dirZ = lz; }
}
const moving = s.slice(0, end);
const along = moving.map((q) => (q.x - p0.x) * dirX + (q.z - p0.z) * dirZ);
const lateral = moving.map((q) => (q.x - p0.x) * -dirZ + (q.z - p0.z) * dirX);
let backsteps = 0; for (let i = 1; i < along.length; i++) if (along[i] < along[i - 1] - 1e-4) backsteps++;
const steady = moving.slice(Math.floor(moving.length * 0.3));
const speeds = steady.map((q) => Math.hypot(q.vx, q.vz));
let flips = 0; for (let i = 2; i < steady.length; i++) { const d1 = steady[i - 1].yaw - steady[i - 2].yaw, d2 = steady[i].yaw - steady[i - 1].yaw; if (Math.abs(d1) > 1e-4 && Math.abs(d2) > 1e-4 && Math.sign(d1) !== Math.sign(d2)) flips++; }
const turn = moving.slice(0, Math.floor(moving.length * 0.3));
let turnFlips = 0; for (let i = 2; i < turn.length; i++) { const d1 = turn[i - 1].yaw - turn[i - 2].yaw, d2 = turn[i].yaw - turn[i - 1].yaw; if (Math.abs(d1) > 1e-3 && Math.abs(d2) > 1e-3 && Math.sign(d1) !== Math.sign(d2)) turnFlips++; }
const yawRange = deg(Math.max(...steady.map((q) => q.yaw)) - Math.min(...steady.map((q) => q.yaw)));
const tilt = deg(Math.max(...moving.map((q) => Math.max(Math.abs(q.pitch), Math.abs(q.roll)))));
const camYawRange = deg(Math.max(...steady.map((q) => q.camYaw)) - Math.min(...steady.map((q) => q.camYaw)));
const jitter = (key) => { let sum = 0; for (let i = 2; i < steady.length; i++) { const o = (j) => [steady[j][key + 'x'] - steady[j].cx, steady[j][key + 'z'] - steady[j].cz]; const [a, b, c] = [o(i - 2), o(i - 1), o(i)]; sum += Math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1]); } return sum / (steady.length - 2); };
const rendered = steady.map((q) => ({ rx: q.rx, rz: q.rz, cx: q.cx, cz: q.cz }));
const after = s.slice(end);
const stopIdx = after.findIndex((q) => Math.hypot(q.vx, q.vz) < 0.2);
const stopT = stopIdx < 0 ? 'never' : (after[stopIdx].t - after[0].t).toFixed(2) + ' s';
console.log(JSON.stringify({
  label, frames: moving.length,
  progress_m: along.at(-1).toFixed(2), backsteps,
  lateral_max_m: Math.max(...lateral.map(Math.abs)).toFixed(3),
  speed_mean: (speeds.reduce((x, y) => x + y, 0) / speeds.length).toFixed(2),
  speed_min_max: [Math.min(...speeds).toFixed(2), Math.max(...speeds).toFixed(2)],
  yaw_range_deg: yawRange.toFixed(2), yaw_rate_flips: flips, turn_flips: turnFlips, final_yaw_deg: deg(moving.at(-1).yaw).toFixed(1),
  tilt_max_deg: tilt.toFixed(2), cam_yaw_range_deg: camYawRange.toFixed(2),
  cam_jitter_physical_mm: (jitter('') * 1000).toFixed(2),
  cam_jitter_rendered_mm: (jitter('r') * 1000).toFixed(2),
  y_min_max: [Math.min(...moving.map((q) => q.y)).toFixed(3), Math.max(...moving.map((q) => q.y)).toFixed(3)],
  y_after: after.slice(-1)[0]?.y.toFixed(3),
  stop_time: stopT, grounded_pct: Math.round(100 * moving.filter((q) => q.ground).length / moving.length),
}));
