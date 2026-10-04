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

console.log('\n# F80. priorities');
const priorityOf = (id) => query('SELECT priority FROM messages WHERE id = ?', id)[0].priority;
const staffView = async (cookie = agent) => (await call('/api/messages', 'GET', null, cookie)).data.messages;
check('every request is "normal" at first, the legacy one included (additive column with a default), and the column cannot be empty', priorityOf(water.data.id) === 'normal' && priorityOf(legacy.data.id) === 'normal' && query("SELECT \"notnull\" AS nn, dflt_value AS d FROM pragma_table_info('messages') WHERE name = 'priority'")[0].nn === 1);
const stamp = query('SELECT updated_at FROM messages WHERE id = ?', water.data.id)[0].updated_at;
const noticesBefore = query('SELECT COUNT(*) AS n FROM notices')[0].n;
const anonymous = await call(`/api/messages/${water.data.id}/priority`, 'PUT', { priority: 'urgent' });
const asResident = await call(`/api/messages/${water.data.id}/priority`, 'PUT', { priority: 'urgent' }, zoe);
check('only staff set a priority: anonymous gets 401, the resident who owns the request gets 403, nothing changes', anonymous.status === 401 && asResident.status === 403 && priorityOf(water.data.id) === 'normal', JSON.stringify([anonymous.status, asResident.status]));
const invalid = [await call(`/api/messages/${water.data.id}/priority`, 'PUT', { priority: 'critical' }, agent), await call(`/api/messages/${water.data.id}/priority`, 'PUT', { priority: ['urgent'] }, agent), await call(`/api/messages/${water.data.id}/priority`, 'PUT', { priority: '__proto__' }, agent), await call(`/api/messages/${water.data.id}/priority`, 'PUT', {}, agent)];
const unknown = await call('/api/messages/99999/priority', 'PUT', { priority: 'urgent' }, agent);
check('an invalid priority (unknown word, array, "__proto__", missing) is 400 and an unknown request is 404, nothing changes', invalid.every((x) => x.status === 400) && unknown.status === 404 && priorityOf(water.data.id) === 'normal', JSON.stringify([invalid.map((x) => x.status), unknown.status]));
const set = await call(`/api/messages/${water.data.id}/priority`, 'PUT', { priority: 'urgent' }, agent);
check('an agent sets "urgent": 200, stored, the resident\'s last-update time and notices are untouched (the priority is internal)', set.status === 200 && set.data.changed === true && priorityOf(water.data.id) === 'urgent' && query('SELECT updated_at FROM messages WHERE id = ?', water.data.id)[0].updated_at === stamp && query('SELECT COUNT(*) AS n FROM notices')[0].n === noticesBefore, JSON.stringify(set.data));
const again = await call(`/api/messages/${water.data.id}/priority`, 'PUT', { priority: 'urgent' }, agent);
const journal = (await call('/api/admin/audit', 'GET', null, agent)).data;
const entries = (journal.entries || []).filter((e) => e.action === 'message.priority');
check('the same priority again changes nothing and is not journalled twice; the one entry says who, which request and from/to', again.status === 200 && again.data.changed === false && entries.length === 1 && /Agent Tri|agent Tri/.test(entries[0].actor_name || entries[0].actor || '') && /Coupure d’eau/.test(entries[0].summary) && /urgente/.test(entries[0].summary), JSON.stringify(entries).slice(0, 400));
await call(`/api/messages/${road.data.id}/priority`, 'PUT', { priority: 'high' }, admin);
const listed = await staffView();
const stripped = await staffView(admin);
const mineAfter = (await call('/api/messages', 'GET', null, zoe)).data.messages;
const receiptJson = (await call(`/api/messages/${water.data.id}/receipt?format=json`, 'GET', null, zoe)).data;
const publicList = (await call('/api/public-requests', 'GET', null, zoe)).data.requests;
check('staff see the priority of every request; the resident list, the receipt and the public reports never carry it', listed.find((x) => x.id === water.data.id).priority === 'urgent' && stripped.find((x) => x.id === road.data.id).priority === 'high' && listed.find((x) => x.id === dflt.data.id).priority === 'normal'
  && mineAfter.every((x) => !('priority' in x)) && !JSON.stringify(receiptJson).includes('priority') && publicList.every((x) => !('priority' in x)), JSON.stringify([mineAfter[0], publicList[0]]));
