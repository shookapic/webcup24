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

export function createSession(response, userId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), userId, Date.now() + sessionLifetime);
  response.setHeader('Set-Cookie', `tn_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

export function clearSession(request, response) {
  const token = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('tn_session='))?.slice(11);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  response.setHeader('Set-Cookie', `tn_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

export function currentUser(request) {
  const token = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('tn_session='))?.slice(11);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db.prepare(`
    SELECT users.id, users.email, users.name, users.role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash(token), Date.now()) || null;
}
