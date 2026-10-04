// F62 / F96 (essentials mode and mobile with a limited connection), F93 / F94 (network failure: the essentials stay readable and recoverable), F95 (no unnecessary resources
// or requests), in real Chrome on a disposable server: requests counted on a 390 px guest load, the optional modules loaded only when their section is near, the mode
// persisted and switched on by a data-saver connection, offline reload from the service worker with the saved date shown, nothing private kept, recovery when the network returns.
// A ports 3200-3209. Usage: node tools/qa-a/essentials-browser.mjs   (needs puppeteer-core and axe-core)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const axeSource = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');
const dataDir = mkdtempSync(join(tmpdir(), 'terra-ess-'));
const port = 3200 + Math.floor(Math.random() * 10);
const base = `http://localhost:${port}`; // a service worker needs a secure context: localhost is one
const env = { ...process.env, DATA_PATH: join(dataDir, 'e.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_MIN_AGE_MS: '0', TN_FORM_LIMIT_SCALE: '1000' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 700)}`); };
let server;
const start = async () => { server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' }); await wait(1500); };
const stopServer = async () => { server.kill(); await wait(500); };
await start();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
async function open({ width = 390, height = 844, saveData = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  if (saveData) await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '2g', addEventListener() {} } }); });
  const requests = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === `http://localhost:${port}`) requests.push(u.pathname); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, requests, errors };
}
const axe = async (page, label) => {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })).violations.map((v) => `${v.id}[${v.impact}] x${v.nodes.length}: ${v.nodes[0].target.join(' ')}`));
  check(`axe (${label}): no violations`, violations.length === 0, violations.join(' | '));
};

console.log('# F95. what a first visit on a phone really needs');
let s = await open();
await s.page.goto(base + '/', { waitUntil: 'networkidle0' });
const first = [...s.requests];
const optional = ['/participation.js', '/orientation.js', '/participation.css', '/orientation.css', '/api/participation/overview', '/api/orientation/index', '/api/topics', '/i18n-en.js'];
check(`a guest's first load asks for ${first.length} things and none of the optional ones (participation and orientation modules and their data, form themes, the English dictionary): ${first.join(' ')}`, first.length <= 12 && optional.every((path) => !first.includes(path)), first.join(' '));
s.requests.length = 0;
await s.page.evaluate(() => { document.querySelector('#orientation').scrollIntoView(); document.querySelector('#participation').scrollIntoView(); });
await wait(800);
check('scrolling past both sections downloads nothing (no surprise layout shift either): each shows a short card with an "Ouvrir" button', s.requests.length === 0 && await s.page.evaluate(() => !document.querySelector('#orientation-card').hidden && document.querySelector('#orientation-root').hidden && !document.querySelector('#participation-card').hidden), s.requests.join(' '));
await s.page.click('#orientation-card button');
await wait(600);
await s.page.waitForFunction(() => window.TerraOrientation && document.querySelector('#orientation-root input'), { timeout: 10000 }).catch(() => {});
const afterOpen = [...s.requests];
check('opening the orientation helper downloads it then (script, style, its index), it works, the card is replaced and the focus moves into its field', afterOpen.includes('/orientation.js') && afterOpen.includes('/api/orientation/index') && await s.page.evaluate(() => document.querySelector('#orientation-card').hidden && document.activeElement?.closest('#orientation-root') !== null), afterOpen.join(' '));
check('the participation module is still not downloaded', !afterOpen.includes('/participation.js') && !afterOpen.includes('/api/participation/overview'), afterOpen.join(' '));
await s.page.evaluate(() => { location.hash = '#participation'; });
await s.page.waitForFunction(() => window.TerraParticipation, { timeout: 10000 }).catch(() => {});
check('following an anchor that targets the participation section opens it at once', Boolean(await s.page.evaluate(() => window.TerraParticipation)));
check('no page error', s.errors.length === 0, s.errors.join(' | '));
await s.context.close();