const dash = (await call('/api/admin/dashboard', 'GET', null, agent)).data;
check('the dashboard counts urgent and high-priority requests that are not resolved', dash.messages.urgent_open === 1 && dash.messages.high_open === 1, JSON.stringify(dash.messages).slice(0, 300));
await call(`/api/messages/${water.data.id}`, 'PATCH', { status: 'resolved' }, agent);
const dashResolved = (await call('/api/admin/dashboard', 'GET', null, agent)).data;
check('a resolved request no longer counts as urgent work (but keeps its priority for the record)', dashResolved.messages.urgent_open === 0 && priorityOf(water.data.id) === 'urgent', JSON.stringify(dashResolved.messages).slice(0, 200));

console.log('\n# F75. similar requests');
const mk = async (cookie, subject, body, extra = {}) => (await call('/api/messages', 'POST', { subject, body, kind: 'incident', location: 'Centre-ville', ...extra }, cookie)).data.id;
const lamp1 = await mk(zoe, 'Lampadaire éteint rue de la Gare', 'Le lampadaire devant le numéro 12 de la rue de la Gare est éteint depuis lundi soir.', { topic: 'voirie' });
const lamp2 = await mk(yan, 'Plus d’éclairage, lampadaire de la Gare', 'Depuis mardi le lampadaire de la rue de la Gare ne s’allume plus, c’est dangereux le soir.', { topic: 'voirie' });
const lamp3 = await mk(zoe, 'Lampadaires éteints près de la gare', 'Deux lampadaires éteints près de la gare, rue de la Gare, la nuit on ne voit rien du tout.', { topic: 'securite' });
const leak1 = await mk(yan, 'Fuite d’eau sur la place du Marché', 'Une grosse fuite d’eau coule sur la place du Marché depuis ce matin.', { topic: 'eau' });
const leak2 = await mk(zoe, 'Grosse fuite d’eau au Marché', 'Il y a une fuite d’eau importante sur la place du Marché, l’eau envahit le trottoir.', { topic: 'eau' });
const hours = await mk(yan, 'Horaires de la mairie', 'Quels sont les horaires d’ouverture de la mairie le samedi matin ?', { kind: 'contact' });
const card = await mk(zoe, 'Carte de transport pour mon enfant', 'Comment obtenir une carte de transport pour mon enfant qui entre au collège ?', { kind: 'contact' });
const view = (await call('/api/messages', 'GET', null, agent)).data;
const groupOf = (id) => view.groups.find((g) => g.ids.includes(id));
const lampGroup = groupOf(lamp1);
const leakGroup = groupOf(leak1);
check('staff get the requests that talk about the same problem grouped: three lamp reports in one group, two leaks in another (different wording, same words)',
  lampGroup && JSON.stringify(lampGroup.ids) === JSON.stringify([lamp1, lamp2, lamp3]) && leakGroup && JSON.stringify(leakGroup.ids) === JSON.stringify([leak1, leak2]) && lampGroup.id !== leakGroup.id, JSON.stringify(view.groups));
