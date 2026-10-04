// F53: a second verification step (authenticator-app code + single-use recovery codes), API level on a disposable server and database: set-up, activation, the two-step
// sign-in, replay, wrong codes and lockout, recovery codes, removal, staff and administrator cases, deletion, persistence across a restart. A ports 3200-3209.
// Usage: node tools/qa-a/second-step.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { totpAt } = await import(pathToFileURL(join(root, 'factors.mjs')).href);
const dataDir = mkdtempSync(join(tmpdir(), 'terra-2fa-'));
const dbPath = join(dataDir, 's.sqlite');
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_MIN_AGE_MS: '0', TN_FORM_LIMIT_SCALE: '1000' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 600)}`); };

const staffPassword = (role) => /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', `${role}@s2.test`, `${role} Étape`, role], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const agentPw = staffPassword('agent');
const adminPw = staffPassword('admin');
let server;
const start = async () => { server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' }); await wait(1500); };
const stop = async () => { server.kill(); await wait(400); };
await start();
let counter = 0;
const call = async (path, method = 'GET', body, cookie = '', ip = null) => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || `10.92.${Math.floor(++counter / 250)}.${counter % 250}`, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data, text, setCookie: response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '', cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0] };
};
const query = (sql, ...args) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
const PW = 'password-long-1';
const register = async (label) => (await call('/api/auth/register', 'POST', { name: `Habitant ${label}`, email: `${label}@s2.test`, password: PW })).cookie;
const login = (label, password = PW, ip = null) => call('/api/auth/login', 'POST', { email: `${label}@s2.test`, password }, '', ip);
const now = () => Date.now();

console.log('# set-up and activation');
const zoe = await register('zoe');
const status0 = await call('/api/me/security', 'GET', null, zoe);
check('a new account has no second step; the status says so and never carries a secret', status0.status === 200 && status0.data.totp.enabled === false && status0.data.totp.recovery_left === 0 && status0.data.has_password === true && !/secret/i.test(status0.text), status0.text);
check('anonymous visitors cannot read or start anything (401)', (await call('/api/me/security')).status === 401 && (await call('/api/me/2fa/setup', 'POST', { password: PW })).status === 401);
const badPw = await call('/api/me/2fa/setup', 'POST', { password: 'not-my-password' }, zoe);
check('set-up asks for the password again: a wrong one is refused (403) and nothing is stored', badPw.status === 403 && query("SELECT totp_pending FROM users WHERE email = 'zoe@s2.test'")[0].totp_pending === null, badPw.text);
const setup = await call('/api/me/2fa/setup', 'POST', { password: PW }, zoe);
check('set-up returns the secret in base32, grouped for typing, and an otpauth link an authenticator app opens', setup.status === 200 && /^[A-Z2-7]{32}$/.test(setup.data.secret) && setup.data.grouped === setup.data.secret.match(/.{4}/g).join(' ') && setup.data.otpauth.startsWith('otpauth://totp/Terra%20Nova:zoe%40s2.test?secret=' + setup.data.secret) && /period=30/.test(setup.data.otpauth) && /digits=6/.test(setup.data.otpauth), setup.text);
check('until a first code proves the app works, the step is NOT active (a lost set-up cannot lock anyone out)', (await call('/api/me/security', 'GET', null, zoe)).data.totp.enabled === false && (await login('zoe')).data.second_step === undefined);
const wrongEnable = await call('/api/me/2fa/enable', 'POST', { code: '000000' }, zoe);
const garbageEnable = await call('/api/me/2fa/enable', 'POST', { code: { a: 1 } }, zoe);
check('activation with a wrong or malformed code is refused (400) and nothing is activated', wrongEnable.status === 400 && garbageEnable.status === 400 && query("SELECT totp_enabled_at FROM users WHERE email = 'zoe@s2.test'")[0].totp_enabled_at === null, [wrongEnable.text, garbageEnable.text]);
const enable = await call('/api/me/2fa/enable', 'POST', { code: totpAt(setup.data.secret, now()) }, zoe);
const codes = enable.data.recovery_codes || [];
check('the right code activates it and shows eight recovery codes once (XXXXX-XXXXX)', enable.status === 200 && codes.length === 8 && codes.every((c) => /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(c)) && new Set(codes).size === 8, enable.text);
const stored = query('SELECT code_hash FROM recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = ?)', 'zoe@s2.test');
check('recovery codes are kept only as hashes (no plaintext in the database), and the status shows 8 left but never the codes or the secret', stored.length === 8 && stored.every((r) => /^[0-9a-f]{64}$/.test(r.code_hash)) && !JSON.stringify(stored).includes(codes[0].replace('-', '')) && (await call('/api/me/security', 'GET', null, zoe)).data.totp.recovery_left === 8 && !(await call('/api/me/security', 'GET', null, zoe)).text.includes(setup.data.secret));

console.log('\n# signing in with the second step');
const first = await login('zoe');
check('a right password is no longer enough: no session cookie, a ticket and the methods offered', first.status === 200 && first.setCookie === '' && first.data.user === undefined && typeof first.data.second_step.ticket === 'string' && first.data.second_step.expires_in === 300 && first.data.second_step.methods.includes('totp') && first.data.second_step.methods.includes('recovery'), first.text);
check('with that ticket alone nothing is reachable (no session)', (await call('/api/me', 'GET', null, '')).data.user === null);
const wrongPw = await login('zoe', 'wrong-password-123');
check('a wrong password still looks like before (401, no hint that a second step exists)', wrongPw.status === 401 && !wrongPw.text.includes('second_step'), wrongPw.text);
const bad = await call('/api/auth/second-step', 'POST', { ticket: first.data.second_step.ticket, code: '123456' });
check('a wrong code is refused (401) with the tries left, and the ticket stays usable', bad.status === 401 && bad.setCookie === '' && bad.data.attemptsLeft >= 1, bad.text);
const nowMs = now();
const ok1 = await call('/api/auth/second-step', 'POST', { ticket: first.data.second_step.ticket, code: totpAt(setup.data.secret, nowMs + 30000) });
check('the right code (the app\'s next step is tolerated for clock drift) opens a session; the user is returned', ok1.status === 200 && ok1.setCookie.includes('HttpOnly') && ok1.data.user.email === 'zoe@s2.test' && (await call('/api/me', 'GET', null, ok1.cookie)).data.user.email === 'zoe@s2.test', ok1.text);
const reuse = await call('/api/auth/second-step', 'POST', { ticket: first.data.second_step.ticket, code: totpAt(setup.data.secret, nowMs + 30000) });
check('the ticket is single-use: replaying it fails', reuse.status === 401 && reuse.data.code === 'second-step-expired', reuse.text);
const second = await login('zoe');
const replayed = await call('/api/auth/second-step', 'POST', { ticket: second.data.second_step.ticket, code: totpAt(setup.data.secret, nowMs + 30000) });
check('a code that was already used is refused even with a fresh ticket (a code works once)', replayed.status === 401 && replayed.setCookie === '', replayed.text);
const older = await call('/api/auth/second-step', 'POST', { ticket: second.data.second_step.ticket, code: totpAt(setup.data.secret, nowMs - 30000) });
check('an older step than the last accepted one is refused too', older.status === 401, older.text);
const current = await call('/api/auth/second-step', 'POST', { ticket: second.data.second_step.ticket, code: totpAt(setup.data.secret, nowMs + 60000) });
check('a code two steps ahead (outside the clock tolerance) is refused, and the ticket survived the earlier wrong tries (the limit is five)', current.status === 401, current.text);
const forged = await call('/api/auth/second-step', 'POST', { ticket: 'A'.repeat(32), code: '123456' });
const noTicket = await call('/api/auth/second-step', 'POST', { code: '123456' });
const objTicket = await call('/api/auth/second-step', 'POST', { ticket: { a: 1 }, code: '123456' });
check('an invented, missing or non-text ticket is refused (401), never an error', forged.status === 401 && noTicket.status === 401 && objTicket.status === 401, [forged.status, noTicket.status, objTicket.status]);

console.log('\n# recovery codes');
const lost = await login('zoe');
const viaRecovery = await call('/api/auth/second-step', 'POST', { ticket: lost.data.second_step.ticket, code: codes[0].toLowerCase().replace('-', ' ') });
check('a recovery code (typed in lower case with a space) opens a session once', viaRecovery.status === 200 && viaRecovery.setCookie !== '', viaRecovery.text);
const again = await login('zoe');
const reused = await call('/api/auth/second-step', 'POST', { ticket: again.data.second_step.ticket, code: codes[0] });
check('the same recovery code does not work twice', reused.status === 401, reused.text);
const notices = (await call('/api/me/notices', 'GET', null, viaRecovery.cookie)).data.notices;
check('the resident is told a recovery code was used and how many are left', notices.some((n) => n.code === 'security.recovery_used' && n.label === '7'), JSON.stringify(notices.map((n) => [n.code, n.label])));
check('the status counts 7 recovery codes left', (await call('/api/me/security', 'GET', null, viaRecovery.cookie)).data.totp.recovery_left === 7);

console.log('\n# guessing is limited');
const target = await login('zoe', PW, '10.99.0.1');
let last;
for (let i = 0; i < 5; i++) last = await call('/api/auth/second-step', 'POST', { ticket: target.data.second_step.ticket, code: String(100000 + i * 7) }, '', '10.99.0.1');
const burnt = await call('/api/auth/second-step', 'POST', { ticket: target.data.second_step.ticket, code: totpAt(setup.data.secret, now()) }, '', '10.99.0.1');
check('five wrong codes burn the ticket: even the right code is then refused', last.status === 401 && burnt.status === 401 && burnt.data.code === 'second-step-expired', [last.text, burnt.text]);
const lockedOut = await login('zoe', PW, '10.99.0.1');
check('the failures count toward the normal sign-in lockout: the same address is now told to wait (429) even with the right password', lockedOut.status === 429 && lockedOut.data.retryAfter > 0, lockedOut.text);
const otherPlace = await login('zoe', PW, '10.99.7.7');
check('a different address is not locked by that (the lockout is per address and account, as for passwords)', otherPlace.status === 200 && otherPlace.data.second_step !== undefined, otherPlace.text);

console.log('\n# removal and new codes need proof');
const session = (await call('/api/auth/second-step', 'POST', { ticket: otherPlace.data.second_step.ticket, code: codes[1] })).cookie;
const noProof = await call('/api/me/2fa/disable', 'POST', { password: PW, code: '000000' }, session);
const wrongPass = await call('/api/me/2fa/disable', 'POST', { password: 'nope-nope-nope', code: codes[2] }, session);
check('removing the step needs the password AND a code: a stolen open session with neither is refused (403)', noProof.status === 403 && wrongPass.status === 403 && (await call('/api/me/security', 'GET', null, session)).data.totp.enabled === true, [noProof.text, wrongPass.text]);
const fresh = await call('/api/me/2fa/recovery-codes', 'POST', { password: PW, code: codes[2] }, session);
check('new recovery codes (password + a code) replace the old ones: the old are dead, the new work', fresh.status === 200 && fresh.data.recovery_codes.length === 8 && fresh.data.recovery_codes.every((c) => !codes.includes(c))
  && query('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = ?)', 'zoe@s2.test')[0].n === 8, fresh.text);
const oldCode = await login('zoe', PW, '10.99.8.8');
check('an old recovery code no longer works after renewal', (await call('/api/auth/second-step', 'POST', { ticket: oldCode.data.second_step.ticket, code: codes[3] }, '', '10.99.8.8')).status === 401);
const newOne = await login('zoe', PW, '10.99.9.9');
const sessionTwo = (await call('/api/auth/second-step', 'POST', { ticket: newOne.data.second_step.ticket, code: fresh.data.recovery_codes[0] }, '', '10.99.9.9')).cookie;
const disable = await call('/api/me/2fa/disable', 'POST', { password: PW, code: fresh.data.recovery_codes[1] }, sessionTwo);
check('with the password and a valid code the step is removed (a recovery code is enough if the app is lost)', disable.status === 200 && query("SELECT totp_secret, totp_enabled_at FROM users WHERE email = 'zoe@s2.test'")[0].totp_secret === null && query('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = ?)', 'zoe@s2.test')[0].n === 0, disable.text);
const afterOff = await login('zoe', PW, '10.99.10.10');
check('after removal a password alone signs in again, and the resident finds a notice that the protection was removed', afterOff.status === 200 && afterOff.data.user && (await call('/api/me/notices', 'GET', null, afterOff.cookie)).data.notices.some((n) => n.code === 'security.2fa_off'), afterOff.text);

console.log('\n# staff, administrators and accounts without the step');
const agent = (await login('agent', agentPw)).cookie;
const staffSetup = await call('/api/me/2fa/setup', 'POST', { password: agentPw }, agent);
const staffEnable = await call('/api/me/2fa/enable', 'POST', { code: totpAt(staffSetup.data.secret, now()) }, agent);
const staffLogin = await login('agent', agentPw);
const staffIn = await call('/api/auth/second-step', 'POST', { ticket: staffLogin.data.second_step.ticket, code: staffEnable.data.recovery_codes[0] });
check('agents and administrators use the same step; their sign-in is journalled only after the second step succeeds', staffEnable.status === 200 && staffLogin.setCookie === '' && staffIn.status === 200 && staffIn.data.user.role === 'agent', [staffEnable.text, staffIn.text]);
const adminCookie = (await login('admin', adminPw)).cookie;
const journal = (await call('/api/admin/audit', 'GET', null, adminCookie)).data;
const actions = (journal.entries || []).map((e) => e.action);
check('enabling is in the staff journal (auth.2fa_enabled); the secret and the codes are nowhere in it', actions.includes('auth.2fa_enabled') && !JSON.stringify(journal).includes(staffSetup.data.secret) && !JSON.stringify(journal).includes(staffEnable.data.recovery_codes[0]), JSON.stringify(actions).slice(0, 300));
const yan = await register('yan');
const yanSetup = await call('/api/me/2fa/setup', 'POST', { password: PW }, yan);
const yanEnable = await call('/api/me/2fa/enable', 'POST', { code: totpAt(yanSetup.data.secret, now()) }, yan);
const yanId = query("SELECT id FROM users WHERE email = 'yan@s2.test'")[0].id;
const asResident = await call(`/api/admin/citizens/${yanId}/2fa-reset`, 'POST', { reason: 'Perte du téléphone' }, yan);
const noReason = await call(`/api/admin/citizens/${yanId}/2fa-reset`, 'POST', {}, staffIn.cookie);
const onStaff = await call(`/api/admin/citizens/${query("SELECT id FROM users WHERE email = 'admin@s2.test'")[0].id}/2fa-reset`, 'POST', { reason: 'Test de limite' }, staffIn.cookie);
check('only staff can reset a resident\'s step, a reason is required, and staff accounts cannot be reset this way', asResident.status === 403 && noReason.status === 400 && [403, 404, 409].includes(onStaff.status), [asResident.status, noReason.status, onStaff.status]);
const reset = await call(`/api/admin/citizens/${yanId}/2fa-reset`, 'POST', { reason: 'Perte du téléphone et des codes' }, staffIn.cookie);
const yanAfter = await login('yan');
check('a staff reset removes the step, ends the resident\'s sessions, and leaves them a notice and a journal line with the reason', reset.status === 200 && (await call('/api/me', 'GET', null, yan)).data.user === null && yanAfter.data.user && (await call('/api/me/notices', 'GET', null, yanAfter.cookie)).data.notices.some((n) => n.code === 'security.2fa_reset')
  && ((await call('/api/admin/audit', 'GET', null, adminCookie)).data.entries || []).some((e) => e.action === 'account.reset_2fa' && /Perte du téléphone et des codes/.test(JSON.stringify(e))), reset.text);
check('resetting an account that has no second step is a clear 409', (await call(`/api/admin/citizens/${yanId}/2fa-reset`, 'POST', { reason: 'Encore une fois' }, staffIn.cookie)).status === 409);
check('administration lists and other endpoints never expose a secret or a code', !JSON.stringify((await call('/api/admin/citizens', 'GET', null, staffIn.cookie)).data).match(/totp|recovery|secret/i) && !(await call('/api/me', 'GET', null, yanAfter.cookie)).text.match(/totp|secret|recovery/i));
let limited;
for (let i = 0; i < 12; i++) limited = await call('/api/me/2fa/setup', 'POST', { password: 'wrong-wrong-wrong' }, yanAfter.cookie);
check('the management routes are rate-limited per account (429 after 10 tries in 10 minutes)', limited.status === 429 && limited.data.retryAfter > 0, limited.text);

console.log('\n# persistence and deletion');
const liam = await register('liam');
const liamSetup = await call('/api/me/2fa/setup', 'POST', { password: PW }, liam);
const liamCodeNow = totpAt(liamSetup.data.secret, now());
const liamEnable = await call('/api/me/2fa/enable', 'POST', { code: liamCodeNow }, liam);
await stop();
await start();
const afterRestart = await login('liam');
const replayAfterRestart = await call('/api/auth/second-step', 'POST', { ticket: afterRestart.data.second_step.ticket, code: liamCodeNow });
check('after a restart the step is still active and the activation code cannot be replayed (the last step is stored)', afterRestart.data.second_step && replayAfterRestart.status === 401, [afterRestart.text, replayAfterRestart.text]);
const liamViaCode = await call('/api/auth/second-step', 'POST', { ticket: afterRestart.data.second_step.ticket, code: liamEnable.data.recovery_codes[0] });
check('and the recovery codes still work after the restart', liamViaCode.status === 200, liamViaCode.text);
const liamId = query("SELECT id FROM users WHERE email = 'liam@s2.test'")[0].id;
const del = await call('/api/me', 'DELETE', { password: PW }, liamViaCode.cookie);
check('deleting the account deletes its recovery codes with it', (del.status === 200 || del.status === 204) && query('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?', liamId)[0].n === 0, del.text);

await stop();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall second-step checks passed');
process.exit(failures ? 1 : 0);
