// Urgent-alert presentation (roadmap §5, R4): raise on arrival, input locked, acknowledge restores the previous view,
// editor defers the camera presentation, manual phone stays open after acknowledging.
// Needs at least one urgent announcement in the server DB. Usage: node tools/qa/alert-flow.mjs http://127.0.0.1:3101
import puppeteer from 'puppeteer-core';
const [base] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 1200000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const check = (name, ok, info = {}) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
const settle = () => new Promise((r) => setTimeout(r, 700));

async function session(withAvatar) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await page.evaluate(async (withAvatar) => {
    const post = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
    if (withAvatar) await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  }, withAvatar);
  await page.goto(`${base}/monde/?debug&fps=60`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__tn && window.__tn.run, { timeout: 30000 });
  return page;
}
const run = (page, s) => page.evaluate((s) => window.__tn.run(s), s);
const ready = (page) => page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 40 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(1); });
const dialogOpen = (page) => page.evaluate(() => Boolean(document.querySelector('.phone-sheet, .phone-host')));
const camDist = (page) => page.evaluate(() => window.__tn.controls.distance);

// A: avatar saved, urgent alert unseen -> phone raises on its own, FPS, input locked
let page = await session(true);
await ready(page); await page.waitForSelector('.phone-sheet, .phone-host', { timeout: 20000 }); await settle(); await run(page, 1.5);
check('alert raises phone', await dialogOpen(page));
check('alert has acknowledge button and role=alert', await page.evaluate(() => Boolean(document.querySelector('.phone-ack') && document.querySelector('[role=alert] .phone-alert'))));
check('alert view is first person', (await camDist(page)) < 0.05, { distance: await camDist(page) });
const before = await page.evaluate(() => window.__tn.ecctrl.body.translation().z);
await page.keyboard.down('KeyW'); await run(page, 1.5); await page.keyboard.up('KeyW');
const after = await page.evaluate(() => window.__tn.ecctrl.body.translation().z);
check('input locked while alert shown', Math.abs(after - before) < 0.05, { moved: Math.abs(after - before).toFixed(3) });
await page.keyboard.press('KeyV'); await run(page, 1);
check('V ignored while phone up', (await camDist(page)) < 0.05);
await page.keyboard.press('KeyT'); await settle();
check('T cannot dismiss an unacknowledged alert', await dialogOpen(page));
await page.click('.phone-ack'); await settle(); await run(page, 1.5);
check('acknowledge closes the alert-raised phone', !(await dialogOpen(page)));
check('previous (third person) view restored', (await camDist(page)) > 8, { distance: (await camDist(page)).toFixed(2) });
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__tn && window.__tn.run); await ready(page); await settle();
check('acknowledged alert does not return after reload', !(await dialogOpen(page)));
// manual open stays open after acknowledgement handled elsewhere: T opens, Escape/T closes, view restored
await page.keyboard.press('KeyT'); await settle(); await run(page, 1);
check('manual T opens phone', await dialogOpen(page));
await page.keyboard.press('Escape'); await settle(); await run(page, 1.5);
check('Escape closes manual phone, view restored', !(await dialogOpen(page)) && (await camDist(page)) > 8);
await page.close();

// B: no avatar yet -> editor opens; alert must wait for the editor to close
page = await session(false);
await ready(page); await settle();
check('editor open, phone not raised', !(await dialogOpen(page)) && (await page.evaluate(() => document.querySelector('dialog.avatar-editor')?.open)));
check('alert announced in HTML while editing', await page.evaluate(() => Boolean(document.querySelector('.sr-only[role=alert]')?.textContent.length)));
await page.evaluate(() => document.querySelector('dialog.avatar-editor form').requestSubmit());
await page.waitForSelector('.phone-sheet, .phone-host', { timeout: 20000 });
check('phone raised after editor closes', await dialogOpen(page));
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILURES');
process.exit(results.every(Boolean) ? 0 : 1);