check('unrelated questions are not grouped with anything', !groupOf(hours) && !groupOf(card) && view.messages.find((m) => m.id === hours).group === null, JSON.stringify([groupOf(hours), groupOf(card)]));
check('a group says its size, how many are not resolved, how many different residents, the most common theme, a sample subject and the words in common', lampGroup.size === 3 && lampGroup.open === 3 && lampGroup.residents === 2 && lampGroup.topic === 'voirie' && lampGroup.subject === 'Lampadaire éteint rue de la Gare' && lampGroup.shared.some((w) => /^lampadaire/.test(w)) && lampGroup.shared.includes('gare'), JSON.stringify(lampGroup));
check('every request carries the id of its group (the smallest id in it) so the list can be narrowed to it', view.messages.find((m) => m.id === lamp3).group === lamp1 && view.messages.find((m) => m.id === leak2).group === leak1);
const residentView = (await call('/api/messages', 'GET', null, zoe)).data;
check('residents get no grouping at all (not the groups, not another resident\'s request)', !('groups' in residentView) && residentView.messages.every((m) => !('group' in m)) && residentView.messages.every((m) => m.id !== lamp2), JSON.stringify(Object.keys(residentView)));
await call(`/api/messages/${lamp1}`, 'PATCH', { status: 'resolved' }, agent);
await call(`/api/messages/${lamp2}`, 'PATCH', { status: 'resolved' }, agent);
const after2 = (await call('/api/messages', 'GET', null, agent)).data;
const lampAfter = after2.groups.find((g) => g.ids.includes(lamp1));
check('resolving requests lowers the group\'s "open" count but keeps the group (an agent can still see the history); groups are listed by open count first', lampAfter.size === 3 && lampAfter.open === 1 && after2.groups[0].open >= after2.groups[after2.groups.length - 1].open, JSON.stringify(after2.groups.map((g) => [g.id, g.size, g.open])));
// volume: 1500 more requests written straight into the disposable database, a poll must stay quick
{
  const db = new DatabaseSync(dbPath);
  const userId = db.prepare("SELECT id FROM users WHERE email = 'zoe@tri.test'").get().id;
  const subjects = ['Poubelle', 'Bruit', 'Parking', 'Arbre', 'Banc', 'Fontaine', 'Passage', 'Graffiti', 'Trottoir', 'Feu', 'Jardin', 'École', 'Bus', 'Piscine', 'Marché', 'Pont', 'Escalier', 'Cantine', 'Chantier', 'Boîte'];
  const insert = db.prepare("INSERT INTO messages (user_id, subject, body, kind, location, topic, fingerprint) VALUES (?, ?, ?, 'incident', ?, 'autre', ?)");
  db.exec('BEGIN');
  for (let i = 0; i < 1500; i++) insert.run(userId, `${subjects[i % 20]} numéro ${i} à surveiller`, `Le ${subjects[(i * 7) % 20].toLowerCase()} situé au ${i} rue ${subjects[(i * 3) % 20].toLowerCase()} pose un souci particulier depuis ${i % 30} jours.`, `Quartier ${i % 5}`, `bulk${i}`);
  db.exec('COMMIT');
  db.close();
}
const started = Date.now();
const big = await call('/api/messages', 'GET', null, agent);
const firstMs = Date.now() - started;
const started2 = Date.now();
await call('/api/messages', 'GET', null, agent);
const secondMs = Date.now() - started2;
check(`with 1500 more requests a staff poll still answers fast (first ${firstMs} ms, next ${secondMs} ms; the limit asserted is 3 s) and the earlier groups are intact`, big.status === 200 && firstMs < 3000 && secondMs < 3000 && big.data.messages.length > 1500 && big.data.groups.some((g) => g.ids.includes(leak1) && g.ids.includes(leak2)), JSON.stringify([big.status, firstMs, secondMs]));

console.log('\n# existing data and restart');
await stop();
await start();
const after = (await call('/api/messages', 'GET', null, zoe)).data.messages;
check('themes and priorities survive a restart; the old request is still without theme (no data rewritten at startup)', after.find((x) => x.id === water.data.id).topic === 'eau' && after.find((x) => x.id === legacy.data.id).topic === null && priorityOf(road.data.id) === 'high');

await stop();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall triage API checks passed');
process.exit(failures ? 1 : 0);
