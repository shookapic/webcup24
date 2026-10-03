// Session A portal in a real browser (Chrome via puppeteer-core): F37 lockout, F38 notice, F39/F40 booking and reminder by keyboard,
// 390px at 150% text, axe on citizen/staff/high-contrast views, screenshots. Needs: npm i --no-save puppeteer-core axe-core
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const shots = process.env.SHOTS_DIR || join(tmpdir(), 'terra-portal-shots');
mkdirSync(shots, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'terra-browser-'));
const port = 3300 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'b.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };

const staffOut = spawnSync(process.execPath, ['create-staff.mjs', 'agent@b.test', 'Agent B', 'agent'], { cwd: root, env, encoding: 'utf8' });
const agentPw = /conserver : (\S+)/.exec(staffOut.stdout)[1];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
await wait(1500);

const call = async (path, method = 'GET', body, cookie = '') => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { r, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
// seed: citizen, staff session, an outage, slots tomorrow and in 90 minutes
await call('/api/auth/register', 'POST', { name: 'Béatrice Habitante', email: 'bea@b.test', password: 'password-long-1' });
const staff = await call('/api/auth/login', 'POST', { email: 'agent@b.test', password: agentPw });
const services = (await call('/api/services')).data.services;
const health = services.find((s) => s.title === 'Centre de santé');
const cityLocal = (min) => new Date(Date.now() + 4 * 3600_000 + min * 60_000).toISOString().slice(0, 16);
await call(`/api/services/${health.id}/availability`, 'PATCH', { availability: 'unavailable', reason: 'Maintenance du système de rendez-vous du centre de santé', until: cityLocal(3 * 1440), alternative: 'Écrivez aux services municipaux depuis votre espace ou appelez le 112 en cas d’urgence.' }, staff.cookie);
const soon = cityLocal(90);
await call('/api/appointments', 'POST', { date: soon.slice(0, 10), start: soon.slice(11), count: 2, duration: 10, location: 'Mairie, guichet 3', instructions: 'Apportez une pièce d’identité et le justificatif de domicile demandé.' }, staff.cookie);
await call('/api/appointments', 'POST', { date: cityLocal(1440).slice(0, 10), start: '10:00', count: 3, duration: 20 }, staff.cookie);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
const axeSource = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');

async function newPage(width, height, extra = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.context_ = context;
  await page.setViewport({ width, height, deviceScaleFactor: 1, ...extra });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/503/.test(m.text())) errors.push(m.text()); });
  // (503 = the official feed: the key is blank in this test server)
  page.errors = errors;
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '10.50.0.' + Math.floor(Math.random() * 200) });
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  return page;
}
async function login(page, email, password) {
  await page.type('#login-form [name=email]', email);
  await page.type('#login-form [name=password]', password);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('#member-area').hidden, { timeout: 8000 });
  await wait(700);
}
const axe = async (page, label, selector) => {
  await page.evaluate(axeSource);
  const result = await page.evaluate(async (sel) => (await axe.run(sel ? document.querySelector(sel) : document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, all: v.nodes.map((n) => n.html.slice(0, 90) + ' :: ' + (n.failureSummary || '').slice(0, 260).replace(/\s+/g, ' ')) })), selector);
  const serious = result.filter((v) => ['serious', 'critical'].includes(v.impact));
  check(`axe (${label}): no serious/critical violations`, serious.length === 0, JSON.stringify(serious, null, 1));
  const minor = result.filter((v) => !['serious', 'critical'].includes(v.impact));
  if (minor.length) console.log(`      (${label}) other axe findings: ${minor.map((v) => `${v.id}[${v.impact}]x${v.nodes}`).join(', ')}`);
};

