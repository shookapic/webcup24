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
  CREATE TABLE IF NOT EXISTS transport_status (
    code TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal', 'perturbé')),
    message TEXT
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
// Deactivated accounts (F34) keep their data but cannot sign in.
if (!userColumns.has('active')) db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))');
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

if (!serviceColumns.has('title_en')) {
  for (const column of ['title_en', 'description_en', 'details_en']) db.exec(`ALTER TABLE services ADD COLUMN ${column} TEXT`);
  const translate = db.prepare('UPDATE services SET title_en = ?, description_en = ?, details_en = ? WHERE title = ?');
  translate.run('Citizen relations', 'A question or a difficulty?', 'From your personal space, send a message to the city services and follow how it is handled.', 'Relations citoyennes');
  translate.run('Personal space', 'All your requests in one place.', 'Create an account to access your information and find your conversations with the city.', 'Espace personnel');
  translate.run('Request tracking', 'Keep track of your conversations.', 'Check the status of each message: received, in progress or resolved.', 'Suivi des demandes');
  translate.run('Health centre', 'Consultations, vaccinations and local care.', 'The city health centre welcomes residents for general medicine, vaccinations and nursing care. To book an appointment, send a message from your personal space.', 'Centre de santé');
  translate.run('Report a problem', 'Broken street light, roads, cleanliness…', 'From your personal space, choose “Report a problem”, describe what happened and give the location. You can then follow how it is handled.', 'Signaler un problème');
  translate.run('Prevention and public health', 'Heat, rising water, epidemics: what to do.', 'The prevention service informs residents about health risks and supports vulnerable people. Active alerts appear at the top of every page; turn on notifications to be warned.', 'Prévention et santé publique');
}
if (!announcementColumns.has('title_en')) {
  db.exec('ALTER TABLE announcements ADD COLUMN title_en TEXT');
  db.exec('ALTER TABLE announcements ADD COLUMN body_en TEXT');
  const translate = db.prepare('UPDATE announcements SET title_en = ?, body_en = ? WHERE title = ?');
  translate.run('Welcome to the Terra Nova portal', 'The portal opens its first digital services. Create your space to contact the city and follow your conversations.', 'Bienvenue sur le portail de Terra Nova');
  translate.run('Rising water in the south district', 'The water level is rising unusually in the south district.\nDo this now: keep away from riverbanks and underpasses, do not drive through flooded streets, move valuables and documents up high, and be ready to leave your home if city staff ask you to.\nIn immediate danger, call 112.', 'Montée des eaux dans le quartier sud');
  translate.run('Extreme heatwave', 'Extreme heat is hitting several parts of the city. Older people, sick people, pregnant women and young children are most at risk.\nDo this now: drink water regularly without waiting to feel thirsty, stay somewhere cool between 11 am and 5 pm, keep shutters and windows closed during the day, avoid physical effort and check on isolated relatives.\nIf you feel unwell, call 112.', 'Vague de chaleur extrême');
}
// Traffic info as of opening day; agents update it from their space afterwards.
db.prepare("INSERT OR IGNORE INTO transport_status (code, status, message) VALUES ('T1', 'perturbé', ?), ('T2', 'normal', NULL)")
  .run('Montée des eaux : ralentissements entre Mairie et Quartier sud. Prévoyez 10 minutes de plus.');

// F38: a service can be marked unavailable, with the reason, when it is back, and what to do meanwhile.
// available_again is city-local time, 'YYYY-MM-DDTHH:MM' (see server.mjs cityNow).
const availabilityColumns = new Set(db.prepare('PRAGMA table_info(services)').all().map((column) => column.name));
if (!availabilityColumns.has('availability')) db.exec("ALTER TABLE services ADD COLUMN availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'unavailable'))");
for (const column of ['unavailable_reason', 'unavailable_reason_en', 'available_again', 'alternative', 'alternative_en']) {
  if (!availabilityColumns.has(column)) db.exec(`ALTER TABLE services ADD COLUMN ${column} TEXT`);
}
// The service a request is about (optional), so staff see it and citizens were warned before writing.
const messageColumnsAgain = new Set(db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name));
if (!messageColumnsAgain.has('service_id')) db.exec('ALTER TABLE messages ADD COLUMN service_id INTEGER REFERENCES services(id)');

// F39: appointment slots published by agents. starts_at is city-local 'YYYY-MM-DDTHH:MM'.
// open → booked (by one citizen) → open again if the citizen cancels, or cancelled if staff cancel a booking.
db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES users(id),
    starts_at TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    location TEXT NOT NULL,
    instructions TEXT NOT NULL,
    citizen_id INTEGER REFERENCES users(id),
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'booked', 'cancelled')),
    booked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (agent_id, starts_at)
  );
  CREATE INDEX IF NOT EXISTS appointments_starts ON appointments(starts_at);
  CREATE INDEX IF NOT EXISTS appointments_citizen ON appointments(citizen_id);
`);

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
