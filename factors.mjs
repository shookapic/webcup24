// F53 (a second verification step: authenticator-app codes and single-use recovery codes) and D02 (passkeys, WebAuthn) without any dependency: node:crypto only.
import { createHash, createHmac, createPublicKey, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const sha256 = (value) => createHash('sha256').update(value).digest();

// ---- RFC 4648 base32 (authenticator apps read the secret this way)
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text.replace(/[\s=-]/g, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// ---- RFC 4226 / RFC 6238: HMAC-SHA1, 30 s steps, 6 digits (what every authenticator app does)
export const newSecret = () => base32(randomBytes(20));
export function hotp(secret, counter, digits = 6) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1] & 15;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}
export const totpAt = (secretText, timeMs, { digits = 6, period = 30 } = {}) => hotp(unbase32(secretText), Math.floor(timeMs / 1000 / period), digits);
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** The step (30 s counter) a code belongs to, if it is right within one step either side of now and newer than the last accepted step; otherwise null (a code works once). */
export function checkTotp(secretText, code, lastStep = 0, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = unbase32(secretText);
  const current = Math.floor(now / 1000 / 30);
  let found = null;
  for (const step of [current - 1, current, current + 1]) if (step > lastStep && same(hotp(secret, step), code)) found = step; // every step is checked: no early exit to time
  return found;
}
export const otpauthUri = ({ secret, account, issuer }) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
export const groupSecret = (secret) => secret.match(/.{1,4}/g).join(' ');

// ---- recovery codes: eight single-use codes shown once, kept only as hashes
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1: they are read aloud and copied by hand
export const normalizeRecovery = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashRecovery = (value) => sha256(`recovery:${normalizeRecovery(value)}`).toString('hex');
export const looksLikeRecovery = (value) => normalizeRecovery(value).length === 10 && [...normalizeRecovery(value)].every((char) => codeAlphabet.includes(char));
export function newRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = Array.from({ length: 10 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    return { code, hash: hashRecovery(code) };
  });
}

// ---- D02: WebAuthn (passkeys). The CBOR / attestation / signature verification is done by the maintained @simplewebauthn/server (exact version pinned in package.json);
// nothing in this repository parses CBOR. What stays here: the single-use challenge and origin policy of the server, the mapping of the library's answer to this
// application, and the conversion of keys stored before the switch.
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';

const fail = (message) => { const error = new Error(message); error.webauthn = true; return error; };
const unusable = 'Réponse de l’appareil invalide ou refusée.';
const forLibrary = (credential) => ({ id: credential.id, rawId: credential.id, type: 'public-key', clientExtensionResults: {}, response: credential.response });

/** navigator.credentials.create() answer -> { credentialId, publicKey (library key format, base64), counter }; throws an Error with a message safe to show. User verification is required. */
export async function verifyRegistration(credential, { challenge, origin, rpId }) {
  let result;
  try {
    result = await verifyRegistrationResponse({ response: forLibrary(credential), expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
  } catch { throw fail(unusable); }
  if (result.verified !== true || !result.registrationInfo) throw fail(unusable);
  const { credential: created } = result.registrationInfo;
  return { credentialId: created.id, publicKey: Buffer.from(created.publicKey).toString('base64'), counter: created.counter };
}

/** navigator.credentials.get() answer, checked against the stored key (library key format). Returns the new signature counter; a counter that does not move forward is refused. */
export async function verifyAssertion(credential, stored, { challenge, origin, rpId }) {
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: forLibrary(credential), expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: true,
      credential: { id: stored.credential_id, publicKey: new Uint8Array(Buffer.from(stored.cose_key, 'base64')), counter: stored.sign_count },
    });
  } catch { throw fail(unusable); }
  // a failed signature can come back as verified:false instead of an exception: it is checked explicitly
  if (result.verified !== true) throw fail('La vérification de la clé d’accès a échoué.');
  return result.authenticationInfo.newCounter;
}

// Keys stored by the first version of this feature are SPKI (DER) + an algorithm id. The library wants its own COSE key bytes: converted here once, losslessly, into a new
// column (the old columns are left untouched). This only ENCODES a fixed small structure; nothing is parsed.
const head = (major, value) => (value < 24 ? Buffer.from([(major << 5) | value]) : value < 256 ? Buffer.from([(major << 5) | 24, value]) : Buffer.from([(major << 5) | 25, value >> 8, value & 255]));
const int = (n) => (n >= 0 ? head(0, n) : head(1, -1 - n));
const bytes = (b) => Buffer.concat([head(2, b.length), b]);
export function legacyToCose(spkiBase64, alg) {
  const jwk = createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' }).export({ format: 'jwk' });
  const b64u = (v) => Buffer.from(v, 'base64url');
  const entries = alg === -7
    ? [[1, int(2)], [3, int(-7)], [-1, int(1)], [-2, bytes(b64u(jwk.x))], [-3, bytes(b64u(jwk.y))]]
    : [[1, int(3)], [3, int(-257)], [-1, bytes(b64u(jwk.n))], [-2, bytes(b64u(jwk.e))]];
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [int(k), v])]).toString('base64');
}
export const rpIdOf = (origin) => new URL(origin).hostname;
export const newChallenge = () => randomBytes(32).toString('base64url');
