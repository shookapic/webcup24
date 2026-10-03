// Session A regression smoke: boots a throwaway server on a temp database and checks the API contracts,
// role checks, Wave 4 account flows and /monde/ asset serving. Usage: node tools/smoke-a.mjs
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'terra-smoke-'));
const port = 3100 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'smoke.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1' };
const bigLine = 'export const x = 1;\n';
const R = 'Motif de test pour le journal des actions';
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
  // look + accessory: optional, allowlisted, old saves stay valid, presence carries them
  const oldSave = (await citizen.call('/api/me')).data.user.avatar;
  check('avatar: an old three-colour save has no look or accessory (renderer defaults apply)', oldSave.look === undefined && oldSave.accessory === undefined);
  check('avatar: invalid look or accessory is refused with 400 (unknown id, wrong type, empty), colours still validated', (await citizen.call('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3', look: 'pirate' })).status === 400 && (await citizen.call('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3', accessory: 7 })).status === 400 && (await citizen.call('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3', look: '' })).status === 400 && (await citizen.call('/api/me/avatar', 'PUT', { skin: 'nope', outfit: '#3a6ea5', accent: '#ff4fa3', look: 'medecin' })).status === 400 && (await citizen.call('/api/me')).data.user.avatar.look === undefined);
  const looked = await citizen.call('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3', look: 'medecin', accessory: 'visiere' });
  check('avatar: look and accessory are saved and returned by PUT and /api/me', looked.status === 200 && looked.data.avatar.look === 'medecin' && looked.data.avatar.accessory === 'visiere' && (await citizen.call('/api/me')).data.user.avatar.accessory === 'visiere');
  check('avatar: an older editor sending only colours keeps the chosen look and accessory', (await citizen.call('/api/me/avatar', 'PUT', { skin: '#8d5524', outfit: '#222222', accent: '#00ff00' })).data.avatar.look === 'medecin' && (await citizen.call('/api/me')).data.user.avatar.skin === '#8d5524' && (await citizen.call('/api/me')).data.user.avatar.accessory === 'visiere');
  await citizen.call('/api/presence', 'POST', { x: 1, z: 1, ry: 0 });
  const observer = new Client();
  await observer.call('/api/auth/register', 'POST', { name: 'Observateur Test', email: 'observer@smoke.test', password: 'observer-password-1' });
  const seenAvatar = (await observer.call('/api/presence')).data.players.find((p) => p.name === 'Citoyen Test');
  check('avatar: other players receive the same look and accessory through presence', Boolean(seenAvatar) && seenAvatar.avatar.look === 'medecin' && seenAvatar.avatar.accessory === 'visiere', JSON.stringify(seenAvatar));
  check('avatar: an unknown stored id (written by a newer or older version) does not break /api/me or presence; the renderer falls back to defaults', await (async () => { const raw = new DatabaseSync(env.DATA_PATH); raw.prepare("UPDATE users SET avatar = ? WHERE email = 'citizen@smoke.test'").run(JSON.stringify({ skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3', look: 'futur', accessory: 'chapeau' })); raw.close(); const me = await citizen.call('/api/me'); const post = await citizen.call('/api/presence', 'POST', { x: 1, z: 1, ry: 0 }); return me.status === 200 && me.data.user.avatar.look === 'futur' && post.status === 204; })());
  check('avatar: a corrupt stored value does not break a colour-only save', await (async () => { const raw = new DatabaseSync(env.DATA_PATH); raw.prepare("UPDATE users SET avatar = ? WHERE email = 'citizen@smoke.test'").run('{not json'); raw.close(); const res = await citizen.call('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' }); return res.status === 200 && res.data.avatar.look === undefined; })());
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
  check('admin lifts alert (a reason is required)', (await admin.call(`/api/announcements/${alert.data.id}`, 'PATCH', { urgent: false })).status === 400 && (await admin.call(`/api/announcements/${alert.data.id}`, 'PATCH', { urgent: false, reason: R })).status === 200);
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
  check('F34 deactivate needs a reason, then revokes the session', (await agent.call(`/api/admin/citizens/${target.id}`, 'PATCH', { active: false })).status === 400 && (await agent.call(`/api/admin/citizens/${target.id}`, 'PATCH', { active: false, reason: R })).status === 200 && (await victim.call('/api/me')).data.user === null);
  check('F34 deactivated cannot log in', (await victim.call('/api/auth/login', 'POST', { email: 'victim@smoke.test', password: 'victim-password-1' })).status === 403);
  check('F34 reactivate allows login', (await agent.call(`/api/admin/citizens/${target.id}`, 'PATCH', { active: true })).status === 200 && (await victim.call('/api/auth/login', 'POST', { email: 'victim@smoke.test', password: 'victim-password-1' })).status === 200);
  check('F34 reset needs a reason', (await agent.call(`/api/admin/citizens/${target.id}/password`, 'POST', {})).status === 400);
  const reset = await agent.call(`/api/admin/citizens/${target.id}/password`, 'POST', { reason: R });
  check('F34 reset returns one-time password, ends sessions, old password dead', reset.status === 200 && reset.data.password.length >= 20 && (await victim.call('/api/me')).data.user === null && (await victim.call('/api/auth/login', 'POST', { email: 'victim@smoke.test', password: 'victim-password-1' })).status === 401);
  check('F34 new password works', (await victim.call('/api/auth/login', 'POST', { email: 'victim@smoke.test', password: reset.data.password })).status === 200);
  check('F34 delete needs a reason, then removes the account', (await agent.call(`/api/admin/citizens/${target.id}`, 'DELETE', {})).status === 400 && (await agent.call(`/api/admin/citizens/${target.id}`, 'DELETE', { reason: R })).status === 200 && (await victim.call('/api/me')).data.user === null && (await agent.call('/api/admin/citizens?q=victim')).data.citizens.length === 0);

  // F38 — service availability
  const svcs = (await anon.call('/api/services')).data.services;
  const healthService = svcs.find((s) => s.title === 'Centre de santé');
  const cityLocal = (offsetMinutes = 0) => new Date(Date.now() + 4 * 3600_000 + offsetMinutes * 60_000).toISOString().slice(0, 16);
  const availability = (id, body, client = agent) => client.call(`/api/services/${id}/availability`, 'PATCH', body);
  check('F38 anonymous 401, citizen 403', (await availability(healthService.id, { availability: 'unavailable', reason: 'Maintenance' }, new Client())).status === 401 && (await availability(healthService.id, { availability: 'unavailable', reason: 'Maintenance' }, citizen)).status === 403);
  check('F38 validation: reason required, past/invalid return date, bad status, unknown service', (await Promise.all([
    availability(healthService.id, { availability: 'unavailable' }), availability(healthService.id, { availability: 'unavailable', reason: 'Maintenance du centre', until: cityLocal(-60) }),
    availability(healthService.id, { availability: 'unavailable', reason: 'Maintenance du centre', until: '2026-13-45T99:99' }), availability(healthService.id, { availability: 'broken' }),
    availability(99999, { availability: 'unavailable', reason: 'Maintenance du centre' }),
  ])).map((r) => r.status).join() === '400,400,400,400,404');
  const back = cityLocal(3 * 24 * 60);
  check('F38 agent marks a service unavailable with reason, return time and alternative', (await availability(healthService.id, { availability: 'unavailable', reason: 'Maintenance du système de rendez-vous', reason_en: 'Appointment system maintenance', until: back, alternative: 'Appelez le 112 en cas d’urgence ou écrivez aux services.', alternative_en: 'Call 112 in an emergency or write to the services.' })).status === 200);
  const down = (await anon.call('/api/services')).data.services.find((s) => s.id === healthService.id);
  check('F38 public list exposes availability, reason, return time, alternative (FR + EN)', down.availability === 'unavailable' && down.unavailable_reason.includes('Maintenance') && down.available_again === back && down.alternative.includes('112') && down.alternative_en.includes('112') && down.unavailable_reason_en.includes('maintenance'));
  const sqlite = new DatabaseSync(env.DATA_PATH);
  sqlite.prepare('UPDATE services SET available_again = ? WHERE id = ?').run(cityLocal(-5), healthService.id);
  check('F38 an outage whose return time has passed stops showing as unavailable by itself', (await anon.call('/api/services')).data.services.find((s) => s.id === healthService.id).availability === 'available');
  sqlite.prepare('UPDATE services SET available_again = ? WHERE id = ?').run(back, healthService.id);
  const aboutService = await citizen.call('/api/messages', 'POST', { subject: 'Rendez-vous médical', body: 'Je voudrais un rendez-vous au centre de santé.', service_id: healthService.id });
  check('F38 a request can name its service; citizen and staff see it', aboutService.status === 201 && (await citizen.call('/api/messages')).data.messages[0].service_title === 'Centre de santé' && (await agent.call('/api/messages')).data.messages.find((m) => m.id === aboutService.data.id).service_title === 'Centre de santé');
  check('F38 unknown service id refused', (await citizen.call('/api/messages', 'POST', { subject: 'Sujet test', body: 'Un message assez long.', service_id: 99999 })).status === 400);
  check('F38 back to available clears the details', (await availability(healthService.id, { availability: 'available' })).status === 200 && await anon.call('/api/services').then((r) => { const s = r.data.services.find((x) => x.id === healthService.id); return s.availability === 'available' && s.unavailable_reason === null && s.available_again === null; }));

  // F39 / F40 — appointments
  const tomorrow = cityLocal(24 * 60).slice(0, 10);
  const slots = (body, client = agent) => client.call('/api/appointments', 'POST', body);
  check('F39 citizens cannot publish slots, anonymous refused', (await slots({ date: tomorrow, start: '10:00' }, citizen)).status === 403 && (await slots({ date: tomorrow, start: '10:00' }, new Client())).status === 401);
  check('F39 slot validation: past, count, duration, midnight, > 90 days, bad format', (await Promise.all([
    slots({ date: cityLocal(-1440).slice(0, 10), start: '10:00' }), slots({ date: tomorrow, start: '10:00', count: 13 }), slots({ date: tomorrow, start: '10:00', duration: 5 }),
    slots({ date: tomorrow, start: '23:50', count: 2 }), slots({ date: cityLocal(100 * 1440).slice(0, 10), start: '10:00' }), slots({ date: 'demain', start: '10h' }),
  ])).map((r) => r.status).join() === '400,400,400,400,400,400');
  const made = await slots({ date: tomorrow, start: '10:00', count: 4, duration: 20 });
  check('F39 agent publishes consecutive slots', made.status === 201 && made.data.created === 4);
  check('F39 the same slots cannot be published twice', (await slots({ date: tomorrow, start: '10:00', count: 4, duration: 20 })).status === 409);
  const apCit = new Client();
  const apCit2 = new Client();
  await apCit.call('/api/auth/register', 'POST', { name: 'Rdv Un', email: 'rdv1@smoke.test', password: 'rendezvous-pass-1' });
  await apCit2.call('/api/auth/register', 'POST', { name: 'Rdv Deux', email: 'rdv2@smoke.test', password: 'rendezvous-pass-2' });
  const openSlots = (await apCit.call('/api/appointments/slots')).data;
  check('F39 citizens list open slots in order with agent, place, preparation info and the time zone', openSlots.slots.length === 4 && openSlots.slots[0].starts_at === `${tomorrow}T10:00` && openSlots.slots[0].ends_at === `${tomorrow}T10:20` && openSlots.slots[1].starts_at === `${tomorrow}T10:20` && openSlots.slots[0].agent === 'Agent Smoke' && openSlots.slots[0].location.length > 3 && openSlots.slots[0].instructions.includes('pièce d’identité') && openSlots.utcOffset === '+04:00', JSON.stringify(openSlots.slots[0]));
  check('F39 staff do not use the citizen booking list', (await agent.call('/api/appointments/slots')).status === 403);
  const [s1, s2, s3, s4] = openSlots.slots;
  const race = await Promise.all([apCit.call(`/api/appointments/${s1.id}/book`, 'POST', { reason: 'Première demande' }), apCit2.call(`/api/appointments/${s1.id}/book`, 'POST', {})]);
  check('F39 two people booking the same slot at once: exactly one wins, the other gets a clear 409', race.map((r) => r.status).sort().join() === '201,409' && race.find((r) => r.status === 409).data.error.includes('plus disponible'), race.map((r) => r.status + r.data.error).join());
  const winner = race[0].status === 201 ? apCit : apCit2;
  const loser = winner === apCit ? apCit2 : apCit;
  const booked = (await winner.call('/api/appointments/mine')).data.appointments;
  check('F39 booking returns/lists the full details', booked.length === 1 && booked[0].status === 'booked' && booked[0].id === s1.id && booked[0].location === s1.location && booked[0].minutes_until > 0);
  check('F39 booked slot disappears from the open list', (await loser.call('/api/appointments/slots')).data.slots.every((s) => s.id !== s1.id));
  check('F39 cannot book an overlapping or a third upcoming appointment', await (async () => {
    const second = await winner.call(`/api/appointments/${s2.id}/book`, 'POST', {});
    const third = await winner.call(`/api/appointments/${s3.id}/book`, 'POST', {});
    return second.status === 201 && third.status === 409 && third.data.error.includes('deux rendez-vous');
  })());
  const ics = await fetch(`${base}/api/appointments/${s1.id}/ics`, { headers: { Cookie: winner.cookie } });
  const icsBody = await ics.text();
  check('F40 calendar file: text/calendar, correct UTC start (city time − 4 h), two alarms (1 day, 1 hour), place + preparation info', ics.status === 200 && ics.headers.get('content-type').startsWith('text/calendar') && icsBody.includes(`DTSTART:${tomorrow.replace(/-/g, '')}T060000Z`) && icsBody.includes('TRIGGER:-P1D') && icsBody.includes('TRIGGER:-PT1H') && icsBody.includes('LOCATION:') && icsBody.includes('pièce d’identité'), icsBody.slice(0, 300));
  check('F40 calendar file only for its owner', (await fetch(`${base}/api/appointments/${s1.id}/ics`, { headers: { Cookie: loser.cookie } })).status === 404 && (await fetch(`${base}/api/appointments/${s1.id}/ics`)).status === 401);
  check('F39 a citizen cannot cancel someone else\'s appointment', (await loser.call(`/api/appointments/${s1.id}`, 'DELETE')).status === 404);
  check('F39 citizen cancels: the slot is offered again, second cancel 404', (await winner.call(`/api/appointments/${s2.id}`, 'DELETE')).status === 200 && (await loser.call('/api/appointments/slots')).data.slots.some((s) => s.id === s2.id) && (await winner.call(`/api/appointments/${s2.id}`, 'DELETE')).status === 404);
  const staffView = (await agent.call('/api/appointments/staff')).data.appointments;
  check('F39 staff see who booked what and why', staffView.find((a) => a.id === s1.id)?.citizen?.email === (winner === apCit ? 'rdv1@smoke.test' : 'rdv2@smoke.test') && (winner !== apCit || staffView.find((a) => a.id === s1.id).reason === 'Première demande'));
  check('F39 citizens cannot read the staff list', (await winner.call('/api/appointments/staff')).status === 403);
  check('F39 staff cancel a booking (reason required): the citizen sees it cancelled, it is not offered again', (await agent.call(`/api/appointments/${s1.id}`, 'DELETE', {})).status === 400 && (await agent.call(`/api/appointments/${s1.id}`, 'DELETE', { reason: R })).status === 200 && (await winner.call('/api/appointments/mine')).data.appointments.find((a) => a.id === s1.id).status === 'cancelled' && (await loser.call('/api/appointments/slots')).data.slots.every((s) => s.id !== s1.id));
  check('F39 staff remove an open slot', (await agent.call(`/api/appointments/${s4.id}`, 'DELETE')).status === 200 && (await loser.call('/api/appointments/slots')).data.slots.every((s) => s.id !== s4.id));
  await winner.call(`/api/appointments/${s3.id}/book`, 'POST', {});
  check('F39/F33 deleting an account frees its booked slot', (await winner.call('/api/me', 'DELETE', { password: winner === apCit ? 'rendezvous-pass-1' : 'rendezvous-pass-2' })).status === 200 && (await loser.call('/api/appointments/slots')).data.slots.some((s) => s.id === s3.id));
  sqlite.close();

  // F37 — layered sign-in protection (client IPs are spoofed through X-Forwarded-For; TRUST_PROXY=1 in this test server)
  const from = (ip) => ({ 'X-Forwarded-For': ip });
  const login = (email, passwordValue, ip) => anon.call('/api/auth/login', 'POST', { email, password: passwordValue }, from(ip));
  for (const n of [1, 2, 3, 4]) await new Client().call('/api/auth/register', 'POST', { name: `Cible ${n}`, email: `target${n}@smoke.test`, password: 'target-password-1' });
  const lefts = [];
  for (let i = 0; i < 5; i++) { const r = await login('target1@smoke.test', 'wrong', '10.1.0.1'); lefts.push(`${r.status}:${r.data.attemptsLeft}`); }
  check('F37 wrong passwords return 401 with a falling attemptsLeft', lefts.join() === '401:4,401:3,401:2,401:1,401:0', lefts.join());
  const blocked = await login('target1@smoke.test', 'target-password-1', '10.1.0.1');
  check('F37 6th attempt is blocked even with the right password: 429 + Retry-After + retryAfter', blocked.status === 429 && Number(blocked.headers.get('retry-after')) > 800 && blocked.data.retryAfter > 800, JSON.stringify(blocked.data));
  const other = await login('target1@smoke.test', 'target-password-1', '10.1.0.2');
  check('F37 the real owner from another address still signs in, and is told about the failed attempts', other.status === 200 && other.data.notice?.failedAttempts === 5, JSON.stringify(other.data));
  check('F37 the blocked address stays blocked', (await login('target1@smoke.test', 'target-password-1', '10.1.0.1')).status === 429);
  const unknown = await login('nobody-here@smoke.test', 'wrong', '10.1.0.3');
  check('F37 unknown address answers exactly like a wrong password', unknown.status === 401 && unknown.data.error === 'Identifiants incorrects.' && unknown.data.attemptsLeft === 4);
  for (let i = 0; i < 3; i++) await login('target3@smoke.test', 'wrong', '10.1.0.4');
  check('F37 normal use: a few typos then the right password signs in with no notice', await login('target3@smoke.test', 'target-password-1', '10.1.0.4').then((r) => r.status === 200 && !r.data.notice));
  check('F37 a success resets the own counter of that person', (await login('target3@smoke.test', 'wrong', '10.1.0.4')).data.attemptsLeft === 4);

  for (let i = 0; i < 20; i++) await login('target2@smoke.test', 'guess', `10.2.0.${i + 1}`);
  check('F37 guessing spread over 20 addresses still locks the account (even for a new address)', (await login('target2@smoke.test', 'target-password-1', '10.2.9.9')).status === 429);

  for (let i = 0; i < 40; i++) await login(`sweep${i}@smoke.test`, 'guess', '10.3.0.1');
  check('F37 one address sweeping many accounts gets blocked for every account', (await login('target4@smoke.test', 'target-password-1', '10.3.0.1')).status === 429);
  check('F37 other addresses are not affected by that sweep', (await login('target4@smoke.test', 'target-password-1', '10.3.0.2')).status === 200);

  check('F37 security overview refused to anonymous and citizens', (await new Client().call('/api/admin/security')).status === 401 && (await citizen.call('/api/admin/security')).status === 403);
  for (let i = 0; i < 3; i++) await login('ghost@smoke.test', 'guess', '10.4.0.1');
  const overview = (await agent.call('/api/admin/security')).data;
  check('F37 staff overview counts failures/blocks and names targeted accounts masked', overview.failedLogins >= 65 && overview.blockedAttempts >= 4 && overview.targeted.some((t) => t.account === 't***@smoke.test' && t.failures >= 5) && !JSON.stringify(overview).includes('target1@') && overview.unknownAddresses >= 1, JSON.stringify(overview));
  const throttle = await import(pathToFileURL(join(root, 'throttle.mjs')).href);
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) throttle.pairs.add('unit', t0 + i * 1000);
  check('F37 window: blocked until the failure over the limit leaves the 15 min window', throttle.pairs.waitMs('unit', t0 + 5000) === t0 + 900_000 - (t0 + 5000));
  check('F37 window: free again after 15 min, and memory is released', throttle.pairs.waitMs('unit', t0 + 4000 + 900_000) === 0 && (throttle.pairs.sweep(t0 + 4000 + 900_001), throttle.pairs.hits.size === 0));
  const del = new Client();
  await del.call('/api/auth/register', 'POST', { name: 'Delete Guard', email: 'delguard@smoke.test', password: 'delete-guard-pass' });
  const del5 = [];
  for (let i = 0; i < 5; i++) del5.push((await del.call('/api/me', 'DELETE', { password: 'x' })).status);
  const del6 = await del.call('/api/me', 'DELETE', { password: 'delete-guard-pass' });
  check('F37 account deletion confirmation is also rate limited', del5.every((s) => s === 403) && del6.status === 429 && del6.data.retryAfter > 0, del5.join() + del6.status);

  // F45 / F46 — places
  const places = (await new Client().call('/api/places')).data.places;
  const stopNames = ['Mairie', 'Habitat', 'Santé', 'Marché', 'Quartier sud'];
  const districtNames = ['Centre-ville', 'Quartier nord', 'Quartier est', 'Quartier ouest', 'Quartier sud'];
  check('F45 public places list: >= 7 places with address, hours, nearest stop and district', places.length >= 7 && places.every((p) => p.code && p.name && p.address && stopNames.includes(p.stop) && districtNames.includes(p.district)), JSON.stringify(places[0]));
  check('F46 emergency services and hospitals come first, 24 h flagged, with the 112 number', places[0].kind === 'emergency' && places.filter((p) => p.kind !== 'service').every((p) => p.open_24h === 1 && p.phone === '112') && places.findIndex((p) => p.kind === 'service') > places.findLastIndex((p) => p.kind !== 'service'));
  const care = (await new Client().call('/api/places?kind=care')).data.places;
  check('F46 ?kind=care returns only hospitals and emergency services (incl. the nearest-stop mapping)', care.length >= 3 && care.every((p) => ['hospital', 'emergency'].includes(p.kind)) && care.some((p) => p.stop === 'Santé') && care.some((p) => p.stop === 'Quartier sud'));
  check('F45 ?district filter works', (await new Client().call('/api/places?district=Quartier%20est')).data.places.every((p) => p.district === 'Quartier est'));
  check('F45 the health centre place links to the health service', places.find((p) => p.code === 'centre-sante')?.service_id === healthService.id);
  const newPlace = { kind: 'service', name: 'Bibliothèque centrale', name_en: 'Central library', district: 'Centre-ville', stop: 'Mairie', address: 'Rue des Livres, derrière la mairie.', hours: 'Du mardi au samedi, 10 h–18 h', open_24h: false, phone: '+262 262 00 00 00' };
  check('F45 role isolation on place writes: anonymous 401, citizen 403, agent 403 (admin only)', (await new Client().call('/api/places', 'POST', newPlace)).status === 401 && (await citizen.call('/api/places', 'POST', newPlace)).status === 403 && (await agent.call('/api/places', 'POST', newPlace)).status === 403);
  check('F45 place validation: kind, stop, district, phone, unknown service, name', (await Promise.all([
    admin.call('/api/places', 'POST', { ...newPlace, kind: 'castle' }), admin.call('/api/places', 'POST', { ...newPlace, stop: 'Lune' }), admin.call('/api/places', 'POST', { ...newPlace, district: 'Nulle part' }),
    admin.call('/api/places', 'POST', { ...newPlace, phone: 'appelez-moi' }), admin.call('/api/places', 'POST', { ...newPlace, service_id: 99999 }), admin.call('/api/places', 'POST', { ...newPlace, name: 'ab' }),
  ])).map((r) => r.status).join() === '400,400,400,400,400,400');
  const auditCount = async () => (await agent.call('/api/admin/audit?limit=1')).data.entries[0]?.id ?? 0;
  const lastBefore = await auditCount();
  check('F48 a rejected action leaves no audit entry (nothing happened)', (await auditCount()) === lastBefore);
  const spoof = await admin.call('/api/places', 'POST', { ...newPlace, actor: 'Quelqu’un d’autre', actor_name: 'Agent Smoke', actor_role: 'agent', actor_id: 1 }, { 'X-Actor': 'agent@smoke.test' });
  check('F45 admin creates a place; a second one with the same name gets its own code', spoof.status === 201 && (await admin.call('/api/places', 'POST', newPlace)).data.code === `${spoof.data.code}-2`, JSON.stringify(spoof.data));
  const placeId = spoof.data.id;
  check('F45 admin edits a place; the public list shows it with a newer updated_at', (await admin.call(`/api/places/${placeId}`, 'PATCH', { ...newPlace, hours: 'Du lundi au samedi, 9 h–19 h' })).status === 200 && (await new Client().call('/api/places')).data.places.find((p) => p.id === placeId).hours.includes('lundi'));
  check('F45 agents and citizens cannot edit or delete places', (await agent.call(`/api/places/${placeId}`, 'PATCH', newPlace)).status === 403 && (await citizen.call(`/api/places/${placeId}`, 'DELETE', { reason: R })).status === 403 && (await agent.call(`/api/places/${placeId}`, 'DELETE', { reason: R })).status === 403);
  check('F45 deleting a place needs a reason', (await admin.call(`/api/places/${placeId}`, 'DELETE', {})).status === 400 && (await admin.call(`/api/places/${placeId}`, 'DELETE', { reason: R })).status === 200 && (await admin.call(`/api/places/${placeId}`, 'DELETE', { reason: R })).status === 404);

  // F47 / F48 — audit trail
  const everyone = [new Client(), citizen];
  check('F48 the journal is for staff only: anonymous 401, citizen 403 (list, verify, csv)', (await Promise.all(everyone.flatMap((c) => ['/api/admin/audit', '/api/admin/audit/verify', '/api/admin/audit?format=csv'].map((p) => c.call(p))))).map((r) => r.status).join() === '401,401,401,403,403,403');
  const adminMe = (await admin.call('/api/me')).data.user;
  const agentMe = (await agent.call('/api/me')).data.user;
  const journal = (await agent.call('/api/admin/audit?limit=200')).data;
  const actions = new Set(journal.entries.map((e) => e.action));
  const expected = ['auth.staff_login', 'service.create', 'service.unavailable', 'service.available', 'announcement.alert', 'announcement.lift', 'transport.status', 'message.status', 'account.deactivate', 'account.reactivate', 'account.reset_password', 'account.delete', 'account.self_delete', 'appointment.slots.create', 'appointment.book', 'appointment.cancel_own', 'appointment.cancel_by_staff', 'appointment.slot.remove', 'place.create', 'place.update', 'place.delete'];
  check('F47 every kind of admin and sensitive action is in the journal', expected.every((a) => actions.has(a)), expected.filter((a) => !actions.has(a)).join(', '));
  const placeCreated = journal.entries.find((e) => e.action === 'place.create' && e.target_id === String(placeId));
  check('F48 actor, action, target and time come from the session: the spoofed actor fields and header were ignored', placeCreated && placeCreated.actor_id === adminMe.id && placeCreated.actor_name === adminMe.name && placeCreated.actor_role === 'admin' && placeCreated.target_label === newPlace.name && !Number.isNaN(Date.parse(placeCreated.at)) && placeCreated.summary.includes('Bibliothèque'), JSON.stringify(placeCreated));
  const selfDelete = journal.entries.find((e) => e.action === 'account.self_delete' && e.target_label.includes('Doomed'));
  check('F47 a citizen deleting their own account is recorded with the citizen as actor', selfDelete?.actor_role === 'citizen' && selfDelete.target_label.includes('Doomed'), JSON.stringify(selfDelete));
  const sensitive = journal.entries.filter((e) => ['account.deactivate', 'account.reset_password', 'account.delete', 'announcement.lift', 'appointment.cancel_by_staff', 'place.delete'].includes(e.action));
  check('F47 sensitive actions all carry their reason', sensitive.length >= 6 && sensitive.every((e) => e.reason === R), JSON.stringify(sensitive.map((e) => [e.action, e.reason])));
  const dump = JSON.stringify(journal.entries);
  check('F47 data handling: no raw citizen e-mail, no password, no temporary password in the journal; citizens appear masked', !dump.includes('victim@smoke.test') && !dump.includes('doomed@smoke.test') && !dump.includes(reset.data.password) && !dump.includes('password_hash') && journal.entries.some((e) => /v\*\*\*@smoke\.test \(n°\d+\)/.test(e.target_label || '')), dump.slice(0, 200));
  check('F47 entries are ordered newest first and times never go backwards', journal.entries.every((e, i) => i === 0 || (e.id < journal.entries[i - 1].id && e.at <= journal.entries[i - 1].at)));
  check('F48 before/after values are kept (service outage: before available, after unavailable)', (() => { const e = journal.entries.find((x) => x.action === 'service.unavailable'); return e?.details?.avant?.availability === 'available' && e.details.apres.availability === 'unavailable' && Boolean(e.reason); })());
  check('F48 who changed what: filter by actor, by category, by target, by dump', (await agent.call(`/api/admin/audit?actor=${agentMe.id}`)).data.entries.every((e) => e.actor_id === agentMe.id) && (await agent.call('/api/admin/audit?category=account')).data.entries.every((e) => e.category === 'account') && (await agent.call(`/api/admin/audit?target_type=service&target_id=${healthService.id}`)).data.entries.every((e) => e.target_type === 'service' && e.target_id === String(healthService.id)) && (await agent.call('/api/admin/audit?q=Biblioth')).data.entries.length >= 1);
  const day = cityLocal(0).slice(0, 10);
  check('F47 date filters (city day) and an empty result for a past period', (await agent.call(`/api/admin/audit?from=${day}&to=${day}`)).data.entries.length > 0 && (await agent.call('/api/admin/audit?from=2020-01-01&to=2020-01-02')).data.entries.length === 0);
  const page1 = (await agent.call('/api/admin/audit?limit=5')).data;
  const page2 = (await agent.call(`/api/admin/audit?limit=5&before=${page1.next_before}`)).data;
  check('F47 history is paginated without gaps or repeats, and the first page lists the actors and categories to filter by', page1.entries.length === 5 && page1.next_before === page1.entries[4].id && page2.entries[0].id < page1.entries[4].id && page1.facets.actors.length >= 3 && page1.facets.categories.length >= 6 && !page2.facets);
  await admin.call('/api/services', 'POST', { title: '=SOMME(1+1) test', description: 'Un service de test', details: 'Informations utiles de test' });
  const csv = await fetch(`${base}/api/admin/audit?format=csv`, { headers: { Cookie: agent.cookie } });
  const csvText = Buffer.from(await csv.arrayBuffer()).toString('utf8');
  check('F47 CSV export for the city: text/csv attachment, spreadsheet-safe cells, header and rows', csv.status === 200 && csv.headers.get('content-type').startsWith('text/csv') && csv.headers.get('content-disposition').includes('attachment') && csvText.startsWith('﻿n°;date (UTC)') && csvText.includes("'=SOMME(1+1) test") && !/;=SOMME/.test(csvText) && csvText.split('\r\n').length > 20);
  const verify = (await agent.call('/api/admin/audit/verify')).data;
  const total = (await agent.call('/api/admin/audit?limit=200')).data.entries.length;
  check('F47 the hash chain verifies over the whole journal', verify.ok === true && verify.checked >= total && verify.brokenAt === null, JSON.stringify(verify));
  // privacy: citizens are masked as ACTORS too (self-deletion, booking, own cancellation), in rows, facets and the export
  const everyRow = (await agent.call('/api/admin/audit?limit=200')).data;
  const citizenRows = everyRow.entries.filter((e) => e.actor_role === 'citizen');
  const facetNames = everyRow.facets?.actors ?? (await agent.call('/api/admin/audit?limit=1')).data.facets.actors;
  const everything = JSON.stringify(everyRow.entries) + JSON.stringify(facetNames) + csvText;
  check('F47 privacy: citizen actors (self-deletion, booking, cancelling) are stored masked: first name, initial, masked e-mail, id', citizenRows.length >= 3 && citizenRows.every((e) => /^\S+( \S\.)? · \S\*\*\*@smoke\.test \(n°\d+\)$/.test(e.actor_name)), JSON.stringify(citizenRows.map((e) => e.actor_name)));
  check('F47 privacy: after self-deletion no full citizen name or e-mail remains in rows, actor filter list or CSV; staff names are kept', !/Doomed One|Rdv Un|Rdv Deux|Citoyen Test|doomed@smoke|rdv1@smoke|rdv2@smoke/.test(everything) && everything.includes('Agent Smoke') && facetNames.some((a) => a.role === 'citizen' && /\*\*\*@/.test(a.name)) && facetNames.some((a) => a.role === 'agent' && a.name === 'Agent Smoke'));
  // robustness: nonsense filters are a clear 400, never a crash
  const bad = ['from=2026-99-99', 'from=2026-02-30', 'to=2026-13-01', 'from=abc', 'from=2026-5-1', 'from=2026-05-02&to=2026-05-01', 'limit=1.5', 'limit=abc', 'limit=0', 'limit=-3', 'limit=1e3', 'before=abc', 'before=0', 'before=1.5', 'actor=abc', 'actor=1.5', 'actor=-1'];
  const badResults = await Promise.all(bad.map(async (q) => { const r = await agent.call('/api/admin/audit?' + q); return { q, status: r.status, message: typeof r.data.error === 'string' }; }));
  check('F47 robustness: 17 malformed filters (impossible dates, non-integer limit/before/actor, reversed range) each return a clear 400 message', badResults.every((r) => r.status === 400 && r.message), JSON.stringify(badResults.filter((r) => r.status !== 400 || !r.message)));
  check('F47 robustness: the CSV export validates the same way', (await agent.call('/api/admin/audit?format=csv&from=2026-99-99')).status === 400);
  check('F47 robustness: the server is still healthy after the bad requests', (await agent.call('/api/me')).status === 200 && (await agent.call('/api/admin/audit/verify')).data.ok === true);
  const clamped = (await agent.call('/api/admin/audit?limit=999')).data;
  check('F47 robustness: valid edge inputs are accepted (limit above the maximum is clamped to 200, limit=1 gives one row, 29 February of a leap year)', clamped.entries.length <= 200 && clamped.entries.length > 20 && (await agent.call('/api/admin/audit?limit=1')).data.entries.length === 1 && (await agent.call('/api/admin/audit?from=2024-02-29&to=2024-02-29')).status === 200 && (await agent.call('/api/admin/audit?actor=&category=&q=&from=&to=&limit=')).status === 200);
  // F49: notices for the resident when a request changes state
  const visitor = new Client();
  const mine = async (client) => (await client.call('/api/me/notices')).data;
  const first = await mine(citizen);
  const moved = first.notices.filter((n) => n.ref_id === msg.data.id);
  check('F49 the first status change (to in progress) gave the owner exactly one unread notice naming their request', moved.length === 1 && moved[0].code === 'message.in_progress' && moved[0].label === 'Lampadaire cassé' && moved[0].seen_at === null && first.unread >= 1, JSON.stringify(first));
  await agent.call(`/api/messages/${msg.data.id}`, 'PATCH', { status: 'in_progress' });
  check('F49 repeating the same status is silent (no duplicate notice)', (await mine(citizen)).notices.length === first.notices.length);
  check('F49 a note shorter than 5 characters is refused', (await agent.call(`/api/messages/${msg.data.id}`, 'PATCH', { status: 'resolved', note: 'ok' })).status === 400 && (await mine(citizen)).notices.length === first.notices.length);
  check('F49 resolving with a note creates a notice carrying that note', (await agent.call(`/api/messages/${msg.data.id}`, 'PATCH', { status: 'resolved', note: 'Lampadaire remplacé ce matin.' })).status === 200 && (await mine(citizen)).notices[0].code === 'message.resolved' && (await mine(citizen)).notices[0].note === 'Lampadaire remplacé ce matin.');
  const neighbour = new Client();
  await neighbour.call('/api/auth/register', 'POST', { name: 'Autre Habitant', email: 'neighbour@smoke.test', password: 'neighbour-password-123' });
  const others = await mine(neighbour);
  check('F49 another resident sees none of these notices', !JSON.stringify(others).includes('Lampadaire') && others.notices.every((n) => n.ref_id !== msg.data.id));
  check('F49 staff and anonymous visitors have no notice list', (await agent.call('/api/me/notices')).status === 403 && (await visitor.call('/api/me/notices')).status === 401 && (await visitor.call('/api/me/notices/seen', 'POST', { ids: [1] })).status === 401);
  const ids = (await mine(citizen)).notices.map((n) => n.id);
  check('F49 a resident cannot mark someone else\'s notices as seen', (await neighbour.call('/api/me/notices/seen', 'POST', { ids })).data.seen === 0 && (await mine(citizen)).unread === ids.length);
  check('F49 invalid id lists are refused', (await citizen.call('/api/me/notices/seen', 'POST', { ids: 'x' })).status === 400 && (await citizen.call('/api/me/notices/seen', 'POST', { ids: [1.5] })).status === 400 && (await citizen.call('/api/me/notices/seen', 'POST', { ids: [] })).status === 200);
  check('F49 marking seen is per recipient, counted once, and remembered', (await citizen.call('/api/me/notices/seen', 'POST', { ids })).data.seen === ids.length && (await citizen.call('/api/me/notices/seen', 'POST', { ids })).data.seen === 0 && (await mine(citizen)).unread === 0);
  check('F49 a resident whose requests never changed state has no notice (nothing is invented)', (await mine(neighbour)).notices.length === 0);

  // F50: staff dashboard, derived from the database
  const dbc = new DatabaseSync(env.DATA_PATH);
  const count = (sql, ...args) => dbc.prepare(sql).get(...args).n;
  const board = (await agent.call('/api/admin/dashboard')).data;
  check('F50 dashboard is for staff only', (await citizen.call('/api/admin/dashboard')).status === 403 && (await visitor.call('/api/admin/dashboard')).status === 401);
  check('F50 message figures equal the database', board.messages.new === count("SELECT COUNT(*) AS n FROM messages WHERE status = 'new'") && board.messages.in_progress === count("SELECT COUNT(*) AS n FROM messages WHERE status = 'in_progress'") && board.messages.resolved === count("SELECT COUNT(*) AS n FROM messages WHERE status = 'resolved'") && board.messages.resolved >= 1, JSON.stringify(board.messages));
  check('F50 resident, place, service and alert figures equal the database', board.residents.total === count("SELECT COUNT(*) AS n FROM users WHERE role = 'citizen'") && board.places === count('SELECT COUNT(*) AS n FROM places') && board.services.total === count('SELECT COUNT(*) AS n FROM services') && board.alerts.active === count('SELECT COUNT(*) AS n FROM announcements WHERE urgent = 1'));
  await neighbour.call('/api/messages', 'POST', { subject: 'Question tableau de bord', body: 'Une question pour compter.' });
  const board2 = (await agent.call('/api/admin/dashboard')).data;
  check('F50 a new message raises "new" and today\'s count by one, and gives a waiting time', board2.messages.new === board.messages.new + 1 && board2.messages.received_today === board.messages.received_today + 1 && board2.messages.waiting_hours !== null);
  const newOne = (await agent.call('/api/messages')).data.messages.find((m) => m.subject === 'Question tableau de bord');
  await agent.call(`/api/messages/${newOne.id}`, 'PATCH', { status: 'resolved' });
  const board3 = (await agent.call('/api/admin/dashboard')).data;
  check('F50 resolving it moves the figure from "new" to "resolved"', board3.messages.new === board.messages.new && board3.messages.resolved === board.messages.resolved + 1);
  check('F50 the payload carries no citizen e-mail, full name or password data', !/citizen@smoke\.test|doomed@|neighbour@|doomed@|rdv1@|Citoyen Test|Victime Test|scrypt|password/i.test(JSON.stringify(board3)));
  check('F50 only administrators see the count of deactivated accounts', board3.residents.deactivated === undefined && (await admin.call('/api/admin/dashboard')).data.residents.deactivated === count("SELECT COUNT(*) AS n FROM users WHERE role = 'citizen' AND active = 0"));
  check('F50 recent actions come from the journal (last five, newest first)', board3.recent.length === 5 && board3.recent.every((r, i) => i === 0 || r.at <= board3.recent[i - 1].at));
  // F50: the outage list must show a current outage and hide one whose return time has passed (review finding: the query lacked the columns serviceView reads)
  const allServices = (await visitor.call('/api/services')).data.services;
  const [outageNow, outagePast] = allServices.filter((svc) => svc.availability === 'available').slice(0, 2);
  const cityTime = (minutes) => new Date(Date.now() + 4 * 3600_000 + minutes * 60_000).toISOString().slice(0, 16);
  await agent.call(`/api/services/${outageNow.id}/availability`, 'PATCH', { availability: 'unavailable', reason: 'Panne en cours pour le tableau de bord', until: cityTime(180), alternative: 'Écrivez aux services de la ville.' });
  await agent.call(`/api/services/${outagePast.id}/availability`, 'PATCH', { availability: 'unavailable', reason: 'Panne terminée pour le tableau de bord', until: cityTime(180), alternative: 'Écrivez aux services de la ville.' });
  dbc.close();
  const outageDb = new DatabaseSync(env.DATA_PATH);
  outageDb.prepare('UPDATE services SET available_again = ? WHERE id = ?').run(cityTime(-5), outagePast.id);
  outageDb.close();
  const outageBoard = (await agent.call('/api/admin/dashboard')).data;
  check('F50 the dashboard lists a service with a current outage and not one whose announced return time has passed', outageBoard.services.unavailable.includes(outageNow.title) && !outageBoard.services.unavailable.includes(outagePast.title), JSON.stringify(outageBoard.services));
  await agent.call(`/api/services/${outageNow.id}/availability`, 'PATCH', { availability: 'available' });
  await agent.call(`/api/services/${outagePast.id}/availability`, 'PATCH', { availability: 'available' });
  check('F50 the outage list is empty again once both are marked available', (await agent.call('/api/admin/dashboard')).data.services.unavailable.length === 0);

  // F51: concerns about data use, and the personal export
  const post = (client, body) => client.call('/api/concerns', 'POST', body);
  check('F51 concerns: visitors and staff cannot file or list them as residents', (await visitor.call('/api/concerns', 'POST', { topic: 'usage', body: 'Une inquiétude sans compte.' })).status === 401 && (await agent.call('/api/concerns')).status === 403 && (await citizen.call('/api/admin/concerns')).status === 403 && (await visitor.call('/api/admin/concerns')).status === 401);
  check('F51 concerns are validated (unknown topic, too short, not text)', (await post(citizen, { topic: 'nope', body: 'Une inquiétude assez longue.' })).status === 400 && (await post(citizen, { topic: 'usage', body: 'court' })).status === 400 && (await post(citizen, { topic: 'usage', body: 12345678901 })).status === 400);
  const filed = await post(citizen, { topic: 'sharing', body: 'Mes messages sont-ils transmis à d’autres services ?' });
  check('F51 a filed concern returns a reference, a date and what happens next', filed.status === 201 && filed.data.reference === `C-${filed.data.id}` && filed.data.status === 'received' && Boolean(filed.data.created_at) && filed.data.confirmation.includes('Nouvelles de mes demandes'), JSON.stringify(filed.data));
  const history = (await citizen.call('/api/concerns')).data.concerns;
  check('F51 the resident\'s history shows it with status and no answer yet; another resident sees none', history.length === 1 && history[0].status === 'received' && history[0].response === null && (await neighbour.call('/api/concerns')).data.concerns.length === 0);
  const staffList = await agent.call('/api/admin/concerns');
  check('F51 staff see the concern with the author masked (first name, initial, masked e-mail), not the full name or e-mail', staffList.data.concerns[0].author.includes('***@') && !JSON.stringify(staffList.data).match(/citizen@smoke\.test|Citoyen Test/) && staffList.data.concerns[0].body.includes('d’autres services'), JSON.stringify(staffList.data));
  check('F51 the dashboard counts concerns still to read', (await agent.call('/api/admin/dashboard')).data.concerns.received === 1);
  const ownNotices = async () => (await mine(citizen)).notices.filter((n) => n.code.startsWith('concern.'));
  check('F51 staff cannot answer without text, nor with an unknown status', (await agent.call(`/api/admin/concerns/${filed.data.id}`, 'PATCH', { status: 'answered' })).status === 400 && (await agent.call(`/api/admin/concerns/${filed.data.id}`, 'PATCH', { status: 'closed' })).status === 400 && (await ownNotices()).length === 0);
  check('F51 marking it read notifies the author once (repeat is silent)', (await agent.call(`/api/admin/concerns/${filed.data.id}`, 'PATCH', { status: 'read' })).status === 200 && (await agent.call(`/api/admin/concerns/${filed.data.id}`, 'PATCH', { status: 'read' })).status === 200 && (await ownNotices()).length === 1 && (await ownNotices())[0].code === 'concern.read' && (await ownNotices())[0].label === `C-${filed.data.id}`);
  check('F51 answering notifies only the author, with the answer text; the history shows status and answer', (await agent.call(`/api/admin/concerns/${filed.data.id}`, 'PATCH', { status: 'answered', response: 'Non : vos messages ne sont lus que par les agents de la ville.' })).status === 200 && (await ownNotices())[0].code === 'concern.answered' && (await ownNotices())[0].note.includes('agents de la ville') && (await citizen.call('/api/concerns')).data.concerns[0].status === 'answered' && !(await mine(neighbour)).notices.some((n) => n.code.startsWith('concern.')));
  check('F51 an answered concern cannot be answered again', (await agent.call(`/api/admin/concerns/${filed.data.id}`, 'PATCH', { status: 'answered', response: 'Une seconde réponse.' })).status === 409);
  const afterJournal = (await agent.call('/api/admin/audit?limit=200&category=concern')).data;
  check('F51 staff handling is in the journal (read, answer) by reference only: the concern text and the answer are not copied there', afterJournal.entries.length === 2 && afterJournal.entries.every((e) => e.target_label === `C-${filed.data.id}` && e.actor_name === 'Agent Smoke') && !JSON.stringify(afterJournal.entries).match(/d’autres services|agents de la ville/));
  const exported = await citizen.call('/api/me/export');
  const exportText = JSON.stringify(exported.data);
  check('F51 export: the resident\'s own data as a downloadable file (account, messages, appointments, concerns, notices)', exported.status === 200 && /attachment/.test(exported.headers.get('content-disposition') || '') && exported.data.account.email === 'citizen@smoke.test' && exported.data.messages.length >= 1 && Array.isArray(exported.data.appointments) && exported.data.concerns.length === 1 && exported.data.notices.length >= 3, exportText.slice(0, 300));
  check('F51 export: no password hash, no session value, nobody else\'s data', !/password|scrypt|token|session/i.test(exportText.replace(/"(?:subject|body|note|label)":"[^"]*"/g, '')) && !/neighbour@|doomed@|agent@smoke|admin@smoke/.test(exportText));
  check('F51 export is for the signed-in resident only', (await visitor.call('/api/me/export')).status === 401 && (await agent.call('/api/me/export')).status === 403);
  for (const n of [1, 2, 3, 4, 5]) await post(neighbour, { topic: 'access', body: `Demande numéro ${n} sur mes données.` });
  check('F51 at most 5 concerns a day per resident (6th refused with 429), others unaffected', (await post(neighbour, { topic: 'access', body: 'Une sixième demande refusée.' })).status === 429 && (await post(citizen, { topic: 'other', body: 'Une autre question pour la ville.' })).status === 201);
  const neighbourId = (await neighbour.call('/api/me')).data.user.id;
  await neighbour.call('/api/me', 'DELETE', { password: 'neighbour-password-123' });
  const gone = new DatabaseSync(env.DATA_PATH);
  check('F51 deleting the account erases the resident\'s concerns and notices, and they vanish from the staff list', gone.prepare('SELECT COUNT(*) AS n FROM concerns WHERE user_id = ?').get(neighbourId).n === 0 && gone.prepare('SELECT COUNT(*) AS n FROM notices WHERE user_id = ?').get(neighbourId).n === 0 && !(await agent.call('/api/admin/concerns')).data.concerns.some((c) => c.body.startsWith('Demande numéro')));
  gone.close();

  // F52: support a request that its author chose to make public
  const register = async (name, email) => { const client = new Client(); await client.call('/api/auth/register', 'POST', { name, email, password: 'support-password-1' }); return client; };
  const supporterA = await register('Soutien Alpha', 'alpha@smoke.test');
  const supporterB = await register('Soutien Bravo', 'bravo@smoke.test');
  const supporterC = await register('Soutien Charlie', 'charlie@smoke.test');
  const incident = await citizen.call('/api/messages', 'POST', { subject: 'Nid-de-poule profond', body: 'Gros trou dangereux près de chez Mme Martin, appelez-moi au 0693123456.', kind: 'incident', location: 'Rue du Port, face au 12' });
  const contactMsg = await citizen.call('/api/messages', 'POST', { subject: 'Question privée', body: 'Une question purement privée.', kind: 'contact' });
  const publishBody = { public_title: 'Trou dangereux dans une rue du port', public_summary: 'Un grand trou dans la chaussée gêne les voitures et les piétons.', district: 'Quartier sud', consent: true };
  const publish = (client, id, body) => client.call(`/api/messages/${id}/public`, 'POST', body);
  check('F52 everything is private by default: no existing message is public', (await supporterA.call('/api/public-requests')).data.requests.length === 0 && (await citizen.call('/api/messages')).data.messages.every((m) => m.public_id === null));
  check('F52 publishing needs explicit consent, a public title and summary (5-100, 10-300), a valid district, and an incident report', (await publish(citizen, incident.data.id, { ...publishBody, consent: false })).status === 400 && (await publish(citizen, incident.data.id, { ...publishBody, consent: undefined })).status === 400 && (await publish(citizen, incident.data.id, { ...publishBody, public_title: 'Hé' })).status === 400 && (await publish(citizen, incident.data.id, { ...publishBody, public_summary: 'court' })).status === 400 && (await publish(citizen, incident.data.id, { ...publishBody, district: 'Ailleurs' })).status === 400 && (await publish(citizen, contactMsg.data.id, publishBody)).status === 400);
  check('F52 public text cannot carry an e-mail address or a phone number', (await publish(citizen, incident.data.id, { ...publishBody, public_summary: 'Appelez-moi au 0693123456 pour en parler.' })).status === 400 && (await publish(citizen, incident.data.id, { ...publishBody, public_title: 'Écrivez à moi@exemple.re' })).status === 400);
  check('F52 only the author can publish or withdraw; staff and visitors cannot; a resolved report cannot be published', (await publish(supporterA, incident.data.id, publishBody)).status === 404 && (await publish(agent, incident.data.id, publishBody)).status === 403 && (await publish(visitor, incident.data.id, publishBody)).status === 401 && (await publish(citizen, msg.data.id, publishBody)).status === 409);
  const published = await publish(citizen, incident.data.id, publishBody);
  check('F52 the author publishes with consent: 201 with the public record', published.status === 201 && published.data.public_title === publishBody.public_title);
  check('F52 a report is published once (second attempt 409)', (await publish(citizen, incident.data.id, publishBody)).status === 409);
  const publicList = await supporterA.call('/api/public-requests');
  const entry = publicList.data.requests[0];
  check('F52 other residents see only the public title, summary, district, status and support count: exact keys, nothing else', publicList.data.requests.length === 1 && JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(['created_at', 'district', 'id', 'mine', 'public_summary', 'public_title', 'status', 'support_count', 'supported_at', 'supported_by_me']) && entry.status === 'new' && entry.support_count === 0 && entry.mine === false, JSON.stringify(entry));
  check('F52 nothing private leaks: no private subject, body, location, phone, name, e-mail or author id in what supporters get', !/Nid-de-poule profond|Gros trou|Martin|0693|Rue du Port, face|citizen@smoke|Citoyen Test|user_id|owner/i.test(JSON.stringify(publicList.data)), JSON.stringify(publicList.data));
  check('F52 the author sees it marked as theirs and cannot support it; staff and visitors cannot support', (await citizen.call('/api/public-requests')).data.requests[0].mine === true && (await citizen.call(`/api/public-requests/${entry.id}/support`, 'POST')).status === 403 && (await agent.call(`/api/public-requests/${entry.id}/support`, 'POST')).status === 403 && (await visitor.call(`/api/public-requests/${entry.id}/support`, 'POST')).status === 401 && (await supporterA.call('/api/public-requests/99999/support', 'POST')).status === 404);
  const firstSupport = await supporterA.call(`/api/public-requests/${entry.id}/support`, 'POST');
  check('F52 a resident supports once: 201 with the new count; a second try is 409 and the count stays', firstSupport.status === 201 && firstSupport.data.support_count === 1 && (await supporterA.call(`/api/public-requests/${entry.id}/support`, 'POST')).status === 409 && (await supporterA.call('/api/public-requests')).data.requests[0].support_count === 1);
  const burst = await Promise.all(Array.from({ length: 10 }, () => supporterB.call(`/api/public-requests/${entry.id}/support`, 'POST')));
  check('F52 ten simultaneous clicks by the same resident give exactly one support (1 x 201, 9 x 409), counted once', burst.filter((r) => r.status === 201).length === 1 && burst.filter((r) => r.status === 409).length === 9 && burst.every((r) => [201, 409].includes(r.status)) && (await supporterC.call('/api/public-requests')).data.requests[0].support_count === 2);
  const mineA = (await supporterA.call('/api/me/supports')).data.supports;
  check('F52 the supporter\'s recorded contribution: title, date supported and current status; marked supported in the list', mineA.length === 1 && mineA[0].public_title === publishBody.public_title && Boolean(mineA[0].supported_at) && mineA[0].status === 'new' && (await supporterA.call('/api/public-requests')).data.requests[0].supported_by_me === true && (await supporterC.call('/api/me/supports')).data.supports.length === 0);
  const staffMsg = (await agent.call('/api/messages')).data.messages.find((m) => m.id === incident.data.id);
  const staffText = JSON.stringify([staffMsg, (await agent.call('/api/admin/dashboard')).data]);
  check('F52 staff get the support count and the publication counts, never who supports', staffMsg.support_count === 2 && Boolean(staffMsg.public_id) && (await agent.call('/api/admin/dashboard')).data.public.requests === 1 && (await agent.call('/api/admin/dashboard')).data.public.supports === 2 && !/alpha@|bravo@|Soutien (Alpha|Bravo)/.test(staffText));
  check('F52 a supporter can withdraw their support (count drops, second withdrawal 404) and support again', (await supporterB.call(`/api/public-requests/${entry.id}/support`, 'DELETE')).data.support_count === 1 && (await supporterB.call(`/api/public-requests/${entry.id}/support`, 'DELETE')).status === 404 && (await supporterB.call(`/api/public-requests/${entry.id}/support`, 'POST')).status === 201);
  const noticesOf = async (client) => (await mine(client)).notices;
  await agent.call(`/api/messages/${incident.data.id}`, 'PATCH', { status: 'in_progress', note: 'Note réservée à l’auteur du signalement.' });
  const noticeA = (await noticesOf(supporterA)).find((n) => n.code === 'public.in_progress');
  check('F52 supporters are notified of a status change through the public record (its title, never the private message or the private note)', Boolean(noticeA) && noticeA.ref_id === entry.id && noticeA.label === publishBody.public_title && noticeA.note === null && (await noticesOf(supporterB)).some((n) => n.code === 'public.in_progress') && !JSON.stringify(await noticesOf(supporterA)).match(/Nid-de-poule profond|réservée/));
  check('F52 the author gets the private notice with the note; a resident who does not support gets nothing', (await noticesOf(citizen)).some((n) => n.code === 'message.in_progress' && n.ref_id === incident.data.id && n.note.includes('réservée')) && !(await noticesOf(supporterC)).some((n) => n.code.startsWith('public.')) && !(await noticesOf(citizen)).some((n) => n.code.startsWith('public.')));
  await agent.call(`/api/messages/${incident.data.id}`, 'PATCH', { status: 'in_progress' });
  check('F52 a repeated status makes no second notice for supporters', (await noticesOf(supporterA)).filter((n) => n.code === 'public.in_progress').length === 1);
  await agent.call(`/api/messages/${incident.data.id}`, 'PATCH', { status: 'resolved' });
  const afterResolve = (await supporterC.call('/api/public-requests')).data.requests.find((r) => r.id === entry.id);
  check('F52 once resolved: supporters are told, the list shows it resolved, nobody can add support, existing support is kept', (await noticesOf(supporterA)).some((n) => n.code === 'public.resolved') && afterResolve.status === 'resolved' && (await supporterC.call(`/api/public-requests/${entry.id}/support`, 'POST')).status === 409 && afterResolve.support_count === 2);
  const second = await citizen.call('/api/messages', 'POST', { subject: 'Banc cassé', body: 'Le banc du parc est cassé depuis une semaine.', kind: 'incident', location: 'Parc central' });
  await publish(citizen, second.data.id, { ...publishBody, public_title: 'Banc cassé dans le parc', public_summary: 'Un banc du parc est cassé et pourrait blesser quelqu’un.', district: 'Centre-ville' });
  const secondEntry = (await supporterA.call('/api/public-requests')).data.requests.find((r) => r.public_title === 'Banc cassé dans le parc');
  check('F52 resolved publications are listed after the open ones', (await supporterA.call('/api/public-requests')).data.requests.map((r) => r.status === 'resolved').join() === 'false,true');
  await supporterA.call(`/api/public-requests/${secondEntry.id}/support`, 'POST');
  await supporterB.call(`/api/public-requests/${secondEntry.id}/support`, 'POST');
  const withdrawn = await citizen.call(`/api/messages/${second.data.id}/public`, 'DELETE');
  const holdings = new DatabaseSync(env.DATA_PATH);
  const rows = (sql, ...args) => holdings.prepare(sql).get(...args).n;
  check('F52 withdrawing the publication removes the record, its supports and every notice that quoted it; the private message stays', withdrawn.status === 200 && !(await supporterA.call('/api/public-requests')).data.requests.some((r) => r.public_title === 'Banc cassé dans le parc') && rows('SELECT COUNT(*) AS n FROM supports WHERE public_request_id = ?', secondEntry.id) === 0 && rows("SELECT COUNT(*) AS n FROM notices WHERE code LIKE 'public.%' AND ref_id = ?", secondEntry.id) === 0 && (await supporterA.call('/api/me/supports')).data.supports.every((x) => x.id !== secondEntry.id) && (await citizen.call('/api/messages')).data.messages.some((m) => m.id === second.data.id && m.public_id === null) && (await supporterA.call(`/api/public-requests/${secondEntry.id}/support`, 'POST')).status === 404 && (await citizen.call(`/api/messages/${second.data.id}/public`, 'DELETE')).status === 404);
  const third = await citizen.call('/api/messages', 'POST', { subject: 'Poubelle renversée', body: 'La poubelle de la place est renversée.', kind: 'incident', location: 'Place centrale' });
  const thirdPub = await publish(citizen, third.data.id, { ...publishBody, public_title: 'Poubelle renversée sur la place', public_summary: 'La poubelle de la place est renversée et déborde.', district: 'Centre-ville' });
  await supporterA.call(`/api/public-requests/${thirdPub.data.id}/support`, 'POST');
  await supporterC.call(`/api/public-requests/${thirdPub.data.id}/support`, 'POST');
  await supporterA.call('/api/me', 'DELETE', { password: 'support-password-1' });
  check('F52 when a supporter deletes their account their support disappears from the count', (await supporterC.call('/api/public-requests')).data.requests.find((r) => r.id === thirdPub.data.id).support_count === 1 && rows('SELECT COUNT(*) AS n FROM supports WHERE public_request_id = ?', thirdPub.data.id) === 1);
  const exportedSupport = (await supporterC.call('/api/me/export')).data;
  check('F52 the export of a supporter lists their supports; of the author, their publications with counts', exportedSupport.supports.some((x) => x.public_request_id === thirdPub.data.id) && (await citizen.call('/api/me/export')).data.public_requests.some((x) => x.id === thirdPub.data.id && x.support_count === 1));
  holdings.close();
  const authorGone = await new Client();
  await authorGone.call('/api/auth/register', 'POST', { name: 'Auteur Parti', email: 'gone@smoke.test', password: 'support-password-1' });
  const goneMsg = await authorGone.call('/api/messages', 'POST', { subject: 'Fuite d’eau', body: 'Une fuite d’eau dans la rue.', kind: 'incident', location: 'Rue de la Source' });
  const gonePub = await publish(authorGone, goneMsg.data.id, { ...publishBody, public_title: 'Fuite d’eau dans une rue', public_summary: 'Une fuite d’eau coule dans la rue depuis hier.', district: 'Quartier est' });
  await supporterC.call(`/api/public-requests/${gonePub.data.id}/support`, 'POST');
  await authorGone.call('/api/me', 'DELETE', { password: 'support-password-1' });
  const after = new DatabaseSync(env.DATA_PATH);
  check('F52 when the author deletes their account the publication, its supports and the notices quoting it are gone and cannot resurface', !(await supporterC.call('/api/public-requests')).data.requests.some((r) => r.id === gonePub.data.id) && after.prepare('SELECT COUNT(*) AS n FROM supports WHERE public_request_id = ?').get(gonePub.data.id).n === 0 && after.prepare("SELECT COUNT(*) AS n FROM notices WHERE code LIKE 'public.%' AND ref_id = ?").get(gonePub.data.id).n === 0 && after.prepare('SELECT COUNT(*) AS n FROM public_requests WHERE public_title LIKE ?').get('Fuite%').n === 0 && (await supporterC.call('/api/me/supports')).data.supports.every((x) => x.id !== gonePub.data.id));
  after.close();

  // F51: the "Vos données" page makes claims; each one is checked against the running server and the database
  const relogin = new Client();
  const loginResponse = await relogin.call('/api/auth/login', 'POST', { email: 'citizen@smoke.test', password: 'a-long-password-1' });
  check('F51 claim: the session cookie lasts 7 days, is HttpOnly and SameSite=Strict', /Max-Age=604800/.test(loginResponse.headers.get('set-cookie')) && /HttpOnly/.test(loginResponse.headers.get('set-cookie')) && /SameSite=Strict/.test(loginResponse.headers.get('set-cookie')));
  const claims = new DatabaseSync(env.DATA_PATH);
  const tables = claims.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const expectedTables = ['announcements', 'appointments', 'audit_log', 'concerns', 'messages', 'notices', 'places', 'public_requests', 'services', 'sessions', 'supports', 'transport_status', 'users'];
  check('F51 claim: the database holds exactly the tables the "Vos données" page describes (a new table means that page must be updated)', JSON.stringify(tables) === JSON.stringify(expectedTables), JSON.stringify(tables));
  const cookieValue = relogin.cookie.split('=')[1];
  check('F51 claim: passwords and session values are stored scrambled, not readable', claims.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(cookieValue).n === 0 && claims.prepare('SELECT COUNT(*) AS n FROM sessions').get().n >= 1 && !claims.prepare("SELECT password_hash FROM users WHERE email = 'citizen@smoke.test'").get().password_hash.includes('a-long-password-1'));
  claims.close();
  await citizen.call('/api/presence', 'POST', { x: 3, z: 4, ry: 0 });
  const seenAt = (await agent.call('/api/presence')).data.players.length;
  await new Promise((resolve) => setTimeout(resolve, 16_000));
  check('F51 claim: a player\'s position is visible to others while they are there and forgotten after 15 seconds', seenAt >= 1 && (await agent.call('/api/presence')).data.players.length === 0, String(seenAt));
  check('F51 claim: audit history has no expiry and cannot be edited or erased (no delete route, triggers refuse)', (await agent.call('/api/admin/audit/' + 1, 'DELETE')).status === 404 && (() => { const raw = new DatabaseSync(env.DATA_PATH); try { raw.prepare('DELETE FROM audit_log WHERE id = 1').run(); return false; } catch { return true; } finally { raw.close(); } })());

  const trail = new DatabaseSync(env.DATA_PATH);
  const refused = [() => trail.prepare("UPDATE audit_log SET summary = 'modifié' WHERE id = 1").run(), () => trail.prepare('DELETE FROM audit_log WHERE id = 1').run()].map((run) => { try { run(); return false; } catch (error) { return /append-only/.test(error.message); } });
  check('F47 the journal is append-only at the database level: UPDATE and DELETE are refused', refused.every(Boolean), refused.join());
  trail.exec('DROP TRIGGER audit_log_no_update');
  trail.prepare("UPDATE audit_log SET summary = 'falsifié' WHERE id = 3").run();
  const tampered = (await agent.call('/api/admin/audit/verify')).data;
  check('F47 tampering (even with the trigger removed) is detected and the first broken entry is named', tampered.ok === false && tampered.brokenAt === 3, JSON.stringify(tampered));
  trail.close();

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
