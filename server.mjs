import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, sep } from 'node:path';
import { db } from './store.mjs';
import { clearSession, createSession, currentUser, hashPassword, publicUser, verifyPassword } from './security.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const apiUrl = 'https://24h.webcup.fr/wp-json/webcup/v1/requests';
// Passenger may hand over a socket path instead of a numeric port.
const port = /^\d+$/.test(process.env.PORT || '') ? Number(process.env.PORT) : process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const worldRoot = join(root, 'dist', 'monde');
const worldTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};
const worldCsp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; base-uri 'none'; object-src 'none'";
const presence = new Map();
// Times are in minutes after midnight, city time. Trams leave each terminus every `every` minutes
// from `first` to `last`, taking `hop` minutes between stops.
const cityTimeZone = 'Indian/Reunion';
const stopDistricts = { Mairie: 'Centre-ville', Habitat: 'Quartier nord', Santé: 'Quartier est', Marché: 'Quartier ouest', 'Quartier sud': 'Quartier sud' };
const transportLines = [
  { code: 'T1', name: 'Habitat ↔ Quartier sud', color: '#b8336a', first: 330, last: 1350, every: 10, hop: 4, stops: ['Habitat', 'Mairie', 'Quartier sud'] },
  { code: 'T2', name: 'Marché ↔ Santé', color: '#1d6fa5', first: 360, last: 1320, every: 15, hop: 5, stops: ['Marché', 'Mairie', 'Santé'] },
].map((line) => ({
  ...line,
  // Every passage at each stop in both directions, sorted, computed once.
  passages: line.stops.map((_, index) => {
    const times = new Set();
    for (let trip = line.first; trip <= line.last; trip += line.every) {
      times.add(trip + index * line.hop);
      times.add(trip + (line.stops.length - 1 - index) * line.hop);
    }
    return [...times].sort((a, b) => a - b);
  }),
}));

function cityMinutes(date = new Date()) {
  const [hours, minutes] = new Intl.DateTimeFormat('en-GB', { timeZone: cityTimeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).split(':');
  return Number(hours) * 60 + Number(minutes);
}

// The next three passages from `now`, rolling over to tomorrow's first trams after the last one.
function nextPassages(passages, now) {
  return [...passages.filter((minute) => minute >= now), ...passages.map((minute) => minute + 1440)].slice(0, 3)
    .map((minute) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
}
const loginAttempts = new Map();
let cachedFeed;
let pendingFeed;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20_000) fail(413, 'Le formulaire est trop volumineux.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Données invalides.');
    return value;
  } catch (error) {
    if (error.status) throw error;
    fail(400, 'JSON invalide.');
  }
}

function requireUser(request, roles) {
  const user = currentUser(request);
  if (!user) fail(401, 'Connectez-vous pour continuer.');
  if (roles && !roles.includes(user.role)) fail(403, 'Accès réservé.');
  return user;
}

function text(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    fail(400, `${label} doit contenir entre ${min} et ${max} caractères.`);
  }
  return value.trim();
}

function email(value) {
  const result = text(value, 5, 254, 'L’adresse e-mail').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, 'Adresse e-mail invalide.');
  return result;
}

function password(value, min) {
  if (typeof value !== 'string' || value.length < min || value.length > 128) {
    fail(400, `Le mot de passe doit contenir entre ${min} et 128 caractères.`);
  }
  return value;
}

