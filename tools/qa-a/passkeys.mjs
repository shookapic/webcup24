// D02 (sign in without a password, with a passkey / WebAuthn) and the F71 access code, counter-opened accounts and password change, protocol level on a disposable server and database, with a software authenticator that can
// also send every kind of WRONG answer: bad signature, wrong site, wrong challenge, missing user verification, copied credential, replay. A ports 3200-3209.
// Usage: node tools/qa-a/passkeys.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { SoftwareAuthenticator } = await import(pathToFileURL(join(root, 'tools/qa-a/webauthn-software.mjs')).href);
const { totpAt } = await import(pathToFileURL(join(root, 'factors.mjs')).href);
const dataDir = mkdtempSync(join(tmpdir(), 'terra-passkeys-'));
const dbPath = join(dataDir, 'p.sqlite');
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://localhost:${port}`;
const env = { ...process.env, DATA_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_MIN_AGE_MS: '0', TN_FORM_LIMIT_SCALE: '1000' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 700)}`); };

const staffPassword = (role) => /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', `${role}@pk.test`, `${role} Clé`, role], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const agentPw = staffPassword('agent');
const adminPw = staffPassword('admin');
let server;
const start = async () => { server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' }); await wait(1500); };
const stop = async () => { server.kill(); await wait(400); };
await start();
let counter = 0;
const call = async (path, method = 'GET', body, cookie = '', { ip = null, origin = base } = {}) => {
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || `10.95.${Math.floor(++counter / 250)}.${counter % 250}`, ...(cookie ? { Cookie: cookie } : {}) };
  if (origin) headers.Origin = origin;
  const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data, text, setCookie: response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '', cookie: (response.headers.getSetCookie().find((c) => c.startsWith('tn_session=')) || '').split(';')[0] };
};
const query = (sql, ...args) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
const PW = 'password-long-1';
const usersCount = () => query('SELECT COUNT(*) AS n FROM users')[0].n;
const passkeyRows = () => query('SELECT COUNT(*) AS n FROM passkeys')[0].n;

// the whole sign-up ceremony: options -> authenticator -> create
async function signUp(authenticator, { name = 'Sam Clé', email, createOptions = {}, mutate } = {}) {
  const options = await call('/api/auth/passkey/signup-options', 'POST', { name, ...(email ? { email } : {}) });
  if (options.status !== 200) return { options };
  const credential = authenticator.create(options.data, base, createOptions);
  const done = await call('/api/auth/passkey/signup', 'POST', mutate ? mutate(credential) : credential);
  return { options, credential, done };
}
async function signIn(authenticator, getOptions = {}, ip = null) {
  const options = await call('/api/auth/passkey/options', 'POST', {}, '', { ip });
  if (options.status !== 200) return { options };
  const assertion = authenticator.get(options.data, base, getOptions);
  return { options, done: await call('/api/auth/passkey/login', 'POST', assertion, '', { ip }) };
}

console.log('# creating an account with a passkey (no password, no e-mail)');
const sam = new SoftwareAuthenticator();
const opts = await call('/api/auth/passkey/signup-options', 'POST', { name: 'Sam Clé' });
check('the options ask for a discoverable credential with user verification required (fingerprint, face or device code), ES256 and RS256, no attestation, and name the site "localhost"',
  opts.status === 200 && opts.data.rp.id === 'localhost' && opts.data.authenticatorSelection.userVerification === 'required' && opts.data.authenticatorSelection.residentKey === 'required'
  && opts.data.pubKeyCredParams.map((p) => p.alg).join() === '-7,-257' && opts.data.attestation === 'none' && /^[A-Za-z0-9_-]{43}$/.test(opts.data.challenge) && opts.data.user.id.length >= 40, opts.text);
const noOrigin = await call('/api/auth/passkey/signup-options', 'POST', { name: 'Sam Clé' }, '', { origin: null });
const evil = await call('/api/auth/passkey/signup-options', 'POST', { name: 'Sam Clé' }, '', { origin: 'http://evil.example' });
check('a request without an Origin, or from another site, gets no options (400 / 403)', noOrigin.status === 400 && evil.status === 403, [noOrigin.status, evil.status]);
const badName = await call('/api/auth/passkey/signup-options', 'POST', { name: 'x' });
check('a name that is too short is refused before anything else (400)', badName.status === 400, badName.text);
const created = await signUp(sam);
check('a correct creation makes the account (201): an access code stands where the e-mail would be, a session is opened', created.done.status === 201 && /^TN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(created.done.data.access_code) && created.done.data.user.email === created.done.data.access_code && created.done.cookie !== '' && created.done.data.user.role === 'citizen', created.done.text);
check('that session works (/api/me), and the database holds a public key and NO password for the account', (await call('/api/me', 'GET', null, created.done.cookie)).data.user?.name === 'Sam Clé' && query("SELECT password_hash FROM users WHERE email = ?", created.done.data.access_code)[0].password_hash === '-' && passkeyRows() === 1);
const code = created.done.data.access_code;
const samCookie = created.done.cookie;
const again = await call('/api/auth/passkey/signup', 'POST', created.credential);
check('the same challenge cannot be used twice (single use): the second creation is refused and no second account appears', again.status === 400 && again.data.code === 'challenge-expired' && usersCount() === 3, again.text);
check('the status shows the passkey (label, dates) and never the public key or credential id', (await call('/api/me/security', 'GET', null, samCookie)).data.passkeys.length === 1 && !JSON.stringify((await call('/api/me/security', 'GET', null, samCookie)).data).match(/public_key|credential/i));

console.log('\n# a creation answer that is wrong in any way is refused (400), and nothing is stored');
const before = [usersCount(), passkeyRows()];
const cases = [
  ['user verification missing (flags without UV)', new SoftwareAuthenticator(), { createOptions: { flags: 0x41 } }],
  ['user presence missing', new SoftwareAuthenticator(), { createOptions: { flags: 0x44 } }],
  ['no attested credential data', new SoftwareAuthenticator(), { createOptions: { flags: 0x05 } }],
  ['made for another site (rpIdHash)', new SoftwareAuthenticator(), { createOptions: { rpId: 'evil.example' } }],
  ['wrong ceremony type', new SoftwareAuthenticator(), { createOptions: { type: 'webauthn.get' } }],
  ['wrong challenge', new SoftwareAuthenticator(), { createOptions: { challenge: 'A'.repeat(43) } }],
];
for (const [label, authenticator, extra] of cases) {
  const out = await signUp(authenticator, extra);
  check(`refused: ${label}`, out.done.status === 400 && !out.done.setCookie, out.done.text);
}
const wrongOrigin = await (async () => { const o = await call('/api/auth/passkey/signup-options', 'POST', { name: 'Sam Clé' }); const a = new SoftwareAuthenticator(); return call('/api/auth/passkey/signup', 'POST', a.create(o.data, 'http://localhost:9999')); })();
check('refused: the device says it was created for another origin', wrongOrigin.status === 400 && /pas été créée pour ce site/.test(wrongOrigin.data.error), wrongOrigin.text);
const garbageOpts = await call('/api/auth/passkey/signup-options', 'POST', { name: 'Sam Clé' });
const garbage = await call('/api/auth/passkey/signup', 'POST', { id: 'abc', response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: garbageOpts.data.challenge, origin: base })).toString('base64url'), attestationObject: 'AAAA' } });
const notObject = await call('/api/auth/passkey/signup', 'POST', { id: 'abc', response: 'x' });
const hugeStrings = await call('/api/auth/passkey/signup', 'POST', { id: 'a', response: { clientDataJSON: 'A'.repeat(30000), attestationObject: 'B' } });
check('refused without any server error: undecodable attestation, a non-object answer (400), a body over the size limit (413)', garbage.status === 400 && notObject.status === 400 && hugeStrings.status === 413, [garbage.status, notObject.status, hugeStrings.status]);
const crossPurpose = await (async () => { const o = await call('/api/auth/passkey/options', 'POST', {}); const a = new SoftwareAuthenticator(); return call('/api/auth/passkey/signup', 'POST', a.create({ rp: { id: 'localhost' }, challenge: o.data.challenge }, base)); })();
check('refused: a sign-in challenge cannot be used to create an account (purpose is bound)', crossPurpose.status === 400 && crossPurpose.data.code === 'challenge-expired', crossPurpose.text);
check('and after all those attempts no account and no passkey was added', usersCount() === before[0] && passkeyRows() === before[1], [usersCount(), passkeyRows()]);

console.log('\n# signing in with the passkey');
const ok = await signIn(sam);
check('a correct assertion signs in (200, session cookie, the user returned), with no password and no e-mail typed', ok.done.status === 200 && ok.done.setCookie.includes('HttpOnly') && ok.done.data.user.name === 'Sam Clé', ok.done.text);
const second = await signIn(sam);
check('and again on the next visit; the stored signature counter moves forward', second.done.status === 200 && query('SELECT sign_count FROM passkeys')[0].sign_count === 2, second.done.text);
const bad = [
  ['a tampered signature', { tamper: true }],
  ['user verification missing', { flags: 0x01 }],
  ['user presence missing', { flags: 0x04 }],
  ['made for another site', { rpId: 'evil.example' }],
  ['wrong ceremony type', { type: 'webauthn.create' }],
  ['a copied credential (counter not moving forward)', { counter: 1 }],
];
for (const [label, extra] of bad) {
  const out = await signIn(sam, extra);
  check(`refused: ${label}`, [400, 401].includes(out.done.status) && !out.done.setCookie, out.done.text);
}
const otherKey = new SoftwareAuthenticator();
otherKey.id = sam.id; // an attacker who knows the credential id but not the key
const forged = await signIn(otherKey, { counter: 99 });
check('refused: someone who knows the credential id but signs with another key', forged.done.status === 401 && !forged.done.setCookie, forged.done.text);
const stranger = await signIn(new SoftwareAuthenticator());
check('refused: an unknown credential (401, the same plain message, nothing about which accounts exist)', stranger.done.status === 401 && /Clé d’accès non reconnue/.test(stranger.done.data.error), stranger.done.text);
const options2 = await call('/api/auth/passkey/options', 'POST', {});
const assertion = sam.get(options2.data, base, { counter: 1000 }); // the copied-credential case above rolled this authenticator's counter back on purpose
const first = await call('/api/auth/passkey/login', 'POST', assertion);
const replay = await call('/api/auth/passkey/login', 'POST', assertion);
check('an assertion is single-use: sending the very same answer again is refused (the challenge is gone)', first.status === 200 && replay.status === 400 && replay.data.code === 'challenge-expired', [first.status, replay.status]);
const sneaky = await call('/api/auth/passkey/login', 'POST', { id: 5, response: { clientDataJSON: 1, authenticatorData: 2, signature: 3 } });
check('malformed answers are 400, never a crash', sneaky.status === 400, sneaky.text);

console.log('\n# a second site cannot use the credential, and limits');
const opts3 = await call('/api/auth/passkey/options', 'POST', {});
const wrongSite = await call('/api/auth/passkey/login', 'POST', sam.get(opts3.data, 'http://localhost:9999'));
check('an answer that names another origin is refused even with a valid signature', wrongSite.status === 401 || wrongSite.status === 400, wrongSite.text);
let limited;
for (let i = 0; i < 32; i++) limited = await signIn(new SoftwareAuthenticator(), {}, '10.250.0.1');
check('repeated unknown passkeys from one address are slowed down (429 after 30)', (limited.done?.status || limited.options.status) === 429, limited.done?.text || limited.options.text);
check('the limit is per address: another address is not affected', (await signIn(sam, {}, '10.250.0.2')).done.status === 200);

console.log('\n# access code sign-in and e-mail optional (F71)');
const viaPassword = await call('/api/auth/register', 'POST', { name: 'Lou Sans Mail', password: PW });
const lou = viaPassword.data.access_code;
check('registering without an e-mail address (name + password only) gives an access code, once, on the answer', viaPassword.status === 201 && /^TN-/.test(lou) && viaPassword.data.user.email === lou, viaPassword.text);
const withCode = await call('/api/auth/login', 'POST', { email: ` ${lou.toLowerCase().replace(/-/g, ' - ').replace(/ /g, '')} `, password: PW });
check('the access code signs in, typed in lower case or with stray spaces, in the same field and with the password', withCode.status === 200 && withCode.data.user.name === 'Lou Sans Mail', withCode.text);
const wrongPass = await call('/api/auth/login', 'POST', { email: lou, password: 'not-the-password-1' });
const unknownCode = await call('/api/auth/login', 'POST', { email: 'TN-AAAA-BBBB', password: PW });
const notEither = await call('/api/auth/login', 'POST', { email: 'pas un identifiant', password: PW });
check('a wrong password, an unknown code, or something that is neither a code nor an address are refused alike (401 / 400)', wrongPass.status === 401 && unknownCode.status === 401 && notEither.status === 400 && wrongPass.data.error === unknownCode.data.error, [wrongPass.status, unknownCode.status, notEither.status]);
const withMail = await call('/api/auth/register', 'POST', { name: 'Mia Avec Mail', email: 'mia@pk.test', password: PW });
check('an e-mail address still works as before (and no access code is invented)', withMail.status === 201 && withMail.data.user.email === 'mia@pk.test' && withMail.data.access_code === undefined, withMail.text);
const agent = (await call('/api/auth/login', 'POST', { email: 'agent@pk.test', password: agentPw })).cookie;
const citizens = (await call('/api/admin/citizens?q=Lou', 'GET', null, agent)).data.citizens;
check('staff see the access code where the address would be, and can search by it', citizens.length === 1 && citizens[0].email === lou && (await call(`/api/admin/citizens?q=${lou.slice(3, 8)}`, 'GET', null, agent)).data.citizens.some((c) => c.email === lou), JSON.stringify(citizens));
const withCodeFromPasskey = await call('/api/auth/login', 'POST', { email: code, password: PW });
check('a passkey-only account cannot be entered with its code and a guessed password (it has none)', withCodeFromPasskey.status === 401, withCodeFromPasskey.text);

console.log('\n# adding and removing passkeys on an existing account');
const mia = withMail.cookie;
const anonymousAdd = await call('/api/me/passkeys/options', 'POST', {});
const noPassword = await call('/api/me/passkeys/options', 'POST', {}, mia);
const wrongPassword = await call('/api/me/passkeys/options', 'POST', { password: 'nope-nope-nope' }, mia);
check('adding a passkey needs the password again: anonymous 401, none 403, wrong 403', anonymousAdd.status === 401 && noPassword.status === 403 && wrongPassword.status === 403, [anonymousAdd.status, noPassword.status, wrongPassword.status]);
const phone = new SoftwareAuthenticator();
const addOptions = await call('/api/me/passkeys/options', 'POST', { password: PW }, mia);
check('with the password the options come back, bound to this account (user name = the address)', addOptions.status === 200 && addOptions.data.user.name === 'mia@pk.test' && addOptions.data.excludeCredentials.length === 0, addOptions.text);
const stolenChallenge = await call('/api/me/passkeys', 'POST', phone.create(addOptions.data, base), samCookie);
check('another signed-in person cannot finish this registration with the challenge (400)', stolenChallenge.status === 400, stolenChallenge.text);
const addOptions2 = await call('/api/me/passkeys/options', 'POST', { password: PW }, mia);
const added = await call('/api/me/passkeys', 'POST', { ...phone.create(addOptions2.data, base), label: 'Téléphone de Mia' }, mia);
check('the passkey is added (201) with the label given, and the resident gets a notice', added.status === 201 && added.data.passkey.label === 'Téléphone de Mia' && (await call('/api/me/notices', 'GET', null, mia)).data.notices.some((n) => n.code === 'security.passkey_added' && n.label === 'Téléphone de Mia'), added.text);
const dup = await call('/api/me/passkeys/options', 'POST', { password: PW }, mia);
check('the same device is offered as "already registered" (excludeCredentials) and the same credential cannot be added twice', dup.data.excludeCredentials.length === 1 && (await call('/api/me/passkeys', 'POST', phone.create(dup.data, base), mia)).status === 409);
const viaPasskey = await signIn(phone);
check('and now Mia signs in with it, without typing her password', viaPasskey.done.status === 200 && viaPasskey.done.data.user.email === 'mia@pk.test', viaPasskey.done.text);
const removeWrong = await call(`/api/me/passkeys/${added.data.passkey.id}`, 'DELETE', { password: 'nope-nope-nope' }, mia);
const removed = await call(`/api/me/passkeys/${added.data.passkey.id}`, 'DELETE', { password: PW }, mia);
check('removing it needs the password; afterwards it no longer signs in, and a notice records it', removeWrong.status === 403 && removed.status === 200 && (await signIn(phone)).done.status === 401 && (await call('/api/me/notices', 'GET', null, mia)).data.notices.some((n) => n.code === 'security.passkey_removed'), [removeWrong.status, removed.status]);
const only = (await call('/api/me/security', 'GET', null, samCookie)).data.passkeys[0];
const lastOne = await call(`/api/me/passkeys/${only.id}`, 'DELETE', {}, samCookie);
check('the only way into a password-less account cannot be removed by accident (409, with what to do)', lastOne.status === 409 && /seul moyen de connexion/.test(lastOne.data.error) || lastOne.status === 403, lastOne.text);

console.log('\n# a password-less account proves itself with its passkey for sensitive actions');
const reauth1 = await call('/api/me/reauth-options', 'POST', {}, samCookie);
check('the re-authentication options list only this account\'s credentials, and need a session', reauth1.status === 200 && reauth1.data.allowCredentials.length === 1 && reauth1.data.allowCredentials[0].id === sam.id && (await call('/api/me/reauth-options', 'POST', {})).status === 401, reauth1.text);
const setupNoProof = await call('/api/me/2fa/setup', 'POST', {}, samCookie);
check('without the proof, setting up a second step is refused (403, "Confirmez avec votre clé d\'accès")', setupNoProof.status === 403 && setupNoProof.data.code === 'proof-required', setupNoProof.text);
const proof = sam.get(reauth1.data, base);
const setupOk = await call('/api/me/2fa/setup', 'POST', { proof }, samCookie);
check('with a fresh passkey assertion it works (200), and the same assertion cannot be reused', setupOk.status === 200 && /^[A-Z2-7]{32}$/.test(setupOk.data.secret) && [400, 403].includes((await call('/api/me/2fa/setup', 'POST', { proof }, samCookie)).status), setupOk.text);
const otherChallenge = await call('/api/me/reauth-options', 'POST', {}, mia).catch(() => ({ status: 0 }));
check('an account with no passkey gets no re-authentication options (409)', otherChallenge.status === 409);
const forgedProof = sam.get((await call('/api/me/reauth-options', 'POST', {}, samCookie)).data, base, { tamper: true });
check('a tampered proof is refused (403)', (await call('/api/me/2fa/setup', 'POST', { proof: forgedProof }, samCookie)).status === 403);
const addSecond = new SoftwareAuthenticator({ alg: -257 });
const reauth2 = await call('/api/me/reauth-options', 'POST', {}, samCookie);
const addOpts = await call('/api/me/passkeys/options', 'POST', { proof: sam.get(reauth2.data, base) }, samCookie);
const addedRsa = await call('/api/me/passkeys', 'POST', { ...addSecond.create(addOpts.data, base), label: 'Clé de sécurité' }, samCookie);
check('a second passkey (RS256, like Windows Hello) can be added with the proof', addedRsa.status === 201, addedRsa.text);
const rsaIn = await signIn(addSecond);
check('and signs in: both ES256 and RS256 assertions are verified', rsaIn.done.status === 200 && rsaIn.done.data.user.name === 'Sam Clé', rsaIn.done.text);
const reauth3 = await call('/api/me/reauth-options', 'POST', {}, samCookie);
const removeFirst = await call(`/api/me/passkeys/${only.id}`, 'DELETE', { proof: sam.get(reauth3.data, base) }, samCookie);
check('with two passkeys one can be removed (proof required): 200, and only the other one remains', removeFirst.status === 200 && (await call('/api/me/security', 'GET', null, samCookie)).data.passkeys.length === 1, removeFirst.text);

console.log('\n# passkeys with the other protections');
const tf = await call('/api/auth/register', 'POST', { name: 'Tess Double', email: 'tess@pk.test', password: PW });
const tfSetup = await call('/api/me/2fa/setup', 'POST', { password: PW }, tf.cookie);
await call('/api/me/2fa/enable', 'POST', { code: totpAt(tfSetup.data.secret, Date.now()) }, tf.cookie);
const tessKey = new SoftwareAuthenticator();
const tessOptions = await call('/api/me/passkeys/options', 'POST', { password: PW }, tf.cookie);
await call('/api/me/passkeys', 'POST', tessKey.create(tessOptions.data, base), tf.cookie);
const tessPassword = await call('/api/auth/login', 'POST', { email: 'tess@pk.test', password: PW });
const tessPasskey = await signIn(tessKey);
check('a passkey already combines the device and a fingerprint, face or code, so it does not ask for the authenticator code; the password path still does', tessPassword.data.second_step !== undefined && tessPasskey.done.status === 200 && tessPasskey.done.data.user.email === 'tess@pk.test', [tessPassword.text, tessPasskey.done.text]);
const staffKey = new SoftwareAuthenticator();
const staffOptions = await call('/api/me/passkeys/options', 'POST', { password: agentPw }, agent);
const staffAdded = await call('/api/me/passkeys', 'POST', staffKey.create(staffOptions.data, base), agent);
const staffIn = await signIn(staffKey);
const admin = (await call('/api/auth/login', 'POST', { email: 'admin@pk.test', password: adminPw })).cookie;
const actions = ((await call('/api/admin/audit', 'GET', null, admin)).data.entries || []).map((e) => e.action);
check('staff can use passkeys too: adding one and signing in with it are in the journal', staffAdded.status === 201 && staffIn.done.status === 200 && staffIn.done.data.user.role === 'agent' && actions.includes('auth.passkey_added') && actions.filter((a) => a === 'auth.staff_login').length >= 2, JSON.stringify(actions));
const tessId = query("SELECT id FROM users WHERE email = 'tess@pk.test'")[0].id;
await call(`/api/admin/citizens/${tessId}`, 'PATCH', { active: false, reason: 'Test de désactivation' }, agent);
const stopped = await signIn(tessKey);
await call(`/api/admin/citizens/${tessId}`, 'PATCH', { active: true }, agent);
const resumed = await signIn(tessKey);
check('a deactivated account cannot sign in with its passkey (403, no session); once reactivated the same passkey works again', stopped.done.status === 403 && stopped.done.setCookie === '' && resumed.done.status === 200, [stopped.done.text, resumed.done.text]);

console.log('\n# F71. an agent opens an account at the desk; password change');
const anonCreate = await call('/api/admin/citizens', 'POST', { name: 'Habitant du guichet' });
const residentCreate = await call('/api/admin/citizens', 'POST', { name: 'Habitant du guichet' }, mia);
const shortName = await call('/api/admin/citizens', 'POST', { name: 'x' }, agent);
const badDistrict = await call('/api/admin/citizens', 'POST', { name: 'Habitant du guichet', district: 'Lune' }, agent);
check('only staff open accounts (anonymous 401, resident 403); a too short name or an unknown district is 400', anonCreate.status === 401 && residentCreate.status === 403 && shortName.status === 400 && badDistrict.status === 400, [anonCreate.status, residentCreate.status, shortName.status, badDistrict.status]);
const desk = await call('/api/admin/citizens', 'POST', { name: 'Habitant du guichet', district: 'Quartier sud' }, agent);
check('an agent opens the account (201): an access code and a one-time password come back once, with the district', desk.status === 201 && /^TN-/.test(desk.data.access_code) && desk.data.password.length >= 16 && desk.data.citizen.district === 'Quartier sud' && desk.data.citizen.email === desk.data.access_code, desk.text);
const counterIn = await call('/api/auth/login', 'POST', { email: desk.data.access_code, password: desk.data.password });
check('the resident signs in with the code and the one-time password; the password is stored only hashed', counterIn.status === 200 && counterIn.data.user.name === 'Habitant du guichet' && query('SELECT password_hash FROM users WHERE email = ?', desk.data.access_code)[0].password_hash.includes(':') && !query('SELECT password_hash FROM users WHERE email = ?', desk.data.access_code)[0].password_hash.includes(desk.data.password), counterIn.text);
const entries = ((await call('/api/admin/audit', 'GET', null, admin)).data.entries || []).filter((e) => e.action === 'account.create');
check('the journal records who opened the account and for whom, and never the one-time password', entries.length === 1 && /Habitant du guichet/.test(JSON.stringify(entries[0])) && !JSON.stringify(entries).includes(desk.data.password), JSON.stringify(entries).slice(0, 300));
const tooShort = await call('/api/me/password', 'POST', { current: desk.data.password, next: 'short' }, counterIn.cookie);
const wrongCurrent = await call('/api/me/password', 'POST', { current: 'not-the-password', next: 'a-brand-new-password-1' }, counterIn.cookie);
const noAuth = await call('/api/me/password', 'POST', { current: desk.data.password, next: 'a-brand-new-password-1' });
check('changing the password needs a session, the current password and 12+ characters (401 / 403 / 400), nothing changes', noAuth.status === 401 && wrongCurrent.status === 403 && tooShort.status === 400 && (await call('/api/auth/login', 'POST', { email: desk.data.access_code, password: desk.data.password })).status === 200, [noAuth.status, wrongCurrent.status, tooShort.status]);
const otherSession = (await call('/api/auth/login', 'POST', { email: desk.data.access_code, password: desk.data.password })).cookie;
const changed = await call('/api/me/password', 'POST', { current: desk.data.password, next: 'a-brand-new-password-1' }, counterIn.cookie);
check('with the current password it changes (200): this session stays, every other session of the account ends, the old password stops working, the new one works', changed.status === 200 && (await call('/api/me', 'GET', null, counterIn.cookie)).data.user !== null && (await call('/api/me', 'GET', null, otherSession)).data.user === null
  && (await call('/api/auth/login', 'POST', { email: desk.data.access_code, password: desk.data.password })).status === 401 && (await call('/api/auth/login', 'POST', { email: desk.data.access_code, password: 'a-brand-new-password-1' })).status === 200, changed.text);
check('and the resident finds a notice that the password was changed', (await call('/api/me/notices', 'GET', null, counterIn.cookie)).data.notices.some((n) => n.code === 'security.password_changed'));
const keyOnly = new SoftwareAuthenticator();
const keyOnlyAccount = await signUp(keyOnly, { name: 'Zed Sans Mot de Passe' });
const noProofPw = await call('/api/me/password', 'POST', { next: 'a-brand-new-password-1' }, keyOnlyAccount.done.cookie);
const reauth = await call('/api/me/reauth-options', 'POST', {}, keyOnlyAccount.done.cookie);
const setPw = await call('/api/me/password', 'POST', { next: 'a-brand-new-password-1', proof: keyOnly.get(reauth.data, base) }, keyOnlyAccount.done.cookie);
check('a password-less account can set a password (a way back in if every device is lost) only with a passkey proof; then the code and that password sign in', noProofPw.status === 403 && setPw.status === 200 && (await call('/api/auth/login', 'POST', { email: keyOnlyAccount.done.data.access_code, password: 'a-brand-new-password-1' })).status === 200 && (await call('/api/me/security', 'GET', null, keyOnlyAccount.done.cookie)).data.has_password === true, [noProofPw.text, setPw.text]);
let lastCreate;
for (let i = 0; i < 61; i++) lastCreate = await call('/api/admin/citizens', 'POST', { name: `Habitant numéro ${i}` }, agent);
check('an agent cannot open more than 60 accounts an hour (429)', lastCreate.status === 429 && lastCreate.data.retryAfter > 0, lastCreate.text);

console.log('\n# restart, deletion');
await stop();
await start();
const afterRestartRsa = await signIn(addSecond, {});
check('the remaining (RS256) passkey signs in after a restart, and the desk keeps increasing', afterRestartRsa.done.status === 200 && query("SELECT sign_count FROM passkeys WHERE label = 'Clé de sécurité'")[0].sign_count >= 2, afterRestartRsa.done.text);
const reauth4 = await call('/api/me/reauth-options', 'POST', {}, afterRestartRsa.done.cookie);
const samId = query('SELECT user_id FROM passkeys WHERE label = ?', 'Clé de sécurité')[0].user_id;
const noProofDelete = await call('/api/me', 'DELETE', {}, afterRestartRsa.done.cookie);
const passwordDelete = await call('/api/me', 'DELETE', { password: 'any-password-123' }, afterRestartRsa.done.cookie);
const del = await call('/api/me', 'DELETE', { proof: addSecond.get(reauth4.data, base) }, afterRestartRsa.done.cookie);
check('a password-less resident cannot delete the account with no proof or a made-up password (403, nothing deleted), and can with a passkey proof; the passkeys go with the account', noProofDelete.status === 403 && passwordDelete.status === 403 && del.status === 200 && query('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?', samId)[0].n === 0 && query('SELECT COUNT(*) AS n FROM users WHERE id = ?', samId)[0].n === 0, del.text);

await stop();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n${failures} FAILED` : '\nall passkey checks passed');
process.exit(failures ? 1 : 0);
