#!/usr/bin/env node
// Upload beside server.mjs/store.mjs in the deployed release. Requires Node 24.
// Run: node --env-file-if-exists=.env setup-jury.mjs
// Preview (read-only): node --env-file-if-exists=.env setup-jury.mjs --check
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const marker = 'jury_demo_setup_v1';
const base = dirname(fileURLToPath(import.meta.url));
const site = 'https://losfablitos.lareunion.webcup.hodi.cloud';
const definitions = [
  ['admin', 'admin', 'Administration jury', 'Centre-ville'],
  ['agent', 'agent', 'Agent jury (tous services)', 'Centre-ville'],
  ['agent-limite', 'agent', 'Agent jury (service de démonstration)', 'Centre-ville'],
  ['citoyen', 'citizen', 'Alice Démonstration', 'Centre-ville'],
  ['citoyen2', 'citizen', 'Benoît Démonstration', 'Quartier sud'],
  ['jetable', 'citizen', 'Compte jetable jury', 'Quartier nord'],
].map(([key, role, name, district]) => ({ key, role, name, district, email: `jury-${key}@terra-nova.invalid` }));

let db;
let credentialsPath;
let credentialsCreated = false;
let committed = false;
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Activez le Node 24 de Hodifly avant de lancer ce script.');
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check')) throw new Error('Seule option disponible : --check (lecture seule).');
  for (const file of ['store.mjs', 'security.mjs', 'audit.mjs', 'participation.mjs']) {
    if (!existsSync(join(base, file))) throw new Error(`Placez setup-jury.mjs à côté de server.mjs : ${file} absent.`);
  }
  // Match the application's DATA_PATH, but refuse to create a new/empty database by mistake.
  const databasePath = resolve(process.env.DATA_PATH || join(base, 'data', 'terra-nova.sqlite'));
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) throw new Error(`Base existante introuvable : ${databasePath}`);
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(databasePath, { readOnly: true });
  const required = {
    users: ['id', 'email', 'name', 'role', 'password_hash', 'district', 'avatar', 'active'],
    services: ['id', 'title', 'featured', 'availability', 'available_again', 'alternative_en'],
    messages: ['id', 'user_id', 'subject', 'service_id', 'topic', 'priority', 'emergency'],
    places: ['id', 'code', 'partner'], appointments: ['id', 'agent_id', 'starts_at'],
    announcements: ['id', 'sender', 'audience', 'urgent'],
    settings: ['key', 'value'], message_replies: ['message_id', 'author_id', 'body'],
    audit_log: ['hash', 'prev_hash'], public_requests: ['id', 'message_id'],
    supports: ['public_request_id', 'user_id'], concerns: ['id', 'response'],
    notices: ['user_id', 'code', 'ref_id'], agent_scopes: ['agent_id', 'service_id'],
    part_decisions: ['id', 'demo'], part_choices: ['id', 'decision_id'],
    part_consultations: ['id', 'demo'], part_projects: ['id', 'demo'],
    part_ideas: ['key', 'receipt'], part_feedback: ['key', 'receipt'],
  };
  for (const [table, columns] of Object.entries(required)) {
    const found = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const column of columns) if (!found.has(column)) throw new Error(`Version déployée incompatible : ${table}.${column} absent.`);
  }
  const prior = db.prepare('SELECT value FROM settings WHERE key = ?').get(marker);
  if (prior) {
    const previous = JSON.parse(prior.value);
    console.log('Préparation déjà effectuée : aucun compte, mot de passe ou exemple modifié.');
    console.log(`Fiche privée : ${previous.credentialsPath}`);
    console.log(`Sauvegarde initiale : ${previous.backupPath}`);
    if (!existsSync(previous.credentialsPath)) console.error('La fiche privée a été déplacée ou supprimée. Aucun mot de passe ne sera réinitialisé automatiquement.');
    db.close(); db = null;
    process.exit(0);
  }
  if (!db.prepare("SELECT value FROM settings WHERE key = 'receipt_key'").get()) throw new Error('Clé des accusés absente : démarrez la version déployée avant la préparation.');
  for (const account of definitions) {
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(account.email)) throw new Error(`Adresse réservée déjà utilisée : ${account.email}. Aucun compte existant ne sera modifié.`);
  }
  const privateDirectory = dirname(realpathSync(databasePath));
  credentialsPath = join(privateDirectory, 'JURY-ACCES-PRIVE.md');
  if (existsSync(credentialsPath)) throw new Error(`Fiche privée déjà présente sans marqueur : ${credentialsPath}. Conservez-la et examinez la situation avant de relancer.`);
  console.log(`Base sélectionnée : ${databasePath}`);
  console.log('Préparation : 6 comptes neufs, 2 services, 5 demandes, réponses, soutien, confidentialité, 4 créneaux, lieu partenaire, annonces et participation fictive.');
  if (args.includes('--check')) {
    console.log('Contrôle préalable terminé. Aucune écriture effectuée.');
    db.close(); db = null;
    process.exit(0);
  }
  db.close(); db = null;
  process.umask(0o077);
  // VACUUM INTO copies committed WAL content too; copying only the .sqlite file would not.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(privateDirectory, `avant-jury-${stamp}-${randomBytes(3).toString('hex')}.sqlite`);
  const backupConnection = new DatabaseSync(databasePath);
  try {
    backupConnection.exec('PRAGMA busy_timeout = 15000');
    backupConnection.prepare('VACUUM INTO ?').run(backupPath);
    chmodSync(backupPath, 0o600);
  } finally { backupConnection.close(); }

  process.env.DATA_PATH = databasePath;
  // Reuse the actual password format and audit chain; do not fork authentication logic.
  ({ db } = await import(pathToFileURL(join(base, 'store.mjs')).href));
  const { hashPassword } = await import(pathToFileURL(join(base, 'security.mjs')).href);
  const { audit, verifyChain } = await import(pathToFileURL(join(base, 'audit.mjs')).href);
  db.exec('PRAGMA busy_timeout = 15000');
  if (!verifyChain().ok) throw new Error('Le journal existant ne vérifie pas : aucune donnée de jury ajoutée.');
  for (const account of definitions) {
    account.password = randomBytes(24).toString('base64url');
    account.hash = await hashPassword(account.password);
  }
  const now = new Date().toISOString();
  const cityDay = (days) => new Date(Date.now() + days * 86400000 + 4 * 3600000).toISOString().slice(0, 10);
  const tomorrow = cityDay(1);
  const later = cityDay(2);
  const privateSheet = [
    '# Terra Nova — accès privés du jury', '',
    `Créés le ${now}. Ne jamais publier ce fichier ni le mettre dans Git.`, '',
    `Connexion : ${site}/#espace`, `Monde : ${site}/monde/`, '',
    '| Compte | Rôle | Identifiant | Mot de passe |', '|---|---|---|---|',
    ...definitions.map((a) => `| ${a.name} | ${a.role} | ${a.email} | ${a.password} |`), '',
    'Tous ces comptes sont fictifs. L’administrateur existant n’est pas modifié.',
    'Alice : demandes, historique, réponse, reçu, publication et rendez-vous réservé.',
    'Benoît : données distinctes et soutien de la publication d’Alice ; peut participer au vote ouvert.',
    'Agent général : outils staff ; agent limité : uniquement le service « [DÉMO JURY] Accueil des habitants » et demandes sans service.',
    'Compte jetable : suppression F33/F34, réinitialisation ou essais de sécurité. Ne pas supprimer les autres comptes de démonstration.',
    'Passkeys et authentificateur TOTP : configurer manuellement sur un compte jetable avec un appareil disponible au jury.', '',
    '## Parcours',
    '1. Se connecter comme Alice, ouvrir ses demandes et télécharger un accusé de réception. Lire la réponse de l’agent.',
    '2. Ouvrir les rendez-vous : un rendez-vous est réservé et trois créneaux sont libres (dates ci-dessous).',
    '3. Se connecter dans un autre profil comme Benoît : les demandes privées d’Alice doivent rester invisibles.',
    '4. Ouvrir les demandes publiques : incident fictif d’Alice soutenu par Benoît.',
    '5. Se connecter comme agent limité, puis agent général/admin et comparer les services visibles.',
    '6. Participation : vote et consultation ouverts sans résultats inventés ; trois projets et une idée/réponse fictives.',
    '7. Lieux : association partenaire fictive ; services : exemple mis en avant et exemple indisponible.',
    '8. Admin : consulter le journal de préparation ; effectuer une vraie action pour vérifier sa journalisation.', '',
    `Créneaux (heure de La Réunion, UTC+4) : ${tomorrow} 10:00, 10:30, 11:00 et ${later} 10:00.`,
    'Les dates ne sont pas prolongées lors d’une relance ; adapter les créneaux depuis les outils staff si nécessaire.', '',
    `Base : ${databasePath}`, `Sauvegarde avant préparation : ${backupPath}`, '',
    'La relance du script conserve les mots de passe, les données et les actions effectuées par le jury.',
    'Partager les identifiants uniquement dans les champs privés du concours. Aucune messagerie n’est nécessaire.',
  ].join('\n');
  writeFileSync(credentialsPath, privateSheet + '\n', { mode: 0o600, flag: 'wx' });
  credentialsCreated = true;
  chmodSync(credentialsPath, 0o600);

  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(marker)) throw new Error('Une autre préparation vient de terminer ; aucune deuxième insertion.');
    const add = (table, values) => {
      const columns = Object.keys(values);
      return Number(db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
    };
    const accounts = {};
    for (const a of definitions) {
      a.id = add('users', { email: a.email, name: a.name, role: a.role, password_hash: a.hash, district: a.district,
        avatar: JSON.stringify({ skin: '#b98160', outfit: a.key === 'citoyen2' ? '#347e8d' : '#b56d48', accent: '#e8bc70' }), active: 1 });
      accounts[a.key] = a;
    }
    const admin = accounts.admin;
    const agent = accounts.agent;
    const alice = accounts.citoyen;
    const benoit = accounts.citoyen2;
    const welcome = add('services', {
      title: '[DÉMO JURY] Accueil des habitants', description: 'Service fictif pour tester les démarches et le suivi.',
      details: 'Démonstration uniquement. Envoyez une demande puis consultez sa réponse et son accusé.', featured: 1,
      title_en: '[JURY DEMO] Citizen help desk', description_en: 'Fictional service for testing requests and tracking.',
      details_en: 'Demonstration only. Send a request, then read its reply and receipt.',
    });
    const workshop = add('services', {
      title: '[DÉMO JURY] Atelier de quartier', description: 'Exemple fictif de service temporairement indisponible.',
      details: 'Démonstration : ne correspond à aucune fermeture réelle.', availability: 'unavailable',
      unavailable_reason: 'Démonstration : maintenance fictive.', available_again: `${tomorrow}T14:00`,
      alternative: 'Utiliser le service de démonstration Accueil des habitants.',
      title_en: '[JURY DEMO] District workshop', description_en: 'Fictional temporarily unavailable service.',
      details_en: 'Demonstration: no real closure.', unavailable_reason_en: 'Demo: fictional maintenance.',
      alternative_en: 'Use the demo Citizen help desk instead.',
    });
    add('agent_scopes', { agent_id: accounts['agent-limite'].id, service_id: welcome });
    const request = (user, subject, status, options = {}) => add('messages', {
      user_id: user.id, subject: `[DÉMO JURY] ${subject}`, body: 'Données fictives pour la vérification du jury. Aucune demande réelle.',
      kind: 'contact', location: null, service_id: welcome, status, topic: 'demarches', priority: 'normal', emergency: 0, ...options,
    });
    const received = request(alice, 'Question sur les démarches', 'new');
    const progress = request(alice, 'Suivi du dossier de démonstration', 'in_progress', { priority: 'high' });
    const resolved = request(alice, 'Demande clôturée de démonstration', 'resolved');
    const incident = request(alice, 'Éclairage de la place (incident fictif)', 'in_progress', {
      kind: 'incident', location: 'Place centrale — démonstration', topic: 'voirie',
    });
    const outsideScope = request(benoit, 'Question sur l’atelier (autre service)', 'new', { service_id: workshop });
    add('message_replies', { message_id: progress, author_id: agent.id, body: '[DÉMO JURY] Nous avons reçu votre demande fictive. Le suivi est en cours.' });
    add('message_replies', { message_id: resolved, author_id: agent.id, body: '[DÉMO JURY] Exemple de réponse finale : le dossier fictif est clôturé.' });
    add('notices', { user_id: alice.id, code: 'message.reply', ref_id: progress, label: '[DÉMO JURY] Réponse à votre demande', note: 'Réponse de démonstration disponible.' });
    add('notices', { user_id: alice.id, code: 'message.resolved', ref_id: resolved, label: '[DÉMO JURY] Demande clôturée', note: 'Clôture fictive.' });
    const published = add('public_requests', {
      message_id: incident, public_title: '[DÉMO JURY] Éclairage de la place',
      public_summary: 'Incident entièrement fictif, publié par le compte de démonstration pour tester le soutien citoyen.', district: 'Centre-ville',
    });
    add('supports', { public_request_id: published, user_id: benoit.id });
    add('concerns', { user_id: alice.id, topic: 'usage', body: '[DÉMO JURY] Comment mes données fictives sont-elles utilisées ?',
      status: 'answered', response: '[DÉMO JURY] Réponse fictive : vos démarches privées ne sont accessibles qu’à vous et au personnel autorisé.', responded_at: now });
    const slots = [`${tomorrow}T10:00`, `${tomorrow}T10:30`, `${tomorrow}T11:00`, `${later}T10:00`];
    const appointmentIds = slots.map((starts_at, index) => add('appointments', {
      agent_id: agent.id, starts_at, duration_min: 30, location: '[DÉMO JURY] Accueil de la mairie',
      instructions: 'Rendez-vous fictif pour tester réservation, annulation et rappel. Ne pas se déplacer.',
      status: index === 0 ? 'booked' : 'open', citizen_id: index === 0 ? alice.id : null,
      reason: index === 0 ? 'Démonstration du rendez-vous citoyen' : null, booked_at: index === 0 ? now : null,
    }));
    add('places', { code: 'jury-demo-partenaire', kind: 'service', name: '[DÉMO JURY] Association des jardins',
      name_en: '[JURY DEMO] Community garden association', district: 'Centre-ville', stop: 'Mairie',
      address: 'Exemple fictif : place centrale, à proximité de la mairie.', address_en: 'Fictional example: central square, near town hall.',
      hours: 'Démonstration : du lundi au vendredi, 09:00–17:00', hours_en: 'Demo: Monday to Friday, 09:00–17:00',
      partner: 1, open_24h: 0, service_id: welcome });
    for (const [title, body, urgent, sender] of [
      ['Bienvenue au jury', 'Les comptes et données portant DÉMO JURY sont fictifs et destinés à vos vérifications.', 0, null],
      ['Exercice de notification urgente', 'EXERCICE UNIQUEMENT : aucune urgence réelle. Cette annonce permet de tester affichage, lecture et acquittement.', 1, null],
      ['Communication officielle de démonstration', 'Message fictif signé Haut Conseil pour vérifier le badge et la visibilité de cet émetteur.', 0, 'Haut Conseil'],
    ]) add('announcements', { title: `[DÉMO JURY] ${title}`, body, audience: 'Tous', urgent, sender,
      title_en: `[JURY DEMO] ${title}`, body_en: `Fictional jury demonstration only. ${body}` });
    const decision = add('part_decisions', { title: '[DÉMO JURY] Quel jardin aménager ?', title_en: '[JURY DEMO] Which garden should be developed?',
      summary: 'Vote fictif ouvert pour le jury. Aucun vote ni résultat préfabriqué.', summary_en: 'Fictional open vote. No fabricated votes or results.',
      status: 'open', demo: 1, created_by_label: 'Démonstration jury', created_at: now });
    for (const [label, label_en] of [['Jardin de la mairie', 'Town hall garden'], ['Jardin du marché', 'Market garden']]) add('part_choices', { decision_id: decision, label, label_en });
    add('part_consultations', { title: '[DÉMO JURY] Les espaces verts', title_en: '[JURY DEMO] Green spaces',
      body: 'Consultation fictive : donnez votre avis pour tester le parcours.', body_en: 'Fictional consultation: share an opinion to test the flow.',
      status: 'open', demo: 1, created_by_label: 'Démonstration jury', created_at: now });
    for (const [status, progressValue, name] of [['planned', 0, 'Jardin'], ['in_progress', 40, 'Serre'], ['done', 100, 'Éclairage']]) {
      add('part_projects', { title: `[DÉMO JURY] ${name}`, title_en: `[JURY DEMO] ${name}`, summary: 'Projet entièrement fictif.',
        summary_en: 'Entirely fictional project.', district: 'Centre-ville', status, progress: progressValue, demo: 1,
        created_by_label: 'Démonstration jury', created_at: now, updated_at: now });
    }
    add('part_ideas', { user_id: alice.id, key: 'jury_demo_idea_v1', title: '[DÉMO JURY] Des jardins partagés',
      body: 'Idée fictive : proposer un jardin collectif pour tester le suivi.', status: 'under_review', staff_note: '[DÉMO JURY] Exemple de réponse du personnel.',
      receipt: `IDEA-${randomBytes(5).toString('hex').toUpperCase()}`, created_at: now, updated_at: now });
    add('part_feedback', { user_id: benoit.id, key: 'jury_demo_feedback_v1', service_id: welcome, rating: 4,
      comment: '[DÉMO JURY] Avis fictif du second compte de démonstration.', receipt: `FEEDBACK-${randomBytes(5).toString('hex').toUpperCase()}`, created_at: now });
    audit(admin, { category: 'maintenance', action: 'jury.demo.seed', target: { type: 'demonstration', label: 'Données fictives du jury' },
      summary: 'a préparé les comptes et exemples fictifs du jury via le script serveur', reason: 'Préparation des vérifications Webcup ; données clairement marquées DÉMO JURY',
      details: { comptes: definitions.length, demandes: [received, progress, resolved, incident, outsideScope], rendez_vous: appointmentIds, services: [welcome, workshop] } });
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(marker, JSON.stringify({ createdAt: now, credentialsPath, backupPath,
      users: Object.fromEntries(definitions.map((a) => [a.key, a.id])) }));
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Contrôle des références échoué ; préparation annulée.');
    if (!verifyChain().ok) throw new Error('Contrôle du journal échoué ; préparation annulée.');
    db.exec('COMMIT');
    committed = true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  console.log('Préparation terminée. Aucun compte préexistant ni mot de passe existant modifié.');
  console.log(`Fiche privée (identifiants et étapes) : ${credentialsPath}`);
  console.log(`Sauvegarde : ${backupPath}`);
  console.log('Pour afficher les accès dans votre terminal privé :');
  console.log(`cat '${credentialsPath.replace(/'/g, "'\\''")}'`);
  console.log('Connectez-vous et vérifiez les parcours avant de déclarer les fonctionnalités terminées.');
  db.close(); db = null;
} catch (error) {
  try { db?.close(); } catch {}
  if (credentialsCreated && !committed) { try { unlinkSync(credentialsPath); } catch {} }
  console.error(`Préparation interrompue : ${error.message}`);
  console.error('Ne restaurez pas une sauvegarde par-dessus le service actif. Aucun mot de passe existant n’a été réinitialisé.');
  process.exitCode = 1;
}
