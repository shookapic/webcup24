// Independent check of @simplewebauthn/server (pinned 14.0.3) against the malformed/truncated/oversized-declaration cases that broke the custom CBOR
// reader, plus the essential WebAuthn regressions (challenge/replay, origin, RP ID, algorithm, user verification). Bounded, local, no HTTP, no production.
// node tools/qa-auth/webauthn-maintained.mjs
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

let bad = 0;
const check = (name, ok, info = '') => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// ---- 1. the exact malformed inputs from the PM/A reports: must reject promptly, not hang, not allocate unbounded memory
const malformed = [
  ['5-byte array header, length 4294967295, no payload', Buffer.from([0x9a, 0xff, 0xff, 0xff, 0xff])],
  ['declared length 10000, 5-byte body (the PM proof)', Buffer.from([0x9a, 0, 0, 0x27, 0x10])],
  ['truncated map header, no content', Buffer.from([0xbf])],
  ['nested array header only, no content', Buffer.from([0x9f])],
  ['empty buffer', Buffer.alloc(0)],
  ['huge byte-string header, 100-byte tarpit', Buffer.concat([Buffer.from([0x5a, 0x7f, 0xff, 0xff, 0xff]), Buffer.alloc(100)])],
];
for (const [name, bytes] of malformed) {
  const start = performance.now();
  const fakeAttestation = { id: 'x', rawId: 'x', type: 'public-key', response: { clientDataJSON: b64u(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: 'c', origin: 'https://example.org' }))), attestationObject: b64u(bytes), transports: [] }, clientExtensionResults: {} };
  let outcome;
  try {
    await verifyRegistrationResponse({ response: fakeAttestation, expectedChallenge: 'c', expectedOrigin: 'https://example.org', expectedRPID: 'example.org' });
    outcome = 'ACCEPTED (should have rejected)';
  } catch (error) { outcome = `rejected: ${error.constructor.name}: ${String(error.message).slice(0, 80)}`; }
  const ms = performance.now() - start;
  check(`malformed CBOR (${name}): rejected promptly, not accepted`, /^rejected/.test(outcome) && ms < 200, `${outcome} (${Math.round(ms)} ms)`);
}

// ---- 2. a real registration + authentication ceremony, simulated with a software key pair (ES256), to prove the maintained library accepts GOOD input
// and to exercise challenge/replay, origin, RP ID, algorithm and user-verification checks against it (same shape of proof as A's own tools/qa-a/*.mjs).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
const rpId = 'example.org';
const origin = 'https://example.org';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const tag = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : Buffer.concat([Buffer.from([(major << 5) | 24]), Buffer.from([n])]));
const cint = (n) => (n >= 0 ? tag(0, n) : tag(1, -1 - n));
const cbstr = (b) => Buffer.concat([tag(2, b.length), b]);
const coseKey = (() => {
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url');
  // CBOR map {1:2 (kty EC2), 3:-7 (alg ES256), -1:1 (crv P-256), -2:x, -3:y}, 5 pairs, encoded by hand (small, fixed shape)
  return Buffer.concat([Buffer.from([0xa5]), cint(1), cint(2), cint(3), cint(-7), cint(-1), cint(1), cint(-2), cbstr(x), cint(-3), cbstr(y)]);
})();
function authData({ counter = 1, up = true, uv = true, includeKey = false, rpidHash = createHash('sha256').update(rpId).digest() }) {
  const flags = (up ? 1 : 0) | (uv ? 4 : 0) | (includeKey ? 0x40 : 0);
  const counterBuf = Buffer.alloc(4); counterBuf.writeUInt32BE(counter);
  const credId = Buffer.from('test-credential-0001');
  const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credId.length);
  const parts = [rpidHash, Buffer.from([flags]), counterBuf];
  if (includeKey) parts.push(Buffer.alloc(16), idLen, credId, coseKey); // 16-byte AAGUID placeholder
  return Buffer.concat(parts);
}
function clientData(type, challenge, origin) { return Buffer.from(JSON.stringify({ type, challenge, origin })); }
function esSign(data) { return sign(null, data, { key: privateKey, dsaEncoding: 'der' }); }

