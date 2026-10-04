// F79 (themes: sort / filter requests and reports by subject), F80 (priorities) and F75 (similar requests grouped for agents): API-level checks on a disposable
// server and database, with roles, validation, existing-data migration and persistence across a restart. A ports 3200-3209.
// Usage: node tools/qa-a/triage-api.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'terra-triage-'));
const dbPath = join(dataDir, 't.sqlite');
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_MIN_AGE_MS: '0', TN_FORM_LIMIT_SCALE: '1000' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 600)}`); };

const staffPassword = (role) => /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', `${role}@tri.test`, `${role} Tri`, role], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const agentPw = staffPassword('agent');
const adminPw = staffPassword('admin');
let server;
const start = async () => { server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' }); await wait(1500); };
const stop = async () => { server.kill(); await wait(400); };
await start();
let counter = 0;
const call = async (path, method = 'GET', body, cookie = '') => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.91.${Math.floor(++counter / 250)}.${counter % 250}`, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0] };
};
const query = (sql, ...args) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
const register = async (label) => (await call('/api/auth/register', 'POST', { name: `Habitant ${label}`, email: `${label}@tri.test`, password: 'password-long-1' })).cookie;
const send = async (cookie, subject, extra = {}) => call('/api/messages', 'POST', { subject, body: `Le texte de la demande « ${subject} » est assez long pour être valide.`, kind: 'contact', ...extra }, cookie);
const zoe = await register('zoe');
const yan = await register('yan');
const agent = (await call('/api/auth/login', 'POST', { email: 'agent@tri.test', password: agentPw })).cookie;
const admin = (await call('/api/auth/login', 'POST', { email: 'admin@tri.test', password: adminPw })).cookie;

console.log('# F79. themes');
const list = await call('/api/topics');
check('GET /api/topics is public and lists the themes with a French and an English name', list.status === 200 && list.data.topics.length >= 8 && list.data.topics.every((x) => /^[a-z]+$/.test(x.code) && x.fr && x.en) && list.data.topics.some((x) => x.code === 'autre'), JSON.stringify(list.data).slice(0, 200));
// a request that existed before themes (no topic column value)
const legacy = await send(zoe, 'Ancienne demande sans thème');
query('SELECT 1');
{ const db = new DatabaseSync(dbPath); db.prepare('UPDATE messages SET topic = NULL WHERE id = ?').run(legacy.data.id); db.close(); }
const water = await send(zoe, 'Coupure d’eau rue du Marché', { topic: 'eau' });
const road = await send(yan, 'Lampadaire éteint avenue du Centre', { topic: 'voirie', kind: 'incident', location: 'Avenue du Centre, Centre-ville' });
const dflt = await send(yan, 'Question sans thème choisi');
check('a request sent with a theme keeps it; one sent without gets "autre"', water.status === 201 && dflt.status === 201 && query('SELECT topic FROM messages WHERE id = ?', water.data.id)[0].topic === 'eau' && query('SELECT topic FROM messages WHERE id = ?', dflt.data.id)[0].topic === 'autre');
const bad = await send(zoe, 'Thème inventé par un script', { topic: 'nimporte-quoi' });
const injection = await send(zoe, 'Thème avec injection SQL', { topic: "eau'; DROP TABLE messages;--" });
const wrongType = await send(zoe, 'Thème qui est un objet', { topic: { code: 'eau' } });
check('an unknown, injected or non-text theme is refused (400, nothing stored)', bad.status === 400 && injection.status === 400 && wrongType.status === 400 && /Sujet invalide|Thème invalide/.test(bad.data.error) && query("SELECT COUNT(*) AS n FROM messages WHERE subject LIKE 'Thème %'")[0].n === 0, JSON.stringify([bad.data, injection.status, wrongType.status]));
const mine = (await call('/api/messages', 'GET', null, zoe)).data.messages;
check('the resident list carries the theme (null for a request that predates themes)', mine.find((x) => x.id === water.data.id).topic === 'eau' && mine.find((x) => x.id === legacy.data.id).topic === null, JSON.stringify(mine.map((x) => x.topic)));
const staffList = (await call('/api/messages', 'GET', null, agent)).data.messages;
check('the staff list carries the theme of every request', staffList.find((x) => x.id === road.data.id).topic === 'voirie' && staffList.length === 4, JSON.stringify(staffList.map((x) => x.topic)));
const published = await call(`/api/messages/${road.data.id}/public`, 'POST', { consent: true, public_title: 'Lampadaire éteint', public_summary: 'Un lampadaire de l’avenue du Centre est éteint depuis trois jours.', district: 'Centre-ville' }, yan);
const reports = (await call('/api/public-requests', 'GET', null, zoe)).data.requests;
check('a published report shows the theme of the request it comes from', published.status === 201 && reports.length === 1 && reports[0].topic === 'voirie', JSON.stringify([published.status, reports]));

console.log('\n# existing data and restart');
await stop();
await start();
const after = (await call('/api/messages', 'GET', null, zoe)).data.messages;
check('themes survive a restart; the old request is still without theme (no data rewritten at startup)', after.find((x) => x.id === water.data.id).topic === 'eau' && after.find((x) => x.id === legacy.data.id).topic === null);

await stop();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall triage API checks passed');
process.exit(failures ? 1 : 0);
