// A software WebAuthn authenticator for protocol tests (no browser): it builds exactly what a device sends (attestationObject, authenticatorData, signature) so the server's
// checks can be exercised with correct answers AND with every kind of wrong one. Supports ES256 and RS256 like real authenticators.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const sha256 = (value) => createHash('sha256').update(value).digest();
const b64u = (buffer) => Buffer.from(buffer).toString('base64url');

// ---- minimal CBOR encoder: unsigned/negative ints, byte strings, text strings, maps
function head(major, value) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  if (value < 65536) return Buffer.from([(major << 5) | 25, value >> 8, value & 255]);
  const out = Buffer.alloc(5);
  out[0] = (major << 5) | 26;
  out.writeUInt32BE(value, 1);
  return out;
}
export function encode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([head(3, bytes.length), bytes]); }
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [encode(k), encode(v)])]);
  throw new Error('cbor encode: unsupported');
}

export class SoftwareAuthenticator {
  constructor({ alg = -7 } = {}) {
    this.alg = alg;
    this.credentialId = randomBytes(32);
    this.counter = 0;
    const pair = alg === -7 ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.publicJwk = pair.publicKey.export({ format: 'jwk' });
    this.id = b64u(this.credentialId);
  }

  cose() {
    const decode = (value) => Buffer.from(value, 'base64url');
    return this.alg === -7
      ? encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, decode(this.publicJwk.x)], [-3, decode(this.publicJwk.y)]]))
      : encode(new Map([[1, 3], [3, -257], [-1, decode(this.publicJwk.n)], [-2, decode(this.publicJwk.e)]]));
  }

  clientData(type, challenge, origin) { return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })); }

  /** navigator.credentials.create(): options come from the server; flags default to "user present + user verified + attested credential data". */
  create(options, origin, { flags = 0x45, rpId = options.rp.id, type = 'webauthn.create', challenge = options.challenge, mutateAuthData } = {}) {
    const clientDataJSON = this.clientData(type, challenge, origin);
    const credential = Buffer.concat([Buffer.alloc(16), (() => { const length = Buffer.alloc(2); length.writeUInt16BE(this.credentialId.length); return length; })(), this.credentialId, this.cose()]);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    let authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), counter, credential]);
    if (mutateAuthData) authData = mutateAuthData(authData);
    const attestationObject = encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return { id: this.id, rawId: this.id, type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) } };
  }

  /** navigator.credentials.get(): signs authenticatorData || SHA-256(clientDataJSON). */
  get(options, origin, { flags = 0x05, rpId = options.rpId, type = 'webauthn.get', challenge = options.challenge, counter, signWith = this.privateKey, tamper = false } = {}) {
    this.counter = counter ?? this.counter + 1;
    const clientDataJSON = this.clientData(type, challenge, origin);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([flags]), count]);
    let signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), signWith);
    if (tamper) { signature = Buffer.from(signature); signature[signature.length - 1] ^= 1; }
    return { id: this.id, rawId: this.id, type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature), userHandle: null } };
  }
}
