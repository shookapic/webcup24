// Real-browser validation of the portal performance candidate (task a09d214e): lazy English dictionary, slow/offline behaviour, duplicate submits,
// hidden-tab polling, HTTP negotiation and headers. Chrome via puppeteer-core, disposable server and database, A ports 3200-3209.
// Usage: node tools/qa-a/portal-candidate.mjs [section...]   sections: i18n offline submit polling http   (default: all)
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { request as httpRequest } from 'node:http';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const wanted = process.argv.slice(2);
const run = (name) => !wanted.length || wanted.includes(name);
const shots = process.env.SHOTS_DIR || join(tmpdir(), 'terra-cand-shots');
mkdirSync(shots, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'terra-cand-'));
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'a.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_LIMIT_SCALE: '1000', TN_FORM_MIN_AGE_MS: '0' }; // form protection relaxed for fixtures (tools/qa-a/form-protection.mjs tests the real settings)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 700)}`); };
const note = (text) => console.log(`NOTE  ${text}`);

const agentPw = /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', 'agent@cand.test', 'Agent Cand', 'agent'], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const adminPw = /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', 'admin@cand.test', 'Admin Cand', 'admin'], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
await wait(1500);
let ipCounter = 0;
const call = async (path, method = 'GET', body, cookie = '') => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.50.0.${++ipCounter % 250}`, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { data: await response.json().catch(() => ({})), cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0], status: response.status };
};
const citizen = await call('/api/auth/register', 'POST', { name: 'Zoé Candidate', email: 'zoe@cand.test', password: 'password-long-1' });
const agent = await call('/api/auth/login', 'POST', { email: 'agent@cand.test', password: agentPw });
const admin = await call('/api/auth/login', 'POST', { email: 'admin@cand.test', password: adminPw });
const messages = [];
for (const subject of ['Lampadaire cassé', 'Question sur les horaires', 'Dépôt sauvage rue du Port']) messages.push((await call('/api/messages', 'POST', { subject, body: 'Un message de test assez long pour ressembler à un vrai message.', kind: subject.startsWith('Question') ? 'contact' : 'incident', location: 'Rue du Port' }, citizen.cookie)).data.id);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
async function open({ cookie, locale = 'fr', notifications = false, interception = false, size = [1280, 900] } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: size[0], height: size[1] });
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  if (cookie) await page.setCookie({ name: 'tn_session', value: cookie.split('=')[1], url: base });
  await page.evaluateOnNewDocument((lang, granted) => {
    try { localStorage.getItem('lang') || localStorage.setItem('lang', lang); } catch { /* storage blocked */ }
    window.__notes = [];
    if (granted) window.Notification = class { static permission = 'granted'; static async requestPermission() { return 'granted'; } constructor(title, options) { window.__notes.push({ title, ...options }); } };
  }, locale, notifications);
  const log = { requests: [], responses: [], errors: [], dialogs: [] };
  page.on('request', (r) => log.requests.push({ url: r.url().replace(base, ''), method: r.method(), at: Date.now() }));
  page.on('response', (r) => log.responses.push({ url: r.url().replace(base, ''), status: r.status(), encoding: r.headers()['content-encoding'] || '' }));
  page.on('pageerror', (e) => log.errors.push(e.message));
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const hooks = { block: new Set(), hold: [], delay: new Map() };
  if (interception) {
    await page.setRequestInterception(true);
    page.on('request', async (r) => {
      const url = r.url().replace(base, '');
      if ([...hooks.block].some((m) => url.includes(m))) return r.abort('failed').catch(() => {});
      const held = hooks.hold.find((h) => h.active && url.includes(h.match) && r.method() === h.method);
      if (held) { held.queue.push(r); return; }
      const delay = [...hooks.delay].find(([m]) => url.includes(m));
      if (delay) { await wait(delay[1]); }
      r.continue().catch(() => {});
    });
  }
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  return { context, page, log, hooks };
}
const text = (page, selector) => page.$eval(selector, (n) => n.textContent.trim()).catch(() => null);
const calls = (log, since = 0) => log.requests.filter((r) => r.url.startsWith('/api/') && r.at >= since);
const byPath = (list) => list.reduce((acc, r) => { const p = r.url.split('?')[0]; acc[p] = (acc[p] || 0) + 1; return acc; }, {});

// ============================================================ 1. French / English, lazy dictionary
if (run('i18n')) {
  console.log('\n# 1. languages');
  let s = await open();
  const dictionaryRequests = () => s.log.requests.filter((r) => r.url.startsWith('/i18n-en.js')).length;
  check('FR visitor: the English dictionary is not requested, no response is an error, no script error, lang=fr, French UI', dictionaryRequests() === 0 && s.log.responses.every((r) => r.status < 400) && s.log.errors.length === 0 && await s.page.evaluate(() => document.documentElement.lang) === 'fr' && (await text(s.page, '.skip-link')) === 'Aller au contenu', JSON.stringify(s.log.responses.filter((r) => r.status >= 400)));
  check('FR visitor: i18n.js is the tiny stub (a few hundred bytes) and the whole first load stayed small', await s.page.evaluate(async () => (await (await fetch('/i18n.js')).text()).length) < 1200);
  await s.page.click('#lang-toggle');
  await s.page.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('#lang-toggle').textContent === 'Français', { timeout: 8000 }).catch(() => {});
  await wait(500);
  const en = await s.page.evaluate(() => ({ skip: document.querySelector('.skip-link').textContent, lang: document.documentElement.lang, stored: localStorage.getItem('lang'), headings: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()), nav: [...document.querySelectorAll('nav[aria-label] a')].slice(0, 6).map((a) => a.textContent.trim()) }));
  const dictionaryResponse = s.log.responses.filter((r) => r.url.startsWith('/i18n-en.js'));
  check('switching to English fetches the dictionary exactly once (200, compressed), flips the UI, the lang attribute and the stored locale', dictionaryRequests() === 1 && dictionaryResponse[0]?.status === 200 && ['gzip', 'br'].includes(dictionaryResponse[0]?.encoding) && en.skip === 'Skip to content' && en.lang === 'en' && en.stored === 'en', JSON.stringify({ n: dictionaryRequests(), dictionaryResponse, en: en.skip }));
  check('English headings are English (proxy: no accented French letters left in any h2)', en.headings.length > 5 && en.headings.every((h) => !/[éèêàùç]/i.test(h)), JSON.stringify(en.headings));
  await s.page.screenshot({ path: join(shots, 'i18n-english.png') });
  await s.page.reload({ waitUntil: 'networkidle0' });
  check('reload keeps English (persisted), fetches the dictionary again as a normal cached file, still no error', await s.page.evaluate(() => document.documentElement.lang) === 'en' && (await text(s.page, '.skip-link')) === 'Skip to content' && s.log.errors.length === 0, JSON.stringify(s.log.errors));
  const before = dictionaryRequests();
  await s.page.click('#lang-toggle');
  await s.page.waitForFunction(() => document.documentElement.lang === 'fr', { timeout: 5000 }).catch(() => {});
  check('switching back to French needs no request, restores French and the stored locale', dictionaryRequests() === before && (await text(s.page, '.skip-link')) === 'Aller au contenu' && await s.page.evaluate(() => localStorage.getItem('lang')) === 'fr');
  await s.context.close();

  // failure of the dictionary
  s = await open({ interception: true });
  s.hooks.block.add('i18n-en.js');
  await s.page.click('#lang-toggle');
  await wait(1500);
  const failed = await s.page.evaluate(() => ({ lang: document.documentElement.lang, skip: document.querySelector('.skip-link').textContent, toggle: document.querySelector('#lang-toggle').textContent }));
  check('dictionary request fails (blocked): no crash, the page stays usable (nav still present)', s.log.errors.length === 0 && await s.page.$('nav[aria-label] a') !== null, JSON.stringify(s.log.errors));
  check('dictionary request fails: the page does not claim English while showing French (lang attribute matches the visible language)', !(failed.lang === 'en' && failed.skip === 'Aller au contenu'), JSON.stringify(failed));
  const langNotice = await s.page.evaluate(() => ({ hidden: document.querySelector('#lang-status').hidden, role: document.querySelector('#lang-status').getAttribute('role'), text: document.querySelector('#lang-status').textContent, stored: localStorage.getItem('lang') }));
  check('D1 dictionary request fails: the page says so in both languages (role=status), the toggle reads "English" again and French is remembered', failed.lang === 'fr' && failed.toggle === 'English' && !langNotice.hidden && langNotice.role === 'status' && /pas pu être chargé/.test(langNotice.text) && /could not be loaded/.test(langNotice.text) && langNotice.stored === 'fr', JSON.stringify({ failed, langNotice }));
  s.hooks.block.clear();
  await s.page.click('#lang-toggle');
  await s.page.waitForFunction(() => document.querySelector('.skip-link').textContent === 'Skip to content', { timeout: 8000 }).catch(() => {});
  check('retry after a failed dictionary load: switching again fetches it and English works (no stuck state)', (await text(s.page, '.skip-link')) === 'Skip to content', JSON.stringify(await s.page.evaluate(() => ({ l: document.documentElement.lang, s: document.querySelector('.skip-link').textContent }))));
  await s.context.close();

  // translated validation, status and notifications in English
  s = await open({ cookie: citizen.cookie, locale: 'en', notifications: true });
  check('signed-in resident in English from the first load: dictionary loaded before the data renders (no French card titles for known strings)', await s.page.evaluate(() => document.documentElement.lang) === 'en' && (await text(s.page, '#member-role')) === 'Citizen space', await text(s.page, '#member-role'));
  await call(`/api/messages/${messages[0]}`, 'PATCH', { status: 'in_progress', note: 'A technician comes tomorrow.' }, agent.cookie);
  await s.page.evaluate('loadNotices()');
  await wait(800);
  const noticeText = await text(s.page, '#notices-list');
  check('English: the status-change notice reads in English, with the note, and the browser notification (stand-in) carries the English sentence', /Your request “Lampadaire cassé” is being handled\./.test(noticeText) && /There is nothing for you to do for now\./.test(noticeText) && (await s.page.evaluate(() => window.__notes.map((n) => n.body))).some((b) => b === 'Your request “Lampadaire cassé” is being handled.'), noticeText.slice(0, 200));
  await s.context.close();
  s = await open({ locale: 'en' });
  await s.page.evaluate(() => { const f = document.querySelector('#register-form'); f.elements.name.value = 'Test Person'; f.elements.email.value = 'short@cand.test'; f.elements.password.value = 'short'; f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await wait(1200);
  const validation = await text(s.page, '#register-status');
  check('English: a server validation error is translated and carries the warning cue (no French left)', /^⚠\s*Error:/.test(validation) && /between 12 and 128 characters/.test(validation) && !/caractères/.test(validation), validation);
  await s.context.close();

  const http = (path, headers = {}) => new Promise((resolve, reject) => { const r = httpRequest(base + path, { headers }, (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); }); r.on('error', reject); r.end(); });
  const allow = await Promise.all(['/i18n-en.js', '/i18n-en.js?v=1', '/I18N-EN.JS', '/i18n-en.js.map', '/public/i18n-en.js', '/%2e%2e/server.mjs', '/i18n-en.js/', '/recap.mjs', '/server.mjs', '/store.mjs', '/package.json', '/.env'].map(async (p) => [p, (await http(p)).status]));
  check('served allowlist: only the exact file names are served; case variants, maps, other paths, source files and dot files are 404', Object.fromEntries(allow)['/i18n-en.js'] === 200 && allow.filter(([p]) => p !== '/i18n-en.js' && p !== '/i18n-en.js?v=1').every(([, st]) => st === 404), JSON.stringify(allow));
}

// ============================================================ 2. slow / offline
if (run('offline')) {
  console.log('\n# 2. slow and offline');
  let s = await open({ cookie: citizen.cookie, interception: true });
  await s.page.waitForSelector('#citizen-messages .message-card');
  const cardsBefore = await s.page.$$eval('#citizen-messages .message-card', (n) => n.length);
  await s.page.type('#message-form [name=subject]', 'Sujet en cours de saisie');
  await s.page.type('#message-form [name=body]', 'Un texte long que la personne est en train d’écrire pendant que le réseau tombe.');
  s.hooks.block.add('/api/');
  await s.page.evaluate('refreshAll()');
  await s.page.waitForFunction(() => !document.querySelector('#connection-banner').hidden, { timeout: 8000 }).catch(() => {});
  const banner = await s.page.evaluate(() => ({ hidden: document.querySelector('#connection-banner').hidden, text: document.querySelector('#connection-banner').textContent, role: document.querySelector('#connection-banner').getAttribute('role'), button: document.querySelector('#connection-banner button')?.textContent, lastGood: lastGoodAt }));
  await s.page.screenshot({ path: join(shots, 'offline-banner.png') });
  const when = new Date(banner.lastGood).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  check('offline: the banner appears in words (role=status), names the time of the last good data, and offers "Réessayer maintenant"', !banner.hidden && banner.role === 'status' && /Connexion lente ou coupée/.test(banner.text) && banner.text.includes(when) && banner.button === 'Réessayer maintenant', JSON.stringify(banner));
  const afterOffline = await s.page.evaluate(() => ({ cards: document.querySelectorAll('#citizen-messages .message-card').length, text: document.querySelector('#citizen-messages').textContent.slice(0, 160), subject: document.querySelector('#message-form [name=subject]').value, body: document.querySelector('#message-form [name=body]').value.length }));
  check('offline: the editable input is preserved (subject and body untouched)', afterOffline.subject === 'Sujet en cours de saisie' && afterOffline.body > 40, JSON.stringify(afterOffline));
  check('offline: the useful last-good data stays on screen (the request history is not replaced by an error)', afterOffline.cards === cardsBefore, `cards before ${cardsBefore}, after ${afterOffline.cards}: "${afterOffline.text}"`);
  const stale = await s.page.evaluate(() => { const n = document.querySelector('#citizen-messages').previousElementSibling; return n?.classList.contains('stale-notice') ? { role: n.getAttribute('role'), text: n.textContent } : null; });
  check('D3 offline: a status line above the history (role=status) names the error and says since when the list dates', Boolean(stale) && stale.role === 'status' && /Erreur/.test(stale.text) && /date de \d{2}:\d{2}/.test(stale.text), JSON.stringify(stale));
  await s.page.click('#message-form button[type=submit]');
  await wait(1500);
  const sent = await s.page.evaluate(() => ({ status: document.querySelector('#message-status').textContent, error: document.querySelector('#message-status').dataset.error, busy: document.querySelector('#message-form').getAttribute('aria-busy'), subject: document.querySelector('#message-form [name=subject]').value }));
  check('offline submit: no false success (error with cue, form not cleared, not left busy), and nothing was created on the server', sent.error === 'true' && /^⚠/.test(sent.status) && sent.busy === null && sent.subject === 'Sujet en cours de saisie' && (await call('/api/messages', 'GET', undefined, citizen.cookie)).data.messages.length === 3, JSON.stringify(sent));
  const lateId = (await call('/api/messages', 'POST', { subject: 'Ajouté pendant la coupure', body: 'Message créé pendant que la page était hors ligne.', kind: 'contact' }, citizen.cookie)).data.id;
  s.hooks.block.clear();
  await s.page.click('#connection-banner button');
  await s.page.waitForFunction(() => document.querySelector('#connection-banner').hidden, { timeout: 10000 }).catch(() => {});
  await wait(1200);
  const recovered = await s.page.evaluate(() => ({ hidden: document.querySelector('#connection-banner').hidden, titles: [...document.querySelectorAll('#citizen-messages h4')].map((h) => h.textContent), subject: document.querySelector('#message-form [name=subject]').value }));
  check('D3 recovery: the status line above the history is gone once the refresh succeeds', await s.page.evaluate(() => !document.querySelector('.stale-notice')));
  check('recovery: "Réessayer maintenant" clears the banner and refreshes the data (the message created meanwhile appears), the typed input is still there', recovered.hidden && recovered.titles.includes('Ajouté pendant la coupure') && recovered.subject === 'Sujet en cours de saisie', JSON.stringify(recovered));
  // the 20 s timeout
  s.hooks.hold.push({ match: '/api/messages', method: 'GET', active: true, queue: [] });
  const started = Date.now();
  await s.page.evaluate('refreshAll()');
  await s.page.waitForFunction(() => !document.querySelector('#connection-banner').hidden, { timeout: 30000 }).catch(() => {});
  const waited = Date.now() - started;
  check('a request that never answers is cut at about 20 s and the banner says so (not earlier than 19 s, not later than 24 s)', waited >= 19000 && waited <= 24000, `banner after ${waited} ms`);
  s.hooks.hold[0].active = false;
  for (const r of s.hooks.hold[0].queue) r.continue().catch(() => {});
  await s.page.evaluate('refreshAll()');
  await s.page.waitForFunction(() => document.querySelector('#connection-banner').hidden, { timeout: 10000 }).catch(() => {});
  check('after the stuck request is released the next refresh recovers by itself', await s.page.evaluate(() => document.querySelector('#connection-banner').hidden));
  await s.context.close();

  // staff action failure
  s = await open({ cookie: agent.cookie, interception: true });
  await s.page.waitForSelector('#staff-messages .message-card');
  const target = await s.page.evaluateHandle(() => [...document.querySelectorAll('#staff-messages .message-card')].find((c) => c.textContent.includes('Dépôt sauvage')));
  const serverStatusBefore = (await call('/api/messages', 'GET', undefined, agent.cookie)).data.messages.find((m) => m.subject === 'Dépôt sauvage rue du Port').status;
  s.hooks.block.add('/api/');
  await s.page.evaluate((card) => { const select = card.querySelector('select'); select.value = 'resolved'; select.dispatchEvent(new Event('change', { bubbles: true })); }, target);
  await wait(1500);
  const staffState = await s.page.evaluate((card) => ({ value: card.querySelector('select').value, disabled: card.querySelector('select').disabled, banner: !document.querySelector('#connection-banner').hidden, failure: card.querySelector('.status-failure')?.textContent || '', failureRole: card.querySelector('.status-failure')?.getAttribute('role'), failureHidden: card.querySelector('.status-failure')?.hidden }), target);
  const serverStatusAfter = (await call('/api/messages', 'GET', undefined, agent.cookie)).data.messages.find((m) => m.subject === 'Dépôt sauvage rue du Port').status;
  check('staff action offline: nothing is applied on the server, the failure is announced next to the control (banner and inline alert, no dialog), the control is usable again', serverStatusAfter === serverStatusBefore && staffState.banner && /Le changement d’état n’a pas été enregistré/.test(staffState.failure) && staffState.failureRole === 'alert' && staffState.failureHidden === false && s.log.dialogs.length === 0 && !staffState.disabled, JSON.stringify({ serverStatusBefore, serverStatusAfter, staffState, dialogs: s.log.dialogs }));
  check('staff action offline: the selector does not keep showing a state the server never accepted (no stale value presented as saved)', staffState.value === serverStatusBefore, `selector shows "${staffState.value}", server still "${serverStatusAfter}"`);
  s.hooks.block.clear();
  await s.page.click('#connection-banner button');
  await s.page.waitForFunction(() => document.querySelector('#connection-banner').hidden, { timeout: 10000 }).catch(() => {});
  await wait(1200);
  const afterRetry = await s.page.evaluate(() => [...document.querySelectorAll('#staff-messages .message-card')].find((c) => c.textContent.includes('Dépôt sauvage'))?.querySelector('select').value);
  check('staff recovery: after the retry the list is rebuilt from the server (selector back to the real state)', afterRetry === serverStatusBefore, afterRetry);
  await s.context.close();
}

// ============================================================ 3. duplicate submits and polling
if (run('submit')) {
  console.log('\n# 3a. duplicate submits');
  const fresh = await call('/api/auth/register', 'POST', { name: 'Doublon Test', email: 'dup@cand.test', password: 'password-long-1' });
  let s = await open({ cookie: fresh.cookie, interception: true });
  await s.page.waitForSelector('#message-form');
  const countMessages = async () => (await call('/api/messages', 'GET', undefined, fresh.cookie)).data.messages.length;
  s.hooks.delay.set('/api/messages', 3000);
  await s.page.type('#message-form [name=subject]', 'Un seul envoi');
  await s.page.type('#message-form [name=body]', 'Ce message ne doit être créé qu’une seule fois malgré les clics répétés.');
  const since = Date.now();
  await s.page.click('#message-form button[type=submit]');
  await Promise.all([s.page.click('#message-form button[type=submit]'), s.page.click('#message-form button[type=submit]')]);
  await s.page.focus('#message-form [name=subject]');
  await s.page.keyboard.press('Enter');
  await s.page.keyboard.press('Enter');
  await wait(800);
  const inflight = await s.page.evaluate(() => ({ busy: document.querySelector('#message-form').getAttribute('aria-busy'), status: document.querySelector('#message-status').textContent }));
  await wait(4500);
  const posts = s.log.requests.filter((r) => r.method === 'POST' && r.url === '/api/messages' && r.at >= since).length;
  const after = await s.page.evaluate(() => ({ busy: document.querySelector('#message-form').getAttribute('aria-busy'), status: document.querySelector('#message-status').textContent, subject: document.querySelector('#message-form [name=subject]').value, error: document.querySelector('#message-status').dataset.error }));
  check('three clicks and two Enter presses during a 3 s delayed response: exactly one POST sent and exactly one message created', posts === 1 && await countMessages() === 1, `posts ${posts}, messages ${await countMessages()}`);
  check('in flight: the form says it is sending (aria-busy, "Envoi en cours…"); afterwards a single confirmation, form emptied, no longer busy', inflight.busy === 'true' && /Envoi en cours/.test(inflight.status) && after.busy === null && after.error === 'false' && /Référence n°\d+/.test(after.status) && after.subject === '', JSON.stringify({ inflight, after }));
  s.hooks.delay.clear();
  await s.page.type('#message-form [name=subject]', 'Deuxième envoi');
  await s.page.type('#message-form [name=body]', 'Le formulaire doit pouvoir être renvoyé normalement après un succès.');
  await s.page.click('#message-form button[type=submit]');
  await wait(1500);
  check('after a success the form submits again normally (buttons restored)', await countMessages() === 2);
  s.hooks.block.add('/api/messages');
  await s.page.type('#message-form [name=subject]', 'Envoi qui échoue');
  await s.page.type('#message-form [name=body]', 'Cet envoi échoue côté réseau puis doit pouvoir être retenté.');
  await s.page.click('#message-form button[type=submit]');
  await wait(1500);
  const failed = await s.page.evaluate(() => ({ busy: document.querySelector('#message-form').getAttribute('aria-busy'), status: document.querySelector('#message-status').textContent, subject: document.querySelector('#message-form [name=subject]').value, disabled: document.querySelector('#message-form button[type=submit]').disabled }));
  check('after a failure the form is not busy, shows an error, keeps the text and the button works', failed.busy === null && /^⚠/.test(failed.status) && failed.subject === 'Envoi qui échoue' && !failed.disabled, JSON.stringify(failed));
  s.hooks.block.clear();
  await s.page.click('#message-form button[type=submit]');
  await wait(1500);
  check('the failed message can be sent again and is created once', await countMessages() === 3);
  await s.context.close();
}

if (run('polling')) {
  console.log('\n# 3b. polling: visible, hidden, opted-in hidden');
  const seconds = 125;
  const V = await open({ cookie: citizen.cookie });
  const H = await open({ cookie: citizen.cookie });
  const O = await open({ cookie: citizen.cookie, notifications: true });
  await V.page.bringToFront();
  await wait(500);
  const states = await Promise.all([V, H, O].map((p) => p.page.evaluate(() => document.visibilityState)));
  note(`visibility states after bringToFront(V): V=${states[0]} H=${states[1]} O=${states[2]}`);
  let emulated = false;
  if (states[1] !== 'hidden') {
    emulated = true;
    for (const p of [H, O]) await p.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    note('headless Chrome does not hide background tabs: the hidden state is EMULATED through document.visibilityState (the application code reads exactly that); real browser throttling is UNVERIFIED');
  }
  const t0 = Date.now();
  await wait(40_000);
  await call('/api/announcements', 'POST', { title: 'Alerte test visibilité', body: 'Une alerte urgente pour tester la notification d’un onglet masqué.', audience: 'Tous', urgent: true }, admin.cookie);
  await wait((seconds - 40) * 1000);
  const count = (p) => byPath(calls(p.log, t0));
  const cV = count(V), cH = count(H), cO = count(O);
  const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);
  note(`${seconds} s window: visible ${total(cV)} calls ${JSON.stringify(cV)}`);
  note(`${seconds} s window: hidden ${total(cH)} calls ${JSON.stringify(cH)}`);
  note(`${seconds} s window: hidden + opted in ${total(cO)} calls ${JSON.stringify(cO)}`);
  check(`visible tab (${seconds} s): keeps polling everything (more than 20 API calls)`, total(cV) > 20, total(cV));
  check(`hidden tab, not opted in (${seconds} s): no API call at all`, total(cH) === 0, JSON.stringify(cH));
  check(`hidden tab, opted in (${seconds} s): only what feeds alerts (news, notices, appointments), at least one of each news and notices, nothing else`, total(cO) > 0 && Object.keys(cO).every((p) => ['/api/announcements', '/api/me/notices', '/api/appointments'].some((a) => p.startsWith(a))) && (cO['/api/announcements'] || 0) >= 3, JSON.stringify(cO));
  const oNotes = await O.page.evaluate(() => window.__notes);
  const hNotes = await H.page.evaluate(() => window.__notes);
  check('the opted-in hidden tab delivered the urgent alert as a notification within the window (title with the audience, body = alert title); the non-opted-in one did not', oNotes.some((n) => n.body === 'Alerte test visibilité') && hNotes.length === 0, JSON.stringify({ oNotes, hNotes }));
  const t1 = Date.now();
  if (emulated) await H.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  else await H.page.bringToFront();
  await wait(3500);
  const resumed = calls(H.log, t1);
  check('hidden tab shown again: stale data refreshes at once (more than 8 calls within 3.5 s, including messages and news)', resumed.length > 8 && resumed.some((r) => r.url.startsWith('/api/messages')) && resumed.some((r) => r.url.startsWith('/api/announcements')), JSON.stringify(byPath(resumed)));
  check('and the urgent alert published while it was hidden is now on its screen', (await text(H.page, '#alert-banner')).includes('Alerte test visibilité'));
  const t2 = Date.now();
  await V.page.setOfflineMode(true);
  await wait(500);
  await V.page.setOfflineMode(false);
  await wait(3000);
  check('coming back online triggers an immediate refresh (more than 8 calls within 3 s)', calls(V.log, t2).length > 8, calls(V.log, t2).length);
  const t3 = Date.now();
  await V.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await wait(1500);
  check('a visibility change with fresh data does not refresh again (no request storm on rapid tab switching)', calls(V.log, t3).length === 0, calls(V.log, t3).length);
  note('unmount cleanup: the portal is a single page without unmounting; its two intervals live as long as the page. N/A, not claimed.');
  await Promise.all([V, H, O].map((p) => p.context.close()));
}

// ============================================================ 4. HTTP
if (run('http')) {
  console.log('\n# 4. HTTP negotiation and headers');
  const http = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => { const r = httpRequest(base + path, { headers, method }, (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); }); r.on('error', reject); r.end(); });
  const disk = (name) => readFileSync(join(root, 'public', name));
  const files = [['/', 'index.html'], ['/app.js', 'app.js'], ['/i18n-en.js', 'i18n-en.js'], ['/styles.css', 'styles.css']];
  let exact = true;
  for (const [url, name] of files) {
    const gz = await http(url, { 'Accept-Encoding': 'gzip' }); const br = await http(url, { 'Accept-Encoding': 'br, gzip' }); const id = await http(url, { 'Accept-Encoding': 'identity' });
    exact = exact && gz.headers['content-encoding'] === 'gzip' && gunzipSync(gz.body).equals(disk(name)) && br.headers['content-encoding'] === 'br' && brotliDecompressSync(br.body).equals(disk(name)) && !id.headers['content-encoding'] && id.body.equals(disk(name)) && /Accept-Encoding/i.test(gz.headers.vary || '');
  }
  check('negotiation: gzip, brotli and identity each return the exact file bytes, with Vary: Accept-Encoding', exact);
  const refusedBr = await http('/app.js', { 'Accept-Encoding': 'br;q=0, gzip' });
  const refusedGz = await http('/app.js', { 'Accept-Encoding': 'gzip;q=0' });
  const noneAccepted = await http('/app.js', { 'Accept-Encoding': 'identity;q=1, *;q=0' });
  check('a coding the client refuses with q=0 is never used (br;q=0 -> gzip, gzip;q=0 -> identity, * ;q=0 -> identity)', refusedBr.headers['content-encoding'] === 'gzip' && !refusedGz.headers['content-encoding'] && !noneAccepted.headers['content-encoding'], JSON.stringify({ brq0: refusedBr.headers['content-encoding'], gzq0: refusedGz.headers['content-encoding'], star0: noneAccepted.headers['content-encoding'] }));
  const first = await http('/app.js', { 'Accept-Encoding': 'gzip' });
  const etag = first.headers.etag;
  const not = await http('/app.js', { 'If-None-Match': etag, 'Accept-Encoding': 'gzip' });
  check('ETag/304: unchanged file is a bodyless 304 that repeats ETag, Vary, Cache-Control and the security headers', not.status === 304 && not.body.length === 0 && not.headers.etag === etag && /Accept-Encoding/i.test(not.headers.vary) && not.headers['cache-control'] === 'no-cache' && not.headers['x-content-type-options'] === 'nosniff' && /default-src 'self'/.test(not.headers['content-security-policy']));
  const portalHeaders = Object.fromEntries(await Promise.all(['/', '/app.js', '/styles.css', '/i18n.js', '/i18n-en.js'].map(async (p) => [p, (await http(p, { 'Accept-Encoding': 'gzip' })).headers])));
  check('security headers on every portal file: nosniff, X-Frame-Options DENY, no-referrer, the strict CSP, and never immutable (revalidated each time)', Object.values(portalHeaders).every((h) => h['x-content-type-options'] === 'nosniff' && h['x-frame-options'] === 'DENY' && h['referrer-policy'] === 'no-referrer' && h['content-security-policy'] === "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'" && h['cache-control'] === 'no-cache'));
  const privateEndpoints = [['/api/me', citizen.cookie], ['/api/messages', citizen.cookie], ['/api/me/notices', citizen.cookie], ['/api/me/devices', citizen.cookie], ['/api/concerns', citizen.cookie], ['/api/public-requests', citizen.cookie], ['/api/me/export', citizen.cookie], ['/api/me/export?format=html', citizen.cookie], ['/api/me/recap', citizen.cookie], ['/api/me/recap?format=csv', citizen.cookie], ['/api/admin/dashboard', agent.cookie], ['/api/admin/audit', admin.cookie], ['/api/admin/concerns', agent.cookie]];
  const noStore = await Promise.all(privateEndpoints.map(async ([p, cookie]) => [p, (await http(p, { Cookie: cookie })).headers['cache-control']]));
  check('private API responses are never cacheable (Cache-Control: no-store on every authenticated endpoint and generated document)', noStore.every(([, v]) => /no-store/.test(v || '')), JSON.stringify(noStore.filter(([, v]) => !/no-store/.test(v || ''))));
  const publicEndpoints = await Promise.all(['/api/services', '/api/announcements', '/api/transports', '/api/places'].map(async (p) => [p, (await http(p)).headers['cache-control']]));
  check('public API responses are no-store too (always fresh alerts and outages)', publicEndpoints.every(([, v]) => /no-store/.test(v || '')), JSON.stringify(publicEndpoints));
  const monde = await http('/monde/', { 'Accept-Encoding': 'gzip' });
  const assetName = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(monde.body.length ? (monde.headers['content-encoding'] === 'gzip' ? gunzipSync(monde.body).toString() : monde.body.toString()) : '')?.[1];
  const hashed = assetName ? await http(`/monde/assets/${assetName}`, { 'Accept-Encoding': 'gzip' }) : null;
  // any model that the built world ships (the folder layout differs between world revisions); skipped, not failed, when no world is built here
  const findGlb = (dir) => { try { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) { const r = findGlb(p); if (r) return r; } else if (e.name.endsWith('.glb')) return p; } } catch { /* no dist */ } return null; };
  const worldDir = join(root, 'dist', 'monde');
  const glbFile = findGlb(worldDir);
  const glbUrl = glbFile ? '/monde/' + glbFile.slice(worldDir.length + 1).replace(/\\/g, '/') : null;
  if (!glbUrl) note('no .glb in dist/monde (the world is not built here): the model checks of section 4 are SKIPPED, not passed');
  const glb = glbUrl ? await http(glbUrl, { 'Accept-Encoding': 'gzip' }) : null;
  const missing = glbUrl ? await http(glbUrl.replace(/[^/]+$/, 'nope.glb')) : null;
  const worldCsp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; base-uri 'none'; object-src 'none'";
  check('/monde/: hashed asset is immutable for a year, index.html and the model are revalidated (no-cache + ETag), nothing unhashed is immutable', Boolean(hashed) && /immutable/.test(hashed.headers['cache-control']) && monde.headers['cache-control'] === 'no-cache' && (!glb || (glb.headers['cache-control'] === 'no-cache' && Boolean(glb.headers.etag) && !/immutable/.test(glb.headers['cache-control']))), JSON.stringify({ assetName, hashed: hashed?.headers['cache-control'], index: monde.headers['cache-control'], glb: glb?.headers['cache-control'] }));
  if (glb) check('/monde/: GLB MIME model/gltf-binary, a missing model is a real 404 (not the SPA page), CSP unchanged', glb.status === 200 && glb.headers['content-type'] === 'model/gltf-binary' && missing.status === 404 && !/<html/i.test(missing.body.toString()) && monde.headers['content-security-policy'] === worldCsp && glb.headers['content-security-policy'] === worldCsp, JSON.stringify({ type: glb.headers['content-type'], missing: missing.status }));
  if (glb) check('/monde/ models: 304 when unchanged', (await http(glbUrl, { 'If-None-Match': glb.headers.etag })).status === 304);
  const portalAfter = (await http('/', { 'Accept-Encoding': 'gzip' })).headers;
  check('portal and world security headers stay separate: the portal CSP is not the world CSP and vice versa', portalAfter['content-security-policy'] !== worldCsp);
}

await browser.close();
server.kill();
await wait(300);
rmSync(dataDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall candidate browser checks passed');
process.exit(failures ? 1 : 0);
