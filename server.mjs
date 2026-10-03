import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, sep } from 'node:path';
import { db } from './store.mjs';
import { clearSession, createSession, currentUser, hashPassword, publicUser, verifyPassword } from './security.mjs';
import { Limiter, loginFailed, loginSucceeded, loginWait, record, summary } from './throttle.mjs';
import { audit, auditCsv, auditFacets, citizenLabel, listAudit, tx, verifyChain } from './audit.mjs';

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

// 'YYYY-MM-DDTHH:MM' in city time. Local strings sort and compare correctly as text.
const cityOffset = '+04:00';
function cityNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: cityTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
const addMinutes = (local, minutes) => new Date(Date.parse(`${local}:00Z`) + minutes * 60_000).toISOString().slice(0, 16);
const minutesBetween = (from, to) => Math.round((Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 60_000);
function localDateTime(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}:00Z`)) || addMinutes(value, 0) !== value) fail(400, `${label} est invalide.`);
  return value;
}
const icsDate = (local) => new Date(`${local}:00${cityOffset}`).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (value) => String(value).replace(/[\\;,]/g, '\\$&').replace(/\r?\n/g, '\\n');

// F38: a stored outage ends by itself once its announced return time has passed.
function serviceView(row) {
  const over = row.available_again && row.available_again <= cityNow();
  return { ...row, availability: row.availability === 'unavailable' && !over ? 'unavailable' : 'available' };
}

// F39
const defaultInstructions = 'Présentez-vous 5 minutes avant l’heure avec une pièce d’identité et les documents liés à votre demande. En cas d’empêchement, annulez depuis votre espace pour libérer l’horaire.';
function appointmentView(row, now = cityNow()) {
  return {
    id: row.id, starts_at: row.starts_at, ends_at: addMinutes(row.starts_at, row.duration_min), duration_min: row.duration_min,
    location: row.location, instructions: row.instructions, agent: row.agent_name, status: row.status, reason: row.reason ?? null,
    minutes_until: minutesBetween(now, row.starts_at),
    ...(row.citizen_name ? { citizen: { name: row.citizen_name, email: row.citizen_email } } : {}),
  };
}
const appointmentSelect = 'SELECT a.*, ag.name AS agent_name, c.name AS citizen_name, c.email AS citizen_email FROM appointments a JOIN users ag ON ag.id = a.agent_id LEFT JOIN users c ON c.id = a.citizen_id';

// The next three passages from `now`, rolling over to tomorrow's first trams after the last one.
function nextPassages(passages, now) {
  return [...passages.filter((minute) => minute >= now), ...passages.map((minute) => minute + 1440)].slice(0, 3)
    .map((minute) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
}
const deletions = new Limiter(5);
let cachedFeed;
let pendingFeed;

// `extra` fields are sent in the JSON body (e.g. retryAfter, attemptsLeft); retryAfter also becomes the header.
function fail(status, message, extra) {
  throw Object.assign(new Error(message), { status, extra });
}

// Behind a proxy every client can look like 127.0.0.1. With TRUST_PROXY set, the last X-Forwarded-For hop
// (added by our own proxy, so not spoofable by the client) is the address.
let warnedLoopback = false;
function clientIp(request) {
  const forwarded = process.env.TRUST_PROXY && String(request.headers['x-forwarded-for'] || '').split(',').pop().trim();
  const address = forwarded || request.socket.remoteAddress || 'unknown';
  if (!forwarded && !warnedLoopback && /^(::1|127.|::ffff:127.)/.test(address) && process.env.NODE_ENV === 'production') {
    warnedLoopback = true;
    console.warn('All clients look like loopback: set TRUST_PROXY=1 so sign-in limits apply per visitor.');
  }
  return address;
}

let dummyHash;

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

// Vite names built files name-<8+ char hash>.ext; those never change. Anything else (models, textures
// copied from world/public) can be replaced in place, so it is revalidated with an ETag instead.
const compressible = new Set(['.html', '.js', '.css', '.json', '.svg', '.wasm', '.gltf', '.glb', '.bin']);
const gzipped = new Map();
const fingerprinted =/^\/assets\/(?:.+\/)?[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

async function serveWorld(request, path, response) {
  if (path === '/monde') {
    response.writeHead(301, { Location: '/monde/' });
    return response.end();
  }
  let relative;
  try { relative = decodeURIComponent(path.slice('/monde'.length)); } catch { fail(400, 'Adresse invalide.'); }
  if (relative.includes('\0')) fail(400, 'Adresse invalide.');
  let file = join(worldRoot, relative);
  if (file !== worldRoot && !file.startsWith(worldRoot + sep)) fail(404, 'Page introuvable.');
  let info;
  try {
    info = await stat(file);
    if (info.isDirectory()) throw Object.assign(new Error('directory'), { code: 'EISDIR' });
  } catch (error) {
    if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) throw error;
    // Navigation (no file extension) falls back to the app; a missing model, texture or script is a real 404.
    if (extname(relative)) fail(404, 'Fichier introuvable.');
    file = join(worldRoot, 'index.html');
    try { info = await stat(file); } catch { fail(404, 'Le monde n’est pas encore disponible.'); }
  }
  const isIndex = file === join(worldRoot, 'index.html');
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': worldTypes[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': !isIndex && fingerprinted.test(relative) ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': worldCsp,
  };
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers);
    return response.end();
  }
  headers.Vary = 'Accept-Encoding';
  let body = await readFile(file);
  if (compressible.has(extname(file).toLowerCase()) && body.length > 1024 && /\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
    // The playable chunk is ~4 MB of JS; compressed once per file version, then served from memory.
    const cached = gzipped.get(file);
    if (cached?.etag !== etag) gzipped.set(file, { etag, body: gzipSync(body, { level: 9 }) });
    body = gzipped.get(file).body;
    headers['Content-Encoding'] = 'gzip';
  }
  response.writeHead(200, headers);
  response.end(body);
}

function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(400, 'Couleur invalide (format #rrggbb).');
  return value.toLowerCase();
}

// F52: removing a public record removes its supports and every notice that quotes it, so nothing of it resurfaces.
function dropPublic(publicId) {
  db.prepare("DELETE FROM notices WHERE code LIKE 'public.%' AND ref_id = ?").run(publicId);
  db.prepare('DELETE FROM supports WHERE public_request_id = ?').run(publicId);
  db.prepare('DELETE FROM public_requests WHERE id = ?').run(publicId);
}
// Public text is written for strangers: no e-mail address, no phone number.
function publicText(value, min, max, label) {
  const clean = text(value, min, max, label);
  if (/@|\d[\d .-]{6,}\d/.test(clean)) fail(400, `${label} ne doit contenir ni adresse e-mail ni numéro de téléphone.`);
  return clean;
}

// Messages go with the account; sessions cascade from users.
function eraseUser(id) {
  tx(() => {
    db.prepare("UPDATE appointments SET citizen_id = NULL, reason = NULL, booked_at = NULL, status = 'open' WHERE citizen_id = ? AND status = 'booked'").run(id);
    db.prepare('DELETE FROM appointments WHERE citizen_id = ?').run(id);
    for (const row of db.prepare('SELECT public_requests.id FROM public_requests JOIN messages ON messages.id = public_requests.message_id WHERE messages.user_id = ?').all(id)) dropPublic(row.id);
    db.prepare('DELETE FROM supports WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM messages WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM notices WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM concerns WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  presence.delete(id);
}

// F47: sensitive staff actions need a stated reason, kept in the audit trail.
const concernTopics = ['usage', 'sharing', 'storage', 'access', 'other'];
const reasonOf = (body, required) => (required || body.reason ? text(body.reason, 5, 200, 'Le motif') : null);

// F34: staff manage citizens only; staff accounts are never reachable from these routes.
function citizenTarget(id) {
  const target = db.prepare('SELECT id, role, name, email FROM users WHERE id = ?').get(id);
  if (!target) fail(404, 'Compte introuvable.');
  if (target.role !== 'citizen') fail(403, 'Les comptes du personnel ne peuvent pas être modifiés ici.');
  return target;
}

// F45 / F46 places
const placeKinds = ['service', 'hospital', 'emergency'];
const placeDistricts = ['Centre-ville', 'Quartier nord', 'Quartier est', 'Quartier ouest', 'Quartier sud'];
const slug = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'lieu';
function placeFields(body) {
  if (!placeKinds.includes(body.kind)) fail(400, 'Type de lieu invalide.');
  if (!placeDistricts.includes(body.district)) fail(400, 'Quartier invalide.');
  if (!Object.hasOwn(stopDistricts, body.stop)) fail(400, 'Arrêt invalide.');
  if (body.open_24h !== undefined && typeof body.open_24h !== 'boolean') fail(400, 'Le champ « ouvert 24 h sur 24 » est invalide.');
  const phone = body.phone ? String(body.phone).trim() : null;
  if (phone && !/^[0-9 +().-]{3,20}$/.test(phone)) fail(400, 'Le numéro de téléphone est invalide.');
  let serviceId = null;
  if (body.service_id !== undefined && body.service_id !== null && body.service_id !== '') {
    serviceId = Number(body.service_id);
    if (!Number.isInteger(serviceId) || !db.prepare('SELECT 1 FROM services WHERE id = ?').get(serviceId)) fail(400, 'Service inconnu.');
  }
  return {
    kind: body.kind, name: text(body.name, 3, 100, 'Le nom'), name_en: body.name_en ? text(body.name_en, 3, 100, 'Le nom') : null,
    district: body.district, stop: body.stop, address: text(body.address, 5, 240, 'L’adresse'), address_en: body.address_en ? text(body.address_en, 5, 240, 'L’adresse') : null,
    hours: body.hours ? text(body.hours, 3, 120, 'Les horaires') : null, hours_en: body.hours_en ? text(body.hours_en, 3, 120, 'Les horaires') : null,
    open_24h: body.open_24h ? 1 : 0, phone, service_id: serviceId,
  };
}
const placeChanges = (before, after) => Object.fromEntries(Object.keys(after).filter((key) => before[key] !== after[key]).map((key) => [key, { avant: before[key] ?? null, apres: after[key] ?? null }]));

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
    const key = String(user.id);
    const wait = deletions.waitMs(key);
    if (wait) fail(429, 'Trop de tentatives. Réessayez plus tard.', { retryAfter: Math.ceil(wait / 1000) });
    const { password_hash: hash } = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!(await verifyPassword(secret, hash))) {
      deletions.add(key);
      fail(403, 'Mot de passe incorrect.');
    }
    tx(() => {
      audit(user, { category: 'account', action: 'account.self_delete', target: { type: 'user', id: user.id, label: citizenLabel(user) }, summary: 'a supprimé son propre compte (messages et signalements effacés)' });
      eraseUser(user.id);
    });
    deletions.reset(key);
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
    const ip = clientIp(request);
    // Blocked before the password is even looked at: a right guess during a lockout does not get in.
    const wait = loginWait(ip, address);
    if (wait) {
      record('blocked', address);
      const retryAfter = Math.ceil(wait / 1000);
      fail(429, `Trop de tentatives. Réessayez dans ${Math.ceil(retryAfter / 60)} min.`, { retryAfter });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(address);
    // Unknown addresses cost the same hashing time, so response time does not reveal which accounts exist.
    dummyHash ??= await hashPassword(randomBytes(12).toString('hex'));
    const valid = await verifyPassword(secret, user ? user.password_hash : dummyHash);
    if (!user || !valid) {
      const attemptsLeft = loginFailed(ip, address);
      fail(401, 'Identifiants incorrects.', { attemptsLeft });
    }
    // Said only after the password is right, so it does not reveal which addresses have accounts.
    if (!user.active) fail(403, 'Ce compte est désactivé. Contactez les services municipaux.');
    const earlierFailures = loginSucceeded(ip, address);
    clearSession(request, response);
    createSession(response, user.id);
    if (user.role !== 'citizen') audit(user, { category: 'security', action: 'auth.staff_login', summary: 's’est connecté à l’espace de travail' });
    // The account owner is told about failed attempts made while they were away.
    return sendJson(response, 200, { user: publicUser(user), ...(earlierFailures >= 3 ? { notice: { failedAttempts: earlierFailures } } : {}) });
  }

  // F50: the staff dashboard. Every figure is counted from the database at request time; the payload holds numbers and service/line names only.
  if (path === '/api/admin/dashboard' && method === 'GET') {
    const staff = requireUser(request, ['agent', 'admin']);
    const one = (sql, ...args) => db.prepare(sql).get(...args);
    const now = cityNow();
    const today = now.slice(0, 10);
    const utc = (local) => new Date(`${local}:00${cityOffset}`).toISOString().slice(0, 19).replace('T', ' ');
    const dayStart = utc(`${today}T00:00`);
    const weekStart = utc(`${addMinutes(`${today}T00:00`, -6 * 1440)}`);
    const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM messages GROUP BY status').all().map((row) => [row.status, row.n]));
    const oldest = one("SELECT MIN(created_at) AS at FROM messages WHERE status = 'new'").at;
    const waitingHours = oldest ? Math.max(0, Math.floor((Date.now() - Date.parse(oldest.replace(' ', 'T') + 'Z')) / 3_600_000)) : null;
    const week = addMinutes(`${today}T00:00`, 7 * 1440);
    const unavailable = db.prepare("SELECT title, availability, available_again FROM services WHERE availability = 'unavailable'").all().map(serviceView).filter((row) => row.availability === 'unavailable').map((row) => row.title);
    const dashboard = {
      generated_at: now,
      messages: {
        new: byStatus.new || 0, in_progress: byStatus.in_progress || 0, resolved: byStatus.resolved || 0,
        waiting_hours: waitingHours,
        received_today: one('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?', dayStart).n,
        received_week: one('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?', weekStart).n,
        incidents_open: one("SELECT COUNT(*) AS n FROM messages WHERE kind = 'incident' AND status != 'resolved'").n,
      },
      appointments: {
        booked_today: one("SELECT COUNT(*) AS n FROM appointments WHERE status = 'booked' AND substr(starts_at, 1, 10) = ? AND starts_at > ?", today, now).n,
        booked_week: one("SELECT COUNT(*) AS n FROM appointments WHERE status = 'booked' AND starts_at > ? AND starts_at < ?", now, week).n,
        open_week: one("SELECT COUNT(*) AS n FROM appointments WHERE status = 'open' AND starts_at > ? AND starts_at < ?", now, week).n,
      },
      public: { requests: one('SELECT COUNT(*) AS n FROM public_requests').n, supports: one('SELECT COUNT(*) AS n FROM supports').n },
      concerns: { received: one("SELECT COUNT(*) AS n FROM concerns WHERE status = 'received'").n },
      services: { total: one('SELECT COUNT(*) AS n FROM services').n, unavailable },
      alerts: { active: one('SELECT COUNT(*) AS n FROM announcements WHERE urgent = 1').n },
      transports: { disrupted: db.prepare("SELECT code FROM transport_status WHERE status != 'normal' ORDER BY code").all().map((row) => row.code) },
      residents: { total: one("SELECT COUNT(*) AS n FROM users WHERE role = 'citizen'").n, new_week: one("SELECT COUNT(*) AS n FROM users WHERE role = 'citizen' AND created_at >= ?", weekStart).n },
      places: one('SELECT COUNT(*) AS n FROM places').n,
      security: (({ failedLogins, blockedAttempts }) => ({ failed_logins: failedLogins, blocked_attempts: blockedAttempts }))(summary()),
      recent: db.prepare('SELECT at, actor_name, summary FROM audit_log ORDER BY id DESC LIMIT 5').all(),
    };
    if (staff.role === 'admin') dashboard.residents.deactivated = one("SELECT COUNT(*) AS n FROM users WHERE role = 'citizen' AND active = 0").n;
    return sendJson(response, 200, dashboard);
  }
  if (path === '/api/admin/security' && method === 'GET') {
    requireUser(request, ['agent', 'admin']);
    const { windowMinutes, failedLogins, blockedAttempts, failures } = summary();
    // Only accounts that exist are named, and masked: random addresses typed by an attacker are just counted.
    const targeted = [];
    let unknown = 0;
    for (const [account, count] of failures) {
      if (count < 3) continue;
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(account)) targeted.push({ account: account.replace(/^(.).*(@.*)$/, '$1***$2'), failures: count });
      else unknown += 1;
    }
    return sendJson(response, 200, { windowMinutes, failedLogins, blockedAttempts, targeted: targeted.sort((a, b) => b.failures - a.failures).slice(0, 20), unknownAddresses: unknown });
  }

  if (path === '/api/admin/citizens' && method === 'GET') {
    requireUser(request, ['agent', 'admin']);
    const query = (new URL(request.url, 'http://localhost').searchParams.get('q') || '').trim().slice(0, 80);
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const citizens = db.prepare(`SELECT id, email, name, district, active, created_at FROM users
      WHERE role = 'citizen' AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY name COLLATE NOCASE, id LIMIT 200`).all(pattern, pattern);
    return sendJson(response, 200, { citizens });
  }
  const citizenMatch = /^\/api\/admin\/citizens\/(\d+)(\/password)?$/.exec(path);
  if (citizenMatch) {
    const actor = requireUser(request, ['agent', 'admin']);
    const id = Number(citizenMatch[1]);
    if (citizenMatch[2] && method === 'POST') {
      const target = citizenTarget(id);
      const reason = reasonOf(await readJson(request), true);
      // One-time password, shown once to the agent; every session of the citizen ends.
      const temporary = randomBytes(18).toString('base64url');
      const hash = await hashPassword(temporary);
      tx(() => {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        audit(actor, { category: 'account', action: 'account.reset_password', target: { type: 'user', id, label: citizenLabel(target) }, summary: 'a réinitialisé le mot de passe d’un habitant (sessions fermées)', reason });
      });
      presence.delete(id);
      return sendJson(response, 200, { password: temporary });
    }
    if (!citizenMatch[2] && method === 'PATCH') {
      const target = citizenTarget(id);
      const body = await readJson(request);
      if (typeof body.active !== 'boolean') fail(400, 'Statut invalide.');
      const reason = reasonOf(body, !body.active);
      tx(() => {
        db.prepare('UPDATE users SET active = ? WHERE id = ?').run(body.active ? 1 : 0, id);
        if (!body.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        audit(actor, { category: 'account', action: body.active ? 'account.reactivate' : 'account.deactivate', target: { type: 'user', id, label: citizenLabel(target) }, summary: body.active ? 'a réactivé le compte d’un habitant' : 'a désactivé le compte d’un habitant (sessions fermées)', reason });
      });
      if (!body.active) presence.delete(id);
      return sendJson(response, 200, { ok: true });
    }
    if (!citizenMatch[2] && method === 'DELETE') {
      const target = citizenTarget(id);
      const reason = reasonOf(await readJson(request), true);
      tx(() => {
        audit(actor, { category: 'account', action: 'account.delete', target: { type: 'user', id, label: citizenLabel(target) }, summary: 'a supprimé le compte d’un habitant (messages et signalements effacés)', reason });
        eraseUser(id);
      });
      return sendJson(response, 200, { ok: true });
    }
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    clearSession(request, response);
    return sendJson(response, 200, { ok: true });
  }

  if (path === '/api/services' && method === 'GET') {
    return sendJson(response, 200, { services: db.prepare('SELECT * FROM services ORDER BY featured DESC, id').all().map(serviceView) });
  }
  if (path === '/api/services' && method === 'POST') {
    const admin = requireUser(request, ['admin']);
    const body = await readJson(request);
    const title = text(body.title, 3, 100, 'Le titre');
    const description = text(body.description, 5, 180, 'La description');
    const details = text(body.details, 10, 2000, 'Les informations');
    if (body.featured !== undefined && typeof body.featured !== 'boolean') fail(400, 'La mise en avant est invalide.');
    // English versions are optional; without a title_en the service shows in French.
    const titleEn = body.title_en ? text(body.title_en, 3, 100, 'Le titre') : null;
    const descriptionEn = body.description_en ? text(body.description_en, 5, 180, 'La description') : null;
    const detailsEn = body.details_en ? text(body.details_en, 10, 2000, 'Les informations') : null;
    const result = tx(() => {
      const inserted = db.prepare('INSERT INTO services (title, description, details, featured, title_en, description_en, details_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(title, description, details, body.featured ? 1 : 0, titleEn, descriptionEn, detailsEn);
      audit(admin, { category: 'service', action: 'service.create', target: { type: 'service', id: inserted.lastInsertRowid, label: title }, summary: `a publié le service « ${title} »`, details: { featured: Boolean(body.featured) } });
      return inserted;
    });
    return sendJson(response, 201, { id: Number(result.lastInsertRowid) });
  }
  const serviceMatch = /^\/api\/services\/(\d+)$/.exec(path);
  if (serviceMatch && method === 'PATCH') {
    const admin = requireUser(request, ['admin']);
    const body = await readJson(request);
    if (typeof body.featured !== 'boolean') fail(400, 'La mise en avant est invalide.');
    const service = db.prepare('SELECT id, title, featured FROM services WHERE id = ?').get(Number(serviceMatch[1]));
    if (!service) fail(404, 'Service introuvable.');
    tx(() => {
      db.prepare('UPDATE services SET featured = ? WHERE id = ?').run(body.featured ? 1 : 0, service.id);
      audit(admin, { category: 'service', action: 'service.feature', target: { type: 'service', id: service.id, label: service.title }, summary: body.featured ? `a mis « ${service.title} » à la une` : `a retiré « ${service.title} » de la une`, details: { avant: Boolean(service.featured), apres: body.featured } });
    });
    return sendJson(response, 200, { ok: true });
  }
  const availabilityMatch = /^\/api\/services\/(\d+)\/availability$/.exec(path);
  if (availabilityMatch && method === 'PATCH') {
    const staff = requireUser(request, ['agent', 'admin']);
    const body = await readJson(request);
    if (!['available', 'unavailable'].includes(body.availability)) fail(400, 'Statut invalide.');
    const service = db.prepare('SELECT id, title, availability, unavailable_reason, available_again FROM services WHERE id = ?').get(Number(availabilityMatch[1]));
    let fields = [null, null, null, null, null];
    if (body.availability === 'unavailable') {
      const now = cityNow();
      const until = body.until ? localDateTime(body.until, 'La date de retour') : null;
      if (until && (until <= now || until > addMinutes(now, 366 * 1440))) fail(400, 'La date de retour doit être dans le futur, et dans moins d’un an.');
      fields = [
        text(body.reason, 5, 200, 'Le motif'), body.reason_en ? text(body.reason_en, 5, 200, 'Le motif') : null, until,
        body.alternative ? text(body.alternative, 5, 200, 'L’alternative') : null, body.alternative_en ? text(body.alternative_en, 5, 200, 'L’alternative') : null,
      ];
    }
    if (!service) fail(404, 'Service introuvable.');
    tx(() => {
      db.prepare('UPDATE services SET availability = ?, unavailable_reason = ?, unavailable_reason_en = ?, available_again = ?, alternative = ?, alternative_en = ? WHERE id = ?')
        .run(body.availability, ...fields, service.id);
      audit(staff, {
        category: 'service', action: body.availability === 'unavailable' ? 'service.unavailable' : 'service.available', target: { type: 'service', id: service.id, label: service.title },
        summary: body.availability === 'unavailable' ? `a signalé « ${service.title} » indisponible` : `a rétabli « ${service.title} »`,
        reason: fields[0], details: { avant: { availability: service.availability, motif: service.unavailable_reason, reprise: service.available_again }, apres: { availability: body.availability, reprise: fields[2], alternative: fields[3] } },
      });
    });
    return sendJson(response, 200, { ok: true });
  }

  if (path === '/api/announcements' && method === 'GET') {
    return sendJson(response, 200, { announcements: db.prepare('SELECT * FROM announcements ORDER BY published_at DESC, id DESC').all() });
  }
  if (path === '/api/announcements' && method === 'POST') {
    const admin = requireUser(request, ['admin']);
    const body = await readJson(request);
    const title = text(body.title, 3, 120, 'Le titre');
    const content = text(body.body, 10, 4000, 'Le contenu');
    if (body.urgent !== undefined && typeof body.urgent !== 'boolean') fail(400, 'Le niveau d’urgence est invalide.');
    const audience = body.audience ? text(body.audience, 2, 80, 'Le public concerné') : 'Tous';
    const titleEn = body.title_en ? text(body.title_en, 3, 120, 'Le titre') : null;
    const contentEn = body.body_en ? text(body.body_en, 10, 4000, 'Le contenu') : null;
    const result = tx(() => {
      const inserted = db.prepare('INSERT INTO announcements (title, body, audience, urgent, title_en, body_en) VALUES (?, ?, ?, ?, ?, ?)')
        .run(title, content, audience, body.urgent ? 1 : 0, titleEn, contentEn);
      audit(admin, { category: 'announcement', action: body.urgent ? 'announcement.alert' : 'announcement.create', target: { type: 'announcement', id: inserted.lastInsertRowid, label: title }, summary: body.urgent ? `a diffusé l’alerte « ${title} »` : `a publié l’actualité « ${title} »`, details: { public: audience, urgent: Boolean(body.urgent) } });
      return inserted;
    });
    return sendJson(response, 201, { id: Number(result.lastInsertRowid) });
  }
  const announcementMatch = /^\/api\/announcements\/(\d+)$/.exec(path);
  if (announcementMatch && method === 'PATCH') {
    const admin = requireUser(request, ['admin']);
    const body = await readJson(request);
    if (typeof body.urgent !== 'boolean') fail(400, 'Le niveau d’urgence est invalide.');
    const reason = reasonOf(body, !body.urgent);
    const item = db.prepare('SELECT id, title, urgent FROM announcements WHERE id = ?').get(Number(announcementMatch[1]));
    if (!item) fail(404, 'Actualité introuvable.');
    tx(() => {
      db.prepare('UPDATE announcements SET urgent = ? WHERE id = ?').run(body.urgent ? 1 : 0, item.id);
      audit(admin, { category: 'announcement', action: body.urgent ? 'announcement.raise' : 'announcement.lift', target: { type: 'announcement', id: item.id, label: item.title }, summary: body.urgent ? `a remis « ${item.title} » en alerte` : `a levé l’alerte « ${item.title} »`, reason, details: { avant: { urgent: Boolean(item.urgent) }, apres: { urgent: body.urgent } } });
    });
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
    const staff = requireUser(request, ['agent', 'admin']);
    if (!transportLines.some((line) => line.code === transportMatch[1])) fail(404, 'Ligne introuvable.');
    const body = await readJson(request);
    if (!['normal', 'perturbé'].includes(body.status)) fail(400, 'Statut invalide.');
    const message = body.status === 'perturbé' || body.message ? text(body.message, 5, 200, 'Le message') : null;
    const before = db.prepare('SELECT status, message FROM transport_status WHERE code = ?').get(transportMatch[1]);
    tx(() => {
      db.prepare('INSERT INTO transport_status (code, status, message) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET status = excluded.status, message = excluded.message')
        .run(transportMatch[1], body.status, message);
      audit(staff, { category: 'transport', action: 'transport.status', target: { type: 'transport', id: transportMatch[1], label: `Ligne ${transportMatch[1]}` }, summary: body.status === 'perturbé' ? `a signalé la ligne ${transportMatch[1]} perturbée` : `a rétabli la ligne ${transportMatch[1]}`, reason: body.status === 'perturbé' ? message : null, details: { avant: before || { status: 'normal', message: null }, apres: { status: body.status, message } } });
    });
    return sendJson(response, 200, { ok: true });
  }
  // F39 appointments + F40 reminders (calendar file). Slots are published by staff, booked by citizens.
  if (path === '/api/appointments' && method === 'POST') {
    const staff = requireUser(request, ['agent', 'admin']);
    const body = await readJson(request);
    if (typeof body.date !== 'string' || typeof body.start !== 'string') fail(400, 'La date et l’heure de début sont obligatoires.');
    const first = localDateTime(`${body.date}T${body.start}`, 'La date ou l’heure');
    const count = Number(body.count ?? 1);
    const duration = Number(body.duration ?? 20);
    if (!Number.isInteger(count) || count < 1 || count > 12) fail(400, 'Le nombre d’horaires doit être compris entre 1 et 12.');
    if (!Number.isInteger(duration) || duration < 10 || duration > 60) fail(400, 'La durée doit être comprise entre 10 et 60 minutes.');
    const now = cityNow();
    if (first <= now) fail(400, 'Le premier horaire doit être dans le futur.');
    if (first > addMinutes(now, 90 * 1440)) fail(400, 'Les horaires ne peuvent pas être publiés plus de 90 jours à l’avance.');
    if (addMinutes(first, count * duration).slice(0, 10) !== first.slice(0, 10)) fail(400, 'Les horaires doivent se terminer le même jour.');
    const location = body.location ? text(body.location, 3, 120, 'Le lieu') : 'Mairie, accueil des rendez-vous';
    const instructions = body.instructions ? text(body.instructions, 10, 500, 'Les consignes') : defaultInstructions;
    const insert = db.prepare('INSERT OR IGNORE INTO appointments (agent_id, starts_at, duration_min, location, instructions) VALUES (?, ?, ?, ?, ?)');
    let created = 0;
    tx(() => {
      for (let i = 0; i < count; i += 1) created += Number(insert.run(staff.id, addMinutes(first, i * duration), duration, location, instructions).changes);
      if (!created) fail(409, 'Ces horaires existent déjà.');
      audit(staff, { category: 'appointment', action: 'appointment.slots.create', target: { type: 'appointment', label: `${first.replace('T', ' ')} (${count} × ${duration} min)` }, summary: `a publié ${created} horaire${created > 1 ? 's' : ''} de rendez-vous`, details: { debut: first, nombre: created, duree_min: duration, lieu: location } });
    });
    return sendJson(response, 201, { created });
  }
  if (path === '/api/appointments/staff' && method === 'GET') {
    requireUser(request, ['agent', 'admin']);
    const now = cityNow();
    const rows = db.prepare(`${appointmentSelect} WHERE a.starts_at > ? ORDER BY a.starts_at LIMIT 300`).all(addMinutes(now, -1440));
    return sendJson(response, 200, { appointments: rows.map((row) => appointmentView(row, now)), now });
  }
  if (path === '/api/appointments/slots' && method === 'GET') {
    requireUser(request, ['citizen']);
    const now = cityNow();
    const rows = db.prepare(`${appointmentSelect} WHERE a.status = 'open' AND a.starts_at > ? ORDER BY a.starts_at LIMIT 100`).all(now);
    return sendJson(response, 200, { slots: rows.map((row) => appointmentView(row, now)), timezone: cityTimeZone, utcOffset: cityOffset, now });
  }
  if (path === '/api/appointments/mine' && method === 'GET') {
    const user = requireUser(request, ['citizen']);
    const now = cityNow();
    const rows = db.prepare(`${appointmentSelect} WHERE a.citizen_id = ? AND a.starts_at > ? ORDER BY a.starts_at`).all(user.id, addMinutes(now, -30 * 1440));
    return sendJson(response, 200, { appointments: rows.map((row) => appointmentView(row, now)), timezone: cityTimeZone, utcOffset: cityOffset, now });
  }
  const appointmentMatch = /^\/api\/appointments\/(\d+)(\/book|\/ics)?$/.exec(path);
  if (appointmentMatch) {
    const user = requireUser(request, ['citizen', 'agent', 'admin']);
    const id = Number(appointmentMatch[1]);
    const now = cityNow();
    const row = db.prepare(`${appointmentSelect} WHERE a.id = ?`).get(id);
    if (appointmentMatch[2] === '/book' && method === 'POST') {
      if (user.role !== 'citizen') fail(403, 'Accès réservé.');
      const body = await readJson(request);
      const reason = body.reason ? text(body.reason, 5, 200, 'Le motif') : null;
      const taken = 'Cet horaire n’est plus disponible. Choisissez-en un autre.';
      if (!row || row.status !== 'open' || row.starts_at <= now) fail(409, taken);
      const mine = db.prepare("SELECT starts_at, duration_min FROM appointments WHERE citizen_id = ? AND status = 'booked' AND starts_at > ?").all(user.id, now);
      if (mine.length >= 2) fail(409, 'Vous avez déjà deux rendez-vous à venir. Annulez-en un pour en réserver un autre.');
      const end = addMinutes(row.starts_at, row.duration_min);
      if (mine.some((other) => other.starts_at < end && addMinutes(other.starts_at, other.duration_min) > row.starts_at)) fail(409, 'Vous avez déjà un rendez-vous à ce moment-là.');
      // Single statement: of two people clicking the same slot, exactly one changes a row.
      const result = tx(() => {
        const claimed = db.prepare("UPDATE appointments SET citizen_id = ?, reason = ?, status = 'booked', booked_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open' AND starts_at > ?").run(user.id, reason, id, now);
        if (claimed.changes) audit(user, { category: 'appointment', action: 'appointment.book', target: { type: 'appointment', id, label: row.starts_at.replace('T', ' ') }, summary: 'a réservé un horaire de rendez-vous', details: { debut: row.starts_at, agent: row.agent_name, lieu: row.location } });
        return claimed;
      });
      if (!result.changes) fail(409, taken);
      return sendJson(response, 201, { appointment: appointmentView(db.prepare(`${appointmentSelect} WHERE a.id = ?`).get(id), now) });
    }
    if (appointmentMatch[2] === '/ics' && method === 'GET') {
      if (!row || row.citizen_id !== user.id || row.status !== 'booked') fail(404, 'Rendez-vous introuvable.');
      const alarm = (trigger, label) => ['BEGIN:VALARM', `TRIGGER:${trigger}`, 'ACTION:DISPLAY', `DESCRIPTION:${icsText(label)}`, 'END:VALARM'];
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Terra Nova//Rendez-vous//FR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:appointment-${row.id}@terra-nova`,
        `DTSTAMP:${icsDate(now)}`, `DTSTART:${icsDate(row.starts_at)}`, `DTEND:${icsDate(addMinutes(row.starts_at, row.duration_min))}`,
        'SUMMARY:Rendez-vous avec un agent de Terra Nova', `LOCATION:${icsText(row.location)}`, `DESCRIPTION:${icsText(row.instructions)}`,
        ...alarm('-P1D', 'Rendez-vous demain à la mairie de Terra Nova'), ...alarm('-PT1H', 'Rendez-vous dans une heure'), 'END:VEVENT', 'END:VCALENDAR'];
      response.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="rendez-vous-${row.id}.ics"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return response.end(lines.join('\r\n') + '\r\n');
    }
    if (!appointmentMatch[2] && method === 'DELETE') {
      if (!row) fail(404, 'Rendez-vous introuvable.');
      if (user.role === 'citizen') {
        if (row.citizen_id !== user.id || row.status !== 'booked') fail(404, 'Rendez-vous introuvable.');
        if (row.starts_at <= now) fail(409, 'Ce rendez-vous est déjà passé.');
        // The slot goes back on offer for someone else.
        tx(() => {
          db.prepare("UPDATE appointments SET citizen_id = NULL, reason = NULL, booked_at = NULL, status = 'open' WHERE id = ?").run(id);
          audit(user, { category: 'appointment', action: 'appointment.cancel_own', target: { type: 'appointment', id, label: row.starts_at.replace('T', ' ') }, summary: 'a annulé son rendez-vous (horaire libéré)', details: { debut: row.starts_at } });
        });
      } else if (row.status === 'booked' && row.starts_at > now) {
        // The citizen keeps seeing it, marked cancelled by the city, instead of the slot silently vanishing. A reason is required.
        const reason = reasonOf(await readJson(request), true);
        tx(() => {
          db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(id);
          audit(user, { category: 'appointment', action: 'appointment.cancel_by_staff', target: { type: 'appointment', id, label: row.starts_at.replace('T', ' ') }, summary: `a annulé le rendez-vous de ${citizenLabel({ id: row.citizen_id, name: row.citizen_name, email: row.citizen_email })}`, reason, details: { debut: row.starts_at, agent: row.agent_name } });
        });
      } else {
        tx(() => {
          db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
          audit(user, { category: 'appointment', action: 'appointment.slot.remove', target: { type: 'appointment', id, label: row.starts_at.replace('T', ' ') }, summary: 'a retiré un horaire de rendez-vous', details: { debut: row.starts_at, etat: row.status } });
        });
      }
      return sendJson(response, 200, { ok: true });
    }
  }

  if (path === '/api/messages' && method === 'GET') {
    const user = requireUser(request);
    const all = ['agent', 'admin'].includes(user.role);
    const messages = all
      ? db.prepare(`SELECT messages.*, users.name AS citizen_name, users.email AS citizen_email, (SELECT id FROM public_requests WHERE message_id = messages.id) AS public_id, (SELECT COUNT(*) FROM supports JOIN public_requests ON public_requests.id = supports.public_request_id WHERE public_requests.message_id = messages.id) AS support_count, services.title AS service_title, services.title_en AS service_title_en FROM messages JOIN users ON users.id = messages.user_id LEFT JOIN services ON services.id = messages.service_id ORDER BY messages.created_at DESC, messages.id DESC`).all()
      : db.prepare('SELECT messages.id, subject, body, kind, location, status, created_at, updated_at, service_id, (SELECT id FROM public_requests WHERE message_id = messages.id) AS public_id, (SELECT public_title FROM public_requests WHERE message_id = messages.id) AS public_title, (SELECT COUNT(*) FROM supports JOIN public_requests ON public_requests.id = supports.public_request_id WHERE public_requests.message_id = messages.id) AS support_count, services.title AS service_title, services.title_en AS service_title_en FROM messages LEFT JOIN services ON services.id = messages.service_id WHERE user_id = ? ORDER BY created_at DESC, messages.id DESC').all(user.id);
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
    let serviceId = null;
    if (body.service_id !== undefined && body.service_id !== null && body.service_id !== '') {
      serviceId = Number(body.service_id);
      if (!Number.isInteger(serviceId) || !db.prepare('SELECT 1 FROM services WHERE id = ?').get(serviceId)) fail(400, 'Service inconnu.');
    }
    const result = db.prepare('INSERT INTO messages (user_id, subject, body, kind, location, service_id) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, subject, content, kind, location, serviceId);
    return sendJson(response, 201, { id: Number(result.lastInsertRowid), status: 'new', confirmation: 'Votre message a bien été transmis.' });
  }
  // F51: what the portal holds about the caller, as a file. Only their own civic data: no password hash, no session value, nobody else's data.
  if (path === '/api/me/export' && method === 'GET') {
    const user = requireUser(request, ['citizen']);
    const own = (sql) => db.prepare(sql).all(user.id);
    const account = db.prepare('SELECT id, name, email, district, avatar, created_at FROM users WHERE id = ?').get(user.id);
    try { account.avatar = account.avatar ? JSON.parse(account.avatar) : null; } catch { account.avatar = null; }
    const file = {
      generated_at: cityNow(),
      account,
      messages: own('SELECT id, subject, body, kind, location, status, service_id, created_at, updated_at FROM messages WHERE user_id = ? ORDER BY id'),
      appointments: own('SELECT id, starts_at, duration_min, location, reason, status, booked_at FROM appointments WHERE citizen_id = ? ORDER BY starts_at'),
      concerns: own('SELECT id, topic, body, status, response, created_at, responded_at FROM concerns WHERE user_id = ? ORDER BY id'),
      notices: own('SELECT id, code, ref_id, label, note, at, seen_at FROM notices WHERE user_id = ? ORDER BY id'),
      public_requests: own('SELECT pr.id, pr.message_id, pr.public_title, pr.public_summary, pr.district, pr.created_at, (SELECT COUNT(*) FROM supports WHERE public_request_id = pr.id) AS support_count FROM public_requests pr JOIN messages m ON m.id = pr.message_id WHERE m.user_id = ? ORDER BY pr.id'),
      supports: own('SELECT supports.public_request_id, pr.public_title, supports.at FROM supports JOIN public_requests pr ON pr.id = supports.public_request_id WHERE supports.user_id = ? ORDER BY supports.id'),
    };
    response.setHeader('Content-Disposition', 'attachment; filename="mes-donnees-terra-nova.json"');
    return sendJson(response, 200, file);
  }
  // F51: concerns about data use (resident side)
  if (path === '/api/concerns' && method === 'GET') {
    const user = requireUser(request, ['citizen']);
    return sendJson(response, 200, { concerns: db.prepare('SELECT id, topic, body, status, response, created_at, responded_at FROM concerns WHERE user_id = ? ORDER BY id DESC').all(user.id) });
  }
  if (path === '/api/concerns' && method === 'POST') {
    const user = requireUser(request, ['citizen']);
    const body = await readJson(request);
    if (!concernTopics.includes(body.topic)) fail(400, 'Choisissez le sujet de votre inquiétude.');
    const content = text(body.body, 10, 1000, 'Votre message');
    if (db.prepare("SELECT COUNT(*) AS n FROM concerns WHERE user_id = ? AND created_at > datetime('now', '-1 day')").get(user.id).n >= 5) fail(429, 'Vous avez déjà envoyé 5 préoccupations aujourd’hui. Réessayez demain.');
    const created = db.prepare('INSERT INTO concerns (user_id, topic, body) VALUES (?, ?, ?)').run(user.id, body.topic, content);
    const row = db.prepare('SELECT id, topic, status, created_at FROM concerns WHERE id = ?').get(Number(created.lastInsertRowid));
    return sendJson(response, 201, { ...row, reference: `C-${row.id}`, confirmation: 'Votre préoccupation a bien été reçue. Un agent la lira ; vous serez prévenu dans « Nouvelles de mes demandes » dès qu’elle sera lue ou qu’une réponse sera donnée.' });
  }
  // staff side: the author is shown masked (first name, initial, masked e-mail); an answer reaches the author as a notice
  if (path === '/api/admin/concerns' && method === 'GET') {
    requireUser(request, ['agent', 'admin']);
    const rows = db.prepare('SELECT concerns.*, users.name AS author_name, users.email AS author_email FROM concerns JOIN users ON users.id = concerns.user_id ORDER BY CASE concerns.status WHEN \'received\' THEN 0 WHEN \'read\' THEN 1 ELSE 2 END, concerns.id DESC').all();
    return sendJson(response, 200, { concerns: rows.map(({ author_name, author_email, user_id, ...row }) => ({ ...row, author: citizenLabel({ id: user_id, name: author_name, email: author_email }) })) });
  }
  const concernMatch = /^\/api\/admin\/concerns\/(\d+)$/.exec(path);
  if (concernMatch && method === 'PATCH') {
    const staff = requireUser(request, ['agent', 'admin']);
    const body = await readJson(request);
    if (!['read', 'answered'].includes(body.status)) fail(400, 'Statut invalide.');
    const item = db.prepare('SELECT id, user_id, status FROM concerns WHERE id = ?').get(Number(concernMatch[1]));
    if (!item) fail(404, 'Préoccupation introuvable.');
    if (item.status === 'answered') fail(409, 'Cette préoccupation a déjà reçu une réponse.');
    const answer = body.status === 'answered' ? text(body.response, 5, 1000, 'La réponse') : null;
    if (body.status === item.status) return sendJson(response, 200, { ok: true });
    tx(() => {
      db.prepare("UPDATE concerns SET status = ?, response = ?, responded_at = CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END WHERE id = ?").run(body.status, answer, answer, item.id);
      db.prepare('INSERT INTO notices (user_id, code, ref_id, label, note) VALUES (?, ?, ?, ?, ?)').run(item.user_id, `concern.${body.status}`, item.id, `C-${item.id}`, answer);
      audit(staff, { category: 'concern', action: `concern.${body.status}`, target: { type: 'concern', id: item.id, label: `C-${item.id}` }, summary: body.status === 'read' ? `a lu la préoccupation C-${item.id}` : `a répondu à la préoccupation C-${item.id}`, details: { avant: item.status, apres: body.status } });
    });
    return sendJson(response, 200, { ok: true });
  }

  // F52: supporting a request that its author chose to make public. The private message is never part of these answers.
  if (path === '/api/public-requests' && method === 'GET') {
    const user = requireUser(request);
    const rows = db.prepare(`SELECT pr.id, pr.public_title, pr.public_summary, pr.district, pr.created_at, m.status, m.user_id AS owner_id,
        (SELECT COUNT(*) FROM supports WHERE public_request_id = pr.id) AS support_count,
        (SELECT at FROM supports WHERE public_request_id = pr.id AND user_id = ?) AS supported_at
      FROM public_requests pr JOIN messages m ON m.id = pr.message_id ORDER BY (m.status = 'resolved'), pr.id DESC`).all(user.id);
    return sendJson(response, 200, { requests: rows.map(({ owner_id, supported_at, ...row }) => ({ ...row, mine: owner_id === user.id, supported_by_me: Boolean(supported_at), supported_at })) });
  }
  if (path === '/api/me/supports' && method === 'GET') {
    const user = requireUser(request, ['citizen']);
    return sendJson(response, 200, { supports: db.prepare('SELECT pr.id, pr.public_title, supports.at AS supported_at, m.status FROM supports JOIN public_requests pr ON pr.id = supports.public_request_id JOIN messages m ON m.id = pr.message_id WHERE supports.user_id = ? ORDER BY supports.at DESC, supports.id DESC').all(user.id) });
  }
  const supportMatch = /^\/api\/public-requests\/(\d+)\/support$/.exec(path);
  if (supportMatch && (method === 'POST' || method === 'DELETE')) {
    const user = requireUser(request, ['citizen']);
    const id = Number(supportMatch[1]);
    const row = db.prepare('SELECT pr.id, m.status, m.user_id AS owner_id FROM public_requests pr JOIN messages m ON m.id = pr.message_id WHERE pr.id = ?').get(id);
    if (!row) fail(404, 'Demande introuvable.');
    const count = () => db.prepare('SELECT COUNT(*) AS n FROM supports WHERE public_request_id = ?').get(id).n;
    if (method === 'DELETE') {
      if (!Number(db.prepare('DELETE FROM supports WHERE public_request_id = ? AND user_id = ?').run(id, user.id).changes)) fail(404, 'Vous ne soutenez pas cette demande.');
      return sendJson(response, 200, { supported: false, support_count: count() });
    }
    if (row.owner_id === user.id) fail(403, 'Vous ne pouvez pas soutenir votre propre demande.');
    try {
      // one statement: the unresolved check and the insert cannot be separated by a concurrent status change; UNIQUE refuses a second support
      const added = db.prepare("INSERT INTO supports (public_request_id, user_id) SELECT pr.id, ? FROM public_requests pr JOIN messages m ON m.id = pr.message_id WHERE pr.id = ? AND m.status != 'resolved'").run(user.id, id);
      if (!Number(added.changes)) fail(409, 'Cette demande est résolue : le soutien n’est plus possible.');
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) fail(409, 'Vous soutenez déjà cette demande.');
      throw error;
    }
    return sendJson(response, 201, { supported: true, support_count: count() });
  }
  const publishMatch = /^\/api\/messages\/(\d+)\/public$/.exec(path);
  if (publishMatch && (method === 'POST' || method === 'DELETE')) {
    const user = requireUser(request, ['citizen']);
    const item = db.prepare('SELECT id, kind, status FROM messages WHERE id = ? AND user_id = ?').get(Number(publishMatch[1]), user.id);
    if (!item) fail(404, 'Message introuvable.');
    if (method === 'DELETE') {
      const published = db.prepare('SELECT id FROM public_requests WHERE message_id = ?').get(item.id);
      if (!published) fail(404, 'Ce signalement n’est pas publié.');
      tx(() => dropPublic(published.id));
      return sendJson(response, 200, { ok: true });
    }
    const body = await readJson(request);
    if (body.consent !== true) fail(400, 'Cochez la case pour confirmer que ce texte peut être lu par les autres habitants.');
    if (item.kind !== 'incident') fail(400, 'Seul un signalement de problème peut être publié.');
    if (item.status === 'resolved') fail(409, 'Ce signalement est résolu : il ne peut plus être publié.');
    const title = publicText(body.public_title, 5, 100, 'Le titre public');
    const summary = publicText(body.public_summary, 10, 300, 'Le résumé public');
    if (!placeDistricts.includes(body.district)) fail(400, 'Quartier invalide.');
    try {
      const created = db.prepare('INSERT INTO public_requests (message_id, public_title, public_summary, district) VALUES (?, ?, ?, ?)').run(item.id, title, summary, body.district);
      return sendJson(response, 201, { id: Number(created.lastInsertRowid), public_title: title, public_summary: summary, district: body.district });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) fail(409, 'Ce signalement est déjà publié.');
      throw error;
    }
  }

  // F49: the resident's own notices (newest first, unread flagged). Polling only; nothing is sent by e-mail or SMS.
  if (path === '/api/me/notices' && method === 'GET') {
    const user = requireUser(request, ['citizen']);
    const notices = db.prepare('SELECT id, code, ref_id, label, note, at, seen_at FROM notices WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id);
    return sendJson(response, 200, { notices, unread: notices.filter((n) => !n.seen_at).length });
  }
  if (path === '/api/me/notices/seen' && method === 'POST') {
    const user = requireUser(request, ['citizen']);
    const { ids } = await readJson(request);
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every((id) => Number.isInteger(id) && id > 0)) fail(400, 'Liste de notifications invalide.');
    const mark = db.prepare('UPDATE notices SET seen_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND seen_at IS NULL');
    let changed = 0;
    for (const id of ids) changed += Number(mark.run(id, user.id).changes);
    return sendJson(response, 200, { seen: changed });
  }
  const messageMatch = /^\/api\/messages\/(\d+)$/.exec(path);
  if (messageMatch && method === 'PATCH') {
    const staff = requireUser(request, ['agent', 'admin']);
    const body = await readJson(request);
    if (!['new', 'in_progress', 'resolved'].includes(body.status)) fail(400, 'Statut invalide.');
    const note = body.note ? text(body.note, 5, 300, 'Le message pour l’habitant') : null;
    const item = db.prepare('SELECT id, user_id, subject, status FROM messages WHERE id = ?').get(Number(messageMatch[1]));
    if (!item) fail(404, 'Message introuvable.');
    const names = { new: 'à traiter', in_progress: 'en cours', resolved: 'résolu' };
    tx(() => {
      db.prepare('UPDATE messages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(body.status, item.id);
      // F49: only a real change tells the resident something; repeating the same status is silent.
      if (body.status !== item.status) {
        db.prepare('INSERT INTO notices (user_id, code, ref_id, label, note) VALUES (?, ?, ?, ?, ?)').run(item.user_id, `message.${body.status}`, item.id, item.subject, note);
        const published = db.prepare('SELECT id, public_title FROM public_requests WHERE message_id = ?').get(item.id);
        if (published) db.prepare('INSERT INTO notices (user_id, code, ref_id, label) SELECT user_id, ?, ?, ? FROM supports WHERE public_request_id = ?').run(`public.${body.status}`, published.id, published.public_title, published.id);
      }
      audit(staff, { category: 'message', action: 'message.status', target: { type: 'message', id: item.id, label: item.subject }, summary: `a passé le message « ${item.subject} » de « ${names[item.status]} » à « ${names[body.status]} »`, details: { avant: item.status, apres: body.status } });
    });
    return sendJson(response, 200, { ok: true });
  }

  // F45 / F46: places (public read, admin write). F47 / F48: the audit trail (staff read, nobody writes through the API).
  if (path === '/api/places' && method === 'GET') {
    const params = new URL(request.url, 'http://localhost').searchParams;
    const kind = params.get('kind');
    const where = [];
    const args = [];
    if (kind === 'care') where.push("kind IN ('hospital', 'emergency')");
    else if (placeKinds.includes(kind)) { where.push('kind = ?'); args.push(kind); }
    if (placeDistricts.includes(params.get('district'))) { where.push('district = ?'); args.push(params.get('district')); }
    const rows = db.prepare(`SELECT * FROM places ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE kind WHEN 'emergency' THEN 0 WHEN 'hospital' THEN 1 ELSE 2 END, name COLLATE NOCASE`).all(...args);
    return sendJson(response, 200, { places: rows });
  }
  if (path === '/api/places' && method === 'POST') {
    const admin = requireUser(request, ['admin']);
    const body = await readJson(request);
    const fields = placeFields(body);
    let code = body.code ? slug(String(body.code)) : slug(fields.name);
    for (let n = 2; db.prepare('SELECT 1 FROM places WHERE code = ?').get(code); n += 1) code = `${slug(fields.name)}-${n}`;
    const created = tx(() => {
      const inserted = db.prepare('INSERT INTO places (code, kind, name, name_en, district, stop, address, address_en, hours, hours_en, open_24h, phone, service_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(code, fields.kind, fields.name, fields.name_en, fields.district, fields.stop, fields.address, fields.address_en, fields.hours, fields.hours_en, fields.open_24h, fields.phone, fields.service_id);
      audit(admin, { category: 'place', action: 'place.create', target: { type: 'place', id: inserted.lastInsertRowid, label: fields.name }, summary: `a ajouté le lieu « ${fields.name} »`, details: { type: fields.kind, quartier: fields.district, arret: fields.stop } });
      return inserted;
    });
    return sendJson(response, 201, { id: Number(created.lastInsertRowid), code });
  }
  const placeMatch = /^\/api\/places\/(\d+)$/.exec(path);
  if (placeMatch && ['PATCH', 'DELETE'].includes(method)) {
    const admin = requireUser(request, ['admin']);
    const id = Number(placeMatch[1]);
    const before = db.prepare('SELECT * FROM places WHERE id = ?').get(id);
    if (!before) fail(404, 'Lieu introuvable.');
    const body = await readJson(request);
    if (method === 'PATCH') {
      const fields = placeFields(body);
      const changes = placeChanges(before, fields);
      tx(() => {
        db.prepare('UPDATE places SET kind = ?, name = ?, name_en = ?, district = ?, stop = ?, address = ?, address_en = ?, hours = ?, hours_en = ?, open_24h = ?, phone = ?, service_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(fields.kind, fields.name, fields.name_en, fields.district, fields.stop, fields.address, fields.address_en, fields.hours, fields.hours_en, fields.open_24h, fields.phone, fields.service_id, id);
        audit(admin, { category: 'place', action: 'place.update', target: { type: 'place', id, label: fields.name }, summary: Object.keys(changes).length ? `a modifié le lieu « ${fields.name} » (${Object.keys(changes).join(', ')})` : `a ré-enregistré le lieu « ${fields.name} » sans changement`, details: changes });
      });
      return sendJson(response, 200, { ok: true });
    }
    const reason = reasonOf(body, true);
    tx(() => {
      db.prepare('DELETE FROM places WHERE id = ?').run(id);
      audit(admin, { category: 'place', action: 'place.delete', target: { type: 'place', id, label: before.name }, summary: `a supprimé le lieu « ${before.name} »`, reason, details: { type: before.kind, quartier: before.district } });
    });
    return sendJson(response, 200, { ok: true });
  }

  if (path === '/api/admin/audit' && method === 'GET') {
    requireUser(request, ['agent', 'admin']);
    const params = Object.fromEntries(new URL(request.url, 'http://localhost').searchParams);
    if (params.format === 'csv') {
      const { entries } = listAudit({ ...params, limit: 5000 }, { limitMax: 5000 });
      response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="journal-des-actions.csv"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return response.end('﻿' + auditCsv(entries));
    }
    const page = listAudit(params);
    return sendJson(response, 200, { ...page, ...(params.before ? {} : { facets: auditFacets() }), now: cityNow() });
  }
  if (path === '/api/admin/audit/verify' && method === 'GET') {
    requireUser(request, ['agent', 'admin']);
    return sendJson(response, 200, verifyChain());
  }

  if (path === '/api/requests' && method === 'GET') {
    requireUser(request, ['agent', 'admin']);
    return sendJson(response, 200, await loadFeed());
  }

  if (method === 'GET' && (path === '/monde' || path.startsWith('/monde/'))) return serveWorld(request, path, response);
  if (method === 'GET' && !path.startsWith('/api/')) return serveFile(path, response);
  fail(404, 'Route introuvable.');
}

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('Request failed:', error);
    if (error.extra?.retryAfter) response.setHeader('Retry-After', String(error.extra.retryAfter));
    sendJson(response, error.status || 500, { error: error.status ? error.message : 'Erreur interne.', ...(error.status ? error.extra : {}) });
  }
});
if (typeof port === 'number') server.listen(port, host, () => console.log(`Terra Nova: http://${host}:${port}`));
else server.listen(port, () => console.log(`Terra Nova: ${port}`));
