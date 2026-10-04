// Session A: the world UI exactly as production serves it: `npm run build`, then Node serving dist/monde (CSP, gzip,
// cache headers, real App.jsx wiring). Seeds a citizen, an urgent alert (store default) and a service outage.
// Modes: `physical` (default; desktop, B's PhoneRig: DOM screen under a CSS matrix3d) and `flat` (/monde/?flatphone, the accessible dialog).
// Needs: npm i --no-save puppeteer-core axe-core. Env: CHROME_PATH, SHOTS_DIR. Usage: node tools/qa-a/world-production.mjs [physical|flat]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const axeSource = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');
const mode = process.argv[2] === 'flat' ? 'flat' : 'physical';
const DIALOG = '.phone-sheet, .phone-host'; // flat dialog | physical host
const shots = process.env.SHOTS_DIR || join(tmpdir(), 'terra-prod-shots');
mkdirSync(shots, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'terra-prod-'));
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'prod.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TN_FORM_TOKENS: 'optional', TN_FORM_LIMIT_SCALE: '1000', TN_FORM_MIN_AGE_MS: '0' };
console.log(`mode: ${mode}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };

const build = spawnSync('npm', ['run', 'build'], { cwd: root, shell: true, encoding: 'utf8' });
check('npm run build succeeds', build.status === 0, build.stdout.slice(-400) + build.stderr.slice(-400));
const staffOut = spawnSync(process.execPath, ['create-staff.mjs', 'agent@prod.test', 'Agent Prod', 'agent'], { cwd: root, env, encoding: 'utf8' });
const staffPassword = /conserver : (\S+)/.exec(staffOut.stdout)[1];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
await wait(1500);

const json = async (path, method = 'GET', body, cookie = '') => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { response, data: await response.json().catch(() => ({})), cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
};
const staff = await json('/api/auth/login', 'POST', { email: 'agent@prod.test', password: staffPassword });
const health = (await json('/api/services')).data.services.find((s) => s.title === 'Centre de santé');
const returnAt = new Date(Date.now() + 4 * 3600_000 + 3 * 86400_000).toISOString().slice(0, 16);
await json(`/api/services/${health.id}/availability`, 'PATCH', { availability: 'unavailable', reason: 'Maintenance du système de rendez-vous', until: returnAt, alternative: 'Écrivez aux services depuis votre espace.' }, staff.cookie);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];
const responses = [];
try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error' || /Content Security Policy|Refused to/.test(message.text())) problems.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', (response) => responses.push({ url: response.url(), status: response.status(), headers: response.headers() }));
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    const post = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await post('/api/auth/register', 'POST', { name: 'Probe Prod', email: 'probe@prod.test', password: 'motdepasse-solide-123' });
    await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  });
  await page.goto(base + (mode === 'flat' ? '/monde/?flatphone' : '/monde/'), { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForSelector('.world-hud', { timeout: 60000 });
  check('production /monde/ renders the A HUD (WorldHud)', (await page.$$('.hud-controls :is(button, a)')).length >= 3);
  await page.waitForSelector(DIALOG, { timeout: 60000 });
  check('urgent alert raises the phone (role=alert takeover with full text)', await page.evaluate(() => Boolean(document.querySelector('[role=dialog] [role=alert] .phone-alert') && document.querySelector('.phone-ack'))));
  await page.screenshot({ path: join(shots, `p01-production-alert-${mode}.png`) });
  const focusInside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]')));
  check('focus is inside the dialog when it is raised', focusInside);
  await page.click('.phone-ack');
  await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 20000 }, DIALOG);
  check('acknowledging an alert-raised phone puts it away', true);
  check('acknowledged IDs stored per user (not the shared legacy key)', await page.evaluate(() => Object.keys(localStorage).some((k) => /^world-seen-alerts:\d+$/.test(k)) && localStorage.getItem('world-seen-alerts') === null));
  // manual open from the HUD
  await page.evaluate(() => [...document.querySelectorAll('.hud-controls button')].find((b) => b.textContent.includes('Téléphone')).click());
  await page.waitForSelector(DIALOG, { timeout: 20000 });
  await wait(600);
  const nav = async (label) => { await page.evaluate((text) => [...document.querySelectorAll('.phone-nav button')].find((b) => b.textContent.trim().startsWith(text)).click(), label); await wait(200); };
  await nav('Services');
  const services = await page.$eval('.phone-body', (n) => n.textContent);
  check('F38 in production: the outage reaches the phone (reason, return time, alternative)', services.includes('Service indisponible') && services.includes('Maintenance du système') && services.includes('Retour prévu') && services.includes('Écrivez aux services'), services.slice(0, 200));
  await page.screenshot({ path: join(shots, `p02-production-services-${mode}.png`) });
  await nav('Transports');
  const transports = await page.$eval('.phone-body', (n) => n.textContent);
  check('F36 in production: lines, departures, nearest stop from the player position, disruption', transports.includes('T1') && transports.includes('T2') && /\d\d:\d\d/.test(transports) && transports.includes('Arrêt le plus proche') && transports.includes('Perturbé'), transports.slice(0, 200));
  await page.screenshot({ path: join(shots, `p03-production-transports-${mode}.png`) });
  if (mode === 'physical') {
    await wait(800);
    const host = await page.evaluate(() => {
      const h = document.querySelector('.phone-host');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      return { matrix3d: cs.transform.startsWith('matrix3d'), opacity: cs.opacity, role: h.getAttribute('role'), modal: h.getAttribute('aria-modal'), label: h.getAttribute('aria-label'), dialogs: document.querySelectorAll('[role=dialog]').length, flatSheets: document.querySelectorAll('.phone-sheet').length, w: Math.round(r.width), h: Math.round(r.height), onScreen: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, focusInside: Boolean(document.activeElement?.closest('.phone-host')) };
    });
    check('physical phone: the screen is the DOM host under a CSS matrix3d, lit, labelled, modal', Boolean(host) && host.matrix3d && host.opacity === '1' && host.role === 'dialog' && host.modal === 'true' && Boolean(host.label), JSON.stringify(host));
    check('physical phone: exactly one focusable screen instance, no flat sheet beside it, and it is on the viewport', host.dialogs === 1 && host.flatSheets === 0 && host.onScreen, JSON.stringify(host));
    console.log(`NOTE  physical screen drawn ${host.w}x${host.h}px for a 360x740 layout: text scale about ${(host.w / 360).toFixed(2)} (16px body text reads as about ${(16 * host.w / 360).toFixed(1)}px)`);
    // click alignment: a real mouse click at each tab's on-screen centre (after the 3D transform) must hit that tab
    const tabs = await page.$$eval(".phone-nav button", (nodes) => nodes.map((n) => { const r = n.getBoundingClientRect(); return { label: n.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === n }; }));
    check('physical phone: every tab button is hit-testable at its projected centre (' + tabs.length + ' tabs)', tabs.length === 6 && tabs.every((t) => t.hit), JSON.stringify(tabs));
    const target = tabs.find((t) => t.label.startsWith('Services'));
    await page.mouse.click(target.x, target.y);
    await wait(500);
    check('physical phone: a real mouse click on the projected "Services" tab opens the Services page', (await page.$eval('.phone-title', (n) => n.textContent)) === 'Services');
    const home = await page.$$eval('.phone-nav button', (nodes) => { const n = nodes[0]; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(home.x, home.y);
    await wait(400);
    check('physical phone: clicking the first tab returns to Home (click coordinates stay accurate after the page change)', (await page.$eval('.phone-title', (n) => n.textContent)) === 'Accueil');
    await page.screenshot({ path: join(shots, 'p05-physical-phone-open.png') });
    await nav('Transports');
  }
  // F45 / F46 in production: real seeded places through the real API
  await nav('Accueil');
  const homeText = await page.$eval('.phone-body', (n) => n.textContent);
  check('F46 in production: the phone home answers an emergency first (call 112 and the closest care, by the player position)', homeText.includes('Urgence ?') && homeText.includes('Appelez le 112.') && homeText.includes('Soins les plus proches'), homeText.slice(0, 300));
  await nav('Lieux');
  const placeNames = await page.$$eval('.phone-place h3', (nodes) => nodes.map((n) => n.textContent.trim()));
  const placeKinds = await page.$$eval('.phone-place .phone-tag-kind', (nodes) => nodes.map((n) => n.textContent.trim()));
  check('F45 in production: the Places page lists the seeded places, emergency and hospital first, with a 112 call link and a nearest tag', placeNames.length >= 7 && placeKinds[0] === 'Urgences' && placeKinds.indexOf('Service de la ville') > placeKinds.lastIndexOf('Hôpital') && (await page.$('a[href="tel:112"]')) !== null && (await page.$('.phone-tag-nearest')) !== null, JSON.stringify({ placeNames, placeKinds }));
  await page.screenshot({ path: join(shots, `p06-production-places-${mode}.png`) });
  await nav('Transports');
  const hudBefore = await page.$eval('.hud-district strong', (n) => n.textContent).catch(() => null);
  check('HUD shows the district of the nearest stop', Boolean(hudBefore), String(hudBefore));
  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 20000 }, DIALOG);
  check('Escape closes the manual phone', true);
  await page.evaluate(axeSource);
  const hudAxe = await page.evaluate(async () => (await axe.run('.world-hud', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations.map((v) => `${v.id}[${v.impact}] ${v.nodes[0].html.slice(0, 80)}`));
  check('axe on the HUD in production: no violations', hudAxe.length === 0, hudAxe.join(' | '));
  await page.screenshot({ path: join(shots, `p04-production-hud-scene-${mode}.png`) });

  // delivery headers on the real files
  const js = responses.find((r) => /\/monde\/assets\/index-[^/]+\.js$/.test(r.url));
  const chunk = responses.find((r) => /PlayableCity-[^/]+\.js$/.test(r.url));
  check('app and physics chunks are served gzip with immutable caching', js?.headers['content-encoding'] === 'gzip' && /immutable/.test(js.headers['cache-control']) && chunk?.headers['content-encoding'] === 'gzip', JSON.stringify([js?.headers, chunk?.headers]));
  check('no 4xx/5xx for world assets', responses.filter((r) => r.url.includes('/monde/') && r.status >= 400).length === 0, responses.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.url}`).join(' | '));
  const csp = responses.find((r) => new URL(r.url).pathname === '/monde/')?.headers['content-security-policy'] || '';
  check('/monde/ CSP is the contract one and the page ran under it with no violations', csp.includes("script-src 'self' 'wasm-unsafe-eval'") && !problems.some((p) => /Content Security Policy|Refused to/.test(p)), problems.join(' | '));
  // Client-side aborts of presence POSTs: headless software WebGL starves the main thread, so the 10 s client timeout can fire.
  // Reported, not hidden; a server error or any other failure still fails the run.
  const aborted = problems.filter((p) => p.startsWith('requestfailed: POST ') && p.includes('/api/presence') && p.endsWith('net::ERR_ABORTED'));
  if (aborted.length) console.log(`NOTE  ${aborted.length} presence POST(s) aborted client-side under software rendering (not a server error)`);
  const realProblems = problems.filter((p) => !aborted.includes(p) && !/favicon|WebGL|GPU stall|swiftshader/i.test(p));
  check('no page errors / failed requests / console errors in production', realProblems.length === 0, realProblems.join(' | '));
} catch (error) {
  failures++;
  console.log('FAIL  production script crashed', error.stack);
} finally {
  await browser.close();
  server.kill();
  await wait(400);
  rmSync(dataDir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall production world checks passed');
  console.log('screenshots:', shots);
  process.exit(failures ? 1 : 0);
}
