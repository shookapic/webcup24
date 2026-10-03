// Old-database regression: builds a database with the ORIGINAL store (commit 1afe494: users, messages, services, announcements only),
// then boots the CURRENT server on it and checks that old data still works and every later table/column appears additively.
// Usage: node tools/qa-a/migration-old-db.mjs [oldCommit=1afe494]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const oldCommit = process.argv[2] || '1afe494';
const dir = mkdtempSync(join(tmpdir(), 'old-db-'));
mkdirSync(join(dir, 'old'));
for (const file of ['store.mjs', 'security.mjs']) writeFileSync(join(dir, 'old', file), spawnSync('git', ['show', `${oldCommit}:${file}`], { cwd: root, encoding: 'utf8' }).stdout);
writeFileSync(join(dir, 'old', 'seed.mjs'), `
import { db } from './store.mjs';
import { hashPassword } from './security.mjs';
const h = await hashPassword('old-password-123');
const u = db.prepare("INSERT INTO users (email,name,password_hash,role) VALUES ('old@x.test','Ancien Habitant',?, 'citizen')").run(h);
db.prepare('INSERT INTO messages (user_id,subject,body) VALUES (?,?,?)').run(Number(u.lastInsertRowid), 'Ancien sujet', 'Ancien message conservé.');
`);
const dataPath = join(dir, 'prod.sqlite');
const seed = spawnSync(process.execPath, [join(dir, 'old', 'seed.mjs')], { env: { ...process.env, DATA_PATH: dataPath }, encoding: 'utf8' });
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
check(`old schema (${oldCommit}) database created with a user and a message`, seed.status === 0, seed.stderr);

const port = 3900 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, DATA_PATH: dataPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '' }, stdio: 'ignore' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await wait(2000);
const call = async (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options);
try {
  const login = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'old@x.test', password: 'old-password-123' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check('the old user still signs in with the old password', login.status === 200);
  const messages = (await (await call('/api/messages', { headers: { Cookie: cookie } })).json()).messages || [];
  check('the old message is kept (new service_id column is NULL)', messages[0]?.subject === 'Ancien sujet' && messages[0].service_id === null);
  const services = (await (await call('/api/services')).json()).services;
  check('old services are all available (new availability columns default to available)', services.length >= 3 && services.every((s) => s.availability === 'available'));
  const places = (await (await call('/api/places')).json()).places;
  check('places table created and seeded', places.length >= 7 && places[0].kind === 'emergency');
  check('appointment routes answer on the migrated database', (await call('/api/appointments/slots', { headers: { Cookie: cookie } })).status === 200);
  check('transports unaffected', (await (await call('/api/transports')).json()).lines.length === 2);
  const db = new DatabaseSync(dataPath);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((r) => r.name);
  check('new tables exist: appointments, places, audit_log (+ append-only triggers)', ['appointments', 'places', 'audit_log'].every((t) => tables.includes(t)) && triggers.includes('audit_log_no_update') && triggers.includes('audit_log_no_delete'), tables.join());
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  check('users gained avatar, district, active additively; nothing was dropped', ['avatar', 'district', 'active'].every((c) => userColumns.includes(c)) && ['email', 'name', 'password_hash', 'role', 'created_at'].every((c) => userColumns.includes(c)));
  db.close();
  server.kill();
  await wait(500);
  const second = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, DATA_PATH: dataPath, PORT: String(port + 1), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '' }, stdio: 'ignore' });
  await wait(2000);
  const again = await fetch(`http://127.0.0.1:${port + 1}/api/places`);
  check('a second boot on the migrated database is harmless and keeps the same places', again.status === 200 && (await again.json()).places.length === places.length);
  second.kill();
} catch (error) {
  failures++;
  console.log('FAIL  migration script crashed', error.stack);
} finally {
  server.kill();
  await wait(500);
  rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nold-database migration: all checks passed');
  process.exit(failures ? 1 : 0);
}