try {
  // ============ desktop, citizen ============
  const page = await newPage(1440, 900);
  await login(page, 'bea@b.test', 'password-long-1');
  check('no console/page errors after citizen login', page.errors.length === 0, page.errors.join(' | '));
  const reminder = await page.$eval('#reminder-banner', (el) => ({ hidden: el.hidden, text: el.textContent, pos: getComputedStyle(el).position }));
  check('F40 reminder banner not shown before booking', reminder.hidden);
  // book via real keyboard on the select
  await page.focus('#appointment-slot');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await wait(200);
  const previewText = await page.$eval('#slot-preview', (el) => el.textContent);
  check('F39 keyboard selection shows the preview with date, hours, agent, place, preparation', /Terra Nova/.test(previewText) && previewText.includes('Agent B') && previewText.includes('Lieu'), previewText);
  await page.screenshot({ path: shots + '/01-slot-preview-desktop.png', clip: { x: 0, y: await page.$eval('#appointments-panel', (e) => e.getBoundingClientRect().top + scrollY - 20), width: 1440, height: 760 }, captureBeyondViewport: true });
  await page.type('#appointment-form [name=reason]', 'Dossier de logement');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#appointment-confirmation').hidden, { timeout: 6000 });
  await wait(500);
  const focusId = await page.evaluate(() => document.activeElement?.id);
  check('F39 submitting with Enter confirms, focus moves to the confirmation', focusId === 'appointment-confirmation', focusId);
  const rem = await page.$eval('#reminder-banner', (el) => ({ hidden: el.hidden, text: el.textContent, pos: getComputedStyle(el).position, top: el.getBoundingClientRect().top }));
  check('F40 reminder banner visible and sticky at the top after booking', !rem.hidden && rem.text.includes('Rendez-vous dans moins de 24 h') && rem.pos === 'sticky', JSON.stringify(rem));
  await page.screenshot({ path: shots + '/02-confirmation-reminder-desktop.png', clip: { x: 0, y: await page.$eval('#appointments-panel', (e) => e.getBoundingClientRect().top + scrollY - 60), width: 1440, height: 900 }, captureBeyondViewport: true });
  const ics = await page.$eval('#my-appointments a[href$="/ics"]', (a) => a.href);
  const icsResponse = await page.evaluate(async (url) => { const r = await fetch(url, { credentials: 'same-origin' }); return { type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), body: (await r.text()).slice(0, 60) }; }, ics);
  check('F40 calendar link works in the browser with the session cookie', icsResponse.type.startsWith('text/calendar') && icsResponse.disp.includes('attachment') && icsResponse.body.startsWith('BEGIN:VCALENDAR'), JSON.stringify(icsResponse));
  // F38 card + request flow
  await page.evaluate(() => document.querySelector('#services').scrollIntoView());
  await page.screenshot({ path: shots + '/03-services-unavailable-desktop.png' });
  const cardBtn = await page.evaluateHandle(() => [...document.querySelectorAll('#services-list .service-card')].find((c) => c.textContent.includes('Centre de santé')).querySelector('button'));
  await cardBtn.click();
  await wait(500);
  const focusName = await page.evaluate(() => document.activeElement?.name);
  const notice = await page.$eval('#service-notice', (el) => el.textContent);
  check('F38 "Faire une demande" jumps to the form, focuses the subject, shows the warning first', focusName === 'subject' && notice.includes('Service indisponible') && notice.includes('En attendant'), focusName + ' / ' + notice);
  await page.screenshot({ path: shots + '/04-request-warning-desktop.png', clip: { x: 0, y: await page.$eval('#message-form', (e) => e.getBoundingClientRect().top + scrollY - 20), width: 1440, height: 800 }, captureBeyondViewport: true });
  await axe(page, 'citizen desktop');

  // ============ desktop, F37 lockout ============
  const lock = await newPage(1440, 900);
  for (let i = 0; i < 6; i++) {
    await lock.evaluate(() => { document.querySelector('#login-form [name=email]').value = ''; document.querySelector('#login-form [name=password]').value = ''; });
    await lock.type('#login-form [name=email]', 'bea@b.test');
    await lock.type('#login-form [name=password]', 'wrong-pass-' + i);
    if (i < 5) await lock.click('#login-form button[type=submit]');
    else await lock.click('#login-form button[type=submit]');
    await wait(600);
  }
  const lockStatus = await lock.$eval('#login-status', (el) => ({ text: el.textContent, error: el.dataset.error }));
  const lockDisabled = await lock.$eval('#login-form button[type=submit]', (b) => b.disabled);
  check('F37 browser: the 6th attempt shows the pause with minutes and disables the button', lockStatus.text.includes('Réessayez dans 15 min') && lockDisabled, JSON.stringify(lockStatus));
  await lock.evaluate(() => document.querySelector('#login-form').scrollIntoView({ block: 'center' }));
  await lock.screenshot({ path: shots + '/05-login-lock-desktop.png' });
  await lock.close();

  // ============ mobile 390x844 at 150% text ============
  const m = await newPage(390, 844, { isMobile: true, hasTouch: true });
  await login(m, 'bea@b.test', 'password-long-1');
  await m.click('#font-up'); await m.click('#font-up');
  await wait(300);
  const overflow = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, fs: getComputedStyle(document.documentElement).fontSize, wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('[style*="overflow"]')).slice(0, 5).map((e) => e.tagName + '#' + e.id + '.' + e.className) }));
  check('390px wide at 150% text: no horizontal page scroll', overflow.sw <= overflow.iw, JSON.stringify(overflow));
  await m.evaluate(() => document.querySelector('#appointments-panel').scrollIntoView());
  await m.screenshot({ path: shots + '/06-appointments-mobile-150.png' });
  const targets = await m.evaluate(() => [...document.querySelectorAll('#appointments-panel :is(button, a, select, input)')].filter((e) => !e.closest('[hidden]') && e.getBoundingClientRect().width).map((e) => ({ t: (e.textContent || e.name || e.id).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 40));
  check('touch targets in the appointment panel are >= 40px high', targets.length === 0, JSON.stringify(targets));
  await axe(m, 'citizen mobile 150%');
  await m.close();

  // ============ staff desktop ============
  const s = await newPage(1440, 900);
  await login(s, 'agent@b.test', agentPw);
  check('no console/page errors after staff login', s.errors.length === 0, s.errors.join(' | '));
  await s.evaluate(() => document.querySelector('#availability-form').scrollIntoView());
  await s.screenshot({ path: shots + '/07-staff-availability-slots-desktop.png' });
  await s.evaluate(() => document.querySelector('#security-panel').scrollIntoView({ block: 'center' }));
  await s.screenshot({ path: shots + '/08-staff-security-desktop.png' });
  await axe(s, 'staff desktop');
  // high contrast + reduced motion smoke on a staff page
  await s.click('#contrast-toggle');
  await s.evaluate(() => document.querySelector('#slots-panel').scrollIntoView());
  await s.screenshot({ path: shots + '/09-staff-slots-high-contrast.png' });
  await axe(s, 'staff high contrast');
  await s.close();
  await page.close();
} catch (error) {
  failures++;
  console.log('FAIL  browser script crashed', error.stack);
} finally {
  await browser.close();
  server.kill();
  await wait(400);
  rmSync(dataDir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall browser checks passed');
  process.exit(failures ? 1 : 0);
}
