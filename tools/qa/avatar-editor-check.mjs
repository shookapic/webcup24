// Avatar look/accessory selection through A's real editor + B's renderer + the real API. node tools/qa/avatar-editor-check.mjs <base> <outDir>
// <base> must run A's current server (accepts look/accessory) with B's world build (the integrated scratch server).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const [base, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
let bad = 0;
const check = (name, ok, info = '') => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  const { user } = await (await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i))); // no urgent alert raises the phone during this check
});
await page.goto(`${base}/monde/?debug&fps=30`, { waitUntil: 'networkidle0' });
await page.waitForSelector('dialog.avatar-editor[open]', { timeout: 60000 });
check('a first-time player gets the editor, with look and accessory groups from the renderer catalogue', (await page.$$eval('dialog.avatar-editor input[name="avatar-look"]', (els) => els.map((e) => e.value))).join() === 'colon,lunettes,bandeau' && (await page.$$eval('dialog.avatar-editor input[name="avatar-accessory"]', (els) => els.map((e) => e.value))).join() === 'none,sac,visiere');
await page.click('input[name="avatar-look"][value="lunettes"]');
await page.click('input[name="avatar-accessory"][value="sac"]');
await settle(1500);
await page.screenshot({ path: `${outDir}/1-editor-lunettes-sac.png` });
const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /character-[a-z]\.glb/.test(n)).map((n) => /character-([a-z])\.glb/.exec(n)[1]));
check('the live preview loads the model for the chosen look (lunettes -> character-i)', loaded.includes('i'), loaded.join());
await page.click('dialog.avatar-editor button[type="submit"]');
await page.waitForFunction(() => !document.querySelector('dialog.avatar-editor[open]'), { timeout: 15000 });
const me = await page.evaluate(async () => (await (await fetch('/api/me')).json()).user.avatar);
check('saved through the real API: look lunettes, accessory sac', me.look === 'lunettes' && me.accessory === 'sac', JSON.stringify(me));
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(2); });
await page.screenshot({ path: `${outDir}/2-world-lunettes-sac.png` });
// reload: the choice is applied from /api/me, and a second look can be chosen and saved
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(1); });
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Mon colon|My colonist/.test(b.textContent)), { timeout: 30000 }); // the HUD button exists once the user is loaded
await settle(1500);
check('after a reload the editor does not reopen (avatar already saved)', (await page.$('dialog.avatar-editor[open]')) === null);
const edit = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /Mon colon|My colonist/.test(b.textContent)));
await edit.asElement().click();
await page.waitForSelector('dialog.avatar-editor[open]', { timeout: 15000 }).catch(async () => { console.log('editor did not open; buttons:', await page.$$eval('button', (b) => b.map((x) => x.textContent.trim()).join(' | '))); throw new Error('editor did not reopen'); });
check('the editor reopens with the saved choices selected', await page.$eval('input[name="avatar-look"][value="lunettes"]', (el) => el.checked) && await page.$eval('input[name="avatar-accessory"][value="sac"]', (el) => el.checked));
await page.click('input[name="avatar-look"][value="bandeau"]');
await page.click('input[name="avatar-accessory"][value="visiere"]');
await settle(1500);
await page.screenshot({ path: `${outDir}/3-editor-bandeau-visiere.png` });
await page.click('dialog.avatar-editor button[type="submit"]');
await page.waitForFunction(() => !document.querySelector('dialog.avatar-editor[open]'), { timeout: 15000 });
const me2 = await page.evaluate(async () => (await (await fetch('/api/me')).json()).user.avatar);
check('second change saved: bandeau + visiere, colours kept', me2.look === 'bandeau' && me2.accessory === 'visiere' && /^#[0-9a-f]{6}$/i.test(me2.skin), JSON.stringify(me2));
await page.evaluate(async () => { await window.__tn.run(2); });
await page.screenshot({ path: `${outDir}/4-world-bandeau-visiere.png` });
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(bad ? `FAILURES (${bad})` : 'ALL PASS');
process.exit(bad ? 1 : 0);
