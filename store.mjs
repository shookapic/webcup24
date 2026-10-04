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

// F45 / F46: physical places residents look for (city services, hospitals, emergency services). Additive table.
// `stop` is the nearest tram stop (one of the five contract names); `district` uses the portal list. Admins maintain it.
db.exec(`
  CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('service', 'hospital', 'emergency')),
    name TEXT NOT NULL,
    name_en TEXT,
    district TEXT NOT NULL,
    stop TEXT NOT NULL,
    address TEXT NOT NULL,
    address_en TEXT,
    hours TEXT,
    hours_en TEXT,
    open_24h INTEGER NOT NULL DEFAULT 0 CHECK (open_24h IN (0, 1)),
    phone TEXT,
    service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
if (db.prepare('SELECT COUNT(*) AS count FROM places').get().count === 0) {
  // Starting content for the city to confirm and edit (README: official details remain to be confirmed with the team).
  const healthService = db.prepare("SELECT id FROM services WHERE title = 'Centre de santé'").get()?.id ?? null;
  const insert = db.prepare('INSERT INTO places (code, kind, name, name_en, district, stop, address, address_en, hours, hours_en, open_24h, phone, service_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run('mairie', 'service', 'Mairie', 'Town hall', 'Centre-ville', 'Mairie', 'Sur la place centrale, le grand bâtiment avec l’antenne. Accueil et rendez-vous à l’entrée sous l’auvent.', 'On the central square, the large building with the antenna. Reception and appointments at the entrance under the canopy.', 'Du lundi au vendredi, de 8 h à 17 h', 'Monday to Friday, 8 am to 5 pm', 0, null, null);
  insert.run('hopital-terra-nova', 'hospital', 'Hôpital de Terra Nova', 'Terra Nova hospital', 'Quartier est', 'Santé', 'Quartier est, à côté de l’arrêt Santé. Grand bâtiment clair avec une croix verte.', 'East district, next to the Santé stop. Large pale building with a green cross.', 'Ouvert 24 h sur 24', 'Open 24 hours', 1, '112', null);
  insert.run('urgences-hopital', 'emergency', 'Urgences de l’hôpital', 'Hospital emergency room', 'Quartier est', 'Santé', 'Entrée des urgences sur le côté nord de l’hôpital, bien indiquée. Elle est ouverte jour et nuit.', 'Emergency entrance on the north side of the hospital, clearly signposted. Open day and night.', 'Ouvert 24 h sur 24', 'Open 24 hours', 1, '112', null);
  insert.run('centre-sante', 'service', 'Centre de santé', 'Health centre', 'Quartier est', 'Santé', 'Quartier est, en face de l’arrêt Santé. Soins de proximité, vaccinations, consultations.', 'East district, opposite the Santé stop. Local care, vaccinations, consultations.', 'Du lundi au samedi, de 8 h à 18 h', 'Monday to Saturday, 8 am to 6 pm', 0, null, healthService);
  insert.run('secours-quartier-sud', 'emergency', 'Poste de secours du quartier sud', 'South district rescue post', 'Quartier sud', 'Quartier sud', 'Quartier sud, près des berges, à côté de l’arrêt Quartier sud. Secours en cas d’inondation.', 'South district, near the riverbank, next to the Quartier sud stop. Rescue in case of flooding.', 'Ouvert 24 h sur 24', 'Open 24 hours', 1, '112', null);
  insert.run('point-accueil-habitat', 'service', 'Point d’accueil d’Habitat', 'Habitat help desk', 'Quartier nord', 'Habitat', 'Quartier nord, au pied des logements, près de l’arrêt Habitat. Aide pour vos démarches.', 'North district, at the foot of the housing blocks, near the Habitat stop. Help with your procedures.', 'Du mardi au jeudi, de 9 h à 16 h', 'Tuesday to Thursday, 9 am to 4 pm', 0, null, null);
  insert.run('marche-couvert', 'service', 'Marché couvert', 'Covered market', 'Quartier ouest', 'Marché', 'Quartier ouest, à côté de l’arrêt Marché. Étals sous auvent ; information pour les commerçants.', 'West district, next to the Marché stop. Stalls under awnings; information for traders.', 'Du mardi au samedi, de 7 h à 13 h', 'Tuesday to Saturday, 7 am to 1 pm', 0, null, null);
}

// F49: notices for one resident, written by the server in the same transaction as the change that causes them. Read through polling.
db.exec(`
  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    ref_id INTEGER,
    label TEXT NOT NULL,
    note TEXT,
    at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    seen_at TEXT
  );
  CREATE INDEX IF NOT EXISTS notices_user ON notices(user_id, seen_at);
