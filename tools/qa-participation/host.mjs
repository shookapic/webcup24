// Mini host for the participation module: in-memory (or file) SQLite, A-shaped helpers and a fake session (cookie `u=<user id>`), no dependency on A's server.
// Used by participation-test.mjs (API) and participation-ui.mjs (browser). It reproduces only the contract A's route() provides:
// same-origin check, 20 KB JSON cap, fail()/sendJson()/readJson(), currentUser(request), tx/audit.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { initParticipation, handleParticipation, eraseParticipationUser } from '../../participation.mjs';

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, role TEXT NOT NULL CHECK (role IN ('citizen','agent','admin')));
    CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, category TEXT, action TEXT, target_type TEXT, target_id TEXT, summary TEXT);
  `);
  return db;
}
export function seedUsers(db) {
  const put = db.prepare('INSERT OR IGNORE INTO users (id, email, name, role) VALUES (?, ?, ?, ?)');
  put.run(1, 'citoyenne@example.org', 'Camille Citoyenne', 'citizen');
  put.run(2, 'autre@example.org', 'Alex Autre', 'citizen');
  put.run(3, 'agent@example.org', 'Sam Agent', 'agent');
  put.run(4, 'admin@example.org', 'Robin Admin', 'admin');
  db.prepare('INSERT OR IGNORE INTO services (id, title) VALUES (?, ?)').run(1, 'Carte de résident');
  db.prepare('INSERT OR IGNORE INTO services (id, title) VALUES (?, ?)').run(2, 'Aide au logement');
}

function fail(status, message, extra) { throw Object.assign(new Error(message), { status, extra }); }
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 20_000) fail(413, 'Le formulaire est trop volumineux.'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Données invalides.'); return value; } catch (error) { if (error.status) throw error; fail(400, 'JSON invalide.'); }
}

export async function startHost({ db, port = 0, seedDemo = false } = {}) {
  initParticipation(db, { seedDemo });
  const audits = [];
  const audit = (actor, entry) => { audits.push({ actor: actor.id, ...entry }); db.prepare('INSERT INTO audit_log (actor_id, category, action, target_type, target_id, summary) VALUES (?, ?, ?, ?, ?, ?)').run(actor.id, entry.category, entry.action, entry.target?.type ?? null, String(entry.target?.id ?? ''), entry.summary); };
  const currentUser = (request) => {
    const match = /(?:^|; )u=(\d+)/.exec(request.headers.cookie || '');
    return match ? db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(Number(match[1])) ?? null : null;
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method !== 'GET' && request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) fail(403, 'Origine non autorisée.');
      if (url.pathname === '/participation.js' || url.pathname === '/participation.css') {
        const file = new URL(`../../public${url.pathname}`, import.meta.url);
        try { const content = readFileSync(file); response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); return response.end(content); } catch { return sendJson(response, 404, { error: 'Introuvable.' }); }
      }
      if (url.pathname === '/api/me') return sendJson(response, 200, { user: currentUser(request) });
      if (url.pathname === '/api/services') return sendJson(response, 200, { services: db.prepare('SELECT id, title FROM services').all() });
      if (url.pathname === '/__erase' && request.method === 'POST') { const { id } = await readJson(request); eraseParticipationUser(db, id); return sendJson(response, 200, { ok: true }); }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return response.end(readFileSync(new URL('./stub.html', import.meta.url)));
      }
      if (await handleParticipation({ request, response, path: url.pathname, method: request.method, user: currentUser(request), db, readJson, sendJson, fail, audit })) return;
      fail(404, 'Introuvable.');
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message, ...(error.extra ?? {}) });
      console.error(error);
      return sendJson(response, 500, { error: 'Erreur interne.' });
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, db, audits, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
