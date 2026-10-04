// Protection of the civic forms against automated and repeated submissions (F81, F82). Zero dependencies, in memory like throttle.mjs: a restart clears
// it and it is per process. Layers, each visible to the person or to staff and none a puzzle for a normal visitor:
//   1. a hidden field a person never sees: filled -> refused as automated
//   2. a signed, single-use form token (bound to the form and to the person or address), requested when the person starts using the form; a token
//      younger than TN_FORM_MIN_AGE_MS (default 1.5 s) is answered "too fast" and the page simply retries once by itself
//   3. an idempotent answer: the same token sent again (double click, slow link) returns the first answer instead of creating a second record
//   4. quotas per form, per address and per account, with the wait in the message (429 + Retry-After)
//   5. counters for staff (no names, no content): too fast, refused as automated, quota, duplicates avoided
// Tests: TN_FORM_MIN_AGE_MS=0 and TN_FORM_LIMIT_SCALE=1000 relax timing and quotas; TN_FORM_TOKENS=optional lets API-only harnesses omit the token (a token that is
// sent is still checked). Never set them in production: a warning is printed at start-up.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Limiter } from './throttle.mjs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_TOKEN_AGE = 2 * HOUR;
const scale = Math.max(1, Number(process.env.TN_FORM_LIMIT_SCALE) || 1);
export const minAgeMs = process.env.TN_FORM_MIN_AGE_MS !== undefined ? Math.max(0, Number(process.env.TN_FORM_MIN_AGE_MS) || 0) : 1500;
const tokensOptional = process.env.TN_FORM_TOKENS === 'optional';
export const relaxed = scale > 1 || minAgeMs !== 1500 || tokensOptional;
if (relaxed) console.warn('Form protection is RELAXED (TN_FORM_LIMIT_SCALE / TN_FORM_MIN_AGE_MS / TN_FORM_TOKENS): for tests only.');

export const HONEYPOT = 'fax_ref';
export const guarded = ['register', 'message', 'concern'];
const key = randomBytes(32);

function refuse(status, message, extra) {
  return Object.assign(new Error(message), { status, extra });
}

// ---- counters for staff (a ring of events, never names or content)
const events = [];
export function note(kind, form, now = Date.now()) {
  events.push({ at: now, kind, form });
  if (events.length > 2000) events.splice(0, events.length - 2000);
}
export function formSummary(now = Date.now(), windowMs = HOUR) {
  const recent = events.filter((event) => now - event.at < windowMs);
  const count = (kind) => recent.filter((event) => event.kind === kind).length;
  return { windowMinutes: windowMs / MINUTE, tooFast: count('too_fast'), automated: count('automated'), rateLimited: count('rate_limited'), duplicates: count('duplicate') };
}

// ---- quotas
const limiters = {
  register: { address: new Limiter(30 * scale, HOUR), all: new Limiter(600 * scale, HOUR) },
  message: { account: new Limiter(6 * scale, 10 * MINUTE), day: new Limiter(40 * scale, DAY), address: new Limiter(60 * scale, HOUR) },
  concern: { address: new Limiter(30 * scale, HOUR) },
  book: { account: new Limiter(20 * scale, 10 * MINUTE) },
  token: { address: new Limiter(120 * scale, 10 * MINUTE), account: new Limiter(60 * scale, 10 * MINUTE) },
};
const wording = {
  register: 'Trop d’inscriptions depuis cette adresse en peu de temps.',
  message: 'Vous avez envoyé beaucoup de messages en peu de temps.',
  concern: 'Trop de préoccupations envoyées en peu de temps.',
  book: 'Trop de réservations en peu de temps.',
  token: 'Trop de demandes de formulaire en peu de temps.',
};
// Takes one slot in every quota of the form, or throws the 429 naming the wait. `who` = { address, account }.
export function charge(form, who, now = Date.now()) {
  const set = limiters[form];
  const keys = { address: who.address, account: who.account, day: who.account, all: 'all' };
  let wait = 0;
  for (const [name, limiter] of Object.entries(set)) if (keys[name] != null) wait = Math.max(wait, limiter.waitMs(keys[name], now));
  if (wait > 0) {
    note('rate_limited', form, now);
    const minutes = Math.max(1, Math.ceil(wait / MINUTE));
    throw refuse(429, `${wording[form]} Réessayez dans ${minutes} min.`, { retryAfter: Math.max(1, Math.ceil(wait / 1000)), code: 'form-rate' });
  }
  for (const [name, limiter] of Object.entries(set)) if (keys[name] != null) limiter.add(keys[name], now);
}

