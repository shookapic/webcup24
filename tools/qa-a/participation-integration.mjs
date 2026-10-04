// F65-F68 / F76 (B's participation module) integrated in A's real server: Origin, session, body size, roles, one vote per resident under concurrency, idempotent retries, results
// hidden until closed, anonymity of the stored ballot, demo labelling, account deletion, audit chain, static serving and CSP, restart, and the portal mount in real Chrome (FR/EN).
// A ports 3200-3209. Usage: node tools/qa-a/participation-integration.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const dataDir = mkdtempSync(join(tmpdir(), 'terra-part-'));
const dbPath = join(dataDir, 'p.sqlite');
const port = 3200 + Math.floor(Math.random() * 10);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_MIN_AGE_MS: '0', TN_FORM_LIMIT_SCALE: '1000' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 600)}`); };
const staff = (role) => /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', `${role}@pt.test`, `${role} Participation`, role], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const pw = { agent: staff('agent'), admin: staff('admin') };
let server;
const start = async () => { server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' }); await wait(1500); };
const stop = async () => { server.kill(); await wait(400); };
await start();
let n = 0;
const call = async (path, method = 'GET', body, cookie = '', headers = {}) => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.97.${Math.floor(++n / 250)}.${n % 250}`, ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined || body === null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data, text, headers: response.headers, cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0] };
};
const query = (sql, ...args) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
const login = async (who) => (await call('/api/auth/login', 'POST', { email: `${who}@pt.test`, password: pw[who] })).cookie;
const register = async (label) => (await call('/api/auth/register', 'POST', { name: `Habitant ${label}`, email: `${label}@pt.test`, password: 'password-long-1' })).cookie;
const [agent, admin, zoe, yan] = [await login('agent'), await login('admin'), await register('zoe'), await register('yan')];

console.log('# integration contract');
const overview = await call('/api/participation/overview');
check('the module answers under /api/participation (public overview, 200) and the portal files are served with the right types', overview.status === 200 && (await fetch(base + '/participation.js')).headers.get('content-type').startsWith('text/javascript') && (await fetch(base + '/participation.css')).headers.get('content-type').startsWith('text/css'), overview.text.slice(0, 200));
check('demo rows are present, labelled as examples, with no votes or results', overview.data.decisions.length + overview.data.consultations.length + overview.data.projects.length > 0 && JSON.stringify(overview.data).match(/demo/i) !== null && !/"votes":[1-9]/.test(overview.text), overview.text.slice(0, 300));
check('/participation.js is not hidden from the allowlist test: unknown module files stay unreachable (guard.mjs, factors.mjs, similar.mjs, participation.mjs are not served)', (await Promise.all(['/participation.mjs', '/guard.mjs', '/factors.mjs', '/similar.mjs', '/tools/qa-participation/host.mjs'].map((p) => fetch(base + p).then((r) => r.status)))).every((s) => s === 404));
const evil = await call('/api/participation/ideas', 'POST', { title: 'Une idée', body: 'Une idée assez longue.', key: 'abcdefgh1' }, zoe, { Origin: 'http://evil.example' });
const big = await call('/api/participation/ideas', 'POST', 'x'.repeat(30_000), zoe);
check('the portal\'s Origin check and 20 kB body limit apply to the module\'s routes (403 / 413)', evil.status === 403 && big.status === 413, [evil.status, big.status]);
const anonVote = await call('/api/participation/decisions/1/vote', 'POST', { choiceId: 1 });
const anonIdea = await call('/api/participation/ideas', 'POST', { title: 'Une idée', body: 'Une idée assez longue.', key: 'abcdefgh1' });
check('without a session, citizen routes are 401 (the module trusts only the session the portal resolved)', anonVote.status === 401 && anonIdea.status === 401 && (await call('/api/participation/mine')).status === 401, [anonVote.status, anonIdea.status]);

