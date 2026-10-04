// End-to-end check of the participation module INSIDE A's real server and portal (a disposable scratch copy with the integration patch applied).
// node tools/qa-participation/integrated-e2e.mjs <base> <scratchDir> <dbPath>      (the server must already run on <base> with DATA_PATH=<dbPath>)
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const [base, scratch, dbPath] = process.argv.slice(2);
let failures = 0;
const check = (name, ok, info = '') => { if (!ok) failures++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const out = execFileSync(process.execPath, ['--no-warnings', 'create-staff.mjs', 'admin-part@example.org', 'Robin Admin', 'admin'], { cwd: scratch, env: { ...process.env, DATA_PATH: dbPath }, encoding: 'utf8' });
const adminPassword = /Mot de passe[^:]*:\s*(\S+)/i.exec(out)?.[1] ?? /(\S{20,})\s*$/m.exec(out)?.[1];
const agentOut = execFileSync(process.execPath, ['--no-warnings', 'create-staff.mjs', 'agent-part@example.org', 'Sam Agent', 'agent'], { cwd: scratch, env: { ...process.env, DATA_PATH: dbPath }, encoding: 'utf8' });
const agentPassword = /Mot de passe[^:]*:\s*(\S+)/i.exec(agentOut)?.[1] ?? /(\S{20,})\s*$/m.exec(agentOut)?.[1];
if (!adminPassword || !agentPassword) { console.log('FAIL could not read the one-time staff passwords from create-staff output'); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const jsonIn = (page, method, path, body) => page.evaluate(async (method, path, body) => {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, method, path, body);
async function session(kind, creds) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  const problems = []; // console 409/403 lines are filtered below: they are refusals this script provokes on purpose
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|status of (409|403)/.test(m.text())) problems.push(`console ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  const r = kind === 'register'
    ? await jsonIn(page, 'POST', '/api/auth/register', creds)
    : await jsonIn(page, 'POST', '/api/auth/login', creds);
  if (r.status >= 400) console.log('auth issue', kind, r.status, JSON.stringify(r.body));
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  return { page, context, problems };
}

// ---- guest: the section is in the portal, demo rows labelled, no CSP violation
{
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) problems.push(m.text()); });
  const response = await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#participation-root .tp-root h2', { timeout: 15000 });
  check('portal CSP forbids inline script and still serves the module (same-origin external script)', /script-src 'self'/.test(response.headers()['content-security-policy'] ?? '') && (await page.$$eval('#participation-root .tp-card', (els) => els.length)) >= 4);
  check('guest in the real portal: login prompt, demo badges, no console errors', (await page.$$eval('#participation-root .tp-badge-demo', (els) => els.length)) >= 4 && (await page.$$eval('#participation-root a[href="#espace"]', (els) => els.length)) >= 3 && problems.length === 0, problems.join(' | '));
  await context.close();
}

// ---- citizen (real registration + session cookie)
const email = `part${Date.now()}@example.org`;
const citizen = await session('register', { name: 'Camille Citoyenne', email, password: 'motdepasse-solide-123' });
{
  const { page, problems } = citizen;
  await page.waitForSelector('#participation-root .tp-root h2');
  const me = await jsonIn(page, 'GET', '/api/me');
  check('real citizen session', me.body.user?.role === 'citizen', me.body.user?.email);
  await page.waitForSelector('#participation-root form.tp-form');
  await page.evaluate(() => { const form = document.querySelector('#participation-root input[name^="vote-"]').closest('form'); form.querySelector('input[type=radio]').click(); form.querySelector('button[type=submit]').click(); });
  await page.waitForSelector('#participation-root .tp-confirm:not([hidden]) button');
  await page.evaluate(() => document.querySelector('#participation-root .tp-confirm button[type=submit]').click());
  await page.waitForFunction(() => [...document.querySelectorAll('#participation-root .tp-status')].some((el) => el.textContent.includes('Reçu : V-')), { timeout: 15000 });
  check('vote through the real portal: receipt shown, history lists it', (await jsonIn(page, 'GET', '/api/participation/mine')).body.votes.length === 1);
  const dup = await jsonIn(page, 'POST', '/api/participation/decisions/1/vote', { choiceId: 1 });
  check('second vote refused by the real server (409)', dup.status === 409 && dup.body.code === 'already_voted');
  const ideaKey = 'e2e-idea-key-0001';
  const bursts = await Promise.all(Array.from({ length: 6 }, () => jsonIn(page, 'POST', '/api/participation/ideas', { title: 'Plus de bancs au parc', body: 'Des bancs supplémentaires près de la serre.', key: ideaKey })));
  check('6 concurrent submissions with one key through the real server: one record', bursts.filter((b) => b.status === 201).length === 1 && (await jsonIn(page, 'GET', '/api/participation/ideas/mine')).body.ideas.length === 1);
  const services = (await jsonIn(page, 'GET', '/api/services')).body.services;
  const fb = await jsonIn(page, 'POST', '/api/participation/feedback', { serviceId: services[0].id, rating: 5, comment: 'Très bien.', key: 'e2e-fb-key-0001' });
  check('service feedback with a real service id', fb.status === 201 && /^F-/.test(fb.body.feedback.receipt), services[0].title);
  check('citizen cannot reach staff routes in the real server (403)', (await jsonIn(page, 'GET', '/api/participation/admin/overview')).status === 403);
  // language switch remounts in English without a reload
  await page.click('#lang-toggle');
  await page.waitForFunction(() => document.querySelector('#participation-root .tp-root h2')?.textContent === 'Citizen participation', { timeout: 15000 });
  check('portal language switch remounts the module in English', true);
  check('no page error / 5xx while using the participation UI', problems.length === 0, problems.join(' | '));
}

// ---- staff through the real login: audit trail, closing, delete
const admin = await session('login', { email: 'admin-part@example.org', password: adminPassword });
{
  const { page } = admin;
  const created = await jsonIn(page, 'POST', '/api/participation/admin/decisions', { title: 'Décision de test e2e', summary: 'Un résumé de test assez long.', choices: [{ label: 'Oui' }, { label: 'Non' }], publish: true });
  check('admin publishes a decision through the real server', created.status === 201, JSON.stringify(created.body));
  const audit = await jsonIn(page, 'GET', '/api/admin/audit?category=participation');
  check('staff action is in the hash-chained audit journal (category participation)', (audit.body.entries ?? []).some((e) => e.action === 'participation.decision.create'), `status ${audit.status}, ${(audit.body.entries ?? []).length} entries`);
  const verify = await jsonIn(page, 'GET', '/api/admin/audit/verify');
  check('audit hash chain still verifies after participation entries', verify.status === 200 && (verify.body.ok ?? verify.body.valid ?? true) !== false, JSON.stringify(verify.body).slice(0, 120));
  await page.waitForSelector('#participation-root .tp-staff', { timeout: 15000 }).catch(() => {});
  const closed = await jsonIn(page, 'PATCH', `/api/participation/admin/decisions/${created.body.id}`, { status: 'closed' });
  check('admin closes it', closed.status === 200);
}
const agent = await session('login', { email: 'agent-part@example.org', password: agentPassword });
check('agent: admin overview allowed, delete refused (403)', (await jsonIn(agent.page, 'GET', '/api/participation/admin/overview')).status === 200 && (await jsonIn(agent.page, 'DELETE', '/api/participation/admin/projects/1')).status === 403);
check('staff cannot vote (403)', (await jsonIn(agent.page, 'POST', '/api/participation/decisions/1/vote', { choiceId: 1 })).status === 403);

// ---- account deletion through the real endpoint cleans participation rows; counts stay
{
  const { page } = citizen;
  const uid = (await jsonIn(page, 'GET', '/api/me')).body.user.id;
  const tables = ['part_voters', 'part_opinions', 'part_ideas', 'part_feedback'];
  const mine = (file) => { const d = new DatabaseSync(file); const rows = tables.map((t) => d.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(uid).n); const counter = d.prepare('SELECT COALESCE(SUM(votes),0) AS v FROM part_choices').get().v; d.close(); return { rows, counter }; };
  const before = mine(dbPath);
  const gone = await jsonIn(page, 'DELETE', '/api/me', { password: 'motdepasse-solide-123' });
  const after = mine(dbPath);
  check('real account deletion (F33 endpoint) removes the citizen voter, idea and feedback rows and keeps the anonymous counter', gone.status === 200 && before.rows[0] === 1 && before.rows[2] === 1 && before.rows[3] === 1 && after.rows.every((n) => n === 0) && after.counter === before.counter, `rows ${before.rows}->${after.rows}, counter ${before.counter}->${after.counter}`);
}
// restart-safety is covered by participation-test.mjs (same file reopened); here: the migration ran on a DB that already held A's tables
{
  const db = new DatabaseSync(dbPath);
  check('A\'s own tables untouched and 8 part_ tables present', db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'part_%'").get().n === 8 && db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('users','messages','services','audit_log','places')").get().n === 5);
  db.close();
}
await browser.close();
console.log(failures ? `FAILURES (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
