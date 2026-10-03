import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './store.mjs';

const scrypt = promisify(scryptCallback);
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = await scrypt(password, salt, 64);
  const expectedBytes = Buffer.from(expected, 'hex');
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

const secure = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');
const deviceLifetime = 365 * 24 * 60 * 60;
const cookieOf = (request, name) => request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);

// One cookie per account (tn_device_<id>): two people who share a browser each keep their own recognition and never overwrite each other's.
const deviceCookieName = (userId) => `tn_device_${userId}`;

// F54: is this browser one this resident has used before? Returns the device row id, whether it is new (the resident already had other
// devices), and a cookie to set when a device was created. The cookie value is always generated here: a value sent by the client is only ever
// looked up, never adopted, so it cannot be used to plant an identifier.
export function recognizeDevice(request, userId, label) {
  const sent = cookieOf(request, deviceCookieName(userId));
  if (sent && /^[A-Za-z0-9_-]{43}$/.test(sent)) {
    const known = db.prepare('SELECT id FROM devices WHERE user_id = ? AND token_hash = ?').get(userId, tokenHash(sent));
    if (known) {
      db.prepare('UPDATE devices SET last_seen = CURRENT_TIMESTAMP, label = ? WHERE id = ?').run(label, known.id);
      return { id: known.id, isNew: false, cookie: null };
    }
  }
  const others = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').get(userId).n;
  const fresh = randomBytes(32).toString('base64url');
  const created = db.prepare('INSERT INTO devices (user_id, token_hash, label) VALUES (?, ?, ?)').run(userId, tokenHash(fresh), label);
  return { id: Number(created.lastInsertRowid), isNew: others > 0, cookie: `${deviceCookieName(userId)}=${fresh}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${deviceLifetime}${secure()}` };
}
// the device row of the request's own cookie, if it is one of this resident's
export function currentDeviceId(request, userId) {
  const sent = cookieOf(request, deviceCookieName(userId));
  return sent && /^[A-Za-z0-9_-]{43}$/.test(sent) ? db.prepare('SELECT id FROM devices WHERE user_id = ? AND token_hash = ?').get(userId, tokenHash(sent))?.id ?? null : null;
}

export function createSession(response, userId, device = null) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, device_id) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, Date.now() + sessionLifetime, device?.id ?? null);
  const cookies = [`tn_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}${secure()}`];
  if (device?.cookie) cookies.push(device.cookie);
  response.setHeader('Set-Cookie', cookies);
}

// the session cookie of the request (hashed), so a caller can tell which session is the current one
export const sessionHashOf = (request) => { const token = cookieOf(request, 'tn_session'); return token ? tokenHash(token) : null; };

export function clearSession(request, response) {
  const token = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('tn_session='))?.slice(11);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  response.setHeader('Set-Cookie', `tn_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

// The user fields any client may see; never the password hash.
// A stored avatar that is not valid JSON must not break every request of that user: treat it as no avatar.
function parseAvatar(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    // provisional look ids from before the renderer shipped read back as their canonical looks
    if (parsed.look === 'ingenieur') parsed.look = 'lunettes';
    else if (parsed.look === 'medecin') parsed.look = 'bandeau';
    return parsed;
  } catch {
    return null;
  }
}

export function publicUser({ id, email, name, role, avatar, district }) {
  return { id, email, name, role, avatar: parseAvatar(avatar), district: district || null };
}

export function currentUser(request) {
  const token = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('tn_session='))?.slice(11);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const user = db.prepare(`
    SELECT users.id, users.email, users.name, users.role, users.avatar, users.district
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
  `).get(tokenHash(token), Date.now());
  return user ? publicUser(user) : null;
}