`);

// F51: a resident's concerns about the use of their data. Erased with the account.
db.exec(`
  CREATE TABLE IF NOT EXISTS concerns (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL CHECK (topic IN ('usage', 'sharing', 'storage', 'access', 'other')),
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'read', 'answered')),
    response TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TEXT
  );
  CREATE INDEX IF NOT EXISTS concerns_user ON concerns(user_id);
`);

// F52: a resident can choose to make one of their incident reports visible to other residents as a separate public record
// (title, summary and district written for that purpose). The private message is never exposed. Withdrawing deletes the record and its supports.
db.exec(`
  CREATE TABLE IF NOT EXISTS public_requests (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    public_title TEXT NOT NULL,
    public_summary TEXT NOT NULL,
    district TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS supports (
    id INTEGER PRIMARY KEY,
    public_request_id INTEGER NOT NULL REFERENCES public_requests(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (public_request_id, user_id)
  );
`);

// F54: devices a resident has signed in from. A device is recognised by a random cookie whose hash is stored here; this is recognition
// (to warn about a new device), never an authentication factor. Only a coarse label (browser, system) is kept: no address, no user-agent string.
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    label TEXT NOT NULL,
    first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, token_hash)
  );
`);
const sessionColumns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map((column) => column.name));
if (!sessionColumns.has('device_id')) db.exec('ALTER TABLE sessions ADD COLUMN device_id INTEGER');

// F47 / F48: append-only audit trail with a hash chain (see audit.mjs). The triggers refuse any UPDATE or DELETE.
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    actor_id INTEGER,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    target_label TEXT,
    summary TEXT NOT NULL,
    reason TEXT,
    details TEXT,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_log_actor ON audit_log(actor_id);
  CREATE INDEX IF NOT EXISTS audit_log_target ON audit_log(target_type, target_id);
  CREATE INDEX IF NOT EXISTS audit_log_category ON audit_log(category);
  CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`);

// F83: a persistent key for receipt proofs: a restart or a redeploy must not invalidate a receipt a resident kept.
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
// F84: replies written by agents to a request, whatever its state. They go with the request when it is deleted.
db.exec(`
  CREATE TABLE IF NOT EXISTS message_replies (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS message_replies_message ON message_replies(message_id);
`);

// F79: the subject of a request (a code from the topic list in server.mjs). Requests sent before it existed keep an empty topic ("non précisé").
{
  const columns = new Set(db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name));
  if (!columns.has('topic')) db.exec('ALTER TABLE messages ADD COLUMN topic TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS messages_topic ON messages(topic)');
}

// F80: the priority an agent gives a request (internal: residents never see it). Every request that existed before is "normal".
{
  const columns = new Set(db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name));
  if (!columns.has('priority')) db.exec("ALTER TABLE messages ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'");
  db.exec('CREATE INDEX IF NOT EXISTS messages_priority ON messages(priority)');
}

// F53: second verification step. The secret of the authenticator app (active, or pending until the first code is checked), when it was switched on and the last
// 30-second step accepted (a code works once). Recovery codes are kept only as hashes and are single-use.
{
  const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
  if (!columns.has('totp_secret')) db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
  if (!columns.has('totp_pending')) db.exec('ALTER TABLE users ADD COLUMN totp_pending TEXT');
  if (!columns.has('totp_enabled_at')) db.exec('ALTER TABLE users ADD COLUMN totp_enabled_at TEXT');
  if (!columns.has('totp_last_step')) db.exec('ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_codes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS recovery_codes_user ON recovery_codes(user_id)');
}

// D02: passkeys (WebAuthn credentials). The server keeps the public key only; the private key never leaves the person's device.
db.exec(`CREATE TABLE IF NOT EXISTS passkeys (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id)');
// the verification library's own key encoding (COSE bytes, base64); rows written before it keep public_key (SPKI) and are converted at start (server.mjs), never rewritten
{
  const columns = new Set(db.prepare('PRAGMA table_info(passkeys)').all().map((column) => column.name));
  if (!columns.has('cose_key')) db.exec('ALTER TABLE passkeys ADD COLUMN cose_key TEXT');
}

// F70: the perimeter of an agent: the services whose requests they handle. No row = no restriction (every agent that existed before keeps everything).
db.exec(`CREATE TABLE IF NOT EXISTS agent_scopes (
  agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, service_id)
)`);

// F82: a durable fingerprint of what a resident sent (messages and concerns), so the same text sent again within minutes (a retry, a script) is recognised
// even after a restart. Additive: old rows keep an empty fingerprint and are never matched.
for (const table of ['messages', 'concerns']) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  if (!columns.has('fingerprint')) db.exec(`ALTER TABLE ${table} ADD COLUMN fingerprint TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS ${table}_fingerprint ON ${table}(user_id, fingerprint)`);
}

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
