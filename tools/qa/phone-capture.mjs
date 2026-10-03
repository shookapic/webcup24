// Handheld phone capture + click alignment check.
// node tools/qa/phone-capture.mjs <base> <outPrefix> [alert=0] [w=1440] [h=900]
// Opens the phone (T, or via an unseen urgent alert), screenshots it, then clicks real DOM buttons on the 3D screen at the
// positions the browser reports after the matrix3d transform, and checks the clicks land (page change / ack).
import puppeteer from 'puppeteer-core';
const [base, prefix, alert = '0', width = '1440', height = '900'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: Number(width), height: Number(height) });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const results = [];
const check = (name, ok, info = {}) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async (alert) => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  const { user } = await (await fetch('/api/me')).json();
  if (alert === '0') localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
}, alert);
await page.goto(`${base}/monde/?debug&fps=30`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
const run = (s) => page.evaluate((s) => window.__tn.run(s), s);
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(2); });
if (alert === '0') { await page.keyboard.press('KeyT'); }
await page.waitForSelector('.phone-host', { timeout: 30000 });
await settle(); await run(1);
await page.screenshot({ path: `${prefix}-open.png` });
const rect = await page.evaluate(() => { const r = document.querySelector('.phone-host').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, opacity: getComputedStyle(document.querySelector('.phone-host')).opacity }; });
check('host visible and on screen', rect.opacity === '1' && rect.w > 150 && rect.h > 300 && rect.x >= 0 && rect.x + rect.w <= Number(width) && rect.y >= 0 && rect.y + rect.h <= Number(height), rect);
check('exactly one focusable screen', (await page.evaluate(() => document.querySelectorAll('.phone-screen').length)) === 1);
check('focus is inside the screen', await page.evaluate(() => document.querySelector('.phone-host').contains(document.activeElement)));
const centre = (selector) => page.evaluate((selector) => { const el = [...document.querySelectorAll(selector)].find((e) => e.offsetParent !== null); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent.trim() }; }, selector);
if (alert === '1') {
  await page.screenshot({ path: `${prefix}-open2.png` });
  const ack = await centre('.phone-ack');
  check('alert acknowledge button reachable', Boolean(ack), ack);
  await page.mouse.click(ack.x, ack.y); await settle(); await run(1);
  check('click on 3D screen acknowledged the alert', !(await page.$('.phone-host')));
} else {
  const nav = await page.evaluate(() => [...document.querySelectorAll('.phone-nav button')].map((b) => b.textContent.trim()));
  const target = await page.evaluate(() => { const b = [...document.querySelectorAll('.phone-nav button')][3]; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(target.x, target.y); await run(0.5); await settle(300);
  const current = await page.evaluate(() => document.querySelector('.phone-nav [aria-current=page]')?.textContent.trim());
  check('click on nav button (4th) selected it', current === nav[3], { current, expected: nav[3] });
  await page.screenshot({ path: `${prefix}-services.png` });
  const corner = await page.evaluate(() => { const b = [...document.querySelectorAll('.phone-nav button')][4]; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(corner.x, corner.y); await run(0.3); await settle(300);
  check('click on the last tab (right edge of the quad) selects it', (await page.evaluate(() => document.querySelector('.phone-nav [aria-current=page]')?.textContent.trim())) === nav[4]);
  await page.keyboard.press('Escape'); await settle(); await run(1);
  check('Escape closes and lowers the phone', !(await page.$('.phone-host')));
}
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILURES');
process.exit(results.every(Boolean) ? 0 : 1);
