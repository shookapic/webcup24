// F70: administrative data reserved to authorized agents: the role gates say who the area is for (401 / 403 with a plain message), and an administrator can give each agent
// a perimeter of services; requests outside it are neither listed, counted, reachable (404) nor visible in that agent's journal. API level, disposable server and database.
// A ports 3200-3209. Usage: node tools/qa-a/scoping.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'terra-scope-'));
const dbPath = join(dataDir, 's.sqlite');
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_MIN_AGE_MS: '0', TN_FORM_LIMIT_SCALE: '1000' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 600)}`); };
const staff = (email, role) => /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', `${email}@sc.test`, `${email} Périmètre`, role], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const pw = { a1: staff('a1', 'agent'), a2: staff('a2', 'agent'), admin: staff('admin', 'admin') };
let server;
const start = async () => { server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' }); await wait(1500); };
const stop = async () => { server.kill(); await wait(400); };
await start();
let counter = 0;
const call = async (path, method = 'GET', body, cookie = '') => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.96.0.${++counter % 250}`, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data, text, cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0] };
};
const query = (sql, ...args) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
const login = async (who) => (await call('/api/auth/login', 'POST', { email: `${who}@sc.test`, password: pw[who] })).cookie;
const [a1, a2, admin] = [await login('a1'), await login('a2'), await login('admin')];
const zoe = (await call('/api/auth/register', 'POST', { name: 'Zoé Périmètre', email: 'zoe@sc.test', password: 'password-long-1' })).cookie;
const service = async (title) => (await call('/api/services', 'POST', { title, description: `Description du service ${title}`, details: `Informations détaillées du service ${title}, ouvert au public.` }, admin)).data.id;
const [svcA, svcB] = [await service('Service Santé'), await service('Service Voirie')];
const send = async (subject, serviceId) => (await call('/api/messages', 'POST', { subject, body: `Texte de la demande « ${subject} », assez long pour être valide.`, kind: 'contact', ...(serviceId ? { service_id: serviceId } : {}) }, zoe)).data.id;
const [mA, mB, mNone] = [await send('Question de santé', svcA), await send('Problème de voirie', svcB), await send('Question générale', null)];
const ids = async (cookie) => (await call('/api/messages', 'GET', null, cookie)).data.messages.map((m) => m.id).sort((x, y) => x - y);

console.log('# who the area is for');
const resident403 = await call('/api/admin/dashboard', 'GET', null, zoe);
const agent403 = await call('/api/admin/agents', 'GET', null, a1);
check('anonymous is told to sign in (401); a resident is told the area is for authorized agents (403); an agent is told an admin area is for administrators (403)', (await call('/api/admin/dashboard')).status === 401 && resident403.status === 403 && resident403.data.error === 'Accès réservé aux agents autorisés.' && agent403.status === 403 && agent403.data.error === 'Accès réservé aux administrateurs.', [resident403.text, agent403.text]);
check('with no perimeter set, every agent and the administrator see all three requests (the behaviour of every account that existed before)', JSON.stringify(await ids(a1)) === JSON.stringify([mA, mB, mNone]) && JSON.stringify(await ids(admin)) === JSON.stringify([mA, mB, mNone]));

console.log('\n# giving an agent a perimeter');
const a1Id = query("SELECT id FROM users WHERE email = 'a1@sc.test'")[0].id;
const adminId = query("SELECT id FROM users WHERE email = 'admin@sc.test'")[0].id;
const zoeId = query("SELECT id FROM users WHERE email = 'zoe@sc.test'")[0].id;
check('the list of agents with their perimeters is for administrators only (agent 403, resident 403)', (await call('/api/admin/agents', 'GET', null, admin)).data.agents.length === 2 && (await call('/api/admin/agents', 'GET', null, a2)).status === 403 && (await call('/api/admin/agents', 'GET', null, zoe)).status === 403);
const bad = [[{ services: 'x' }, 400], [{ services: [svcA, 'b'] }, 400], [{ services: [999] }, 400], [{ services: [1.5] }, 400], [{}, 400]];
const badResults = await Promise.all(bad.map(([body]) => call(`/api/admin/agents/${a1Id}/scope`, 'PUT', body, admin)));
check('an invalid perimeter (not a list, not integers, unknown service, missing) is 400 and nothing changes', badResults.every((r, i) => r.status === bad[i][1]) && query('SELECT COUNT(*) AS n FROM agent_scopes')[0].n === 0, badResults.map((r) => r.status));
check('only an administrator can set it (agent 403, resident 403, anonymous 401); an administrator or a resident is not an agent (404)', (await call(`/api/admin/agents/${a1Id}/scope`, 'PUT', { services: [svcA] }, a2)).status === 403 && (await call(`/api/admin/agents/${a1Id}/scope`, 'PUT', { services: [svcA] }, zoe)).status === 403 && (await call(`/api/admin/agents/${a1Id}/scope`, 'PUT', { services: [svcA] })).status === 401
  && (await call(`/api/admin/agents/${adminId}/scope`, 'PUT', { services: [svcA] }, admin)).status === 404 && (await call(`/api/admin/agents/${zoeId}/scope`, 'PUT', { services: [svcA] }, admin)).status === 404);
const set = await call(`/api/admin/agents/${a1Id}/scope`, 'PUT', { services: [svcA, svcA] }, admin);
check('the administrator limits agent 1 to the Santé service (duplicates ignored): 200 and the list of agents shows it', set.status === 200 && JSON.stringify(set.data.services) === JSON.stringify([svcA]) && (await call('/api/admin/agents', 'GET', null, admin)).data.agents.find((a) => a.id === a1Id).services.join() === String(svcA), set.text);

