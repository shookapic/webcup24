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
  check('F39 staff cancel a booking: the citizen sees it cancelled, it is not offered again', (await agent.call(`/api/appointments/${s1.id}`, 'DELETE')).status === 200 && (await winner.call('/api/appointments/mine')).data.appointments.find((a) => a.id === s1.id).status === 'cancelled' && (await loser.call('/api/appointments/slots')).data.slots.every((s) => s.id !== s1.id));
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
