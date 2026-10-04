// F36 world check: motion AND geometry. Both trams move along their rail, dwell at every stop, reverse at the ends, and at
// every sampled frame each car (a) sits on the rail polyline, (b) rests on the rail top, (c) is not stacked on its neighbour,
// (d) points along the rail, (e) has a mesh bounding box centred on its position (catches exported model offsets).
// node tools/qa/tram-check.mjs <base>
import puppeteer from 'puppeteer-core';
const [base] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const missing = [];
page.on('response', (r) => r.status() >= 400 && !r.url().includes('/api/presence') && missing.push(`${r.status()} ${r.url()}`));
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
const results = [];
const check = (name, ok, info = {}) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
// Per-frame geometry probe inside the page.
const probe = () => page.evaluate(() => {
  const tn = window.__tn;
  const out = {};
  for (const [code, t] of Object.entries(tn.trams)) {
    const path = t.geom.path;
    const cars = tn.carsOf(code);
    const pos = cars.map((c) => c.position.toArray());
    const distToPath = (x, z) => {
      let best = Infinity;
      for (let i = 1; i < path.length; i++) {
        const [ax, az] = path[i - 1], [bx, bz] = path[i];
        const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
        const f = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
        best = Math.min(best, Math.hypot(ax + (bx - ax) * f - x, az + (bz - az) * f - z));
      }
      return best;
    };
    const boxes = cars.map((c) => new tn.THREE.Box3().setFromObject(c));
    out[code] = {
      s: t.state.s, dir: t.state.dir, dwell: t.state.dwell, arcs: t.stopArcs, range: t.range,
      offPath: Math.max(...pos.map(([x, , z]) => distToPath(x, z))),
      railGap: Math.max(...boxes.map((b, i) => Math.abs(b.min.y - (t.geom.y + 0.175)))),
      minSpacing: Math.min(Math.hypot(pos[0][0] - pos[1][0], pos[0][2] - pos[1][2]), Math.hypot(pos[1][0] - pos[2][0], pos[1][2] - pos[2][2])),
      centreError: Math.max(...boxes.map((b, i) => Math.hypot((b.min.x + b.max.x) / 2 - pos[i][0], (b.min.z + b.max.z) / 2 - pos[i][2]))),
    };
  }
  return out;
});
const seen = { T1: { dwell: new Set(), dirs: new Set(), minS: 1e9, maxS: -1, offPath: 0, railGap: 0, spacing: 1e9, centre: 0 }, T2: { dwell: new Set(), dirs: new Set(), minS: 1e9, maxS: -1, offPath: 0, railGap: 0, spacing: 1e9, centre: 0 } };
let last;
for (let t = 0; t < 150; t += 1) {
  await page.evaluate(() => window.__tn.run(1));
  last = await probe();
  for (const code of ['T1', 'T2']) {
    const r = last[code];
    const o = seen[code];
    o.dirs.add(r.dir); o.minS = Math.min(o.minS, r.s); o.maxS = Math.max(o.maxS, r.s);
    o.offPath = Math.max(o.offPath, r.offPath); o.railGap = Math.max(o.railGap, r.railGap); o.spacing = Math.min(o.spacing, r.minSpacing); o.centre = Math.max(o.centre, r.centreError);
    if (r.dwell > 0) r.arcs.forEach((a, i) => Math.abs(a - r.s) < 0.6 && o.dwell.add(i));
  }
}
for (const code of ['T1', 'T2']) {
  const o = seen[code];
  const span = last[code].range[1] - last[code].range[0];
  check(`${code} covers its whole rail`, o.maxS - o.minS > span * 0.95, { min: o.minS.toFixed(1), max: o.maxS.toFixed(1), span: span.toFixed(1) });
  check(`${code} dwells at all ${last[code].arcs.length} stops`, o.dwell.size === last[code].arcs.length, { stopped: [...o.dwell] });
  check(`${code} reverses at both ends`, o.dirs.size === 2);
  check(`${code} cars stay on the rail polyline (<= 0.05 m)`, o.offPath <= 0.05, { max: o.offPath.toFixed(3) });
  check(`${code} car underside rests on the rail top (<= 0.03 m)`, o.railGap <= 0.03, { max: o.railGap.toFixed(3) });
  check(`${code} cars never stack (min chord spacing >= 2.9 m)`, o.spacing >= 2.9, { min: o.spacing.toFixed(2) });
  check(`${code} mesh bounds centred on the car position (<= 0.1 m)`, o.centre <= 0.1, { max: o.centre.toFixed(3) });
}
// Endpoints and cab orientation, measured on the rendered meshes with the consist parked at each rail end.
const ends = await page.evaluate(async () => {
  const tn = window.__tn;
  const out = {};
  for (const [code, t] of Object.entries(tn.trams)) {
    out[code] = [];
    for (const which of ['start', 'end']) {
      t.state.s = which === 'start' ? t.range[0] : t.range[1];
      t.state.dwell = 1e6;
      t.state.dir = which === 'start' ? -1 : 1;
      await tn.run(0.2);
      const path = t.geom.path;
      const [e, n] = which === 'start' ? [path[0], path[1]] : [path[path.length - 1], path[path.length - 2]];
      const out2 = [e[0] - n[0], e[1] - n[1]];
      const len = Math.hypot(...out2);
      const dir = [out2[0] / len, out2[1] / len];
      let overhang = -Infinity;
      for (const car of tn.carsOf(code)) {
        const b = new tn.THREE.Box3().setFromObject(car);
        for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) overhang = Math.max(overhang, (x - e[0]) * dir[0] + (z - e[1]) * dir[1]);
      }
      // cab orientation: the nose car's mesh bounds are skewed towards its nose (nose 1.8 m, tail 1.65 m from the origin)
      const cars = tn.carsOf(code);
      const skew = [0, 2].map((i) => { const b = new tn.THREE.Box3().setFromObject(cars[i]); const c = [(b.min.x + b.max.x) / 2 - cars[i].position.x, (b.min.z + b.max.z) / 2 - cars[i].position.z]; return c[0] * dir[0] + c[1] * dir[1]; });
      out[code].push({ which, overhang, outerSkew: which === 'end' ? skew[1] : skew[0], innerSkew: which === 'end' ? skew[0] : skew[1] });
    }
  }
  return out;
});
for (const code of ['T1', 'T2']) {
  for (const e of ends[code]) {
    check(`${code} ${e.which}: no body or nose beyond the rail end (<= 0.05 m)`, e.overhang <= 0.05, { overhang: e.overhang.toFixed(3) });
    check(`${code} ${e.which}: outer cab nose points outward, inner cab inward`, e.outerSkew > 0.04 && e.innerSkew < -0.04, { outer: e.outerSkew.toFixed(3), inner: e.innerSkew.toFixed(3) });
  }
}
check('no 4xx/5xx for models/textures during the run', missing.length === 0, { missing });
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILURES');
process.exit(results.every(Boolean) ? 0 : 1);