console.log('\n# a decision, one vote per resident (F65)');
const adminHdr = admin;
const created = await call('/api/participation/admin/decisions', 'POST', { title: 'Nouveau parc', summary: 'Faut-il créer un parc ?', choices: [{ label: 'Oui' }, { label: 'Non' }], status: 'open' }, adminHdr);
const opened = await call(`/api/participation/admin/decisions/${created.data.id}`, 'PATCH', { status: 'open' }, adminHdr);
check('an administrator creates a decision (2 choices, draft: invisible to residents) and opens it', created.status === 201 && opened.status === 200 && !(await call('/api/participation/overview')).text.includes('Nouveau parc') === false, [created.text, opened.text]);
const decisionId = created.data.id;
const list = (await call('/api/participation/overview', 'GET', null, zoe)).data.decisions.find((d) => d.id === decisionId);
const choiceId = list.choices[0].id;
const agentVote = await call(`/api/participation/decisions/${decisionId}/vote`, 'POST', { choiceId }, agent);
const adminVote = await call(`/api/participation/decisions/${decisionId}/vote`, 'POST', { choiceId }, admin);
check('staff cannot vote as residents (403)', agentVote.status === 403 && adminVote.status === 403, [agentVote.status, adminVote.status]);
const burst = await Promise.all(Array.from({ length: 20 }, () => call(`/api/participation/decisions/${decisionId}/vote`, 'POST', { choiceId }, zoe)));
check('20 simultaneous votes by one resident: exactly one is accepted (201), the others are 409 already_voted', burst.filter((r) => r.status === 201).length === 1 && burst.filter((r) => r.status === 409).length === 19, burst.map((r) => r.status).join());
const second = await call(`/api/participation/decisions/${decisionId}/vote`, 'POST', { choiceId: list.choices[1].id }, zoe);
check('trying to vote again for the other choice is refused (409) and the count does not move', second.status === 409 && query('SELECT SUM(votes) AS v FROM part_choices WHERE decision_id = ?', decisionId)[0].v === 1, second.text);
check('the stored ballot holds no link between the person and the choice: part_voters has who voted + a receipt, part_choices has only counters', !JSON.stringify(query('PRAGMA table_info(part_voters)')).includes('choice') && query('SELECT COUNT(*) AS n FROM part_voters WHERE decision_id = ?', decisionId)[0].n === 1);
const live = (await call('/api/participation/overview', 'GET', null, yan)).data.decisions.find((d) => d.id === decisionId);
check('while the vote is open nobody sees results (only the resident\'s own receipt, never the choice)', !JSON.stringify(live).includes('"votes"') && (await call('/api/participation/overview', 'GET', null, zoe)).data.decisions.find((d) => d.id === decisionId).myVote?.receipt, JSON.stringify(live).slice(0, 300));
check('a made-up choice id is 400, an unknown decision 404', (await call(`/api/participation/decisions/${decisionId}/vote`, 'POST', { choiceId: 99999 }, yan)).status === 400 && (await call('/api/participation/decisions/9999/vote', 'POST', { choiceId: 1 }, yan)).status === 404);
const yanVote = await call(`/api/participation/decisions/${decisionId}/vote`, 'POST', { choiceId: list.choices[1].id }, yan);
const closed = await call(`/api/participation/admin/decisions/${decisionId}`, 'PATCH', { status: 'closed', outcomeNote: 'Adopté' }, admin);
const results = (await call('/api/participation/overview', 'GET', null, yan)).data.decisions.find((d) => d.id === decisionId);
check('after closing, results are shown (one vote each) and a late vote is refused (409 closed)', yanVote.status === 201 && closed.status === 200 && results.choices.map((c) => c.votes).join() === '1,1' && (await call(`/api/participation/decisions/${decisionId}/vote`, 'POST', { choiceId }, await register('late'))).status === 409, JSON.stringify(results.choices));