async function loadFeed() {
  if (!process.env.TERRA_NOVA_API_KEY) fail(503, 'La clé API de l’équipe doit être configurée.');
  if (cachedFeed && Date.now() - cachedFeed.at < 15_000) return cachedFeed.data;
  if (pendingFeed) return pendingFeed;

  pendingFeed = (async () => {
    const response = await fetch(apiUrl, {
      headers: { 'X-Webcup-Api-Key': process.env.TERRA_NOVA_API_KEY },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) fail(502, response.status === 403 ? 'La clé a été refusée par l’API officielle.' : 'Le flux officiel est indisponible.');
    const data = await response.json();
    if (!data || !data.session || !Array.isArray(data.requests)) fail(502, 'Réponse invalide de l’API officielle.');
    cachedFeed = { data, at: Date.now() };
    return data;
  })();

  try {
    return await pendingFeed;
  } finally {
    pendingFeed = undefined;
  }
}

async function serveFile(path, response) {
  const file = files.get(path);
  if (!file) fail(404, 'Page introuvable.');
  const body = await readFile(join(root, 'public', file[0]));
  response.writeHead(200, {
    'Content-Type': file[1],
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'",
  });
  response.end(body);
}

async function serveWorld(path, response) {
  let relative;
  try { relative = decodeURIComponent(path.slice('/monde'.length)); } catch { fail(400, 'Adresse invalide.'); }
  if (relative.includes('\0')) fail(400, 'Adresse invalide.');
  let file = join(worldRoot, relative);
  if (file !== worldRoot && !file.startsWith(worldRoot + sep)) fail(404, 'Page introuvable.');
  let body;
  try {
    body = await readFile(file);
  } catch (error) {
    if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) throw error;
    file = join(worldRoot, 'index.html');
    try { body = await readFile(file); } catch { fail(404, 'Le monde n’est pas encore disponible.'); }
  }
  response.writeHead(200, {
    'Content-Type': worldTypes[extname(file).toLowerCase()] || 'application/octet-stream',
    // Vite fingerprints everything under assets/, so those files never change.
    'Cache-Control': relative.startsWith('/assets/') && file !== join(worldRoot, 'index.html') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': worldCsp,
  });
  response.end(body);
}

function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(400, 'Couleur invalide (format #rrggbb).');
  return value.toLowerCase();
}

function coordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6) fail(400, 'Position invalide.');
  return value;
}

