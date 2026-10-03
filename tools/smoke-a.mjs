// Session A regression smoke: boots a throwaway server on a temp database and checks the API contracts,
// role checks, Wave 4 account flows and /monde/ asset serving. Usage: node tools/smoke-a.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'terra-smoke-'));
const port = 3100 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'smoke.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '' };
const bigLine = 'export const x = 1;\n';
const results = [];
const created = [];

const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`);
};

function staff(email, name, role) {
  const out = spawnSync(process.execPath, ['create-staff.mjs', email, name, role], { cwd: root, env, encoding: 'utf8' });
  return /Mot de passe à conserver : (\S+)/.exec(out.stdout)?.[1];
}

class Client {
  cookie = '';
  async call(path, method = 'GET', body, headers = {}) {
    const response = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = response.headers.get('set-cookie');
    if (set) this.cookie = set.startsWith('tn_session=;') ? '' : set.split(';')[0];
    const type = response.headers.get('content-type') || '';
    return { status: response.status, headers: response.headers, data: type.includes('json') ? await response.json() : await response.text() };
  }
}

const adminPassword = staff('admin@smoke.test', 'Admin Smoke', 'admin');
const agentPassword = staff('agent@smoke.test', 'Agent Smoke', 'agent');
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (chunk) => { log += chunk; });
server.stderr.on('data', (chunk) => { log += chunk; });

try {
  for (let i = 0; i < 50 && !log.includes('Terra Nova:'); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  check('server boots', log.includes('Terra Nova:'), log);

  const anon = new Client();
  const citizen = new Client();
  const admin = new Client();
  const agent = new Client();
  const victim = new Client();

  // Public contracts
  check('GET /api/me anonymous', (await anon.call('/api/me')).data.user === null);
  const news = (await anon.call('/api/announcements')).data.announcements;
  check('announcements expose urgent/audience/title_en', news.length >= 3 && news.every((n) => 'urgent' in n && 'audience' in n && 'published_at' in n) && news.some((n) => n.urgent === 1));
  const services = (await anon.call('/api/services')).data.services;
  check('services featured first', services.length > 3 && services[0].featured === 1 && services.every((s) => 'title_en' in s));
  const transports = (await anon.call('/api/transports')).data.lines;
  check('transports: 2 lines, stops/districts/3 departures', transports.length === 2 && transports.every((l) => /^T\d$/.test(l.code) && /^#[0-9a-f]{6}$/i.test(l.color) && l.stops.length === 3 && l.stops.every((s) => s.district && s.next.length === 3 && s.next.every((t) => /^\d\d:\d\d$/.test(t)))));
  const mapping = Object.fromEntries(transports.flatMap((l) => l.stops).map((s) => [s.name, s.district]));
  check('transport stop→district mapping', JSON.stringify(mapping) === JSON.stringify({ Habitat: 'Quartier nord', Mairie: 'Centre-ville', 'Quartier sud': 'Quartier sud', 'Marché': 'Quartier ouest', 'Santé': 'Quartier est' }), JSON.stringify(mapping));
  check('transport T1 disrupted with message', transports.find((l) => l.code === 'T1').status === 'perturbé' && Boolean(transports.find((l) => l.code === 'T1').message));
  check('anonymous cannot POST presence', (await anon.call('/api/presence', 'POST', { x: 1, z: 1, ry: 0 })).status === 401);
  check('anonymous cannot read requests feed', (await anon.call('/api/requests')).status === 401);

  // Citizen journey
  const reg = await citizen.call('/api/auth/register', 'POST', { name: 'Citoyen Test', email: 'citizen@smoke.test', password: 'a-long-password-1' });
  check('citizen registers', reg.status === 201 && reg.data.user.role === 'citizen' && reg.data.user.avatar === null);
  check('short password rejected', (await anon.call('/api/auth/register', 'POST', { name: 'X Y', email: 'x@y.test', password: 'short' })).status === 400);
  check('avatar rejects bad colour', (await citizen.call('/api/me/avatar', 'PUT', { skin: 'red', outfit: '#000000', accent: '#ffffff' })).status === 400);
  check('avatar saved', (await citizen.call('/api/me/avatar', 'PUT', { skin: '#E0AC69', outfit: '#3a6ea5', accent: '#ff4fa3' })).data.avatar.skin === '#e0ac69');
  check('/api/me returns avatar', (await citizen.call('/api/me')).data.user.avatar.outfit === '#3a6ea5');
  check('profile district saved', (await citizen.call('/api/me', 'PATCH', { name: 'Citoyen Test', district: 'Quartier sud' })).data.user.district === 'Quartier sud');
  check('presence post 204', (await citizen.call('/api/presence', 'POST', { x: 1, z: 2, ry: 0.5 })).status === 204);
  check('presence rejects NaN-like', (await citizen.call('/api/presence', 'POST', { x: 'a', z: 2, ry: 0 })).status === 400);
  const msg = await citizen.call('/api/messages', 'POST', { subject: 'Lampadaire cassé', body: 'Le lampadaire de la rue est cassé.', kind: 'incident', location: 'Rue du Port' });
  check('incident requires location', (await citizen.call('/api/messages', 'POST', { subject: 'Lampadaire', body: 'Sans lieu précisé ici.', kind: 'incident' })).status === 400);
  check('incident submitted with confirmation', msg.status === 201 && msg.data.status === 'new' && Boolean(msg.data.confirmation));
  check('citizen cannot patch message', (await citizen.call(`/api/messages/${msg.data.id}`, 'PATCH', { status: 'resolved' })).status === 403);
  check('citizen cannot publish news', (await citizen.call('/api/announcements', 'POST', { title: 'Hack', body: 'Contenu de test long' })).status === 403);
  check('citizen cannot reach admin citizens', (await citizen.call('/api/admin/citizens')).status === 403);

  // Staff
  check('admin logs in', (await admin.call('/api/auth/login', 'POST', { email: 'admin@smoke.test', password: adminPassword })).status === 200);
  check('agent logs in', (await agent.call('/api/auth/login', 'POST', { email: 'agent@smoke.test', password: agentPassword })).status === 200);
  check('wrong password rejected', (await anon.call('/api/auth/login', 'POST', { email: 'agent@smoke.test', password: 'nope' })).status === 401);
  check('agent sees all messages', (await agent.call('/api/messages')).data.messages.some((m) => m.id === msg.data.id && m.citizen_email));
  check('agent updates status', (await agent.call(`/api/messages/${msg.data.id}`, 'PATCH', { status: 'in_progress' })).status === 200);
  check('citizen sees updated status', (await citizen.call('/api/messages')).data.messages[0].status === 'in_progress');
  check('requests feed without key → 503 for staff', (await agent.call('/api/requests')).status === 503);
  const alert = await admin.call('/api/announcements', 'POST', { title: 'Alerte test', body: 'Contenu d’alerte de test.', urgent: true, audience: 'Quartier sud', title_en: 'Test alert', body_en: 'English test alert body.' });
  check('admin publishes urgent alert', alert.status === 201);
  check('alert listed urgent with audience', (await anon.call('/api/announcements')).data.announcements.find((n) => n.id === alert.data.id)?.audience === 'Quartier sud');
  check('admin lifts alert', (await admin.call(`/api/announcements/${alert.data.id}`, 'PATCH', { urgent: false })).status === 200);
  const featured = await admin.call('/api/services', 'POST', { title: 'Service test', description: 'Résumé test', details: 'Informations utiles test', featured: true });
  check('admin publishes featured service', featured.status === 201 && (await anon.call('/api/services')).data.services[0].title === 'Service test' || (await anon.call('/api/services')).data.services.some((s) => s.title === 'Service test' && s.featured === 1));
  check('agent updates traffic', (await agent.call('/api/transports/T2', 'PATCH', { status: 'perturbé', message: 'Travaux sur la ligne T2' })).status === 200 && (await anon.call('/api/transports')).data.lines.find((l) => l.code === 'T2').status === 'perturbé');
  check('traffic message required when disrupted', (await agent.call('/api/transports/T2', 'PATCH', { status: 'perturbé' })).status === 400);
  await agent.call('/api/transports/T2', 'PATCH', { status: 'normal' });

  // F33 — own deletion
  const doomed = new Client();
  await doomed.call('/api/auth/register', 'POST', { name: 'Doomed One', email: 'doomed@smoke.test', password: 'doomed-password-1' });
  await doomed.call('/api/messages', 'POST', { subject: 'Sujet à effacer', body: 'Message à effacer ensuite.' });
  check('F33 wrong password refused', (await doomed.call('/api/me', 'DELETE', { password: 'wrong' })).status === 403);
  check('F33 staff cannot self-delete', (await agent.call('/api/me', 'DELETE', { password: agentPassword })).status === 403);
  check('F33 deletes with password and logs out', (await doomed.call('/api/me', 'DELETE', { password: 'doomed-password-1' })).status === 200 && (await doomed.call('/api/me')).data.user === null);
  check('F33 deleted account cannot log in', (await anon.call('/api/auth/login', 'POST', { email: 'doomed@smoke.test', password: 'doomed-password-1' })).status === 401);

  // F34 — staff administer citizens
  await victim.call('/api/auth/register', 'POST', { name: 'Victime Test', email: 'victim@smoke.test', password: 'victim-password-1' });
  const list = await agent.call('/api/admin/citizens?q=victim');
  const target = list.data.citizens?.[0];
  check('F34 list + search', list.status === 200 && list.data.citizens.length === 1 && target.email === 'victim@smoke.test' && target.active === 1 && !('password_hash' in target));
  check('F34 search finds nobody for junk / escapes wildcard', (await agent.call('/api/admin/citizens?q=%25')).data.citizens.length === 0);
  check('F34 anonymous refused', (await anon.call('/api/admin/citizens')).status === 401);
  const staffRow = (await admin.call('/api/me')).data.user;
  check('F34 staff account protected (patch/reset/delete)', (await [
    () => admin.call(`/api/admin/citizens/${staffRow.id}`, 'PATCH', { active: false }),
    () => agent.call(`/api/admin/citizens/${staffRow.id}/password`, 'POST'),
    () => agent.call(`/api/admin/citizens/${staffRow.id}`, 'DELETE'),
  ].reduce(async (all, run) => [...await all, (await run()).status], Promise.resolve([]))).every((s) => s === 403));
  check('F34 unknown id → 404', (await agent.call('/api/admin/citizens/99999', 'DELETE')).status === 404);
  check('F34 invalid status body → 400', (await agent.call(`/api/admin/citizens/${target.id}`, 'PATCH', { active: 'no' })).status === 400);
  check('F34 deactivate revokes session', (await agent.call(`/api/admin/citizens/${target.id}`, 'PATCH', { active: false })).status === 200 && (await victim.call('/api/me')).data.user === null);
  check('F34 deactivated cannot log in', (await victim.call('/api/auth/login', 'POST', { email: 'victim@smoke.test', password: 'victim-password-1' })).status === 403);
  check('F34 reactivate allows login', (await agent.call(`/api/admin/citizens/${target.id}`, 'PATCH', { active: true })).status === 200 && (await victim.call('/api/auth/login', 'POST', { email: 'victim@smoke.test', password: 'victim-password-1' })).status === 200);
  const reset = await agent.call(`/api/admin/citizens/${target.id}/password`, 'POST');
  check('F34 reset returns one-time password, ends sessions, old password dead', reset.status === 200 && reset.data.password.length >= 20 && (await victim.call('/api/me')).data.user === null && (await victim.call('/api/auth/login', 'POST', { email: 'victim@smoke.test', password: 'victim-password-1' })).status === 401);
  check('F34 new password works', (await victim.call('/api/auth/login', 'POST', { email: 'victim@smoke.test', password: reset.data.password })).status === 200);
  check('F34 delete removes account', (await agent.call(`/api/admin/citizens/${target.id}`, 'DELETE')).status === 200 && (await victim.call('/api/me')).data.user === null && (await agent.call('/api/admin/citizens?q=victim')).data.citizens.length === 0);

  // /monde/ serving
  const worldDir = join(root, 'dist', 'monde');
  const hadWorld = existsSync(join(worldDir, 'index.html'));
  mkdirSync(join(worldDir, 'assets', 'models'), { recursive: true });
  const put = (file, content) => { const full = join(worldDir, file); if (!existsSync(full)) { writeFileSync(full, content); created.push(full); } };
  put('index.html', '<!doctype html><title>smoke</title>');
  put('assets/models/smoke.glb', 'glTF');
  put('assets/big-AbCdEf12.js', bigLine.repeat(500));
  put('assets/index-AbCdEf12.js', 'export {}');
  const model = await anon.call('/monde/assets/models/smoke.glb');
  check('/monde model MIME + revalidated cache', model.headers.get('content-type') === 'model/gltf-binary' && model.headers.get('cache-control') === 'no-cache' && Boolean(model.headers.get('etag')));
  check('/monde ETag → 304', (await anon.call('/monde/assets/models/smoke.glb', 'GET', undefined, { 'If-None-Match': model.headers.get('etag') })).status === 304);
  check('/monde fingerprinted asset immutable', (await anon.call('/monde/assets/index-AbCdEf12.js')).headers.get('cache-control').includes('immutable'));
  const big = await anon.call('/monde/assets/big-AbCdEf12.js', 'GET', undefined, { 'Accept-Encoding': 'gzip' });
  check('/monde gzip for large text assets, body intact, Vary set', big.headers.get('content-encoding') === 'gzip' && big.data.length === bigLine.length * 500 && big.headers.get('vary') === 'Accept-Encoding');
  check('/monde small files are not compressed', model.headers.get('content-encoding') === null);
  check('/monde missing .glb → 404 not HTML', await anon.call('/monde/assets/models/missing.glb').then((r) => r.status === 404 && !String(r.data).includes('<html') && !String(r.data).includes('<!doctype')));
  check('/monde navigation falls back to index', await anon.call('/monde/some/route').then((r) => r.status === 200 && r.headers.get('content-type').startsWith('text/html') && /<title>/i.test(String(r.data))));
  check('/monde path traversal blocked', await anon.call('/monde/..%2fserver.mjs').then((r) => r.status === 404 && !String(r.data).includes('createServer')));
  const csp = (await anon.call('/monde/')).headers.get('content-security-policy');
  check('/monde CSP per contract', csp?.includes("script-src 'self' 'wasm-unsafe-eval'") && csp.includes('worker-src') && csp.includes('blob:'));
  check('/monde redirects without slash', (await anon.call('/monde')).status === 301);
  check('portal CSP stays strict', (await anon.call('/')).headers.get('content-security-policy').includes("script-src 'self'; style-src 'self'"));
  void hadWorld;
} catch (error) {
  check('smoke script ran to completion', false, error.stack);
} finally {
  server.kill();
  for (const file of created) rmSync(file, { force: true });
  rmSync(join(root, 'dist', 'monde', 'assets', 'models'), { recursive: true, force: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
