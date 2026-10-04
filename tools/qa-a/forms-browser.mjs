// F81 / F82 in a real browser against a disposable server with the REAL form protection (no relaxation): a normal person does not notice it (a quick
// submit is retried by itself), the same form sent twice creates one record and says so, a quota refusal is readable and keeps the typed text, the hidden
// field is out of reach of keyboard and screen reader, staff see the counters. Chrome via puppeteer-core, disposable database, A ports 3200-3209.
// Usage: node tools/qa-a/forms-browser.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const dataDir = mkdtempSync(join(tmpdir(), 'terra-forms-ui-'));
const dbPath = join(dataDir, 'a.sqlite');
const shots = process.env.SHOTS_DIR || join(tmpdir(), 'terra-forms-shots');
mkdirSync(shots, { recursive: true });
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1' };
for (const name of ['TN_FORM_LIMIT_SCALE', 'TN_FORM_MIN_AGE_MS', 'TN_FORM_TOKENS']) delete env[name];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 600)}`); };
const rows = (table, where = '1=1', ...args) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n; } finally { db.close(); } };

const agentPw = /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', 'agent@ui.test', 'Agent Ui', 'agent'], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
await wait(1500);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
let ipCounter = 0;
async function open(cookie, locale = 'fr') {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.80.0.${++ipCounter}` });
  await page.evaluateOnNewDocument((lang) => { try { localStorage.setItem('lang', lang); } catch { /* blocked */ } }, locale);
  if (cookie) await page.setCookie({ name: 'tn_session', value: cookie.split('=')[1], url: base });
  const log = { posts: [], dialogs: [], errors: [] };
  page.on('request', (r) => { if (r.method() === 'POST') log.posts.push(r.url().replace(base, '')); });
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(e.message));
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  return { context, page, log };
}
const status = (page, selector) => page.$eval(selector, (n) => ({ text: n.textContent.trim(), error: n.dataset.error })).catch(() => null);
const fill = (page, selector, values) => page.evaluate((sel, vals) => { const f = document.querySelector(sel); for (const [name, value] of Object.entries(vals)) { f.elements[name].value = value; f.elements[name].dispatchEvent(new Event('input', { bubbles: true })); } }, selector, values);

console.log('# 1. a normal person registers quickly: no visible friction');
let s = await open();
await fill(s.page, '#register-form', { name: 'Personne Pressée', email: 'rapide@ui.test', password: 'password-long-1' });
const startedAt = Date.now();
await s.page.click('#register-form button[type=submit]'); // no focus on the form first: the token is asked for at submit and the page retries by itself
await s.page.waitForFunction(() => document.querySelector('#register-status')?.textContent.includes('Compte créé'), { timeout: 12000 }).catch(() => {});
const reg = await status(s.page, '#register-status');
check('submitting at once registers the person (a "too fast" answer is retried by the page, no error is ever shown)', reg?.text.includes('Compte créé') && reg.error !== 'true' && rows('users', 'email = ?', 'rapide@ui.test') === 1, JSON.stringify([reg, Date.now() - startedAt]));
check('the retry cost about a second and a half at most, and the page sent the form once visibly (no script error, no dialog)', Date.now() - startedAt < 8000 && s.log.errors.length === 0 && s.log.dialogs.length === 0, JSON.stringify([s.log.errors, s.log.dialogs, Date.now() - startedAt]));
const me = await s.page.evaluate(async () => (await (await fetch('/api/me')).json()).user?.email);
check('the new session works (signed in as the new resident)', me === 'rapide@ui.test', me);