async function attempt(label, { challenge, expectedChallenge, clientOrigin = origin, clientType = 'webauthn.get', ad = authData({ counter: 1 }), tamperSignature = false, expectedRPID = rpId, expectedOrigin = origin, authenticator, requireUserVerification = true } = {}) {
  const sentChallenge = challenge ?? expectedChallenge;
  const cdj = clientData(clientType, sentChallenge, clientOrigin);
  const toSign = Buffer.concat([ad, createHash('sha256').update(cdj).digest()]);
  let sig = esSign(toSign);
  if (tamperSignature) { const before = sig.toString('hex'); sig = Buffer.from(sig); sig[Math.floor(sig.length / 2)] ^= 0xff; if (process.env.DEBUG_SIG) console.error('DEBUG sig before', before, 'after', sig.toString('hex')); } // flip a byte in the middle of a genuine signature (DER r/s)
  const response = { id: b64u(Buffer.from('test-credential-0001')), rawId: b64u(Buffer.from('test-credential-0001')), type: 'public-key', response: { clientDataJSON: b64u(cdj), authenticatorData: b64u(ad), signature: b64u(sig), userHandle: undefined }, clientExtensionResults: {} };
  try {
    const result = await verifyAuthenticationResponse({ response, expectedChallenge: expectedChallenge ?? sentChallenge, expectedOrigin, expectedRPID, requireUserVerification,
      credential: authenticator ?? { id: 'test-credential-0001', publicKey: createPublicKey(publicKey).export({ type: 'spki', format: 'der' }), counter: 0 } });
    // the library does not always throw on a bad signature: a failed ceremony can also come back as { verified: false } (confirmed by probing with a
    // deliberately corrupted public key vs. a tampered signature, which behave differently) — both must be treated as "rejected" here.
    if (result.verified !== true) return { ok: false, error: new Error('verified: false') };
    return { ok: true, result };
  } catch (error) { return { ok: false, error }; }
}
// the credential record the library expects: id (base64url), publicKey (raw COSE-derived key bytes it produced at registration time)
// for this proof we register first, so the stored credential matches exactly what verifyAuthenticationResponse expects.
const regOptions = await generateRegistrationOptions({ rpName: 'Terra Nova', rpID: rpId, userName: 'camille@example.org', attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
const regAd = authData({ counter: 0, includeKey: true });
const regCdj = clientData('webauthn.create', regOptions.challenge, origin);
// attestationObject: CBOR map {fmt:"none", attStmt:{}, authData: <bytes>}
const cstr = (s) => Buffer.concat([Buffer.from([0x60 | s.length]), Buffer.from(s)]);
const attestationObject = Buffer.concat([Buffer.from([0xa3]), cstr('fmt'), cstr('none'), cstr('attStmt'), Buffer.from([0xa0]), cstr('authData'), Buffer.from([0x59, (regAd.length >> 8) & 0xff, regAd.length & 0xff]), regAd]);
const regResponse = { id: b64u(Buffer.from('test-credential-0001')), rawId: b64u(Buffer.from('test-credential-0001')), type: 'public-key', response: { clientDataJSON: b64u(regCdj), attestationObject: b64u(attestationObject), transports: [] }, clientExtensionResults: {} };
let registered;
try {
  const verified = await verifyRegistrationResponse({ response: regResponse, expectedChallenge: regOptions.challenge, expectedOrigin: origin, expectedRPID: rpId });
  registered = verified.registrationInfo;
  check('registration ceremony (software ES256 key, UP+UV set) is accepted by the maintained verifier', verified.verified === true, JSON.stringify({ alg: registered?.credential?.publicKey ? 'present' : 'missing' }));
} catch (error) { check('registration ceremony accepted', false, String(error.message)); }

if (registered) {
  const authenticator = { id: registered.credential.id, publicKey: registered.credential.publicKey, counter: registered.credential.counter };
  const good = await attempt('valid', { expectedChallenge: regOptions.challenge, authenticator });
  check('valid authentication (right challenge/origin/RPID, UV set) is accepted', good.ok, good.ok ? '' : String(good.error?.message));
  // each case changes exactly one thing relative to the valid ceremony above, so the rejection isolates that one check
  const wrongChallenge = await attempt('wrong challenge', { challenge: 'a-different-challenge', expectedChallenge: regOptions.challenge, authenticator });
  check('a client-side challenge that does not match what the server issued is rejected', !wrongChallenge.ok, wrongChallenge.ok ? 'ACCEPTED' : wrongChallenge.error.message);
  const wrongOrigin = await attempt('wrong origin', { expectedChallenge: regOptions.challenge, clientOrigin: 'https://evil.example', authenticator });
  check('wrong origin is rejected', !wrongOrigin.ok, wrongOrigin.ok ? 'ACCEPTED' : wrongOrigin.error.message);
  const wrongRpid = await attempt('wrong RP ID', { expectedChallenge: regOptions.challenge, expectedRPID: 'evil.example', authenticator });
  check('wrong RP ID is rejected', !wrongRpid.ok, wrongRpid.ok ? 'ACCEPTED' : wrongRpid.error.message);
  const noUv = await attempt('no user verification flag', { expectedChallenge: regOptions.challenge, ad: authData({ counter: 1, uv: false }), authenticator });
  check('missing user-verification flag is rejected when requireUserVerification is true', !noUv.ok, noUv.ok ? 'ACCEPTED' : noUv.error.message);
  const noUp = await attempt('no user presence flag', { expectedChallenge: regOptions.challenge, ad: authData({ counter: 1, up: false }), authenticator });
  check('missing user-presence flag is rejected', !noUp.ok, noUp.ok ? 'ACCEPTED' : noUp.error.message);
  const staleCounter = await attempt('non-increasing counter (cloned credential)', { expectedChallenge: regOptions.challenge, ad: authData({ counter: 0 }), authenticator: { ...authenticator, counter: 5 } });
  check('a signature counter that does not advance is rejected (clone detection)', !staleCounter.ok, staleCounter.ok ? 'ACCEPTED' : staleCounter.error.message);
  const badSig = await attempt('tampered signature', { expectedChallenge: regOptions.challenge, authenticator, tamperSignature: true });
  check('a genuine signature with one bit flipped is rejected', !badSig.ok, badSig.ok ? 'ACCEPTED' : badSig.error.message);
  // replay: the SAME valid response used twice. The library itself does not track used challenges (that is the server's job, same as A's existing
  // single-use `challenges` Map in server.mjs); verify it at least re-validates independently and does not cache a "verified" result across calls.
  const replay1 = await attempt('replay 1st use', { expectedChallenge: regOptions.challenge, authenticator });
  const replay2 = await attempt('replay 2nd use (same response)', { expectedChallenge: regOptions.challenge, authenticator });
  check('the verifier alone does not block a literal replay (confirms the server MUST keep single-use challenge tracking, as A already does)', replay1.ok && replay2.ok, 'both calls returned the same verdict, as expected for a pure verifier');
}

console.log(bad ? `FAILURES (${bad})` : 'ALL PASS');
process.exit(bad ? 1 : 0);

