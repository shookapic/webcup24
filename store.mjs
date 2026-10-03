import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const path = resolve(process.env.DATA_PATH || './data/terra-nova.sqlite');
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(path);
chmodSync(path, 0o600);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('citizen', 'agent', 'admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'contact' CHECK (kind IN ('contact', 'incident')),
    location TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    details TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS messages_user_id ON messages(user_id);
  CREATE INDEX IF NOT EXISTS messages_status ON messages(status);
`);

// Preserve messages written before incident reports were introduced.
const messageColumns = new Set(db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name));
if (!messageColumns.has('kind')) db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'contact' CHECK (kind IN ('contact', 'incident'))");
if (!messageColumns.has('location')) db.exec('ALTER TABLE messages ADD COLUMN location TEXT');

if (db.prepare('SELECT COUNT(*) AS count FROM services').get().count === 0) {
  const insert = db.prepare('INSERT INTO services (title, description, details) VALUES (?, ?, ?)');
  insert.run('Relations citoyennes', 'Une question ou une difficulté ?', 'Depuis votre espace personnel, envoyez un message aux services municipaux et suivez son traitement.');
  insert.run('Espace personnel', 'Vos démarches au même endroit.', 'Créez un compte pour accéder à vos informations et retrouver vos échanges avec la ville.');
  insert.run('Suivi des demandes', 'Gardez une trace de vos échanges.', 'Consultez le statut de chaque message : reçu, en cours de traitement ou résolu.');
}

if (db.prepare('SELECT COUNT(*) AS count FROM announcements').get().count === 0) {
  db.prepare('INSERT INTO announcements (title, body) VALUES (?, ?)').run(
    'Bienvenue sur le portail de Terra Nova',
    'Le portail ouvre ses premiers services numériques. Créez votre espace pour contacter la ville et suivre vos échanges.'
  );
}

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