console.log('\n# 2. the request form: a double send creates one request, a repeat says so');
await s.page.waitForSelector('#message-form [name=subject]');
const shown = await s.page.evaluate(() => ['#message-form', '#concern-form'].map((id) => { const input = document.querySelector(id + ' [name=fax_ref]'); const r = input.getBoundingClientRect(); return { id, left: r.left, visibleForm: document.querySelector(id).getBoundingClientRect().height > 0 }; }));
check('in the rendered, signed-in forms the hidden field really sits far off screen (never visible to a person)', shown.every((h) => h.visibleForm && h.left < -1000), JSON.stringify(shown));
await s.page.focus('#message-form [name=subject]');
await wait(1700); // the token was asked for on focus and is now old enough: no retry needed
await fill(s.page, '#message-form', { subject: 'Lampadaire éteint rue des Dunes', body: 'Le lampadaire devant le numéro 12 est éteint depuis trois jours.' });
const before = s.log.posts.filter((p) => p === '/api/messages').length;
await Promise.all([s.page.click('#message-form button[type=submit]'), s.page.click('#message-form button[type=submit]'), s.page.keyboard.press('Enter')]);
await s.page.waitForFunction(() => /Référence M-\d+/.test(document.querySelector('#message-status')?.textContent || ''), { timeout: 8000 }).catch(() => {});
const sent = await status(s.page, '#message-status');
check('clicking twice and pressing Enter sends one request: one POST, one row, one confirmation with a reference', s.log.posts.filter((p) => p === '/api/messages').length - before === 1 && rows('messages', 'subject = ?', 'Lampadaire éteint rue des Dunes') === 1 && /Référence M-\d+/.test(sent?.text || ''), JSON.stringify([sent, s.log.posts]));
await fill(s.page, '#message-form', { subject: 'LAMPADAIRE éteint rue des Dunes', body: 'Le lampadaire devant le numéro 12 est éteint depuis trois jours.' });
await s.page.click('#message-form button[type=submit]');
await s.page.waitForFunction(() => /déjà été reçue/.test(document.querySelector('#message-status')?.textContent || ''), { timeout: 12000 }).catch(() => {});
const dup = await status(s.page, '#message-status');
check('sending the same request again (even in capitals) says it was already received, with the same reference, and creates nothing (F82)', /déjà été reçue : aucun doublon/.test(dup?.text || '') && /Référence M-\d+/.test(dup.text) && dup.error !== 'true' && rows('messages', 'user_id = (SELECT id FROM users WHERE email = ?)', 'rapide@ui.test') === 1, JSON.stringify(dup));
await s.page.screenshot({ path: join(shots, 'duplicate-says-so.png') });

console.log('\n# 3. quota: readable, keeps the typed text, English too');
for (let i = 2; i <= 6; i++) {
  await fill(s.page, '#message-form', { subject: `Demande numéro ${i} pour le quota`, body: `Un texte assez long pour la demande numéro ${i}, envoyée pour atteindre le quota.` });
  await s.page.click('#message-form button[type=submit]');
  await s.page.waitForFunction((n) => new RegExp(`Référence M-\\d+`).test(document.querySelector('#message-status')?.textContent || '') && document.querySelector('#message-form [name=subject]').value === '', { timeout: 12000 }, i).catch(() => {});
}
check('six requests in ten minutes are accepted', rows('messages', 'user_id = (SELECT id FROM users WHERE email = ?)', 'rapide@ui.test') === 6, rows('messages', 'user_id = (SELECT id FROM users WHERE email = ?)', 'rapide@ui.test'));
await fill(s.page, '#message-form', { subject: 'Septième demande refusée', body: 'Ce texte reste dans le formulaire quand le quota est atteint.' });
await s.page.click('#message-form button[type=submit]');
await s.page.waitForFunction(() => /Réessayez dans \d+ min/.test(document.querySelector('#message-status')?.textContent || ''), { timeout: 12000 }).catch(() => {});
const limited = await status(s.page, '#message-status');
const kept = await s.page.$eval('#message-form [name=subject]', (n) => n.value);
check('the 7th is refused in plain words with the wait (error cue "⚠ Erreur :"), the typed text stays, nothing created', /^⚠ Erreur : Vous avez envoyé beaucoup de messages en peu de temps\. Réessayez dans \d+ min\./.test(limited?.text || '') && limited.error === 'true' && kept === 'Septième demande refusée' && rows('messages', 'subject = ?', 'Septième demande refusée') === 0, JSON.stringify([limited, kept]));
await s.page.screenshot({ path: join(shots, 'quota-refusal.png') });
await s.page.click('#lang-toggle');
await s.page.waitForFunction(() => document.documentElement.lang === 'en', { timeout: 6000 }).catch(() => {});
await s.page.click('#message-form button[type=submit]');
await s.page.waitForFunction(() => /Try again in \d+ min/.test(document.querySelector('#message-status')?.textContent || ''), { timeout: 12000 }).catch(() => {});
const english = await status(s.page, '#message-status');
check('in English the refusal reads in English ("You have sent many messages in a short time. Try again in N min.")', /You have sent many messages in a short time\. Try again in \d+ min\./.test(english?.text || ''), JSON.stringify(english));
await s.context.close();

