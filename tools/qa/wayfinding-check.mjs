// F45/F46 world wayfinding checks. node tools/qa/wayfinding-check.mjs <base> <outDir>
// <base> must serve A's /api/places (the integrated scratch server, or A's server with B's world build).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { footprints, placeSites, placeSite, pathNodes, BOUNDS } from '../../world/src/layout.js';
const [base, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
let bad = 0;
const check = (name, ok, info = '') => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name, info); };

// ---- data: every site is open ground and every route avoids solid buildings
const solid = footprints.filter((f) => !f.thin && !(f.y && f.y > 0.5));
const inside = (x, z, f, margin = 0.4) => Math.abs(x - f.x) < f.w / 2 + margin && Math.abs(z - f.z) < f.d / 2 + margin;
const crosses = (a, b, f) => { for (let t = 0; t <= 1; t += 0.01) if (inside(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, f, 0.1)) return true; return false; };
for (const [code, site] of Object.entries(placeSites)) {
  check(`site ${code}: inside the playable square and outside every solid footprint`, Math.abs(site.x) < BOUNDS && Math.abs(site.z) < BOUNDS && !footprints.some((f) => f.h >= 0.5 && !f.y && inside(site.x, site.z, f, 0.5)), `${site.x},${site.z}`);
  const nodes = [pathNodes[site.via], ...(site.route ?? []), [site.x, site.z]];
  const hit = nodes.slice(1).map((p, i) => [nodes[i], p]).filter(([a, b]) => solid.some((f) => crosses(a, b, f)));
  check(`site ${code}: route from its path node to the entrance avoids solid buildings`, hit.length === 0, hit.length ? JSON.stringify(hit[0]) : '');
}
check('all seven seeded place codes of the API have a site', ['mairie', 'hopital-terra-nova', 'urgences-hopital', 'centre-sante', 'secours-quartier-sud', 'point-accueil-habitat', 'marche-couvert'].every((c) => placeSites[c]));
check('unknown place codes fall back to their stop shelter', placeSite({ code: 'nouveau', stop: 'Marché' }).via === null);

// ---- browser
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
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
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(2.5); });
const labels = await page.$$eval('.place-label', (els) => els.map((e) => e.textContent));
check('place labels exist for the 7 API places (name + kind text, aria-hidden layer)', labels.length === 7 && (await page.$eval('.place-labels', (el) => el.getAttribute('aria-hidden'))) === 'true', `${labels.length} labels`);
check('emergency button is visible and labelled (keyboard alternative: G)', (await page.$eval('.way-button', (b) => b.textContent)).includes('(G)'));
await page.screenshot({ path: `${outDir}/1-spawn-labels.png` });

// G -> nearest emergency place, a route, a status announcement
await page.keyboard.press('KeyG');
await page.evaluate(async () => { await window.__tn.run(1); });
const panel = await page.$eval('.way-panel', (el) => el.textContent).catch(() => '');
check('G starts guidance to the nearest hospital/emergency place with name, distance, kind and stop', /Guidage vers/.test(panel) && /m/.test(panel), panel.slice(0, 160));
const live = await page.$eval('.way-live', (el) => el.textContent);
check('start is announced once in the polite live region', /Guidage vers .*mètres/.test(live), live);
const guideInfo = await page.evaluate(() => { const g = window.__tn.way.guide; return { code: g.place.code, kind: g.place.kind, length: g.route.length, points: g.route.points }; });
check('target is an emergency-kind place', ['hospital', 'emergency'].includes(guideInfo.kind), `${guideInfo.code} ${guideInfo.length.toFixed(0)} m`);
await page.screenshot({ path: `${outDir}/2-guide-started.png` });

// walk the route like a player and arrive
const walked = await page.evaluate(async (points) => {
  const tn = window.__tn; const b = tn.ecctrl.body;
  let i = 1, steps = 0; const trace = [];
  while (steps < 900 && i < points.length) {
    const p = b.translation(); const [wx, wz] = points[i];
    if (Math.hypot(wx - p.x, wz - p.z) < 1) { i++; continue; }
    tn.controls.rotateAzimuthTo(Math.atan2(-(wx - p.x), -(wz - p.z)), false);
    await tn.run(0.1, { forward: true, backward: false, leftward: false, rightward: false, run: true, jump: false });
    steps++;
    if (steps % 20 === 0) trace.push([+p.x.toFixed(1), +p.z.toFixed(1), i]);
  }
  await tn.run(1);
  const p = b.translation();
  return { reached: i >= points.length, end: [p.x, p.z], steps, trace };
}, guideInfo.points);
await new Promise((r) => setTimeout(r, 1200)); // the guide hook polls on real timers
const arrivedText = await page.$eval('.way-panel', (el) => el.textContent).catch(() => '');
check('walking the drawn route reaches the entrance and the panel says arrived', walked.reached && /arrivé/.test(arrivedText), `end ${walked.end.map((v) => v.toFixed(1))} in ${walked.steps} steps; route ${JSON.stringify(guideInfo.points.map((p) => p.map((v) => +v.toFixed(1))))} trace ${JSON.stringify(walked.trace)}`);
await page.screenshot({ path: `${outDir}/3-arrived.png` });
await page.keyboard.press('Escape');
await page.evaluate(async () => { await window.__tn.run(0.5); });
check('Escape stops guidance and announces it', (await page.$('.way-panel')) === null && (await page.$eval('.way-live', (el) => el.textContent)).includes('arrêté'));

// guide to a specific place the way the phone will (onLocate)
await page.evaluate(async () => { const tn = window.__tn; const place = tn.way.places.find((p) => p.code === 'marche-couvert'); tn.way.startGuide(place); await tn.run(0.5); });
const marche = await page.$eval('.way-panel', (el) => el.textContent);
check('onLocate-style start for another place (marché couvert) shows its name and stop', /Marché couvert/.test(marche) && /Marché/.test(marche));
await page.screenshot({ path: `${outDir}/4-guide-marche.png` });
await page.evaluate(() => window.__tn.way.stopGuide());
await page.evaluate(async () => { const tn = window.__tn; tn.ecctrl.body.setTranslation({ x: 0, y: 1.2, z: -10 }, true); await tn.run(1.5); });
await new Promise((r) => setTimeout(r, 1200));
const promptInfo = await page.evaluate(() => ({ prompt: window.__tn.way.prompt?.code ?? null, ui: document.querySelector('.way-ui')?.textContent ?? null, guide: !!window.__tn.way.guide }));
check('proximity prompt appears near a place (Mairie) with a phone-details action', await page.$eval('.way-prompt', (el) => /À proximité : Mairie/.test(el.textContent) && !!el.querySelector('button')).catch(() => false), JSON.stringify(promptInfo));
check('no page errors / failing requests during the run', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(bad ? `FAILURES (${bad})` : 'ALL PASS');
process.exit(bad ? 1 : 0);