// ---- tokens
const used = new Map(); // nonce -> { at, answer }
const sign = (form, subject, at, nonce) => createHmac('sha256', key).update(`${form}|${subject}|${at}|${nonce}`).digest('base64url').slice(0, 24);

export function issueToken(form, subject, now = Date.now()) {
  if (!guarded.includes(form)) throw refuse(400, 'Formulaire inconnu.');
  const nonce = randomBytes(9).toString('base64url');
  return `${now}.${nonce}.${sign(form, subject, now, nonce)}`;
}

function readToken(token, form, subject, now) {
  const [at, nonce, mac] = String(token || '').split('.');
  if (!at || !nonce || !mac || !/^\d+$/.test(at)) return null;
  const expected = Buffer.from(sign(form, subject, at, nonce));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const age = now - Number(at);
  if (age < -5000 || age > MAX_TOKEN_AGE) return null;
  return { nonce, age: Math.max(0, age) };
}

// Called first by a guarded route, after the body is read. Returns { replay } when the same token was already accepted (the stored first answer is to be sent
// again, nothing is created), otherwise { done(status, body), abandon() }: done once the record exists, abandon if the route fails after an await (pass
// pending: true for a route that awaits between the check and the record, so a second request with the same token waits for the first: 409 form-busy).
// Throws the refusals (400 / 409 / 429) otherwise. A token is only used up by done(), so a refused or invalid send can be corrected and sent again.
export function begin({ form, subject, body, pending = false, now = Date.now() }) {
  if (body[HONEYPOT]) {
    note('automated', form, now);
    throw refuse(400, 'Ce formulaire n’a pas pu être envoyé. Rechargez la page et recommencez.', { code: 'form-refused' });
  }
  const token = body.form_token;
  if (!token && tokensOptional) return { done() {}, abandon() {} };
  const parsed = readToken(token, form, subject, now);
  if (!parsed) {
    note('automated', form, now);
    throw refuse(400, 'Le formulaire a expiré ou n’a pas été chargé correctement. Rechargez la page et recommencez.', { code: 'form-expired' });
  }
  const previous = used.get(parsed.nonce);
  if (previous?.answer) return { replay: previous.answer };
  if (previous?.pending && now - previous.at < 30_000) throw refuse(409, 'Ce formulaire est déjà en cours d’envoi.', { code: 'form-busy' });
  if (parsed.age < minAgeMs) {
    note('too_fast', form, now);
    const wait = minAgeMs - parsed.age;
    throw refuse(429, 'Le formulaire a été envoyé très vite : un instant, nous réessayons.', { retryAfter: Math.max(1, Math.ceil(wait / 1000)), retryAfterMs: Math.ceil(wait), code: 'form-too-fast' });
  }
  if (pending) used.set(parsed.nonce, { at: now, pending: true, answer: null });
  return {
    done(status, answer) { used.set(parsed.nonce, { at: Date.now(), pending: false, answer: { status, body: answer } }); },
    abandon() { if (pending) used.delete(parsed.nonce); },
  };
}

export function issue(form, who, subject, now = Date.now()) {
  charge('token', who, now);
  return issueToken(form, subject, now);
}

setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of used) if (now - entry.at > MAX_TOKEN_AGE) used.delete(nonce);
  for (const set of Object.values(limiters)) for (const limiter of Object.values(set)) limiter.sweep(now);
}, MINUTE).unref();
