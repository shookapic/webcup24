# Maintained WebAuthn verifier: package handoff and independent verification (release blocker)

Status: package added and independently verified by B on a standalone harness (no HTTP, no production). **A still owns the actual integration into `factors.mjs`/`server.mjs`/`store.mjs`** — this handoff does not itself fix the custom-CBOR defect; it gives A a verified replacement to wire in.

## Package

- `@simplewebauthn/server`, pinned exact version **14.0.3** (latest on npm at review time; `engines.node >= 20.0.0`, so Node 24 is fine). Added as a real `dependencies` entry (the server previously had zero runtime dependencies) in `package.json` / `package-lock.json`.
- Confirmed working: `npm install` succeeds, `npm run build` (world/vite) still succeeds, no conflict with existing devDependencies.
- Its own dependency tree is all first-party `@peculiar/*`/`@hexagon/base64`/`@levischuck/tiny-cbor` — no native bindings, no network calls at runtime.

## What it replaces

A's `factors.mjs` currently hand-rolls CBOR decoding (`cbor()`) and the WebAuthn registration/assertion verification (`verifyRegistration`, `verifyAssertion`). **Confirmed defect** (same one the PM's read-only proof found): `cbor()` trusts a declared array/map/string length from untrusted attacker input without bounding it against the remaining buffer size, so a 5-byte crafted header can claim ~4.29 billion elements. `Array.from({length}, read)` then tries to materialize that many items, which blocks the event loop (reproduced locally with a 4 s kill timer: the process is still running when killed — see evidence below). This parser is reached unauthenticated from `/api/auth/passkey/signup` and `/api/auth/passkey/login` (both decode attacker-supplied `attestationObject`/`authenticatorData` before any session exists).

## Exports A needs (same shapes A's code already expects)

```js
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
```

- **`generateRegistrationOptions({ rpName, rpID, userName, userID?, attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, excludeCredentials? })`** → options object with a `.challenge` (string) to send to the browser and store server-side, same role as A's current `putChallenge`.
- **`verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID })`** → `{ verified: boolean, registrationInfo: { credential: { id, publicKey (Uint8Array, COSE-ish bytes — store as-is, do not re-encode), counter, transports }, credentialDeviceType, credentialBackedUp, ... } }`. **Throws** on structurally malformed CBOR/attestation (confirmed: all 6 malformed/truncated/oversized-declaration cases below threw promptly, none hung, none were accepted).
- **`generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials? })`** → options with `.challenge`.
- **`verifyAuthenticationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID, requireUserVerification: true, credential: { id, publicKey, counter, transports? } })`** → `{ verified: boolean, authenticationInfo: { newCounter, ... } }`. **Important, confirmed by testing (see below): a failed signature/tamper check does NOT always throw — it can return `{ verified: false }` instead.** A's integration must check `result.verified === true` explicitly, not rely on try/catch alone, or a tampered assertion could be silently treated as success by code that only guards against exceptions.

## Storage shape change for A (`passkeys` table)

A's current schema stores `public_key` as SPKI-DER (`key.export({ type: 'spki', format: 'der' })`) and a separate `alg` column, because the custom verifier builds a Node `KeyObject` by hand. The maintained library instead returns `credential.publicKey` as its own byte encoding (COSE-derived, 77 bytes for a P-256 key in the test run) and expects to receive exactly that same encoding back on `verifyAuthenticationResponse`'s `credential.publicKey` — **do not pass it through `createPublicKey`/re-export it, and do not mix old rows (SPKI-DER) with new rows (library format) in the same column**: a stored key in the wrong format will not verify, but (per the point above) that currently surfaces as `verified: false`, not an error, so A's code must check it explicitly and should probably add a `format`/`version` column or a one-time migration note so existing passkeys enrolled under the custom verifier are not silently treated as working. B does not have access to production passkey rows and makes no claim about how many exist or how to migrate them; that decision is A's (e.g. require re-enrollment, keep both code paths keyed by a stored format tag, or similar) and is **UNVERIFIED** here. `alg` is no longer needed as a separate column (the library infers it); `sign_count`/`counter` keeps the same meaning.

## Independent verification (`tools/qa-auth/`, local, bounded, no HTTP)

- `cbor-dos.mjs <copy of factors.mjs>`: reproduces the PM's proof against A's **current, unfixed** `factors.mjs` in a child process with a 4 s kill timer. Result: **FAIL as expected** — confirms the defect is real and reachable (`docs/qa-captures/auth/cbor-dos.log`).
- `webauthn-maintained.mjs`: **ALL PASS (15 checks)** against the maintained library:
  - The 6 malformed/truncated/oversized-declaration inputs (the PM's exact 5-byte case, a truncated map, a truncated array, an empty buffer, a huge byte-string header) are all **rejected in under 1 ms each**, none accepted, none hung.
  - A full software-key (ES256/P-256) registration + authentication ceremony is **accepted** (proves the library works end-to-end, not just that it rejects garbage).
  - Negative cases, each changing exactly one property of an otherwise-valid ceremony: wrong challenge, wrong origin, wrong RP ID, missing user-verification flag, missing user-presence flag, a signature counter that does not advance (clone detection), a genuine signature with one bit flipped — **all correctly rejected** (the last two confirmed only after fixing the test harness itself to check `result.verified`, not just exceptions — see the note above, which is itself evidence for that behaviour).
  - Replay: the verifier alone does not reject a byte-identical response used twice (expected — single-use challenge tracking is the server's job; A's existing `challenges` Map with single-use delete-on-read already provides this and should be kept unchanged).
- Evidence: `docs/qa-captures/auth/webauthn-maintained.log`, `docs/qa-captures/auth/cbor-dos.log`. Source reviewed: A's `factors.mjs`/`server.mjs` at `470aa42`/`6be0b90` (unchanged by this handoff).

## What this handoff does NOT cover (UNVERIFIED)

- A's actual edit of `factors.mjs`/`server.mjs`/`store.mjs` to call the new library and adapt the `passkeys` table — not done here (A owns it, per ownership).
- Compatibility/migration of any already-enrolled passkeys under the old custom verifier.
- Live/production behaviour, real authenticator hardware (only a software ES256 key pair was used), real browser `navigator.credentials` ceremonies.
- `totp`/recovery-code parts of `factors.mjs` (base32, HOTP/TOTP, recovery codes) are unrelated to CBOR/WebAuthn and were not reviewed here; no defect claimed there.
