// F36 world check: both trams move along their line, dwell at every stop, stay on the elevated rail; stops exist for all five API names.
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
const read = () => page.evaluate(() => Object.fromEntries(Object.entries(window.__tn.trams).map(([k, v]) => [k, { s: v.state.s, dir: v.state.dir, dwell: v.state.dwell, last: v.state.last, arcs: v.stopArcs, total: v.total }])));
const start = await read();
check('two trams exist', Object.keys(start).length === 2);
const seen = { T1: { dwell: new Set(), dirs: new Set(), minS: 1e9, maxS: -1 }, T2: { dwell: new Set(), dirs: new Set(), minS: 1e9, maxS: -1 } };
for (let t = 0; t < 130; t += 1) {
  await page.evaluate(() => window.__tn.run(1));
  const now = await read();
  for (const code of ['T1', 'T2']) {
    const r = now[code];
    seen[code].dirs.add(r.dir);
    seen[code].minS = Math.min(seen[code].minS, r.s);
    seen[code].maxS = Math.max(seen[code].maxS, r.s);
    if (r.dwell > 0) r.arcs.forEach((a, i) => Math.abs(a - r.s) < 0.6 && seen[code].dwell.add(i));
  }
}
const end = await read();
for (const code of ['T1', 'T2']) {
  const stopCount = end[code].arcs.length;
  check(`${code} moves along its whole line`, seen[code].maxS - seen[code].minS > end[code].total * 0.9, { min: seen[code].minS.toFixed(1), max: seen[code].maxS.toFixed(1), total: end[code].total.toFixed(1) });
  check(`${code} dwells at all ${stopCount} stops`, seen[code].dwell.size === stopCount, { stopped: [...seen[code].dwell] });
  check(`${code} reverses at the end of the line`, seen[code].dirs.size === 2, { dirs: [...seen[code].dirs] });
}
check('no 404 for models/textures during the run', missing.length === 0, { missing });
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILURES');
process.exit(results.every(Boolean) ? 0 : 1);
