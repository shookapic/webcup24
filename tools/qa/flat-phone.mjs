// Flat accessible phone dialog (?flatphone): opens with T, one dialog, focus inside, tab click works, Escape closes, movement locked.
// node tools/qa/flat-phone.mjs <base>
import puppeteer from 'puppeteer-core';
const [base] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const results = [];
const check = (name, ok, info = {}) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
const settle = (ms = 1000) => new Promise((r) => setTimeout(r, ms));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  const { user } = await (await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
});
await page.goto(base + '/monde/?debug&fps=30&flatphone', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(1); });
await page.keyboard.press('KeyT'); await settle();
check('flat dialog opens (role=dialog, no 3D host)', await page.evaluate(() => Boolean(document.querySelector('.phone-sheet[role=dialog]')) && !document.querySelector('.phone-host')));
check('exactly one phone screen', (await page.evaluate(() => document.querySelectorAll('.phone-screen').length)) === 1);
check('focus is inside the dialog', await page.evaluate(() => document.querySelector('.phone-sheet').contains(document.activeElement)));
const nav = await page.evaluate(() => [...document.querySelectorAll('.phone-nav button')].map((b) => b.textContent.trim()));
await page.evaluate(() => [...document.querySelectorAll('.phone-nav button')][3].click()); await settle(400);
check('tab click selects it', (await page.evaluate(() => document.querySelector('.phone-nav [aria-current=page]')?.textContent.trim())) === nav[3], { current: nav[3] });
const z0 = await page.evaluate(() => window.__tn.ecctrl.body.translation().z);
await page.keyboard.down('KeyW'); await page.evaluate(() => window.__tn.run(1)); await page.keyboard.up('KeyW');
check('movement locked while open', Math.abs((await page.evaluate(() => window.__tn.ecctrl.body.translation().z)) - z0) < 0.05);
await page.keyboard.press('Escape'); await settle();
check('Escape closes the dialog', !(await page.$('.phone-sheet')));
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILURES');
process.exit(results.every(Boolean) ? 0 : 1);
