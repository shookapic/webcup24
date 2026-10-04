// F53 (a second verification step: authenticator-app codes and single-use recovery codes) and D02 (passkeys, WebAuthn) without any dependency: node:crypto only.
import { createHash, createHmac, createPublicKey, randomBytes, randomInt, timingSafeEqual, verify } from 'node:crypto';

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

// ---- D02: WebAuthn (passkeys). Minimal CBOR reader for the attestation object and the COSE key, then the checks of the W3C "verifying" algorithms that matter
//      for a passkey with no attestation: challenge, origin, relying-party id, user presence AND user verification, signature, signature counter.
export function cbor(buffer, start = 0) {
  let position = start;
  const read = () => {
    const initial = buffer[position++];
    const major = initial >> 5;
    const info = initial & 31;
    const length = () => {
      if (info < 24) return info;
      if (info === 24) return buffer[position++];
      if (info === 25) { const value = buffer.readUInt16BE(position); position += 2; return value; }
      if (info === 26) { const value = buffer.readUInt32BE(position); position += 4; return value; }
      throw new Error('cbor: length not supported');
    };
    if (major === 0) return length();
    if (major === 1) return -1 - length();
    if (major === 2) { const size = length(); const out = buffer.subarray(position, position + size); position += size; return out; }
    if (major === 3) { const size = length(); const out = buffer.toString('utf8', position, position + size); position += size; return out; }
    if (major === 4) { const size = length(); return Array.from({ length: size }, read); }
    if (major === 5) { const size = length(); const out = new Map(); for (let i = 0; i < size; i++) { const key = read(); out.set(key, read()); } return out; }
    if (major === 7) { if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; }
    throw new Error('cbor: unsupported item');
  };
  const value = read();
  return { value, end: position };
}

const b64u = (value) => Buffer.from(value, 'base64url');
const fail = (message) => { const error = new Error(message); error.webauthn = true; return error; };

/** The credential key (COSE) as a Node public key: ES256 (-7) and RS256 (-257) are what authenticators produce. */
export function keyFromCose(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return { alg, key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: cose.get(-2).toString('base64url'), y: cose.get(-3).toString('base64url') }, format: 'jwk' }) };
  if (kty === 3 && alg === -257) return { alg, key: createPublicKey({ key: { kty: 'RSA', n: cose.get(-1).toString('base64url'), e: cose.get(-2).toString('base64url') }, format: 'jwk' }) };
  throw fail('Cette clé d’accès n’est pas prise en charge.');
}

function parseAuthData(authData) {
  if (authData.length < 37) throw fail('Réponse de l’appareil invalide.');
  return { rpIdHash: authData.subarray(0, 32), flags: authData[32], counter: authData.readUInt32BE(33), rest: authData.subarray(37) };
}
function checkClient(clientDataJSON, type, challenge, origin) {
  let client;
  try { client = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')); } catch { throw fail('Réponse de l’appareil invalide.'); }
  if (client.type !== type) throw fail('Réponse de l’appareil invalide.');
  if (typeof client.challenge !== 'string' || !same(client.challenge, challenge)) throw fail('La vérification a expiré ou a déjà été utilisée. Recommencez.');
  if (client.origin !== origin) throw fail('Cette clé d’accès n’a pas été créée pour ce site.');
  return b64u(clientDataJSON);
}

/** navigator.credentials.create() answer -> { credentialId, publicKey (SPKI, base64), alg, counter } or throws an Error with a message safe to show. */
export function verifyRegistration({ clientDataJSON, attestationObject }, { challenge, origin, rpId }) {
  checkClient(clientDataJSON, 'webauthn.create', challenge, origin);
  let attestation;
  try { attestation = cbor(b64u(attestationObject)).value; } catch { throw fail('Réponse de l’appareil invalide.'); }
  const authData = attestation instanceof Map ? attestation.get('authData') : null;
  if (!Buffer.isBuffer(authData)) throw fail('Réponse de l’appareil invalide.');
  const parsed = parseAuthData(authData);
  if (!same(parsed.rpIdHash.toString('hex'), sha256(rpId).toString('hex'))) throw fail('Cette clé d’accès n’a pas été créée pour ce site.');
  if (!(parsed.flags & 0x01)) throw fail('La présence de la personne n’a pas été vérifiée.');
  if (!(parsed.flags & 0x04)) throw fail('L’appareil n’a pas vérifié l’identité de la personne (empreinte, visage ou code de l’appareil exigés).');
  if (!(parsed.flags & 0x40)) throw fail('Réponse de l’appareil invalide.');
  const rest = parsed.rest;
  if (rest.length < 18) throw fail('Réponse de l’appareil invalide.');
  const idLength = rest.readUInt16BE(16);
  const credentialId = rest.subarray(18, 18 + idLength);
  if (!idLength || idLength > 1023 || credentialId.length !== idLength) throw fail('Réponse de l’appareil invalide.');
  let cose;
  try { cose = cbor(rest, 18 + idLength).value; } catch { throw fail('Réponse de l’appareil invalide.'); }
  if (!(cose instanceof Map)) throw fail('Réponse de l’appareil invalide.');
  const { alg, key } = keyFromCose(cose);
  return { credentialId: credentialId.toString('base64url'), publicKey: key.export({ type: 'spki', format: 'der' }).toString('base64'), alg, counter: parsed.counter };
}

/** navigator.credentials.get() answer, checked against the stored key. Returns the new signature counter. */
export function verifyAssertion({ clientDataJSON, authenticatorData, signature }, stored, { challenge, origin, rpId }) {
  const clientData = checkClient(clientDataJSON, 'webauthn.get', challenge, origin);
  const authData = b64u(authenticatorData);
  const parsed = parseAuthData(authData);
  if (!same(parsed.rpIdHash.toString('hex'), sha256(rpId).toString('hex'))) throw fail('Cette clé d’accès n’a pas été créée pour ce site.');
  if (!(parsed.flags & 0x01)) throw fail('La présence de la personne n’a pas été vérifiée.');
  if (!(parsed.flags & 0x04)) throw fail('L’appareil n’a pas vérifié l’identité de la personne (empreinte, visage ou code de l’appareil exigés).');
  const key = createPublicKey({ key: Buffer.from(stored.public_key, 'base64'), format: 'der', type: 'spki' });
  const signed = Buffer.concat([authData, sha256(clientData)]);
  const ok = verify('sha256', signed, key, b64u(signature)); // ES256 signatures are DER here; RSA is PKCS#1 v1.5 (RS256)
  if (!ok) throw fail('La vérification de la clé d’accès a échoué.');
  // A counter that does not move forward means the credential may have been cloned (authenticators that never count keep it at 0)
  if ((parsed.counter !== 0 || stored.sign_count !== 0) && parsed.counter <= stored.sign_count) throw fail('Cette clé d’accès semble avoir été copiée : elle est refusée.');
  return parsed.counter;
}
export const rpIdOf = (origin) => new URL(origin).hostname;
export const newChallenge = () => randomBytes(32).toString('base64url');