console.log('\n# 4. the hidden field');
s = await open();
const hp = await s.page.evaluate(() => [...document.querySelectorAll('input[name=fax_ref]')].map((input) => ({ form: input.form.id, tab: input.tabIndex, hidden: !!input.closest('[aria-hidden=true]'), box: (() => { const r = input.getBoundingClientRect(); return (r.width === 0 && r.height === 0) || r.right < 0 || r.left < -1000; })(), autocomplete: input.autocomplete })));
check('the hidden field exists in the four forms (sign-up, sign-up with a passkey, message, concern), is aria-hidden, off screen (or not rendered while signed out), out of the tab order and without autofill', hp.length === 4 && hp.some((h) => h.form === 'passkey-signup-form') && hp.every((h) => h.hidden && h.tab === -1 && h.box && h.autocomplete === 'off'), JSON.stringify(hp));
await s.page.focus('#register-form [name=name]');
const order = [];
for (let i = 0; i < 6; i++) { await s.page.keyboard.press('Tab'); order.push(await s.page.evaluate(() => document.activeElement.name || document.activeElement.id || document.activeElement.tagName)); }
check('Tab never lands on the hidden field', !order.includes('fax_ref'), order.join(' > '));
await fill(s.page, '#register-form', { name: 'Robot Visible', email: 'robot@ui.test', password: 'password-long-1', fax_ref: 'http://spam.example' });
await s.page.click('#register-form button[type=submit]');
await s.page.waitForFunction(() => /n’a pas pu être envoyé/.test(document.querySelector('#register-status')?.textContent || ''), { timeout: 12000 }).catch(() => {});
const robot = await status(s.page, '#register-status');
check('a form with the hidden field filled in (a script) is refused with a readable message, and nothing is created', /Ce formulaire n’a pas pu être envoyé/.test(robot?.text || '') && robot.error === 'true' && rows('users', 'email = ?', 'robot@ui.test') === 0, JSON.stringify(robot));
await s.context.close();

console.log('\n# 5. staff see the counters');
const agent = await (async () => { const out = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.81.0.1' }, body: JSON.stringify({ email: 'agent@ui.test', password: agentPw }) }); return (out.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0]; })();
s = await open(agent);
await s.page.waitForFunction(() => /Formulaires \(dernière heure\)/.test(document.querySelector('#security-summary')?.textContent || ''), { timeout: 10000 }).catch(() => {});
const summary = await s.page.$eval('#security-summary', (n) => n.textContent.trim()).catch(() => '');
check('the staff security panel lists form counters (automated refusals, too fast, quota, duplicates)', /Formulaires \(dernière heure\) : [1-9]\d* envois refusés comme automatiques, [1-9]\d* envois trop rapides, [1-9]\d* refus pour quota, [1-9]\d* doublons évités\./.test(summary), summary);
await s.page.screenshot({ path: join(shots, 'staff-counters.png') });
await s.context.close();

await browser.close();
server.kill();
await wait(400);
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall form UI checks passed');
process.exit(failures ? 1 : 0);
