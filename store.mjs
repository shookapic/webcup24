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
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
if (!userColumns.has('avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
if (!userColumns.has('district')) db.exec('ALTER TABLE users ADD COLUMN district TEXT');
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

const announcementColumns = new Set(db.prepare('PRAGMA table_info(announcements)').all().map((column) => column.name));
if (!announcementColumns.has('audience')) db.exec("ALTER TABLE announcements ADD COLUMN audience TEXT NOT NULL DEFAULT 'Tous'");
if (!announcementColumns.has('urgent')) {
  db.exec('ALTER TABLE announcements ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1))');
  // Alerts already under way in the city when alerts went live (F29, F31).
  const insert = db.prepare('INSERT INTO announcements (title, body, audience, urgent) VALUES (?, ?, ?, 1)');
  insert.run(
    'Montée des eaux dans le quartier sud',
    'Le niveau de l’eau monte anormalement dans le quartier sud.\nÀ faire maintenant : éloignez-vous des berges et des passages souterrains, ne circulez pas en voiture dans les rues inondées, montez vos objets de valeur et vos papiers en hauteur, et tenez-vous prêts à quitter votre logement si les agents municipaux le demandent.\nEn cas de danger immédiat, appelez le 112.',
    'Quartier sud'
  );
  insert.run(
    'Vague de chaleur extrême',
    'Une chaleur extrême touche plusieurs secteurs de la ville. Personnes âgées, malades, femmes enceintes, jeunes enfants : vous êtes les plus exposés.\nÀ faire maintenant : buvez de l’eau régulièrement sans attendre d’avoir soif, restez au frais entre 11 h et 17 h, fermez volets et fenêtres pendant la journée, évitez les efforts physiques et prenez des nouvelles de vos proches isolés.\nEn cas de malaise, appelez le 112.',
    'Personnes vulnérables'
  );
}

const serviceColumns = new Set(db.prepare('PRAGMA table_info(services)').all().map((column) => column.name));
if (!serviceColumns.has('featured')) {
  db.exec('ALTER TABLE services ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1))');
  const insert = db.prepare('INSERT INTO services (title, description, details, featured) VALUES (?, ?, ?, ?)');
  insert.run('Centre de santé', 'Consultations, vaccinations et soins de proximité.', 'Le centre de santé municipal reçoit les habitants pour la médecine générale, les vaccinations et les soins infirmiers. Pour prendre rendez-vous, envoyez un message depuis votre espace personnel.', 1);
  insert.run('Signaler un problème', 'Lampadaire cassé, voirie, propreté…', 'Depuis votre espace personnel, choisissez « Signaler un problème », décrivez ce qui s’est passé et indiquez le lieu. Vous suivez ensuite son traitement.', 1);
  insert.run('Prévention et santé publique', 'Chaleur, montée des eaux, épidémies : les bons gestes.', 'Le service de prévention informe sur les risques sanitaires et accompagne les personnes vulnérables. Les alertes en cours s’affichent en haut de chaque page ; activez les notifications pour être prévenu.', 0);
}

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