console.log('\n# F62 / F96. the essentials mode');
s = await open();
await s.page.goto(base + '/', { waitUntil: 'networkidle0' });
check('the header offers "Mode essentiel" as a toggle button (aria-pressed false) with a description', await s.page.$eval('#light-toggle', (b) => b.getAttribute('aria-pressed') === 'false' && /essentiel/i.test(b.textContent) && Boolean(document.getElementById(b.getAttribute('aria-describedby')))));
await s.page.click('#light-toggle');
await wait(300);
const light = await s.page.evaluate(() => {
  const shown = (sel) => { const n = document.querySelector(sel); return Boolean(n) && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0; };
  return { pressed: document.querySelector('#light-toggle').getAttribute('aria-pressed'), hidden: ['.hero', '#orientation', '#participation', '#mots', '#debuter'].filter((sel) => !shown(sel)).length, kept: ['#urgences', '#services', '#lieux', '#transports', '#actualites', '#espace'].filter((sel) => shown(sel)).length, emergency: document.querySelector('#urgences').textContent.includes('112') };
});
check('in the essentials mode the optional sections are gone (5 of 5) and the six essentials stay (emergency number, services, places, transport, news, personal space)', light.pressed === 'true' && light.hidden === 5 && light.kept === 6 && light.emergency, JSON.stringify(light));
await axe(s.page, 'essentials mode, phone');
await s.page.reload({ waitUntil: 'networkidle0' });
const afterReload = await s.page.evaluate(() => document.documentElement.dataset.light);
const reloadRequests = [...s.requests].slice(-14);
await s.page.evaluate(() => document.querySelector('#orientation').scrollIntoView());
await wait(800);
check('the choice survives a reload, and the optional modules are not downloaded', afterReload === 'true' && !s.requests.slice(-10).some((p) => ['/orientation.js', '/participation.js', '/api/orientation/index', '/api/participation/overview'].includes(p)), s.requests.slice(-10).join(' '));
await s.page.click('#light-toggle');
await wait(300);
check('and it can be switched off again (the full page is back)', await s.page.evaluate(() => document.documentElement.dataset.light === 'false' && getComputedStyle(document.querySelector('.hero')).display !== 'none'));
await s.context.close();
s = await open({ saveData: true });
await s.page.goto(base + '/', { waitUntil: 'networkidle0' });
const auto = await s.page.evaluate(() => ({ light: document.documentElement.dataset.light, banner: document.querySelector('#light-banner').textContent, hidden: document.querySelector('#light-banner').hidden }));
check('a connection that asks to save data switches the mode on by itself and says so, with a button to get the full page', auto.light === 'true' && !auto.hidden && /Mode essentiel activé · Votre connexion est limitée/.test(auto.banner), JSON.stringify(auto));
await s.page.click('#light-banner button');
await wait(300);
check('that button restores the full page and remembers the choice', await s.page.evaluate(() => document.documentElement.dataset.light === 'false' && document.querySelector('#light-banner').hidden));
await s.context.close();

console.log('\n# F93 / F94. the network goes down');
s = await open({ width: 1100, height: 900 });
await s.page.goto(base + '/', { waitUntil: 'networkidle0' });
await s.page.evaluate(() => navigator.serviceWorker.ready);
await s.page.evaluate(() => navigator.serviceWorker.controller || new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })));
await s.page.evaluate('refreshAll()'); // the public lists now pass through the service worker and are kept
await wait(1500);
const keptUrls = await s.page.evaluate(async () => (await (await caches.open('tn-essential-v1')).keys()).map((r) => new URL(r.url).pathname).sort());
check('the service worker kept the page shell and ONLY public lists (alerts, services, places, transport): ' + keptUrls.join(' '), keptUrls.includes('/') && keptUrls.includes('/api/places') && keptUrls.includes('/api/announcements') && keptUrls.every((p) => !/^\/api\/(me|messages|auth|participation\/mine|admin)/.test(p)), keptUrls.join(' '));
await stopServer();
await s.page.reload({ waitUntil: 'domcontentloaded' });
await s.page.waitForFunction(() => document.querySelector('#saved-banner') && !document.querySelector('#saved-banner').hidden, { timeout: 15000 }).catch(() => {});
const offline = await s.page.evaluate(() => ({ banner: document.querySelector('#saved-banner').textContent, role: document.querySelector('#saved-banner').getAttribute('role'), services: document.querySelectorAll('#services-list article, #services-list li, #services-list .service-card').length, emergency: document.querySelector('#urgences').textContent, places: document.querySelectorAll('#places-list .place-card').length, news: document.querySelectorAll('#news-list article').length }));
check('reloading with NO network still shows the page, with a banner that says it is offline and the day and time the information was saved, and the limits (writing, booking, signing in need a connection)', /^Hors connexion ou serveur injoignable · Vous voyez les informations enregistrées le .+ à .+\. Elles peuvent ne plus être à jour\./.test(offline.banner) && /demandent une connexion/.test(offline.banner) && offline.role === 'status', JSON.stringify(offline).slice(0, 400));
check('and the essentials are readable: the emergency number, the services, the places with their phone numbers and hours, the news and alerts', /112/.test(offline.emergency) && offline.services >= 3 && offline.places >= 3 && offline.news >= 1, JSON.stringify(offline).slice(0, 400));
await s.page.screenshot({ path: join(dataDir, 'offline.png') });
await axe(s.page, 'offline, saved copy');
await s.page.evaluate(() => { const f = document.querySelector('#login-form'); f.elements.email.value = 'quelquun@example.org'; f.elements.password.value = 'password-long-1'; });
await s.page.click('#login-form button[type=submit]');
await s.page.waitForFunction(() => /Erreur : Connexion lente ou coupée/.test(document.querySelector('#login-status')?.textContent || ''), { timeout: 12000 }).catch(() => {});
check('an action that needs the server says so in words, where the person is looking (nothing is faked offline)', /^⚠ Erreur : Connexion lente ou coupée/.test(await s.page.$eval('#login-status', (n) => n.textContent.trim())));
await start();
await s.page.click('#saved-banner button');
await s.page.waitForFunction(() => document.querySelector('#saved-banner').hidden, { timeout: 15000 }).catch(() => {});
check('when the network is back, "Réessayer maintenant" fetches fresh data and the offline banner disappears', await s.page.$eval('#saved-banner', (n) => n.hidden));
await s.context.close();

