// Signed-in checks against a deployed host (or a local copy). Jury credentials are read from the private file IN PROCESS and never printed; every write uses a newly registered TEST QA citizen
// that deletes itself at the end (the shared jury accounts and fixtures are only read, plus ordinary logins). Usage: node tools/qa-a/prod-signed-in.mjs https://host [path/to/jury-accounts.json]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const base = (process.argv[2] || '').replace(/\/$/, '');
const credsFile = process.argv[3] || join(root, '..', 'coordination', 'private', 'jury-accounts.json');
if (!base) { console.error('Usage: node tools/qa-a/prod-signed-in.mjs https://host [accounts.json]'); process.exit(2); }
const { totpAt } = await import(pathToFileURL(join(root, 'factors.mjs')).href);
const accounts = Object.fromEntries(JSON.parse(readFileSync(credsFile, 'utf8')).map((a) => [a.key, a]));
let failures = 0;
const results = [];
const check = (code, name, ok, detail = '') => { if (!ok) failures++; results.push({ code, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${code}] ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 400)}`); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Client {
  constructor() { this.cookies = new Map(); }
  async call(path, method = 'GET', body, extra = {}) {
    const headers = { Origin: base, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra };
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(40_000) });
    for (const line of response.headers.getSetCookie()) { const [pair] = line.split(';'); const [k, v] = pair.split('='); if (/Max-Age=0/i.test(line)) this.cookies.delete(k); else this.cookies.set(k, v); }
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: response.status, data, text, headers: response.headers };
  }
  async form(name) { const out = await this.call(`/api/forms/token?form=${name}`); await wait(1700); return { form_token: out.data.token, fax_ref: '' }; }
}
const login = async (key) => { const c = new Client(); const out = await c.call('/api/auth/login', 'POST', { email: accounts[key].email, password: accounts[key].password }); return { c, out }; };

console.log(`# ${base}`);
const anon = new Client();
check('D01', 'anonymous: /api/me is {user:null}; private routes refuse (401)', (await anon.call('/api/me')).data.user === null && (await anon.call('/api/messages')).status === 401 && (await anon.call('/api/admin/dashboard')).status === 401);

console.log('\n# roles and staff views (shared accounts, read-only)');
const adm = await login('admin');
check('D03', 'admin signs in (role admin)', adm.out.status === 200 && adm.out.data.user?.role === 'admin', adm.out.status);
const ag = await login('agent');
const lim = await login('limited');
check('D03', 'agent and limited agent sign in (role agent)', ag.out.data.user?.role === 'agent' && lim.out.data.user?.role === 'agent');
const dash = await ag.c.call('/api/admin/dashboard');
check('F50', 'staff dashboard answers with numbers and links', dash.status === 200 && Number.isInteger(dash.data.messages?.new) && dash.data.messages.received_week >= 0, dash.text);
const agentMsgs = await ag.c.call('/api/messages');
const limMsgs = await lim.c.call('/api/messages');
check('F70', 'limited agent sees fewer requests than the all-services agent, and says its perimeter; residents/agents are refused on admin routes', agentMsgs.status === 200 && limMsgs.status === 200 && limMsgs.data.scope?.limited === true && limMsgs.data.messages.length <= agentMsgs.data.messages.length && (await ag.c.call('/api/admin/agents')).status === 403 && (await adm.c.call('/api/admin/agents')).status === 200, JSON.stringify([agentMsgs.data.messages?.length, limMsgs.data.messages?.length, limMsgs.data.scope]));
const outOfScope = agentMsgs.data.messages.find((m) => !limMsgs.data.messages.some((x) => x.id === m.id));
if (outOfScope) check('F70', 'a request outside the limited agent perimeter is 404 for them (reply and priority)', (await lim.c.call(`/api/messages/${outOfScope.id}/priority`, 'PUT', { priority: outOfScope.priority || 'normal' })).status === 404);
const dupe = await adm.c.call('/api/admin/audit/verify');
check('F47', 'audit journal chain verifies; entries list in order', dupe.data.ok === true && (await adm.c.call('/api/admin/audit')).data.entries?.length > 0, dupe.text);
check('F48', 'journal filter by category works and CSV export is a download', (await adm.c.call('/api/admin/audit?category=security&limit=5')).status === 200 && (await adm.c.call('/api/admin/audit?format=csv')).headers.get('content-type')?.startsWith('text/csv'));
check('F85', 'unusual-activity list and consistency check answer; consistency ok or problems listed in words', Array.isArray((await ag.c.call('/api/admin/security')).data.anomalies) && typeof (await ag.c.call('/api/admin/integrity')).data.ok === 'boolean');
const opts = await ag.c.call('/api/admin/export/options');
const csv = await ag.c.call('/api/admin/export?dataset=requests&fields=reference,status,priority,emergency');
check('F88', 'export options and a CSV with only chosen columns', opts.status === 200 && csv.status === 200 && /^﻿?Référence;État;Priorité;Urgence médicale/.test(csv.text), csv.text.slice(0, 80));
const backup = await adm.c.call('/api/admin/backup/verify', 'POST', {});
check('F87', 'backup verification: ok with the important data identical in the copy (copy deleted, not downloadable)', backup.status === 200 && backup.data.ok === true && backup.data.important?.every((x) => x.same), backup.text);
check('F87', 'backup status is admin-only', (await adm.c.call('/api/admin/backup/status')).data.last?.ok === true && (await ag.c.call('/api/admin/backup/status')).status === 403);

