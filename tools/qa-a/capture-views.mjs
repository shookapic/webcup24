// Captures the same set of portal views on a disposable local server (before / after the civic refactor).
// Usage: node tools/qa-a/capture-views.mjs <outDir>   (needs puppeteer-core)
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = process.argv[2] || join(root, 'docs', 'qa-captures', 'civic-before');
mkdirSync(out, { recursive: true });
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const dataDir = mkdtempSync(join(tmpdir(), 'terra-cap-'));
const port = 3200 + Math.floor(Math.random() * 10);
const base = `http://localhost:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'c.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_MIN_AGE_MS: '0', TN_FORM_LIMIT_SCALE: '1000' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const agentPw = /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', 'agent@cap.test', 'Agent Démonstration', 'agent'], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const adminPw = /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', 'admin@cap.test', 'Administration', 'admin'], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
await wait(1500);
let n = 0;
const call = async (path, method = 'GET', body, cookie = '') => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.60.0.${++n}`, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { data, cookie: (r.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0] };
};
const alice = (await call('/api/auth/register', 'POST', { name: 'Alice Démonstration', email: 'alice@cap.test', password: 'password-long-1' })).cookie;
const agent = (await call('/api/auth/login', 'POST', { email: 'agent@cap.test', password: agentPw })).cookie;
const admin = (await call('/api/auth/login', 'POST', { email: 'admin@cap.test', password: adminPw })).cookie;
const m1 = await call('/api/messages', 'POST', { kind: 'incident', subject: 'Lampadaire éteint rue de la Gare', body: 'Le lampadaire devant le numéro 12 de la rue de la Gare est éteint depuis lundi soir.', location: 'Rue de la Gare, Centre-ville', topic: 'voirie' }, alice);
await call('/api/messages', 'POST', { kind: 'contact', subject: 'Horaires du centre de santé', body: 'Quels sont les horaires du centre de santé le samedi matin ?', topic: 'sante' }, alice);
await call(`/api/messages/${m1.data.id}/replies`, 'POST', { body: 'Une équipe de la voirie passe demain matin.' }, agent);
await call(`/api/messages/${m1.data.id}`, 'PATCH', { status: 'in_progress' }, agent);
await call('/api/announcements', 'POST', { title: 'Séance publique du Haut Conseil', body: 'Le Haut Conseil tient une séance publique demain à 9 h, ouverte à tous les habitants.', sender: 'Haut Conseil' }, admin);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
async function shot(name, { width, height = 1000, cookie, hash = '', full = false, prepare }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.61.0.${++n}` });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('lang', 'fr'); } catch { /* blocked */ } });
  if (cookie) await page.setCookie({ name: 'tn_session', value: cookie.split('=')[1], url: base });
  await page.goto(base + '/' + hash, { waitUntil: 'networkidle0' });
  await wait(800);
  if (prepare) await prepare(page);
  await wait(500);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: full });
  await context.close();
}
await shot('01-home-desktop', { width: 1440 });
await shot('02-home-mobile', { width: 390, height: 844 });
await shot('03-services-desktop', { width: 1440, prepare: (p) => p.evaluate(() => document.querySelector('#services').scrollIntoView({ behavior: 'instant', block: 'start' })) });
await shot('04-citizen-workspace-desktop', { width: 1440, cookie: alice, prepare: (p) => p.evaluate(() => document.querySelector('#espace').scrollIntoView({ behavior: 'instant', block: 'start' })) });
await shot('05-citizen-message-history', { width: 1440, cookie: alice, prepare: (p) => p.evaluate(() => document.querySelector('#message-form').scrollIntoView({ behavior: 'instant', block: 'start' })) });
await shot('06-citizen-mobile', { width: 390, height: 844, cookie: alice, prepare: (p) => p.evaluate(() => document.querySelector('#espace').scrollIntoView({ behavior: 'instant', block: 'start' })) });
await shot('07-staff-workspace', { width: 1440, cookie: agent, prepare: (p) => p.evaluate(() => document.querySelector('#staff-area').scrollIntoView({ behavior: 'instant', block: 'start' })) });
await shot('08-staff-messages', { width: 1440, cookie: agent, prepare: (p) => p.evaluate(() => document.querySelector('#staff-messages-panel').scrollIntoView({ behavior: 'instant', block: 'start' })) });
await shot('09-participation-open', { width: 1440, hash: '#participation', prepare: (p) => p.evaluate(() => document.querySelector('#participation').scrollIntoView({ behavior: 'instant', block: 'start' })) });
await shot('10-orientation-open', { width: 1440, hash: '#orientation', prepare: (p) => p.evaluate(() => document.querySelector('#orientation').scrollIntoView({ behavior: 'instant', block: 'start' })) });
await shot('11-guide-and-news-mobile', { width: 390, height: 844, prepare: (p) => p.evaluate(() => document.querySelector('#debuter').scrollIntoView({ behavior: 'instant', block: 'start' })) });
await browser.close();
server.kill();
await wait(400);
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log('captures in', out);