console.log('\n# what a limited agent can reach');
const list = (await call('/api/messages', 'GET', null, a1)).data;
check('the limited agent lists the Santé request and the request with no service, not the Voirie one; the answer says the perimeter and names its services', JSON.stringify(list.messages.map((m) => m.id).sort((x, y) => x - y)) === JSON.stringify([mA, mNone]) && list.scope.limited === true && list.scope.services.length === 1 && list.scope.services[0].title === 'Service Santé', JSON.stringify(list.scope));
check('the other agent and the administrator still see everything, and say they are not limited', JSON.stringify(await ids(a2)) === JSON.stringify([mA, mB, mNone]) && JSON.stringify(await ids(admin)) === JSON.stringify([mA, mB, mNone]) && (await call('/api/messages', 'GET', null, a2)).data.scope.limited === false);
const status = await call(`/api/messages/${mB}`, 'PATCH', { status: 'in_progress' }, a1);
const reply = await call(`/api/messages/${mB}/replies`, 'POST', { body: 'Une réponse hors périmètre.' }, a1);
const prio = await call(`/api/messages/${mB}/priority`, 'PUT', { priority: 'urgent' }, a1);
const unknownLike = await call('/api/messages/999999', 'PATCH', { status: 'in_progress' }, a1);
check('a request outside the perimeter cannot be changed, answered or prioritised: 404 "Message introuvable", the same answer as for a request that does not exist; nothing changed', [status, reply, prio].every((r) => r.status === 404 && r.data.error === unknownLike.data.error)
  && query('SELECT status, priority FROM messages WHERE id = ?', mB)[0].status === 'new' && query('SELECT status, priority FROM messages WHERE id = ?', mB)[0].priority === 'normal' && query('SELECT COUNT(*) AS n FROM message_replies WHERE message_id = ?', mB)[0].n === 0, [status.status, reply.status, prio.status]);
const inside = [await call(`/api/messages/${mA}`, 'PATCH', { status: 'in_progress' }, a1), await call(`/api/messages/${mA}/replies`, 'POST', { body: 'Une réponse dans le périmètre.' }, a1), await call(`/api/messages/${mNone}/priority`, 'PUT', { priority: 'high' }, a1)];
check('inside the perimeter everything works as before (status 200, reply 201, priority 200)', inside.every((r) => [200, 201].includes(r.status)), inside.map((r) => r.status + ' ' + r.text));
const dashA1 = (await call('/api/admin/dashboard', 'GET', null, a1)).data.messages;
const dashA2 = (await call('/api/admin/dashboard', 'GET', null, a2)).data.messages;
check('the dashboard counts only what the limited agent may see (2 requests, not 3); the others count 3', dashA1.new + dashA1.in_progress + dashA1.resolved === 2 && dashA2.new + dashA2.in_progress + dashA2.resolved === 3 && dashA1.received_today === 2 && dashA2.received_today === 3, JSON.stringify([dashA1, dashA2]));

console.log('\n# the journal');
await call(`/api/messages/${mB}`, 'PATCH', { status: 'in_progress' }, a2);
const journalA1 = await call('/api/admin/audit', 'GET', null, a1);
const journalA2 = await call('/api/admin/audit', 'GET', null, a2);
const csvA1 = await fetch(`${base}/api/admin/audit?format=csv`, { headers: { Cookie: a1 } }).then((r) => r.text());
check('the journal of the limited agent hides the lines about the Voirie request (page and CSV); the other agent sees them; both see their own and the scope line is journalled for administrators',
  !JSON.stringify(journalA1.data.entries).includes('Problème de voirie') && !csvA1.includes('Problème de voirie') && JSON.stringify(journalA2.data.entries).includes('Problème de voirie') && JSON.stringify(journalA1.data.entries).includes('Question de santé')
  && ((await call('/api/admin/audit', 'GET', null, admin)).data.entries || []).some((e) => e.action === 'agent.scope' && /Service Santé/.test(e.summary)), JSON.stringify(journalA1.data.entries.map((e) => e.summary)).slice(0, 300));
check('the resident is unaffected: still sees and owns all three of their requests', (await call('/api/messages', 'GET', null, zoe)).data.messages.length === 3);

console.log('\n# restart and clearing');
await stop();
await start();
const a1After = await login('a1');
check('the perimeter survives a restart', JSON.stringify(await ids(a1After)) === JSON.stringify([mA, mNone]));
await call(`/api/admin/agents/${a1Id}/scope`, 'PUT', { services: [] }, admin);
check('an empty list gives the agent everything back, and says so', JSON.stringify(await ids(a1After)) === JSON.stringify([mA, mB, mNone]) && (await call('/api/messages', 'GET', null, a1After)).data.scope.limited === false);
await call(`/api/admin/agents/${a1Id}/scope`, 'PUT', { services: [svcB] }, admin);
// no route deletes a service today; if one is added, the foreign key must clear the perimeter (checked at database level, foreign keys on)
const svcC = await service('Service sans demande');
await call(`/api/admin/agents/${a1Id}/scope`, 'PUT', { services: [svcC] }, admin);
{ const db = new DatabaseSync(dbPath); db.exec('PRAGMA foreign_keys = ON'); db.prepare('DELETE FROM services WHERE id = ?').run(svcC); const left = db.prepare('SELECT COUNT(*) AS n FROM agent_scopes WHERE service_id = ?').get(svcC).n; db.close(); check('deleting a service (database level) leaves no orphan perimeter row', left === 0, left); }

await stop();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall scoping checks passed');
process.exit(failures ? 1 : 0);
