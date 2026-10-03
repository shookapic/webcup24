// Phone state machine races (real-time timers, deterministic frames):
//   rapid close/reopen inside the 300 ms transition, reopen then close, urgent alert arriving during manual use,
//   alert withdrawn while displayed (PATCH urgent=false), acknowledge keeps a manually opened phone open.
// node tools/qa/phone-race.mjs <base> <adminEmail> <adminPassword>     (admin created with create-staff against the same DB)
import puppeteer from 'puppeteer-core';
const [base, adminEmail, adminPassword] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const check = (name, ok, info = {}) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Admin context: separate browser context so the citizen and the admin keep separate cookies.
const adminContext = await browser.createBrowserContext();
const adminPage = await adminContext.newPage();
await adminPage.goto(base + '/', { waitUntil: 'networkidle0' });
const adminCall = (method, path, body) => adminPage.evaluate(async (method, path, body) => {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}, method, path, body);
const login = await adminCall('POST', '/api/auth/login', { email: adminEmail, password: adminPassword });
check('admin login', login.status === 200, { status: login.status });
const publish = async (title) => (await adminCall('POST', '/api/announcements', { title, body: 'Message de test pour le téléphone, assez long pour être valide.', urgent: true, audience: 'Tous' })).data.id;
// Make sure no stale urgent items from earlier runs are active.
const existing = await adminCall('GET', '/api/announcements');
for (const item of existing.data.announcements.filter((a) => a.urgent)) await adminCall('PATCH', `/api/announcements/${item.id}`, { urgent: false });

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
});
await page.goto(`${base}/monde/?debug&fps=30`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
const run = (s) => page.evaluate((s) => window.__tn.run(s), s);
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(2); });
const up = () => page.evaluate(() => Boolean(document.querySelector('.phone-host, .phone-sheet')));
const cam = () => page.evaluate(() => window.__tn.controls.distance);
const z = () => page.evaluate(() => window.__tn.ecctrl.body.translation().z);

// 1. rapid close / reopen inside the transition
await page.keyboard.press('KeyT'); await wait(700); await run(0.5);
check('open', await up() && (await cam()) < 0.05);
await page.keyboard.press('KeyT'); await wait(120); await page.keyboard.press('KeyT'); await wait(900); await run(1);
check('reopened during lowering stays up in first person', await up() && (await cam()) < 0.05, { cam: await cam() });
const before = await z(); await page.keyboard.down('KeyW'); await run(1); await page.keyboard.up('KeyW');
check('input still locked after rapid reopen', Math.abs((await z()) - before) < 0.05);
await page.keyboard.press('KeyT'); await wait(900); await run(1.5);
check('final close lowers and restores third person', !(await up()) && (await cam()) > 8, { cam: (await cam()).toFixed(2) });

// 2. close then reopen right before the old timer would fire (old timer must not close the new session)
await page.keyboard.press('KeyT'); await wait(700);
await page.keyboard.press('KeyT'); await wait(280); await page.keyboard.press('KeyT'); await wait(450); await run(1);
check('reopen 20 ms before the lowering timer: still up', await up() && (await cam()) < 0.05);
await page.keyboard.press('KeyT'); await wait(900); await run(1.5);
check('then closes cleanly', !(await up()) && (await cam()) > 8);

// 3. alert arrives while the phone is open manually; acknowledging keeps it open
await page.keyboard.press('KeyT'); await wait(700);
const id1 = await publish('Alerte pendant usage manuel');
await page.waitForSelector('.phone-ack', { timeout: 25000 });
check('alert shown inside the manually opened phone', await up());
await page.click('.phone-ack'); await wait(900); await run(1);
check('acknowledge keeps a manual phone open', await up() && (await cam()) < 0.05);
await page.keyboard.press('KeyT'); await wait(900); await run(1.5);
check('manual phone closes afterwards, third person restored', !(await up()) && (await cam()) > 8);
await adminCall('PATCH', `/api/announcements/${id1}`, { urgent: false });

// 4. alert raises the phone, then is withdrawn while displayed
const id2 = await publish('Alerte retirée');
await page.waitForSelector('.phone-host, .phone-sheet', { timeout: 25000 }); await wait(700); await run(1);
check('alert raised the phone', await up() && (await cam()) < 0.05);
await adminCall('PATCH', `/api/announcements/${id2}`, { urgent: false });
await page.waitForFunction(() => !document.querySelector('.phone-host, .phone-sheet'), { timeout: 25000 }); await wait(500); await run(1.5);
check('withdrawal puts the phone away and restores the view', !(await up()) && (await cam()) > 8, { cam: (await cam()).toFixed(2) });

await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILURES');
process.exit(results.every(Boolean) ? 0 : 1);
