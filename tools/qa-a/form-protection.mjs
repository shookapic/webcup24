// F81 (robots on forms) and F82 (the same form sent several times): API-level checks against a disposable server with the REAL protection settings
// (no TN_FORM_* relaxation): hidden field, signed single-use tokens, minimum age, idempotent answers, durable duplicate detection, quotas, staff counters,
// restart, concurrency and negative role cases. Disposable database, A ports 3200-3209. Usage: node tools/qa-a/form-protection.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'terra-forms-'));
const dbPath = join(dataDir, 'forms.sqlite');
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1' };
for (const name of ['TN_FORM_LIMIT_SCALE', 'TN_FORM_MIN_AGE_MS', 'TN_FORM_TOKENS']) delete env[name]; // the real protection, never the test relaxation
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 600)}`); };

const staffPassword = (role) => /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', `${role}@forms.test`, `${role} Forms`, role], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const agentPw = staffPassword('agent');
const adminPw = staffPassword('admin');
let server;
const start = async () => { server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' }); await wait(1500); };
const stop = async () => { server.kill(); await wait(400); };
await start();

const call = async (path, method = 'GET', body, cookie = '', ip = '10.70.0.1') => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, retryAfter: response.headers.get('retry-after'), cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0] };
};
const tokenFor = async (form, cookie, ip) => (await call(`/api/forms/token?form=${form}`, 'GET', undefined, cookie, ip)).data.token;
let counter = 0;
const unique = (label) => `${label} ${++counter} ${Math.random().toString(36).slice(2, 8)}`;
let addressCounter = 0;
const freshIp = () => `10.71.${Math.floor(++addressCounter / 250)}.${addressCounter % 250}`;
// a registered resident with their own address, a token ready and old enough
async function resident(label) {
  const ip = freshIp();
  const token = await tokenFor('register', '', ip);
  await wait(1700);
  const out = await call('/api/auth/register', 'POST', { name: `Resident ${label}`, email: `${label}-${Math.random().toString(36).slice(2, 7)}@forms.test`, password: 'password-long-1', form_token: token }, '', ip);
  return { cookie: out.cookie, ip, out };
}
const messageBody = (extra = {}) => ({ subject: unique('Sujet de test'), body: 'Un message de test assez long pour être valide et unique.', kind: 'contact', ...extra });
const authorEmail = (subject) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare('SELECT email FROM users WHERE id = (SELECT user_id FROM messages WHERE subject = ?)').get(subject).email; } finally { db.close(); } };
const rows = (table, where = '1=1', ...args) => { const db = new DatabaseSync(dbPath); try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n; } finally { db.close(); } };

console.log('# 1. token endpoint and roles');
const anonymous = await call('/api/forms/token?form=message');
check('a message token needs a session (anonymous gets 401)', anonymous.status === 401, anonymous.status);
const registerToken = await call('/api/forms/token?form=register');
check('a registration token is public and tells the minimum age', registerToken.status === 200 && typeof registerToken.data.token === 'string' && registerToken.data.minAgeMs === 1500, JSON.stringify(registerToken.data));
check('an unknown form is refused (400)', (await call('/api/forms/token?form=nope')).status === 400);
const agent = await call('/api/auth/login', 'POST', { email: 'agent@forms.test', password: agentPw }, '', freshIp());
const admin = await call('/api/auth/login', 'POST', { email: 'admin@forms.test', password: adminPw }, '', freshIp());
check('staff cannot get a resident form token (403) and cannot post a resident message (403); anonymous cannot post (401)', (await call('/api/forms/token?form=message', 'GET', undefined, agent.cookie)).status === 403 && (await call('/api/messages', 'POST', messageBody(), agent.cookie)).status === 403 && (await call('/api/messages', 'POST', messageBody())).status === 401);

console.log('\n# 2. F81 registration: hidden field, token, minimum age');
let ip = freshIp();
const noToken = await call('/api/auth/register', 'POST', { name: 'Robot One', email: 'robot1@forms.test', password: 'password-long-1' }, '', ip);
check('no token: refused as an expired form (400, code form-expired), nothing created', noToken.status === 400 && noToken.data.code === 'form-expired' && rows('users', 'email = ?', 'robot1@forms.test') === 0, JSON.stringify(noToken.data));
const honeyToken = await tokenFor('register', '', ip);
await wait(1700);
const honey = await call('/api/auth/register', 'POST', { name: 'Robot Two', email: 'robot2@forms.test', password: 'password-long-1', form_token: honeyToken, fax_ref: '0102030405' }, '', ip);
check('the hidden field filled in: refused as automated (400, form-refused), nothing created', honey.status === 400 && honey.data.code === 'form-refused' && rows('users', 'email = ?', 'robot2@forms.test') === 0, JSON.stringify(honey.data));
const fastToken = await tokenFor('register', '', ip);
const tooFast = await call('/api/auth/register', 'POST', { name: 'Fast Person', email: 'fast@forms.test', password: 'password-long-1', form_token: fastToken }, '', ip);
check('a token used at once is answered "too fast" (429, code form-too-fast, Retry-After and retryAfterMs), nothing created', tooFast.status === 429 && tooFast.data.code === 'form-too-fast' && Number(tooFast.retryAfter) >= 1 && tooFast.data.retryAfterMs > 0 && rows('users', 'email = ?', 'fast@forms.test') === 0, JSON.stringify({ d: tooFast.data, h: tooFast.retryAfter }));
await wait(tooFast.data.retryAfterMs + 100);
const retried = await call('/api/auth/register', 'POST', { name: 'Fast Person', email: 'fast@forms.test', password: 'password-long-1', form_token: fastToken }, '', ip);
check('the SAME token works once it is old enough (the page retries by itself): 201 and a session', retried.status === 201 && Boolean(retried.cookie) && rows('users', 'email = ?', 'fast@forms.test') === 1, JSON.stringify(retried.data));
const again = await call('/api/auth/register', 'POST', { name: 'Fast Person', email: 'fast@forms.test', password: 'password-long-1', form_token: fastToken }, '', ip);
check('the same token sent again (double click, slow link) gets the first answer and creates nothing more (F82)', again.status === 201 && again.data.user?.id === retried.data.user?.id && rows('users', 'email = ?', 'fast@forms.test') === 1, JSON.stringify(again.data));

console.log('\n# 3. token binding and tampering');
const a = await resident('binding-a');
const b = await resident('binding-b');
check('both residents registered with their own address and token', a.out.status === 201 && b.out.status === 201, JSON.stringify([a.out.data, b.out.data]));
const tokenA = await tokenFor('message', a.cookie, a.ip);
const concernToken = await tokenFor('concern', a.cookie, a.ip);
const registerForOther = await tokenFor('register', '', '10.99.0.1');
await wait(1700);
check('a message token of resident A used by resident B is refused (400)', (await call('/api/messages', 'POST', { ...messageBody(), form_token: tokenA }, b.cookie, b.ip)).data.code === 'form-expired');
check('a concern token used for a message is refused (400)', (await call('/api/messages', 'POST', { ...messageBody(), form_token: concernToken }, a.cookie, a.ip)).data.code === 'form-expired');
check('a registration token fetched from another address is refused (400)', (await call('/api/auth/register', 'POST', { name: 'Elsewhere', email: 'else@forms.test', password: 'password-long-1', form_token: registerForOther }, '', freshIp())).data.code === 'form-expired');
const parts = tokenA.split('.');
const tampered = await Promise.all([`${Number(parts[0]) - 60000}.${parts[1]}.${parts[2]}`, `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`, parts[0]].map((t) => call('/api/messages', 'POST', { ...messageBody(), form_token: t }, a.cookie, a.ip)));
check('a tampered token (changed time, changed signature, truncated) is refused (400)', tampered.every((r) => r.data.code === 'form-expired'), JSON.stringify(tampered.map((r) => [r.status, r.data.code])));
// a failed validation does not use the token up
const badThenGood = messageBody();
const badShort = await call('/api/messages', 'POST', { ...badThenGood, subject: 'ab', form_token: tokenA }, a.cookie, a.ip);
const goodNow = await call('/api/messages', 'POST', { ...badThenGood, form_token: tokenA }, a.cookie, a.ip);
check('a refused (invalid) send does not use the token up: the corrected form goes through with the same token (F82 without punishing a typo)', badShort.status === 400 && goodNow.status === 201, JSON.stringify([badShort.data, goodNow.data]));

console.log('\n# 4. F82 duplicates (request form)');
const r1 = messageBody();
const [t1, t2, t3, t4, t5] = await Promise.all([tokenFor('message', a.cookie, a.ip), tokenFor('message', a.cookie, a.ip), tokenFor('message', a.cookie, a.ip), tokenFor('message', a.cookie, a.ip), tokenFor('message', b.cookie, b.ip)]);
await wait(1700);
const first = await call('/api/messages', 'POST', { ...r1, form_token: t1 }, a.cookie, a.ip);
const second = await call('/api/messages', 'POST', { ...r1, form_token: t2 }, a.cookie, a.ip);
check('the same request sent again with a fresh token within minutes: 200 duplicate:true, the SAME id, one row', first.status === 201 && second.status === 200 && second.data.duplicate === true && second.data.id === first.data.id && rows('messages', 'subject = ?', r1.subject) === 1, JSON.stringify([first.data, second.data]));
const variant = await call('/api/messages', 'POST', { ...r1, subject: r1.subject.toUpperCase(), body: `  ${r1.body.replace(/ /g, '   ')}  `, form_token: t3 }, a.cookie, a.ip);
check('capital letters and extra spaces do not make it a new request (still the same id)', variant.status === 200 && variant.data.duplicate === true && variant.data.id === first.data.id, JSON.stringify(variant.data));
const different = await call('/api/messages', 'POST', { ...messageBody(), form_token: t4 }, a.cookie, a.ip);
check('a different request is created normally (201, a new id)', different.status === 201 && different.data.id !== first.data.id, JSON.stringify(different.data));
const forNeighbour = await call('/api/messages', 'POST', { ...r1, form_token: t5 }, b.cookie, b.ip);
check('the same text from ANOTHER resident is not a duplicate (201): duplicates are per person', forNeighbour.status === 201 && forNeighbour.data.id !== first.data.id, JSON.stringify(forNeighbour.data));

console.log('\n# 5. F82 concurrency');
const burstSame = messageBody();
const sameToken = await tokenFor('message', a.cookie, a.ip);
await wait(1700);
const burst1 = await Promise.all(Array.from({ length: 6 }, () => call('/api/messages', 'POST', { ...burstSame, form_token: sameToken }, a.cookie, a.ip)));
check('six simultaneous sends with the SAME token: exactly one row, every answer carries the same id', rows('messages', 'subject = ?', burstSame.subject) === 1 && new Set(burst1.map((r) => r.data.id)).size === 1 && burst1.every((r) => [200, 201].includes(r.status)), JSON.stringify(burst1.map((r) => [r.status, r.data.id])));
const burstText = messageBody();
const tokens = await Promise.all(Array.from({ length: 5 }, () => tokenFor('message', b.cookie, b.ip)));
await wait(1700);
const burst2 = await Promise.all(tokens.map((token) => call('/api/messages', 'POST', { ...burstText, form_token: token }, b.cookie, b.ip)));
check('five simultaneous sends of the same text with DIFFERENT tokens: exactly one row (one 201, the rest duplicates)', rows('messages', 'subject = ?', burstText.subject) === 1 && burst2.filter((r) => r.status === 201).length === 1 && burst2.filter((r) => r.data.duplicate === true).length === 4, JSON.stringify(burst2.map((r) => [r.status, r.data.id, r.data.duplicate])));
const raceEmail = `race-${Math.random().toString(36).slice(2, 7)}@forms.test`;
const raceIp = freshIp();
const raceToken = await tokenFor('register', '', raceIp);
await wait(1700);
const raceBodies = await Promise.all(Array.from({ length: 5 }, () => call('/api/auth/register', 'POST', { name: 'Race Person', email: raceEmail, password: 'password-long-1', form_token: raceToken }, '', raceIp)));
check('five simultaneous registrations with one token: exactly one account; the others wait (409 form-busy) or get the same answer', rows('users', 'email = ?', raceEmail) === 1 && raceBodies.filter((r) => r.status === 201).length >= 1 && raceBodies.every((r) => r.status === 201 || r.data.code === 'form-busy'), JSON.stringify(raceBodies.map((r) => [r.status, r.data.code])));

console.log('\n# 6. F82 concerns and staff forms');
const concernText = { topic: 'access', body: unique('Une inquiétude assez longue pour être valide') };
const ct1 = await tokenFor('concern', a.cookie, a.ip); const ct2 = await tokenFor('concern', a.cookie, a.ip);
await wait(1700);
const c1 = await call('/api/concerns', 'POST', { ...concernText, form_token: ct1 }, a.cookie, a.ip);
const c2 = await call('/api/concerns', 'POST', { ...concernText, form_token: ct2 }, a.cookie, a.ip);
check('a concern sent twice: one record, the second answer says it was already received and gives the same reference', c1.status === 201 && c2.status === 200 && c2.data.duplicate === true && c2.data.reference === c1.data.reference && rows('concerns', 'body = ?', concernText.body) === 1, JSON.stringify([c1.data, c2.data]));
const notice = { title: unique('Annonce de test'), body: 'Le contenu de cette annonce est assez long pour être valide.', audience: 'Tous' };
const n1 = await call('/api/announcements', 'POST', notice, admin.cookie, freshIp());
const n2 = await call('/api/announcements', 'POST', notice, admin.cookie, freshIp());
check('the same announcement sent twice within minutes is published once (second: 200 duplicate:true, same id)', n1.status === 201 && n2.status === 200 && n2.data.duplicate === true && n2.data.id === n1.data.id && rows('announcements', 'title = ?', notice.title) === 1, JSON.stringify([n1.data, n2.data]));
const service = { title: unique('Service de test'), description: 'Une description de service.', details: 'Les informations détaillées du service de test.' };
const s1 = await call('/api/services', 'POST', service, admin.cookie, freshIp());
const s2 = await call('/api/services', 'POST', service, admin.cookie, freshIp());
check('the same service sent twice is created once (second: 200 duplicate:true, same id)', s1.status === 201 && s2.status === 200 && s2.data.duplicate === true && s2.data.id === s1.data.id && rows('services', 'title = ?', service.title) === 1, JSON.stringify([s1.data, s2.data]));

console.log('\n# 7. F81 quotas (a clear wait, other people unaffected)');
const heavy = await resident('quota');
const tokensForQuota = await Promise.all(Array.from({ length: 8 }, () => tokenFor('message', heavy.cookie, heavy.ip)));
await wait(1700);
const sent = [];
for (const token of tokensForQuota) sent.push(await call('/api/messages', 'POST', { ...messageBody(), form_token: token }, heavy.cookie, heavy.ip));
const accepted = sent.filter((r) => r.status === 201).length;
const limited = sent.find((r) => r.status === 429);
check('a resident can send 6 requests in ten minutes, the 7th is refused (429, code form-rate)', accepted === 6 && limited?.data.code === 'form-rate', JSON.stringify(sent.map((r) => r.status)));
check('the refusal names the wait in minutes (readable) and sends Retry-After', /Réessayez dans \d+ min/.test(limited?.data.error || '') && Number(limited?.retryAfter) > 0, JSON.stringify([limited?.data, limited?.retryAfter]));
const neighbour = await resident('quota-neighbour');
const neighbourSend = await call('/api/messages', 'POST', { ...messageBody(), form_token: await (async () => { const t = await tokenFor('message', neighbour.cookie, neighbour.ip); await wait(1700); return t; })() }, neighbour.cookie, neighbour.ip);
check('another resident is unaffected by that quota (201)', neighbourSend.status === 201, JSON.stringify(neighbourSend.data));
// registration quota per address: 30 an hour from one address, the 31st refused, another address fine
const crowdIp = freshIp();
const crowdTokens = await Promise.all(Array.from({ length: 31 }, () => tokenFor('register', '', crowdIp)));
await wait(1700);
const crowd = [];
for (const [index, token] of crowdTokens.entries()) crowd.push(await call('/api/auth/register', 'POST', { name: `Crowd ${index}`, email: `crowd${index}-${Math.random().toString(36).slice(2, 6)}@forms.test`, password: 'password-long-1', form_token: token }, '', crowdIp));
check('30 registrations an hour from one address are accepted, the 31st is refused (429 form-rate) with its wait', crowd.slice(0, 30).every((r) => r.status === 201) && crowd[30].status === 429 && crowd[30].data.code === 'form-rate' && /Réessayez dans \d+ min/.test(crowd[30].data.error), JSON.stringify(crowd.map((r) => r.status)));
const otherAddress = freshIp();
const otherToken = await tokenFor('register', '', otherAddress);
await wait(1700);
check('another address can still register (201)', (await call('/api/auth/register', 'POST', { name: 'Calm Person', email: `calm-${Math.random().toString(36).slice(2, 6)}@forms.test`, password: 'password-long-1', form_token: otherToken }, '', otherAddress)).status === 201);
const issuer = await resident('issuer');
let issueRefused = null;
for (let i = 0; i < 62 && !issueRefused; i++) { const out = await call('/api/forms/token?form=message', 'GET', undefined, issuer.cookie, issuer.ip); if (out.status === 429) issueRefused = out; }
check('asking for tokens in a loop is limited too (429 form-rate within 62 requests)', issueRefused?.data.code === 'form-rate', JSON.stringify(issueRefused?.data));

console.log('\n# 8. staff counters (no names, no content)');
const security = await call('/api/admin/security', 'GET', undefined, agent.cookie, freshIp());
const forms = security.data.forms || {};
check('staff see counts of automated refusals, too-fast sends, quota refusals and duplicates avoided', security.status === 200 && forms.automated >= 4 && forms.tooFast >= 1 && forms.rateLimited >= 2 && forms.duplicates >= 4, JSON.stringify(forms));
check('the counters carry no names or content, and a resident cannot read them (403)', !JSON.stringify(forms).match(/@|Sujet|Resident/) && (await call('/api/admin/security', 'GET', undefined, a.cookie, a.ip)).status === 403);

console.log('\n# 9. restart: tokens die, duplicates are still recognised from the database');
const before = messageBody();
const rt1 = await tokenFor('message', b.cookie, b.ip);
await wait(1700);
const kept = await call('/api/messages', 'POST', { ...before, form_token: rt1 }, b.cookie, b.ip);
const oldToken = await tokenFor('message', b.cookie, b.ip);
await stop();
await start();
const reLogin = await call('/api/auth/login', 'POST', { email: authorEmail(before.subject), password: 'password-long-1' }, '', freshIp());
const stale = await call('/api/messages', 'POST', { ...messageBody(), form_token: oldToken }, reLogin.cookie, freshIp());
check('after a restart a token from before is refused cleanly (400 form-expired, the page fetches a new one)', kept.status === 201 && reLogin.status === 200 && stale.data.code === 'form-expired', JSON.stringify([kept.status, reLogin.status, stale.data]));
const rt2 = await tokenFor('message', reLogin.cookie, freshIp());
await wait(1700);
const dupAfter = await call('/api/messages', 'POST', { ...before, form_token: rt2 }, reLogin.cookie, freshIp());
check('after a restart the same request within minutes is still recognised as a duplicate (same id, no second row)', dupAfter.status === 200 && dupAfter.data.duplicate === true && dupAfter.data.id === kept.data.id && rows('messages', 'subject = ?', before.subject) === 1, JSON.stringify([kept.data, dupAfter.data]));

await stop();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall form-protection checks passed');
process.exit(failures ? 1 : 0);