async function route(request, response) {
  const path = new URL(request.url, 'http://localhost').pathname;
  const method = request.method;

  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fail(405, 'Méthode non autorisée.');
  if (method !== 'GET' && request.headers.origin) {
    let origin;
    try { origin = new URL(request.headers.origin); } catch { fail(403, 'Origine non autorisée.'); }
    if (origin.host !== request.headers.host) fail(403, 'Origine non autorisée.');
  }

  if (path === '/api/me' && method === 'GET') return sendJson(response, 200, { user: currentUser(request) });
  if (path === '/api/me' && method === 'PATCH') {
    const user = requireUser(request);
    const body = await readJson(request);
    const name = text(body.name, 2, 80, 'Le nom');
    const district = body.district ? text(body.district, 2, 80, 'Le quartier') : null;
    db.prepare('UPDATE users SET name = ?, district = ? WHERE id = ?').run(name, district, user.id);
    return sendJson(response, 200, { user: { ...user, name, district } });
  }
  if (path === '/api/me' && method === 'DELETE') {
    // Citizens only: staff accounts are managed by an administrator.
    const user = requireUser(request, ['citizen']);
    const body = await readJson(request);
    const secret = password(body.password, 1);
    const key = `delete:${user.id}`;
    const attempt = loginAttempts.get(key);
    if (attempt?.count >= 5 && attempt.until > Date.now()) fail(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    const { password_hash: hash } = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!(await verifyPassword(secret, hash))) {
      loginAttempts.set(key, { count: (attempt?.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      fail(403, 'Mot de passe incorrect.');
    }
    // Messages go with the account; sessions cascade from users.
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM messages WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    loginAttempts.delete(key);
    presence.delete(user.id);
    clearSession(request, response);
    return sendJson(response, 200, { ok: true });
  }
  if (path === '/api/me/avatar' && method === 'PUT') {
    const user = requireUser(request);
    const body = await readJson(request);
    const avatar = { skin: color(body.skin), outfit: color(body.outfit), accent: color(body.accent) };
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(JSON.stringify(avatar), user.id);
    return sendJson(response, 200, { avatar });
  }

  if (path === '/api/presence' && method === 'POST') {
    const user = requireUser(request);
    const body = await readJson(request);
    presence.set(user.id, { id: user.id, name: user.name, avatar: user.avatar, x: coordinate(body.x), z: coordinate(body.z), ry: coordinate(body.ry), at: Date.now() });
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    return response.end();
  }
  if (path === '/api/presence' && method === 'GET') {
    // Anonymous visitors see nobody: player names stay behind the login.
    const user = currentUser(request);
    const players = [];
    for (const [id, { at, ...player }] of presence) {
      if (Date.now() - at > 15_000) presence.delete(id);
      else if (user && id !== user.id) players.push(player);
    }
    return sendJson(response, 200, { players });
  }

  if (path === '/api/auth/register' && method === 'POST') {
    const body = await readJson(request);
    const name = text(body.name, 2, 80, 'Le nom');
    const address = email(body.email);
    const secret = password(body.password, 12);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(address)) fail(409, 'Cette adresse est déjà utilisée.');
    const hash = await hashPassword(secret);
    let result;
    try {
      result = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(address, name, hash, 'citizen');
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) fail(409, 'Cette adresse est déjà utilisée.');
      throw error;
    }
    clearSession(request, response);
    createSession(response, Number(result.lastInsertRowid));
    return sendJson(response, 201, { user: publicUser({ id: Number(result.lastInsertRowid), email: address, name, role: 'citizen' }) });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readJson(request);
    const address = email(body.email);
    const secret = password(body.password, 1);
    const key = `${request.socket.remoteAddress}:${address}`;
    const attempt = loginAttempts.get(key);
    if (attempt?.count >= 5 && attempt.until > Date.now()) fail(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(address);
    if (!user || !(await verifyPassword(secret, user.password_hash))) {
      loginAttempts.set(key, { count: (attempt?.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      fail(401, 'Identifiants incorrects.');
    }
    loginAttempts.delete(key);
    clearSession(request, response);
    createSession(response, user.id);
    return sendJson(response, 200, { user: publicUser(user) });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    clearSession(request, response);
    return sendJson(response, 200, { ok: true });
  }

  if (path === '/api/services' && method === 'GET') {
    return sendJson(response, 200, { services: db.prepare('SELECT * FROM services ORDER BY featured DESC, id').all() });
  }
  if (path === '/api/services' && method === 'POST') {
    requireUser(request, ['admin']);
    const body = await readJson(request);
    const title = text(body.title, 3, 100, 'Le titre');
    const description = text(body.description, 5, 180, 'La description');
    const details = text(body.details, 10, 2000, 'Les informations');
    if (body.featured !== undefined && typeof body.featured !== 'boolean') fail(400, 'La mise en avant est invalide.');
    // English versions are optional; without a title_en the service shows in French.
    const titleEn = body.title_en ? text(body.title_en, 3, 100, 'Le titre') : null;
    const descriptionEn = body.description_en ? text(body.description_en, 5, 180, 'La description') : null;
    const detailsEn = body.details_en ? text(body.details_en, 10, 2000, 'Les informations') : null;
    const result = db.prepare('INSERT INTO services (title, description, details, featured, title_en, description_en, details_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(title, description, details, body.featured ? 1 : 0, titleEn, descriptionEn, detailsEn);
    return sendJson(response, 201, { id: Number(result.lastInsertRowid) });
  }
  const serviceMatch = /^\/api\/services\/(\d+)$/.exec(path);
  if (serviceMatch && method === 'PATCH') {
    requireUser(request, ['admin']);
    const body = await readJson(request);
    if (typeof body.featured !== 'boolean') fail(400, 'La mise en avant est invalide.');
    const result = db.prepare('UPDATE services SET featured = ? WHERE id = ?').run(body.featured ? 1 : 0, Number(serviceMatch[1]));
    if (!result.changes) fail(404, 'Service introuvable.');
    return sendJson(response, 200, { ok: true });
  }

  if (path === '/api/announcements' && method === 'GET') {
    return sendJson(response, 200, { announcements: db.prepare('SELECT * FROM announcements ORDER BY published_at DESC, id DESC').all() });
  }
  if (path === '/api/announcements' && method === 'POST') {
    requireUser(request, ['admin']);
    const body = await readJson(request);
    const title = text(body.title, 3, 120, 'Le titre');
    const content = text(body.body, 10, 4000, 'Le contenu');
    if (body.urgent !== undefined && typeof body.urgent !== 'boolean') fail(400, 'Le niveau d’urgence est invalide.');
    const audience = body.audience ? text(body.audience, 2, 80, 'Le public concerné') : 'Tous';
    const titleEn = body.title_en ? text(body.title_en, 3, 120, 'Le titre') : null;
    const contentEn = body.body_en ? text(body.body_en, 10, 4000, 'Le contenu') : null;
    const result = db.prepare('INSERT INTO announcements (title, body, audience, urgent, title_en, body_en) VALUES (?, ?, ?, ?, ?, ?)')
      .run(title, content, audience, body.urgent ? 1 : 0, titleEn, contentEn);
    return sendJson(response, 201, { id: Number(result.lastInsertRowid) });
  }
  const announcementMatch = /^\/api\/announcements\/(\d+)$/.exec(path);
  if (announcementMatch && method === 'PATCH') {
    requireUser(request, ['admin']);
    const body = await readJson(request);
    if (typeof body.urgent !== 'boolean') fail(400, 'Le niveau d’urgence est invalide.');
    const result = db.prepare('UPDATE announcements SET urgent = ? WHERE id = ?').run(body.urgent ? 1 : 0, Number(announcementMatch[1]));
    if (!result.changes) fail(404, 'Actualité introuvable.');
    return sendJson(response, 200, { ok: true });
  }

  if (path === '/api/transports' && method === 'GET') {
    const now = cityMinutes();
    const statuses = new Map(db.prepare('SELECT * FROM transport_status').all().map((row) => [row.code, row]));
    const lines = transportLines.map((line) => ({
      code: line.code,
      name: line.name,
      color: line.color,
      status: statuses.get(line.code)?.status || 'normal',
      message: statuses.get(line.code)?.message || null,
      stops: line.stops.map((name, index) => ({ name, district: stopDistricts[name], next: nextPassages(line.passages[index], now) })),
    }));
    return sendJson(response, 200, { lines });
  }
  const transportMatch = /^\/api\/transports\/(T\d)$/.exec(path);
  if (transportMatch && method === 'PATCH') {
    requireUser(request, ['agent', 'admin']);
    if (!transportLines.some((line) => line.code === transportMatch[1])) fail(404, 'Ligne introuvable.');
    const body = await readJson(request);
    if (!['normal', 'perturbé'].includes(body.status)) fail(400, 'Statut invalide.');
    const message = body.status === 'perturbé' || body.message ? text(body.message, 5, 200, 'Le message') : null;
    db.prepare('INSERT INTO transport_status (code, status, message) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET status = excluded.status, message = excluded.message')
      .run(transportMatch[1], body.status, message);
    return sendJson(response, 200, { ok: true });
  }

  if (path === '/api/messages' && method === 'GET') {
    const user = requireUser(request);
    const all = ['agent', 'admin'].includes(user.role);
    const messages = all
      ? db.prepare(`SELECT messages.*, users.name AS citizen_name, users.email AS citizen_email FROM messages JOIN users ON users.id = messages.user_id ORDER BY messages.created_at DESC, messages.id DESC`).all()
      : db.prepare('SELECT id, subject, body, kind, location, status, created_at, updated_at FROM messages WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(user.id);
    return sendJson(response, 200, { messages });
  }
  if (path === '/api/messages' && method === 'POST') {
    const user = requireUser(request, ['citizen']);
    const body = await readJson(request);
    const subject = text(body.subject, 4, 120, 'Le sujet');
    const content = text(body.body, 10, 4000, 'Le message');
    const kind = body.kind || 'contact';
    if (!['contact', 'incident'].includes(kind)) fail(400, 'Type de demande invalide.');
    const location = kind === 'incident' ? text(body.location, 5, 180, 'Le lieu') : null;
    const result = db.prepare('INSERT INTO messages (user_id, subject, body, kind, location) VALUES (?, ?, ?, ?, ?)').run(user.id, subject, content, kind, location);
    return sendJson(response, 201, { id: Number(result.lastInsertRowid), status: 'new', confirmation: 'Votre message a bien été transmis.' });
  }
  const messageMatch = /^\/api\/messages\/(\d+)$/.exec(path);
  if (messageMatch && method === 'PATCH') {
    requireUser(request, ['agent', 'admin']);
    const body = await readJson(request);
    if (!['new', 'in_progress', 'resolved'].includes(body.status)) fail(400, 'Statut invalide.');
    const result = db.prepare('UPDATE messages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(body.status, Number(messageMatch[1]));
    if (!result.changes) fail(404, 'Message introuvable.');
    return sendJson(response, 200, { ok: true });
  }

  if (path === '/api/requests' && method === 'GET') {
    requireUser(request, ['agent', 'admin']);
    return sendJson(response, 200, await loadFeed());
  }

  if (method === 'GET' && (path === '/monde' || path.startsWith('/monde/'))) return serveWorld(path, response);
  if (method === 'GET' && !path.startsWith('/api/')) return serveFile(path, response);
  fail(404, 'Route introuvable.');
}

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('Request failed:', error);
    sendJson(response, error.status || 500, { error: error.status ? error.message : 'Erreur interne.' });
  }
});
if (typeof port === 'number') server.listen(port, host, () => console.log(`Terra Nova: http://${host}:${port}`));
else server.listen(port, () => console.log(`Terra Nova: ${port}`));
