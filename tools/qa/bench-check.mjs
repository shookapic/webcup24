// Bench NPC proof: full state cycle (approach > turn > sitDown > sit > standUp > walk) with exact seat pose, unique seat
// ownership, no teleporting, natural sitting during a long run; run again with reduced=1 to prove essential behaviour survives.
// node tools/qa/bench-check.mjs <base> [reduced=0]
import puppeteer from 'puppeteer-core';
const [base, reduced = '0'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 1800000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 500 });
if (reduced === '1') await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
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
const results = [];
const check = (name, ok, info = {}) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };

// 1. forced cycle on seat 0 (bot 0), recording every mode change
const forced = await page.evaluate(async () => {
  const tn = window.__tn;
  const bot = tn.npcs[0];
  let ok = false;
  for (let i = 0; i < 600 && !ok; i++) { ok = tn.forceSit(0, 0); if (!ok) await tn.run(0.1); }
  const log = [];
  let last = null;
  let maxStep = 0;
  let prev = [bot.x, bot.z];
  for (let f = 0; f < 30 * 150; f++) {
    await tn.run(1 / 30);
    maxStep = Math.max(maxStep, Math.hypot(bot.x - prev[0], bot.z - prev[1]));
    prev = [bot.x, bot.z];
    if (bot.mode !== last) { log.push({ mode: bot.mode, f, x: +bot.x.toFixed(3), z: +bot.z.toFixed(3), y: bot.y, heading: +bot.heading.toFixed(3), sit: bot.sit }); last = bot.mode; }
    if (last === 'walk' && log.some((l) => l.mode === 'standUp')) break;
  }
  return { ok, log, maxStep, owner0: tn.seatOwner[0], seat: tn.seatsInfo?.[0] ?? null };
});
check('forced cycle started', forced.ok);
const modes = forced.log.map((l) => l.mode);
const tail = modes.slice(modes.indexOf('approach'));
check('state order approach > turn > sitDown > sit > standUp > walk', JSON.stringify(tail.slice(0, 6)) === JSON.stringify(['approach', 'turn', 'sitDown', 'sit', 'standUp', 'walk']), { modes: tail });
const sitEntry = forced.log.find((l) => l.mode === 'sit');
check('seated: hips at seat height (y = -0.09) with the sit clip active', sitEntry && Math.abs(sitEntry.y + 0.09) < 0.001 && sitEntry.sit === true, sitEntry);
check('no teleport: largest single-frame move <= 0.2 m', forced.maxStep <= 0.2, { maxStep: forced.maxStep.toFixed(3) });
check('seat released after standing up', forced.owner0 === null, { owner: forced.owner0 });

// 2. natural behaviour for 6 simulated minutes
const run = await page.evaluate(async () => {
  const tn = window.__tn;
  const bots = tn.npcs;
  let sitFrames = 0, episodes = 0, doubleOwner = 0, mismatch = 0, overlap = 0, nan = 0, maxStep = 0, travelled = 0;
  const wasSit = bots.map(() => false);
  const prev = bots.map((b) => [b.x, b.z]);
  for (let f = 0; f < 30 * 360; f++) {
    await tn.run(1 / 30);
    const sitting = bots.filter((b) => b.mode === 'sit' || b.mode === 'sitDown' || b.mode === 'standUp');
    const seats = sitting.map((b) => b.seat);
    if (new Set(seats).size !== seats.length) doubleOwner++;
    for (const b of bots) {
      if (b.seat >= 0 && tn.seatOwner[b.seat] !== b.id) mismatch++;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.z)) nan++;
      const step = Math.hypot(b.x - prev[b.id][0], b.z - prev[b.id][1]);
      maxStep = Math.max(maxStep, step);
      travelled += step;
      prev[b.id] = [b.x, b.z];
      const s = b.mode === 'sit';
      if (s) sitFrames++;
      if (s && !wasSit[b.id]) episodes++;
      wasSit[b.id] = s;
    }
    for (let i = 0; i < sitting.length; i++) for (let j = i + 1; j < sitting.length; j++) if (Math.hypot(sitting[i].x - sitting[j].x, sitting[i].z - sitting[j].z) < 0.5) overlap++;
  }
  return { sitFrames, episodes, doubleOwner, mismatch, overlap, nan, maxStep, travelled };
});
check('natural sitting happens (>= 3 episodes in 6 min)', run.episodes >= 3, { episodes: run.episodes, seatSeconds: Math.round(run.sitFrames / 30) });
check('a seat never has two occupants or owners', run.doubleOwner === 0 && run.mismatch === 0, { doubleOwner: run.doubleOwner, mismatch: run.mismatch });
check('seated NPCs never overlap (< 0.5 m)', run.overlap === 0, { overlap: run.overlap });
check('no NaN positions, no teleports (<= 0.2 m per frame)', run.nan === 0 && run.maxStep <= 0.2, { nan: run.nan, maxStep: run.maxStep.toFixed(3) });
check('walkers keep travelling (total path > 300 m)', run.travelled > 300, { travelled: Math.round(run.travelled) });
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILURES', reduced === '1' ? '(reduced motion)' : '');
process.exit(results.every(Boolean) ? 0 : 1);
