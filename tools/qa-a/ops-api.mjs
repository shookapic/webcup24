// F86 (medical emergency not treated like an ordinary request), F85 (unusual activity and consistency made visible), F87 (backup verification), F88 (select and export follow-up
// data): API level on a disposable server and database. A ports 3200-3209. Usage: node tools/qa-a/ops-api.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'terra-ops-'));
const dbPath = join(dataDir, 'o.sqlite');
const port = 3200 + Math.floor(Math.random() * 10);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_MIN_AGE_MS: '0', TN_FORM_LIMIT_SCALE: '1000' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 600)}`); };
const staff = (who, role) => /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', `${who}@op.test`, `${who} Opérations`, role], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const pw = { agent: staff('agent', 'agent'), admin: staff('admin', 'admin') };
let server;
const start = async () => { server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' }); await wait(1500); };
const stop = async () => { server.kill(); await wait(400); };
await start();
let n = 0;
const call = async (path, method = 'GET', body, cookie = '', ip = null) => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || `10.99.${Math.floor(++n / 250)}.${n % 250}`, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data, text, headers: response.headers, cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0] };
};
const query = (sql, ...args) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
const login = async (who, ip) => (await call('/api/auth/login', 'POST', { email: `${who}@op.test`, password: pw[who] }, '', ip)).cookie;
const [agent, admin] = [await login('agent'), await login('admin')];
const zoe = (await call('/api/auth/register', 'POST', { name: 'Zoé Opérations', email: 'zoe@op.test', password: 'password-long-1' })).cookie;
const send = (subject, extra = {}, cookie = zoe) => call('/api/messages', 'POST', { subject, body: `Le texte de la demande « ${subject} » est assez long pour être valide.`, kind: 'contact', ...extra }, cookie);

console.log('# F86. a medical emergency is not an ordinary request');
const ordinary = await send('Question sur les horaires');
const ticked = await send('Mon voisin est tombé', { emergency: true, body: 'Mon voisin est tombé dans l’escalier et ne bouge plus, merci de venir.' });
const worded = await call('/api/messages', 'POST', { subject: 'Aide', body: 'Ma mère est inconsciente et elle ne respire plus, il faut de l’aide vite.', kind: 'contact' }, zoe);
const english = await call('/api/messages', 'POST', { subject: 'Help please', body: 'My father is having a heart attack and nobody answers the phone.', kind: 'contact' }, zoe);
const calm = await call('/api/messages', 'POST', { subject: 'Un arrêt de bus', body: 'Je voudrais savoir où est l’arrêt de bus le plus proche de la mairie.', kind: 'contact' }, zoe);
check('an ordinary request is not flagged; one ticked as a medical emergency, and two whose words report one (FR and EN), are flagged in the answer', !ordinary.data.emergency && ticked.data.emergency === true && worded.data.emergency === true && english.data.emergency === true && !calm.data.emergency, JSON.stringify([ordinary.data, ticked.data, worded.data, english.data]));
const rows = query('SELECT id, emergency, priority, topic FROM messages ORDER BY id');
check('flagged requests are stored as emergency, priority urgent and theme health; the others are untouched (normal priority)', rows.filter((r) => r.emergency === 1).length === 3 && rows.filter((r) => r.emergency === 1).every((r) => r.priority === 'urgent' && r.topic === 'sante') && rows.filter((r) => r.emergency === 0).every((r) => r.priority === 'normal'), JSON.stringify(rows));
const notBool = await send('Une demande avec un faux drapeau', { emergency: 'oui' });
check('only a real boolean true ticks the box (the string "oui" does not)', notBool.status === 201 && !notBool.data.emergency);
const staffList = (await call('/api/messages', 'GET', null, agent)).data.messages;
const residentList = (await call('/api/messages', 'GET', null, zoe)).data.messages;
check('staff and the resident see the flag on the request', staffList.filter((m) => m.emergency === 1).length === 3 && residentList.filter((m) => m.emergency === 1).length === 3);
const dash = (await call('/api/admin/dashboard', 'GET', null, agent)).data.messages;
check('the dashboard counts the emergencies not yet resolved, and resolving one lowers the count', dash.emergency_open === 3 && (await call(`/api/messages/${ticked.data.id}`, 'PATCH', { status: 'resolved' }, agent)).status === 200 && (await call('/api/admin/dashboard', 'GET', null, agent)).data.messages.emergency_open === 2, JSON.stringify(dash));
const dup = await call('/api/messages', 'POST', { subject: 'Aide', body: 'Ma mère est inconsciente et elle ne respire plus, il faut de l’aide vite.', kind: 'contact' }, zoe);
check('the same emergency sent twice is still one record (duplicate handling is unchanged)', dup.status === 200 && dup.data.duplicate === true && query("SELECT COUNT(*) AS n FROM messages WHERE subject = 'Aide'")[0].n === 1, dup.text);

console.log('\n# F88. select and export follow-up data');
const options = (await call('/api/admin/export/options', 'GET', null, agent)).data;
check('the export options list the datasets, their states and the columns that can be chosen; residents get nothing (403) and anonymous 401', options.datasets.map((d) => d.key).join() === 'requests,appointments' && options.datasets[0].columns.length >= 10 && (await call('/api/admin/export/options', 'GET', null, zoe)).status === 403 && (await call('/api/admin/export/options')).status === 401);
const csv = await fetch(`${base}/api/admin/export?dataset=requests&fields=reference,status,priority,emergency`, { headers: { Cookie: agent } });
const csvBytes = Buffer.from(await csv.arrayBuffer());
const csvText = csvBytes.toString('utf8').replace(/^\ufeff/, '');
check('a CSV with only the chosen columns (readable headers, UTF-8 with BOM, ; separator), one line per request, as a download', csv.status === 200 && csv.headers.get('content-type').startsWith('text/csv') && /attachment; filename="export-requests-\d{4}-\d{2}-\d{2}\.csv"/.test(csv.headers.get('content-disposition')) && csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && csvText.startsWith('Référence;État;Priorité;Urgence médicale') && csvText.trim().split('\r\n').length === 1 + 6 && !/Zoé|zoe@/.test(csvText), JSON.stringify(csvText.slice(0, 200)));
const json = (await call('/api/admin/export?dataset=requests&fields=reference,subject&status=new&format=json', 'GET', null, agent)).data;
check('JSON with a status filter: the columns array and rows with the chosen keys only; resolved requests are left out', json.columns.length === 2 && json.rows.every((r) => Object.keys(r).join() === 'reference,subject') && !json.rows.some((r) => r.reference === `M-${ticked.data.id}`) && json.rows.length === 5, JSON.stringify(json).slice(0, 300));
const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
const inRange = (await call(`/api/admin/export?dataset=requests&fields=reference&from=${today}&to=${today}&format=json`, 'GET', null, agent)).data.rows.length;
const outRange = (await call('/api/admin/export?dataset=requests&fields=reference&from=2020-01-01&to=2020-01-02&format=json', 'GET', null, agent)).data.rows.length;
check('a period filter works on the city date (today: all 6, long ago: none)', inRange === 6 && outRange === 0, [inRange, outRange]);
const bad = await Promise.all(['dataset=users', 'dataset=requests&fields=password_hash', 'dataset=requests&fields=reference,reference', 'dataset=requests&fields=1;DROP TABLE users', 'dataset=requests&status=archived', 'dataset=requests&format=xml', 'dataset=requests&from=hier', 'dataset=requests&from=2026-13-45'].map((q) => call(`/api/admin/export?${q}`, 'GET', null, agent)));
check('unknown datasets, columns (password hash, injection), duplicates, states, formats and dates are all 400 (nothing leaks, nothing runs)', bad.every((r) => r.status === 400) && query('SELECT COUNT(*) AS n FROM users')[0].n === 3, bad.map((r) => r.status));
const csvInjection = await send('=HYPERLINK("http://evil.example","clic")');
const evil = (await (await fetch(`${base}/api/admin/export?dataset=requests&fields=subject`, { headers: { Cookie: agent } })).text()).replace(/^\ufeff/, '');
check('a subject starting with = is neutralised in the CSV (no formula runs in a spreadsheet)', csvInjection.status === 201 && /(^|\r\n)"?'=HYPERLINK/.test(evil), evil.slice(-200));
const appts = await fetch(`${base}/api/admin/export?dataset=appointments`, { headers: { Cookie: agent } });
check('the appointments dataset exports too (header only when there are none)', appts.status === 200 && (await appts.text()).replace(/^\ufeff/, '').startsWith('Date et heure'));
const journal = ((await call('/api/admin/audit', 'GET', null, admin)).data.entries || []).filter((e) => e.action === 'export.data');
check('every export is journalled (who, which dataset and columns, how many lines), never the data itself', journal.length >= 4 && journal.some((e) => /« Demandes »/.test(e.summary)) && !JSON.stringify(journal).includes('Mon voisin'), JSON.stringify(journal.map((e) => e.summary)).slice(0, 300));
const svc = (await call('/api/services', 'POST', { title: 'Service Périmètre', description: 'Description du service périmètre', details: 'Informations détaillées du service périmètre.' }, admin)).data.id;
const svc2 = (await call('/api/services', 'POST', { title: 'Service Voisin', description: 'Description du service voisin', details: 'Informations détaillées du service voisin.' }, admin)).data.id;
const mine = await send('Question pour mon service', { service_id: svc });
const other = await send('Question pour un autre service', { service_id: svc2 });
const agentRow = query("SELECT id FROM users WHERE email = 'agent@op.test'")[0].id;
await call(`/api/admin/agents/${agentRow}/scope`, 'PUT', { services: [svc] }, admin);
const scoped = (await call('/api/admin/export?dataset=requests&fields=reference&format=json', 'GET', null, agent)).data.rows.length;
check('an agent limited to a service exports only what they may see (F70 applies: the requests with no service and that service)', scoped === 8 && (await call('/api/admin/export?dataset=requests&fields=reference&format=json', 'GET', null, admin)).data.rows.length === 9 && other.status === 201 && mine.status === 201, scoped);
await call(`/api/admin/agents/${agentRow}/scope`, 'PUT', { services: [] }, admin);

console.log('\n# F87. verify that the data can be backed up');
const noAgent = await call('/api/admin/backup/verify', 'POST', {}, agent);
const noAuth = await call('/api/admin/backup/verify', 'POST', {});
check('only an administrator can run it (agent 403, anonymous 401)', noAgent.status === 403 && noAuth.status === 401);
const before = readdirSync(dataDir);
const verify = await call('/api/admin/backup/verify', 'POST', {}, admin);
check('it returns a plain report: ok, integrity "ok", number of tables and rows, the important data counted (accounts, requests, services, appointments, journal) and each one identical in the copy', verify.status === 200 && verify.data.ok === true && verify.data.integrity === 'ok' && verify.data.tables >= 20 && verify.data.rows > 20 && verify.data.mismatched.length === 0 && verify.data.important.length === 5 && verify.data.important.every((x) => x.same) && verify.data.important.find((x) => x.label === 'demandes').rows === query('SELECT COUNT(*) AS n FROM messages')[0].n, verify.text.slice(0, 400));
check('the copy is deleted afterwards (no stray file in the data folder) and was never offered for download', JSON.stringify(readdirSync(dataDir).filter((f) => f.startsWith('.verif'))) === '[]' && JSON.stringify(readdirSync(dataDir).sort()) === JSON.stringify(before.sort()), readdirSync(dataDir).join());
check('the date and result are kept for the next visit (admin only), and the check is journalled', (await call('/api/admin/backup/status', 'GET', null, admin)).data.last.ok === true && (await call('/api/admin/backup/status', 'GET', null, agent)).status === 403 && ((await call('/api/admin/audit', 'GET', null, admin)).data.entries || []).some((e) => e.action === 'backup.verify'));
let last;
for (let i = 0; i < 4; i++) last = await call('/api/admin/backup/verify', 'POST', {}, admin);
check('it is rate-limited (429 after 3 in 10 minutes): a heavy operation cannot be looped', last.status === 429 && last.data.retryAfter > 0, last.text);

console.log('\n# F85. unusual activity and consistency');
const calmSecurity = (await call('/api/admin/security', 'GET', null, agent)).data;
check('on a calm platform the anomaly list is empty', Array.isArray(calmSecurity.anomalies) && calmSecurity.anomalies.length === 0, JSON.stringify(calmSecurity.anomalies));
for (let i = 0; i < 12; i++) await call('/api/auth/login', 'POST', { email: 'zoe@op.test', password: `mauvais-mot-de-passe-${i}` }, '', `10.77.0.${i + 1}`);
const attacked = (await call('/api/admin/security', 'GET', null, agent)).data;
check('12 failed sign-ins on one account (from different addresses) are reported in words with a level, and the account is masked', attacked.anomalies.some((a) => ['logins'].includes(a.code) && a.level === 'high' && /compte\(s\) subissent beaucoup/.test(a.text)) && !JSON.stringify(attacked).includes('zoe@op.test'), JSON.stringify(attacked.anomalies));
check('residents cannot read it (403)', (await call('/api/admin/security', 'GET', null, zoe)).status === 403 && (await call('/api/admin/integrity', 'GET', null, zoe)).status === 403);
const consistent = (await call('/api/admin/integrity', 'GET', null, agent)).data;
check('the consistency check passes on healthy data (journal chain, database, links, request states)', consistent.ok === true && consistent.problems.length === 0 && consistent.journal.checked > 0, JSON.stringify(consistent));
await stop();
{ const db = new DatabaseSync(dbPath); db.exec("UPDATE messages SET updated_at = '2000-01-01 00:00:00' WHERE id = 1"); for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log'").all()) db.exec(`DROP TRIGGER "${t.name}"`); // the append-only triggers are removed in this DISPOSABLE copy to simulate tampering from outside the application
db.exec("UPDATE audit_log SET summary = 'modifié à la main' WHERE id = 2"); db.close(); }
await start();
const agent2 = await login('agent', '10.88.0.1');
const broken = (await call('/api/admin/integrity', 'GET', null, agent2)).data;
const brokenSecurity = (await call('/api/admin/security', 'GET', null, agent2)).data;
check('a request updated before it was received and a journal line edited by hand are both found and said plainly (journal: from which line; data: how many)', broken.ok === false && broken.problems.some((p) => p.code === 'journal' && /à partir de la ligne 2/.test(p.text)) && broken.problems.some((p) => p.code === 'data' && /antérieure à leur réception/.test(p.text)), JSON.stringify(broken));
check('and the same problems appear among the unusual activity for agents (level high)', brokenSecurity.anomalies.filter((a) => a.level === 'high').length >= 2, JSON.stringify(brokenSecurity.anomalies));
const badBackup = (await call('/api/admin/backup/verify', 'POST', {}, await login('admin', '10.88.0.2'))).data;
check('the backup verification still copies and relays a database with these defects faithfully (the copy is identical to the live data: it verifies the backup, not the content)', badBackup.ok === true || badBackup.mismatched.length === 0, JSON.stringify(badBackup).slice(0, 200));

await stop();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall operations checks passed');
process.exit(failures ? 1 : 0);