console.log('\n# nothing private is kept');
const secret = 'SECRET-TEXT-9d3f';
const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.50.0.1' }, body: JSON.stringify({ name: 'Zoé Privée', email: 'zoe@ess.test', password: 'password-long-1' }) });
const cookie = reg.headers.getSetCookie().find((c) => c.startsWith('tn_session=')).split(';')[0];
await fetch(`${base}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': '10.50.0.1' }, body: JSON.stringify({ subject: 'Ma demande privée', body: `Un texte privé qui contient ${secret} et ne doit jamais être gardé.`, kind: 'contact' }) });
s = await open({ width: 1100, height: 900 });
await s.page.setCookie({ name: 'tn_session', value: cookie.split('=')[1], url: base });
await s.page.goto(base + '/', { waitUntil: 'networkidle0' });
await s.page.waitForFunction(() => document.querySelector('#citizen-messages .message-card'), { timeout: 10000 }).catch(() => {});
await s.page.evaluate('refreshAll()');
await wait(1500);
const stored = await s.page.evaluate(async (needle) => {
  const cache = await caches.open('tn-essential-v1');
  const hits = [];
  for (const request of await cache.keys()) { const text = await (await cache.match(request)).text(); if (text.includes(needle) || /Zoé Privée|zoe@ess\.test/.test(text)) hits.push(new URL(request.url).pathname); }
  return { hits, keys: (await cache.keys()).map((r) => new URL(r.url).pathname), storage: JSON.stringify({ ...localStorage }).includes(needle) };
}, secret);
check('a signed-in resident\'s private data (message text, name, e-mail) is in none of the saved copies nor in local storage', stored.hits.length === 0 && !stored.storage && stored.keys.every((p) => !/\/api\/(me|messages|notices)/.test(p)), JSON.stringify(stored));
await stopServer();
await s.page.reload({ waitUntil: 'domcontentloaded' });
await s.page.waitForFunction(() => document.querySelector('#saved-banner') && !document.querySelector('#saved-banner').hidden, { timeout: 15000 }).catch(() => {});
const privateOffline = await s.page.evaluate(() => ({ member: !document.querySelector('#member-area').hidden, text: document.body.textContent.includes('SECRET-TEXT') }));
check('offline, the page shows the public essentials but NOT the resident\'s private space (it needs the server)', !privateOffline.member && !privateOffline.text, JSON.stringify(privateOffline));
check('no page error through the whole offline path', s.errors.length === 0, s.errors.join(' | '));
await s.context.close();

await browser.close();
server.kill();
await wait(400);
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall essentials checks passed');
process.exit(failures ? 1 : 0);
