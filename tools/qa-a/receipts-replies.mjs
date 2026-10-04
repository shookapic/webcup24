// F83 (a durable, verifiable receipt with a reference) and F84 (agents answer a request directly): API-level checks on a disposable server and database,
// including roles, escaping, privacy of the public check, persistence across a restart, quotas and account deletion. A ports 3200-3209.
// Usage: node tools/qa-a/receipts-replies.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'terra-receipts-'));
const dbPath = join(dataDir, 'r.sqlite');
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
// fixtures are created through the API without form tokens (the strict protection is tested in form-protection.mjs); quotas stay real except where noted
const baseEnv = { ...process.env, DATA_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_MIN_AGE_MS: '0' };
const env = { ...baseEnv, TN_FORM_LIMIT_SCALE: '1000' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 600)}`); };

const staffPassword = (role) => /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', `${role}@rr.test`, `${role} Réponse`, role], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const agentPw = staffPassword('agent');
const adminPw = staffPassword('admin');
let server;
const start = async (serverEnv = env) => { server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: serverEnv, stdio: 'ignore' }); await wait(1500); };
const stop = async () => { server.kill(); await wait(400); };
await start();
let counter = 0;
const call = async (path, method = 'GET', body, cookie = '', ip = null) => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || `10.90.${Math.floor(++counter / 250)}.${counter % 250}`, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json().catch(() => ({})) : await response.text();
  return { status: response.status, data, type, headers: response.headers, cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0] };
};
const query = (sql, ...args) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
const register = async (label) => { const out = await call('/api/auth/register', 'POST', { name: `Habitant ${label}`, email: `${label}@rr.test`, password: 'password-long-1' }); return out.cookie; };
const send = async (cookie, subject, extra = {}) => (await call('/api/messages', 'POST', { subject, body: `Le texte de la demande « ${subject} » est assez long pour être valide.`, kind: 'contact', ...extra }, cookie)).data;
const zoe = await register('zoe');
const yan = await register('yan');
const agent = (await call('/api/auth/login', 'POST', { email: 'agent@rr.test', password: agentPw })).cookie;
const admin = (await call('/api/auth/login', 'POST', { email: 'admin@rr.test', password: adminPw })).cookie;

console.log('# F83. receipt with an identifiable reference');
const subject = 'Lampadaire <script>alert(1)</script> éteint';
const sent = await send(zoe, subject, { kind: 'incident', location: 'Rue des Dunes, numéro 12' });
const list = (await call('/api/messages', 'GET', undefined, zoe)).data.messages;
const mine = list.find((m) => m.id === sent.id);
check('the resident\'s list carries the reference "M-<id>" on every request', mine?.reference === `M-${sent.id}` && list.every((m) => m.reference === `M-${m.id}`), JSON.stringify(mine));
const receipt = await call(`/api/messages/${sent.id}/receipt`, 'GET', undefined, zoe);
check('the receipt is a page (200, text/html, never cached, strict CSP, nosniff)', receipt.status === 200 && receipt.type.startsWith('text/html') && /no-store/.test(receipt.headers.get('cache-control')) && /default-src 'none'/.test(receipt.headers.get('content-security-policy')) && receipt.headers.get('x-content-type-options') === 'nosniff', JSON.stringify([receipt.status, receipt.type]));
check('it shows the reference, a verification code, when the city received it (city time), type, subject, place, the message and who sent it', receipt.data.includes(`M-${sent.id}`) && /[A-Z2-9]{5}-[A-Z2-9]{5}/.test(receipt.data) && /Reçue le<\/dt><dd>\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2} \(heure de la cité\)/.test(receipt.data) && receipt.data.includes('Signalement de problème') && receipt.data.includes('Rue des Dunes, numéro 12') && receipt.data.includes('Habitant zoe') && receipt.data.includes('assez long pour être valide'), receipt.data.slice(0, 300));
check('what the person wrote is escaped in the page (no script can run), and the page names how to verify it', !receipt.data.includes('<script>alert(1)') && receipt.data.includes('&lt;script&gt;alert(1)') && /Vérifier un accusé de réception/.test(receipt.data));
const json = (await call(`/api/messages/${sent.id}/receipt?format=json`, 'GET', undefined, zoe)).data;
check('the same receipt as JSON: the code has no look-alike characters (no 0, O, 1, I) and is stable between two requests', /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(json.code) && json.code === (await call(`/api/messages/${sent.id}/receipt?format=json`, 'GET', undefined, zoe)).data.code && json.reference === `M-${sent.id}`, JSON.stringify(json).slice(0, 300));
check('the English receipt reads in English and downloads as a file when asked', /Acknowledgement of receipt/.test((await call(`/api/messages/${sent.id}/receipt?lang=en`, 'GET', undefined, zoe)).data) && /attachment; filename="accuse-de-reception-M-\d+-en\.html"/.test((await call(`/api/messages/${sent.id}/receipt?lang=en&download=1`, 'GET', undefined, zoe)).headers.get('content-disposition') || ''));
check('only the owner can get a receipt: another resident 404, staff 403, anonymous 401, unknown request 404', (await call(`/api/messages/${sent.id}/receipt`, 'GET', undefined, yan)).status === 404 && (await call(`/api/messages/${sent.id}/receipt`, 'GET', undefined, agent)).status === 403 && (await call(`/api/messages/${sent.id}/receipt`)).status === 401 && (await call('/api/messages/999999/receipt', 'GET', undefined, zoe)).status === 404);

const verify = (reference, code, lang = 'fr') => call(`/api/receipts/verify?reference=${encodeURIComponent(reference)}&code=${encodeURIComponent(code)}&lang=${lang}`);
const ok = await verify(`M-${sent.id}`, json.code);
check('anyone with the reference and the code can check it (public, no session): valid, with the date of receipt, type and state', ok.status === 200 && ok.data.valid === true && ok.data.reference === `M-${sent.id}` && /^\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/.test(ok.data.received) && ok.data.kind === 'incident' && ok.data.status === 'new', JSON.stringify(ok.data));
check('the check says nothing about the content: no subject, message, place or name in the answer', !/Lampadaire|Dunes|Habitant|zoe|texte de la demande/i.test(JSON.stringify(ok.data)));
const variants = await Promise.all([verify(`m-${sent.id}`, json.code.toLowerCase()), verify(` M-${sent.id} `, json.code.replace('-', ' ')), verify(`M-${sent.id}`, json.code.replace('-', ''))]);
check('lower case, spaces and a missing hyphen are accepted (a code read out or retyped still works)', variants.every((v) => v.data.valid === true), JSON.stringify(variants.map((v) => v.data)));
const wrong = await verify(`M-${sent.id}`, 'AAAAA-AAAAA');
const unknown = await verify('M-999999', 'AAAAA-AAAAA');
const garbage = await verify('xyz', '');
check('a wrong code, an unknown reference and garbage all get the same answer { valid: false } (no way to tell which references exist)', JSON.stringify(wrong.data) === '{"valid":false}' && JSON.stringify(unknown.data) === '{"valid":false}' && JSON.stringify(garbage.data) === '{"valid":false}');
const other = await send(yan, 'Une autre demande de Yan');
check('a code of one request does not validate another (M-n with the code of M-m is invalid)', (await verify(`M-${other.id}`, json.code)).data.valid === false);
await call(`/api/messages/${sent.id}`, 'PATCH', { status: 'resolved' }, agent);
const after = await call(`/api/messages/${sent.id}/receipt?format=json`, 'GET', undefined, zoe);
check('the receipt keeps the same code after the state changes (it proves the reception, not the state) and shows the new state', after.data.code === json.code && after.data.status === 'resolved' && (await verify(`M-${sent.id}`, json.code)).data.status === 'resolved');
const recapCsv = await call('/api/me/recap?format=csv', 'GET', undefined, zoe);
check('the personal summary (F56) lists the same reference "M-<id>"', recapCsv.data.includes(`M-${sent.id}`));

console.log('\n# F83. persistence and abuse limits');
await stop();
await start();
const zoeAgain = (await call('/api/auth/login', 'POST', { email: 'zoe@rr.test', password: 'password-long-1' })).cookie;
check('after a restart the receipt code is identical and still verifies (the key is stored in the database)', (await call(`/api/messages/${sent.id}/receipt?format=json`, 'GET', undefined, zoeAgain)).data.code === json.code && (await verify(`M-${sent.id}`, json.code)).data.valid === true);
const settingRow = query("SELECT length(value) AS n FROM settings WHERE key = 'receipt_key'")[0];
check('the key is 64 hex characters in the settings table and appears in no answer (receipt, export, list)', settingRow?.n === 64 && !JSON.stringify([(await call('/api/me/export', 'GET', undefined, zoeAgain)).data, (await call('/api/messages', 'GET', undefined, zoeAgain)).data]).match(/[0-9a-f]{64}/));
let limited = null;
for (let i = 0; i < 64 && !limited; i++) { const out = await call(`/api/receipts/verify?reference=M-${i + 1}&code=ABCDE-FGHJK`, 'GET', undefined, '', '10.99.0.9'); if (out.status === 429) limited = out; } // one address, like one person guessing
check('checking references in a loop is limited (429 with a wait) so codes cannot be guessed', limited?.status === 429 && /Réessayez dans \d+ min/.test(limited.data.error) && Number(limited.headers.get('retry-after')) > 0, JSON.stringify(limited?.data));

console.log('\n# F84. an agent answers a request directly');
const asked = await send(zoeAgain, 'Question sur les horaires du marché');
const noticesBefore = (await call('/api/me/notices', 'GET', undefined, zoeAgain)).data.notices.length;
const replyText = 'Le marché ouvre à 8 h du mardi au samedi. Merci de votre question.';
const reply = await call(`/api/messages/${asked.id}/replies`, 'POST', { body: replyText }, agent);
check('an agent answers (201) without changing the state of the request', reply.status === 201 && reply.data.reference === `M-${asked.id}` && query('SELECT status FROM messages WHERE id = ?', asked.id)[0].status === 'new');
const residentView = (await call('/api/messages', 'GET', undefined, zoeAgain)).data.messages.find((m) => m.id === asked.id);
check('the resident sees the answer on the request, signed "Un agent de la ville" (no staff name)', residentView.replies.length === 1 && residentView.replies[0].body === replyText && residentView.replies[0].author === 'Un agent de la ville' && !JSON.stringify(residentView).includes('Réponse'.concat(' ')) , JSON.stringify(residentView.replies));
const staffView = (await call('/api/messages', 'GET', undefined, agent)).data.messages.find((m) => m.id === asked.id);
check('staff see the same answer with who wrote it, and no internal fingerprint leaks in the list', staffView.replies[0].author === 'agent Réponse' && !('fingerprint' in staffView) && (await call('/api/messages', 'GET', undefined, admin)).data.messages.every((m) => !('fingerprint' in m)), JSON.stringify(staffView.replies));
const notices = (await call('/api/me/notices', 'GET', undefined, zoeAgain)).data.notices;
const notice = notices.find((n) => n.code === 'message.reply');
check('the resident gets a notice carrying the answer, unread; another resident gets nothing', notices.length === noticesBefore + 1 && notice?.ref_id === asked.id && notice.note === replyText && notice.label === 'Question sur les horaires du marché' && !notice.seen_at && !(await call('/api/me/notices', 'GET', undefined, yan)).data.notices.some((n) => n.code === 'message.reply'));
const again = await call(`/api/messages/${asked.id}/replies`, 'POST', { body: replyText }, agent);
check('the same answer sent twice within minutes is recorded once (200 duplicate:true) and notifies once', again.status === 200 && again.data.duplicate === true && query('SELECT COUNT(*) AS n FROM message_replies WHERE message_id = ?', asked.id)[0].n === 1 && (await call('/api/me/notices', 'GET', undefined, zoeAgain)).data.notices.filter((n) => n.code === 'message.reply').length === 1);
const second = await call(`/api/messages/${asked.id}/replies`, 'POST', { body: 'Et le dimanche, le marché est fermé.' }, admin);
check('an administrator can answer too, and several answers build a thread in order', second.status === 201 && (await call('/api/messages', 'GET', undefined, zoeAgain)).data.messages.find((m) => m.id === asked.id).replies.map((r) => r.body).join('|') === `${replyText}|Et le dimanche, le marché est fermé.`);
check('negative cases: resident 403, anonymous 401, too short 400, too long 400, not JSON 400, unknown request 404', (await call(`/api/messages/${asked.id}/replies`, 'POST', { body: replyText }, zoeAgain)).status === 403 && (await call(`/api/messages/${asked.id}/replies`, 'POST', { body: replyText })).status === 401 && (await call(`/api/messages/${asked.id}/replies`, 'POST', { body: 'ok' }, agent)).status === 400 && (await call(`/api/messages/${asked.id}/replies`, 'POST', { body: 'x'.repeat(2001) }, agent)).status === 400 && (await call(`/api/messages/${asked.id}/replies`, 'POST', undefined, agent)).status === 400 && (await call('/api/messages/999999/replies', 'POST', { body: replyText }, agent)).status === 404);
const journal = (await call('/api/admin/audit?category=message', 'GET', undefined, admin)).data.entries || [];
const entry = journal.find((e) => e.action === 'message.reply');
check('the journal records who answered which request, without copying the answer text; residents cannot read the journal', Boolean(entry) && /a répondu à la demande/.test(entry.summary) && !JSON.stringify(entry).includes('marché ouvre à 8 h') && (await call('/api/admin/audit', 'GET', undefined, zoeAgain)).status === 403, JSON.stringify(entry));
const noteInRecap = (await call('/api/me/recap?format=csv', 'GET', undefined, zoeAgain)).data;
check('the answer reaches the resident\'s own summary (the town hall column)', noteInRecap.includes('Et le dimanche, le marché est fermé.'));
check('an answer containing HTML stays text in the receipt-like pages (escaped in the summary page)', (await call(`/api/messages/${asked.id}/replies`, 'POST', { body: '<img src=x onerror=alert(1)> merci' }, agent)).status === 201 && !(await call('/api/me/recap', 'GET', undefined, zoeAgain)).data.includes('<img src=x'));

console.log('\n# F84. quota for answers (real limit: 60 per ten minutes per agent)');
await stop();
await start({ ...baseEnv }); // no TN_FORM_LIMIT_SCALE: the real quota
const agent2 = (await call('/api/auth/login', 'POST', { email: 'agent@rr.test', password: agentPw })).cookie;
const target = query('SELECT id FROM messages ORDER BY id LIMIT 1')[0].id;
const results = [];
for (let i = 0; i < 62; i++) results.push((await call(`/api/messages/${target}/replies`, 'POST', { body: `Réponse numéro ${i} pour le quota des agents.` }, agent2)).status);
check('60 answers in ten minutes are accepted, the 61st is refused (429) with its wait', results.slice(0, 60).every((s) => s === 201) && results[60] === 429, JSON.stringify(results.slice(55)));

console.log('\n# account deletion');
await stop();
await start();
const zoeThird = (await call('/api/auth/login', 'POST', { email: 'zoe@rr.test', password: 'password-long-1' })).cookie;
const before = query('SELECT COUNT(*) AS n FROM message_replies WHERE message_id = ?', asked.id)[0].n;
const gone = await call('/api/me', 'DELETE', { password: 'password-long-1' }, zoeThird);
check('deleting the account removes the requests, their answers and makes the receipts invalid', before >= 2 && gone.status === 200 && query('SELECT COUNT(*) AS n FROM message_replies WHERE message_id = ?', asked.id)[0].n === 0 && (await verify(`M-${sent.id}`, json.code)).data.valid === false && (await verify(`M-${other.id}`, 'AAAAA-AAAAA')).data.valid === false, JSON.stringify([before, gone.status]));
check('another resident\'s receipt still verifies after that deletion', (await call(`/api/messages/${other.id}/receipt?format=json`, 'GET', undefined, (await call('/api/auth/login', 'POST', { email: 'yan@rr.test', password: 'password-long-1' })).cookie)).status === 200);

await stop();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall receipt and reply checks passed');
process.exit(failures ? 1 : 0);
