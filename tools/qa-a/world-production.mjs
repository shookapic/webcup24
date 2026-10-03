// Session A: the world UI exactly as production serves it: `npm run build`, then Node serving dist/monde (CSP, gzip,
// cache headers, real App.jsx wiring). Seeds a citizen, an urgent alert (store default) and a service outage.
// Needs: npm i --no-save puppeteer-core axe-core. Env: CHROME_PATH, SHOTS_DIR. Usage: node tools/qa-a/world-production.mjs
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
const shots = process.env.SHOTS_DIR || join(tmpdir(), 'terra-prod-shots');
mkdirSync(shots, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'terra-prod-'));
const port = 3600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'prod.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '' };
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
  await page.goto(base + '/monde/', { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForSelector('.world-hud', { timeout: 60000 });
  check('production /monde/ renders the A HUD (WorldHud)', (await page.$$('.hud-controls :is(button, a)')).length >= 3);
  await page.waitForSelector('.phone-sheet', { timeout: 60000 });
  check('urgent alert raises the phone (role=alert takeover with full text)', await page.evaluate(() => Boolean(document.querySelector('[role=dialog] [role=alert] .phone-alert') && document.querySelector('.phone-ack'))));
  await page.screenshot({ path: join(shots, 'p01-production-alert.png') });
  const focusInside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]')));
  check('focus is inside the dialog when it is raised', focusInside);
  await page.click('.phone-ack');
  await page.waitForFunction(() => !document.querySelector('.phone-sheet'), { timeout: 20000 });
  check('acknowledging an alert-raised phone puts it away', true);
  check('acknowledged IDs stored per user (not the shared legacy key)', await page.evaluate(() => Object.keys(localStorage).some((k) => /^world-seen-alerts:\d+$/.test(k)) && localStorage.getItem('world-seen-alerts') === null));
  // manual open from the HUD
  await page.evaluate(() => [...document.querySelectorAll('.hud-controls button')].find((b) => b.textContent.includes('Téléphone')).click());
  await page.waitForSelector('.phone-sheet', { timeout: 20000 });
  await wait(600);
  const nav = async (label) => { await page.evaluate((text) => [...document.querySelectorAll('.phone-nav button')].find((b) => b.textContent.trim().startsWith(text)).click(), label); await wait(200); };
  await nav('Services');
  const services = await page.$eval('.phone-body', (n) => n.textContent);
  check('F38 in production: the outage reaches the phone (reason, return time, alternative)', services.includes('Service indisponible') && services.includes('Maintenance du système') && services.includes('Retour prévu') && services.includes('Écrivez aux services'), services.slice(0, 200));
  await page.screenshot({ path: join(shots, 'p02-production-services.png') });
  await nav('Transports');
  const transports = await page.$eval('.phone-body', (n) => n.textContent);
  check('F36 in production: lines, departures, nearest stop from the player position, disruption', transports.includes('T1') && transports.includes('T2') && /\d\d:\d\d/.test(transports) && transports.includes('Arrêt le plus proche') && transports.includes('Perturbé'), transports.slice(0, 200));
  await page.screenshot({ path: join(shots, 'p03-production-transports.png') });
  const hudBefore = await page.$eval('.hud-district strong', (n) => n.textContent).catch(() => null);
  check('HUD shows the district of the nearest stop', Boolean(hudBefore), String(hudBefore));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.phone-sheet'), { timeout: 20000 });
  check('Escape closes the manual phone', true);
  await page.evaluate(axeSource);
  const hudAxe = await page.evaluate(async () => (await axe.run('.world-hud', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations.map((v) => `${v.id}[${v.impact}] ${v.nodes[0].html.slice(0, 80)}`));
  check('axe on the HUD in production: no violations', hudAxe.length === 0, hudAxe.join(' | '));
  await page.screenshot({ path: join(shots, 'p04-production-hud-scene.png') });

  // delivery headers on the real files
  const js = responses.find((r) => /\/monde\/assets\/index-[^/]+\.js$/.test(r.url));
  const chunk = responses.find((r) => /PlayableCity-[^/]+\.js$/.test(r.url));
  check('app and physics chunks are served gzip with immutable caching', js?.headers['content-encoding'] === 'gzip' && /immutable/.test(js.headers['cache-control']) && chunk?.headers['content-encoding'] === 'gzip', JSON.stringify([js?.headers, chunk?.headers]));
  check('no 4xx/5xx for world assets', responses.filter((r) => r.url.includes('/monde/') && r.status >= 400).length === 0, responses.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.url}`).join(' | '));
  const csp = responses.find((r) => r.url.endsWith('/monde/'))?.headers['content-security-policy'] || '';
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