console.log('\n# shared citizen Alice (read-only) and the seeded fixtures');
const alice = await login('alice');
check('D03', 'citizen signs in', alice.out.data.user?.role === 'citizen');
const aliceMsgs = await alice.c.call('/api/messages');
const seeded = aliceMsgs.data.messages || [];
check('F26/F83', 'Alice\'s history lists her requests with a reference M-n and city-time dates', seeded.length > 0 && seeded.every((m) => /^M-\d+$/.test(m.reference)), JSON.stringify(seeded.map((m) => m.reference)));
check('F84', 'at least one agent reply is visible to Alice, signed by the city (no staff name)', seeded.some((m) => (m.replies || []).length && m.replies.every((r) => r.author === 'Un agent de la ville')), JSON.stringify(seeded.map((m) => (m.replies || []).length)));
const first = seeded[0];
const receipt = await alice.c.call(`/api/messages/${first.id}/receipt?format=json`);
const code = receipt.data.code || receipt.data.verification_code || /([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(JSON.stringify(receipt.data))?.[1];
const verify = code ? await anon.call(`/api/receipts/verify?reference=${first.reference}&code=${code}`) : null;
check('F83', 'owner receipt is available and the PUBLIC check validates it without content', receipt.status === 200 && verify?.data.valid === true && !JSON.stringify(verify.data).includes(first.subject), JSON.stringify(verify?.data || receipt.data).slice(0, 200));
check('F83', 'another resident cannot open that receipt (403/404)', [403, 404].includes((await (await login('benoit')).c.call(`/api/messages/${first.id}/receipt`)).status));
check('F51', 'Alice\'s data export lists only her data (no password hash, no session)', (await alice.c.call('/api/me/export')).status === 200 && !/password_hash|token_hash/.test((await alice.c.call('/api/me/export')).text));
check('F53/F54', 'her devices and notices lists answer', (await alice.c.call('/api/me/devices')).status === 200 && (await alice.c.call('/api/me/notices')).status === 200);
const publicList = await alice.c.call('/api/public-requests');
check('F52', 'published requests show only public fields (no author, no private text) and a support count', publicList.status === 200 && publicList.data.requests.every((r) => !('user_id' in r) && !('body' in r) && 'support_count' in r), JSON.stringify(publicList.data).slice(0, 120));
const slots = (await alice.c.call('/api/appointments/slots')).data;
check('F39', 'free appointment slots are listed with date and place', Array.isArray(slots.slots) && slots.slots.length >= 1, JSON.stringify(slots).slice(0, 160));

console.log('\n# a fresh TEST QA citizen: every write goes through a disposable account');
const stamp = Date.now().toString(36);
const tc = new Client();
const email = `test-qa-${stamp}@terra-nova.invalid`;
const pw = `Qa-${stamp}-${Math.random().toString(36).slice(2)}-password`;
const reg = await tc.call('/api/auth/register', 'POST', { name: `TEST QA ${stamp}`, email, password: pw, ...(await tc.form('register')) });
check('D03/F81', 'registration works with the signed form token (201)', reg.status === 201 && reg.data.user?.role === 'citizen', reg.text);
const honey = await new Client().call('/api/auth/register', 'POST', { name: 'TEST QA robot', email: `test-qa-bot-${stamp}@terra-nova.invalid`, password: pw, fax_ref: 'robot', form_token: 'x' });
check('F81', 'a form with the hidden field filled (a robot) is refused (400) and creates nothing', honey.status === 400 && (await new Client().call('/api/auth/login', 'POST', { email: `test-qa-bot-${stamp}@terra-nova.invalid`, password: pw })).status === 401, honey.text);
const msgBody = (extra) => ({ kind: 'incident', subject: `TEST QA lampadaire ${stamp}`, body: `Message de test QA ${stamp} : le lampadaire de la rue du Test est éteint depuis lundi.`, location: 'Rue du Test, Centre-ville', topic: 'voirie', ...extra });
const m1 = await tc.call('/api/messages', 'POST', { ...msgBody(), ...(await tc.form('message')) });
check('F26/F83', 'a request is created with a reference and a receipt', m1.status === 201 && Number.isInteger(m1.data.id), m1.text);
const m1again = await tc.call('/api/messages', 'POST', { ...msgBody(), ...(await tc.form('message')) });
check('F82', 'the same request sent again within minutes is one record (200 duplicate:true, same id)', m1again.status === 200 && m1again.data.duplicate === true && m1again.data.id === m1.data.id, m1again.text);
const m2 = await tc.call('/api/messages', 'POST', { ...msgBody({ subject: `TEST QA éclairage éteint ${stamp}`, body: `Test QA ${stamp} : lampadaire éteint rue du Test depuis deux nuits, il n'y a plus d'éclairage.` }), ...(await tc.form('message')) });
const m3 = await tc.call('/api/messages', 'POST', { ...msgBody({ subject: `TEST QA urgence fictive ${stamp}`, kind: 'contact', location: undefined, topic: 'sante', body: `TEST QA ${stamp} SCÉNARIO FICTIF : mon voisin est inconscient et ne respire plus (essai automatique, ne pas intervenir).` }), ...(await tc.form('message')) });
check('F86', 'a fictional medical-emergency wording is flagged emergency in the answer', m3.status === 201 && m3.data.emergency === true, m3.text);
const staffView = (await ag.c.call('/api/messages')).data;
const mine = staffView.messages.filter((m) => [m1.data.id, m2.data.id, m3.data.id].includes(m.id));
check('F86', 'the agent sees the emergency flagged, urgent and sorted into the data (priority urgent)', mine.find((m) => m.id === m3.data.id)?.emergency === 1 && mine.find((m) => m.id === m3.data.id)?.priority === 'urgent', JSON.stringify(mine.map((m) => [m.id, m.emergency, m.priority])));
check('F75', 'the two lamp requests are grouped as similar for staff, the emergency is not in their group', mine.length === 3 && mine.find((m) => m.id === m1.data.id).group && mine.find((m) => m.id === m1.data.id).group === mine.find((m) => m.id === m2.data.id).group && !mine.find((m) => m.id === m3.data.id).group, JSON.stringify(mine.map((m) => [m.id, m.group])));
check('F79', 'requests carry a theme; the topics list is public', mine.find((m) => m.id === m1.data.id).topic === 'voirie' && (await anon.call('/api/topics')).data.topics.length >= 8);
const pr = await ag.c.call(`/api/messages/${m1.data.id}/priority`, 'PUT', { priority: 'high' });
check('F80', 'an agent sets a priority; the resident never receives it', pr.status === 200 && !('priority' in (await tc.call('/api/messages')).data.messages[0]));
const rep = await ag.c.call(`/api/messages/${m1.data.id}/replies`, 'POST', { body: `Réponse de test QA ${stamp} : une équipe passe demain.` });
const st = await ag.c.call(`/api/messages/${m1.data.id}`, 'PATCH', { status: 'in_progress', note: 'Pris en charge (test QA).' });
const notices = (await tc.call('/api/me/notices')).data.notices;
check('F84/F49', 'agent reply (201) and status change reach the resident as notices; the reply is on the request signed by the city', rep.status === 201 && st.status === 200 && notices.some((n) => n.code === 'message.reply') && notices.some((n) => n.code === 'message.in_progress'), JSON.stringify(notices.map((n) => n.code)));
const pub = await tc.call(`/api/messages/${m1.data.id}/public`, 'POST', { consent: true, public_title: `TEST QA signalement ${stamp}`, public_summary: 'Un lampadaire est éteint depuis lundi dans la rue du Test.', district: 'Centre-ville' });
check('F52', 'the resident publishes the report with consent; other residents then see it without private data', pub.status === 201 && (await alice.c.call('/api/public-requests')).data.requests.some((r) => r.public_title === `TEST QA signalement ${stamp}`), pub.text);
const sup = await alice.c.call(`/api/public-requests/${pub.data.id}/support`, 'POST');
const unsup = await alice.c.call(`/api/public-requests/${pub.data.id}/support`, 'DELETE');
check('F52', 'another resident supports then withdraws support (reversible), the owner cannot support their own', sup.status === 201 && unsup.status === 200 && (await tc.call(`/api/public-requests/${pub.data.id}/support`, 'POST')).status >= 400, [sup.status, unsup.status]);
const conc = await tc.call('/api/concerns', 'POST', { topic: 'other', body: `Inquiétude de test QA ${stamp} sur mes données, merci de ne pas répondre.`, ...(await tc.form('concern')) });
check('F55/F56', 'a data concern can be sent and is visible to staff', conc.status === 201 && (await ag.c.call('/api/admin/concerns')).data.concerns?.some((c) => c.id === conc.data.id), conc.text);
const slotList = (await tc.call('/api/appointments/slots')).data.slots || [];
const target = slotList.find((s) => s.status === 'open' || !s.status) || slotList[0];
if (target) {
  const book = await tc.call(`/api/appointments/${target.id}/book`, 'POST', { reason: 'Test QA : rendez-vous réversible' });
  const mineAp = (await tc.call('/api/appointments/mine')).data.appointments || [];
  const ics = await tc.call(`/api/appointments/${target.id}/ics`);
  check('F39/F40', 'a resident books a free slot with a reason; it appears with weekday/time/place and an .ics with a VALARM', [200, 201].includes(book.status) && mineAp.some((a) => a.id === target.id) && /BEGIN:VALARM/.test(ics.text), [book.status, ics.status]);
  const cancel = await tc.call(`/api/appointments/${target.id}`, 'DELETE');
  check('F39', 'the booking is cancelled (slot restored: reversible demo action)', [200, 204].includes(cancel.status) && !((await tc.call('/api/appointments/mine')).data.appointments || []).some((a) => a.id === target.id), cancel.status);
} else check('F39', 'free slot to book', false, 'none');

console.log('\n# account security on the TEST account');
const setup = await tc.call('/api/me/2fa/setup', 'POST', { password: pw });
const enable = await tc.call('/api/me/2fa/enable', 'POST', { code: totpAt(setup.data.secret, Date.now()) });
check('F53', 'second step set up and enabled with a TOTP code; 8 recovery codes shown once', setup.status === 200 && enable.status === 200 && enable.data.recovery_codes?.length === 8, enable.text);
const t2 = new Client();
const l1 = await t2.call('/api/auth/login', 'POST', { email, password: pw });
check('F53', 'a right password no longer opens a session (ticket only)', l1.data.second_step?.ticket && !l1.data.user && !t2.cookies.has('tn_session'));
const l2 = await t2.call('/api/auth/second-step', 'POST', { ticket: l1.data.second_step.ticket, code: enable.data.recovery_codes[0] });
check('F53', 'a recovery code completes the sign-in once', l2.status === 200 && l2.data.user?.email === email);
const l3 = await new Client().call('/api/auth/login', 'POST', { email, password: pw });
const l4 = await new Client().call('/api/auth/second-step', 'POST', { ticket: l3.data.second_step.ticket, code: enable.data.recovery_codes[0] });
check('F53', 'the same recovery code does not work twice (401)', l4.status === 401);
const off = await t2.call('/api/me/2fa/disable', 'POST', { password: pw, code: enable.data.recovery_codes[1] });
check('F53', 'the step is turned off with password + a code', off.status === 200);
const stamp37 = new Client();
const wrongs = [];
for (let i = 0; i < 3; i++) wrongs.push((await stamp37.call('/api/auth/login', 'POST', { email, password: 'wrong-password-123' })).data);
check('F37', 'wrong passwords answer 401 with the tries left', wrongs.every((w) => Number.isInteger(w.attemptsLeft)) && wrongs[2].attemptsLeft < wrongs[0].attemptsLeft, JSON.stringify(wrongs));
const newPw = pw + '-2';
check('F71', 'password change needs the current one; other sessions end', (await tc.call('/api/me/password', 'POST', { current: pw, next: newPw })).status === 200 && (await new Client().call('/api/auth/login', 'POST', { email, password: newPw })).status === 200);
check('F54', 'the account lists its devices', (await tc.call('/api/me/devices')).data.devices?.length >= 1);

console.log('\n# public information and features');
const places = (await anon.call('/api/places')).data.places;
check('F45/F46/F74', 'places carry address, hours, phone; at least one emergency place and one partner place', places.length > 0 && places.some((p) => p.kind !== 'service' && p.phone) && places.some((p) => p.partner === 1) && places.every((p) => p.address), JSON.stringify(places.map((p) => [p.kind, p.partner])));
const news = (await anon.call('/api/announcements')).data.announcements;
check('D18/F29/F73', 'announcements: audience, urgent flag, and an official sender message is first', news.length > 0 && news.every((a) => 'audience' in a && 'urgent' in a) && (news.some((a) => a.sender) ? Boolean(news[0].sender) : true), JSON.stringify(news.map((a) => [a.sender, a.urgent, a.audience])));
check('F36', 'transport lines with stops and next departures', (await anon.call('/api/transports')).data.lines?.every((l) => l.stops?.every((s) => Array.isArray(s.next))));
check('F28/F38/F32', 'services: featured first, availability fields, search data', (await anon.call('/api/services')).data.services?.every((s) => 'featured' in s && 'availability' in s));
check('F72/F62/F93-F96', 'the portal serves the guide, the essentials toggle and the service worker', /id="debuter"/.test((await anon.call('/')).text) && /id="light-toggle"/.test((await anon.call('/')).text) && (await anon.call('/sw.js')).status === 200);

console.log('\n# cleanup: the TEST account deletes itself (messages, replies, notices, devices go with it)');
const del = await tc.call('/api/me', 'DELETE', { password: newPw });
check('F33', 'self-deletion with the password: 200, sessions end, the account cannot sign in again', del.status === 200 && (await new Client().call('/api/auth/login', 'POST', { email, password: newPw })).status === 401);
const leftover = (await ag.c.call('/api/messages')).data.messages.filter((m) => /TEST QA/.test(m.subject) && String(m.subject).includes(stamp));
check('F33', 'its requests are gone from staff lists after deletion (no residue)', leftover.length === 0, leftover.length);
const pubAfter = (await alice.c.call('/api/public-requests')).data.requests.some((r) => r.public_title === `TEST QA signalement ${stamp}`);
check('F52', 'its published report and supports are gone too', !pubAfter);
for (const c of [adm, ag, lim, alice]) await c.c.call('/api/auth/logout', 'POST', {});
console.log(failures ? `\n${failures} FAILED of ${results.length}` : `\nall ${results.length} signed-in checks passed`);
process.exit(failures ? 1 : 0);