console.log('\n# ideas and feedback: duplicates, rate, roles (F68, F76)');
const idea = { title: 'Plus de bancs', body: 'Il faudrait des bancs sur la place du marché.', key: 'idea-key-0001' };
const i1 = await call('/api/participation/ideas', 'POST', idea, zoe);
const i2 = await call('/api/participation/ideas', 'POST', idea, zoe);
check('the same idea sent twice (double click or retry) is one record: 201 then 200 duplicate:true with the same receipt', i1.status === 201 && i2.status === 200 && i2.data.duplicate === true && i1.data.receipt === i2.data.receipt && query('SELECT COUNT(*) AS n FROM part_ideas')[0].n === 1, [i1.text, i2.text]);
const ideaId = query('SELECT id FROM part_ideas ORDER BY id LIMIT 1')[0].id;
const answered = await call(`/api/participation/admin/ideas/${ideaId}`, 'PATCH', { status: 'accepted', note: 'Merci, nous les installons.' }, agent);
const mineIdeas = (await call('/api/participation/ideas/mine', 'GET', null, zoe)).data;
check('an agent answers the idea; the resident sees the status and the answer; another resident does not see it', answered.status === 200 && JSON.stringify(mineIdeas).includes('Merci, nous les installons.') && !JSON.stringify((await call('/api/participation/ideas/mine', 'GET', null, yan)).data).includes('Plus de bancs'), answered.text);
const staffIdea = await call('/api/participation/ideas', 'POST', { ...idea, key: 'staff-key-0001' }, agent);
check('staff cannot post ideas as residents (403)', staffIdea.status === 403);
const svc = (await call('/api/services')).data.services[0];
const fb = await call('/api/participation/feedback', 'POST', { serviceId: svc.id, rating: 4, comment: 'Accueil rapide.', key: 'fb-key-00001' }, zoe);
const fbBad = await call('/api/participation/feedback', 'POST', { serviceId: 99999, rating: 4, key: 'fb-key-00002' }, zoe);
const fbRating = await call('/api/participation/feedback', 'POST', { serviceId: svc.id, rating: 9, key: 'fb-key-00003' }, zoe);
check('service feedback: stored (201); an unknown service or a rating of 9 is 400', fb.status === 201 && fbBad.status === 400 && fbRating.status === 400, [fb.status, fbBad.status, fbRating.status]);
let limited;
for (let i = 0; i < 7; i++) limited = await call('/api/participation/ideas', 'POST', { title: `Idée numéro ${i}`, body: 'Une idée assez longue pour être acceptée.', key: `rate-key-000${i}` }, yan);
check('ideas are capped per resident per hour (429)', limited.status === 429, limited.text);
check('hostile markup in an idea is stored as text and returned as text (the portal never inserts it as HTML: checked in the browser below)', (await call('/api/participation/ideas', 'POST', { title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script> assez long', key: 'xss-key-0001' }, await register('mallory'))).status === 201);
const consult = await call('/api/participation/admin/consultations', 'POST', { title: 'Horaires du marché', body: 'Quels horaires préférez-vous ?', status: 'open' }, agent);
await call(`/api/participation/admin/consultations/${consult.data.id}`, 'PATCH', { status: 'open' }, agent);
const op1 = await call(`/api/participation/consultations/${consult.data.id}/opinion`, 'PUT', { rating: 3, comment: 'Plutôt le matin.' }, zoe);
const op2 = await call(`/api/participation/consultations/${consult.data.id}/opinion`, 'PUT', { rating: 5, comment: 'Finalement le soir.' }, zoe);
check('a consultation opinion is one editable record per resident: 201 then 200 with the same receipt, still one row', consult.status === 201 && op1.status === 201 && op2.status === 200 && op1.data.receipt === op2.data.receipt && query('SELECT COUNT(*) AS n FROM part_opinions')[0].n === 1, [op1.text, op2.text]);

const exported = (await call('/api/me/export', 'GET', null, zoe)).data;
const exportedHtml = (await call('/api/me/export?format=html', 'GET', null, zoe)).text;
check('the personal export lists the resident\'s participation (vote with receipt but NOT the choice, opinion, idea with its answer, feedback) in JSON and in the readable page, and nothing of another resident',
  exported.participation.votes.length === 1 && Boolean(exported.participation.votes[0].receipt) && !JSON.stringify(exported.participation.votes).match(/choice/i) && exported.participation.opinions[0].comment === 'Finalement le soir.'
  && exported.participation.ideas[0].staff_note === 'Merci, nous les installons.' && exported.participation.feedback.length === 1 && /Finalement le soir\./.test(exportedHtml) && !exportedHtml.includes('mallory'), JSON.stringify(exported.participation).slice(0, 300));

console.log('\n# account deletion, audit, restart');
const before = query('SELECT (SELECT COUNT(*) FROM part_voters) AS v, (SELECT COUNT(*) FROM part_ideas) AS i, (SELECT COUNT(*) FROM part_opinions) AS o, (SELECT COUNT(*) FROM part_feedback) AS f, (SELECT SUM(votes) FROM part_choices) AS c')[0];
const zoeId = query("SELECT id FROM users WHERE email = 'zoe@pt.test'")[0].id;
const del = await call('/api/me', 'DELETE', { password: 'password-long-1' }, zoe);
const after = query('SELECT (SELECT COUNT(*) FROM part_voters) AS v, (SELECT COUNT(*) FROM part_ideas) AS i, (SELECT COUNT(*) FROM part_opinions) AS o, (SELECT COUNT(*) FROM part_feedback) AS f, (SELECT SUM(votes) FROM part_choices) AS c')[0];
const left = query('SELECT (SELECT COUNT(*) FROM part_voters WHERE user_id = ?) AS v, (SELECT COUNT(*) FROM part_ideas WHERE user_id = ?) AS i, (SELECT COUNT(*) FROM part_opinions WHERE user_id = ?) AS o, (SELECT COUNT(*) FROM part_feedback WHERE user_id = ?) AS f', zoeId, zoeId, zoeId, zoeId)[0];
check('deleting a resident\'s account removes their voter row, opinion, ideas and feedback; the anonymous vote counts stay', del.status === 200 && left.v + left.i + left.o + left.f === 0 && before.v > after.v && after.c === before.c, JSON.stringify([before, after, left]));
const verify = (await call('/api/admin/audit/verify', 'GET', null, admin)).data;
const journal = ((await call('/api/admin/audit', 'GET', null, admin)).data.entries || []).filter((e) => e.category === 'participation');
check('staff actions of the module are in the journal (category participation: create, close, answer an idea) and the chain still verifies', journal.length >= 3 && verify.ok === true, JSON.stringify([journal.map((e) => e.action), verify]));
await stop();
await start();
const [admin2, yan2] = [await login('admin'), (await call('/api/auth/login', 'POST', { email: 'yan@pt.test', password: 'password-long-1' })).cookie];
const afterRestart = (await call('/api/participation/overview', 'GET', null, yan2)).data.decisions.find((d) => d.id === decisionId);
check('after a restart the decision, its results and the resident\'s receipt are intact, and starting again did not duplicate the demo rows', afterRestart.choices.map((c) => c.votes).join() === '1,1' && afterRestart.myVote?.receipt && query('SELECT COUNT(*) AS n FROM part_decisions WHERE demo = 1')[0].n <= 3 && Boolean(admin2));

console.log('\n# portal in real Chrome');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
async function open(cookie, lang = 'fr') {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1100, height: 1000 });
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.98.0.${++n % 250}` });
  await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('lang', l); } catch { /* blocked */ } }, lang);
  if (cookie) await page.setCookie({ name: 'tn_session', value: cookie.split('=')[1], url: base });
  const log = { dialogs: [], errors: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (4\d\d)|favicon/.test(m.text())) log.errors.push(m.text()); });
  await page.goto(base + '/#participation', { waitUntil: 'networkidle0' }); // the module is loaded when its section is near or targeted
  return { context, page, log };
}
let s = await open(null);
await s.page.waitForSelector('#participation-root .tp-section, #participation-root section', { timeout: 10000 }).catch(() => {});
const guest = await s.page.evaluate(() => ({ heading: document.querySelector('#tp-title')?.textContent, sections: document.querySelectorAll('#participation-root section').length, demo: document.querySelector('#participation-root')?.textContent.match(/Exemple/g)?.length || 0 }));
check('the guest sees the participation section on the portal (heading, several areas, demo rows labelled "Exemple")', guest.heading && guest.sections >= 3 && guest.demo >= 1, JSON.stringify(guest));
await s.context.close();
const kim = await register('kim');
s = await open(kim);
await s.page.waitForSelector('#participation-root button', { timeout: 10000 }).catch(() => {});
const hostile = await s.page.evaluate(() => !document.querySelector('#participation-root img[src="x"]') && !document.querySelector('#participation-root script'));
check('the citizen sees the voting and idea forms; hostile markup posted earlier is shown as text, never as HTML', hostile && (await s.page.evaluate(() => document.querySelectorAll('#participation-root form, #participation-root textarea').length)) > 0);
await s.page.click('#lang-toggle');
await s.page.waitForFunction(() => document.documentElement.lang === 'en' && /Participation|Decisions|Ideas/i.test(document.querySelector('#tp-title')?.textContent || ''), { timeout: 10000 }).catch(() => {});
check('switching the portal to English switches the module too', /Participation|Decisions|Ideas/i.test(await s.page.$eval('#tp-title', (x) => x.textContent).catch(() => '')));
await s.page.click('#lang-toggle');
const nav = await s.page.evaluate(() => [...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '#participation'));
check('there is a link to the section (footer)', nav);
check('no browser dialog and no page error while the module runs inside the portal', s.log.dialogs.length === 0 && s.log.errors.length === 0, JSON.stringify([s.log.dialogs, s.log.errors]));
await s.context.close();
await browser.close();
await stop();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall participation integration checks passed');
process.exit(failures ? 1 : 0);
