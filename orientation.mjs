// Orientation + plain language (D10, F89, F90, F91, F92): server side. One public, read-only route that assembles the index the browser matches against:
// the city's real services and places (public columns only), a fixed catalogue of portal actions tied to anchors that exist, and reviewed plain-language
// explanations keyed by service title. The resident's request is matched in the browser (public/orientation.js): it never reaches the server, nothing is logged
// or stored. No dependency, no write. Contract: coordination/reports/B-orientation-contract.md.

export const INDEX_VERSION = 1;

// Portal actions. `anchor` is an element id of the portal page (verified by tools/qa-orientation against the real index.html); `auth` = needs a signed-in resident.
// `kw_*` are curated vocabulary: what residents actually say, FR and EN, with and without accents (the client normalises anyway).
export const ACTIONS = [
  { id: 'emergency', anchor: 'urgences', auth: false, domain: 'emergency',
    title: 'Urgence : numéro et lieux', title_en: 'Emergency: number and places',
    why: 'Pour une urgence, appelez tout de suite le numéro d’urgence et rendez-vous à l’hôpital ou au poste de secours.', why_en: 'In an emergency, call the emergency number straight away and go to the hospital or the rescue post.',
    plain: 'Urgence vitale : appelez le numéro d’urgence. N’écrivez pas un message à la ville : il ne sera pas lu à temps.', plain_en: 'Life-threatening emergency: call the emergency number. Do not write a message to the city: it will not be read in time.',
    kw_fr: ['urgence', 'urgent', 'secours', 'ambulance', 'pompiers', 'samu', 'hopital', 'hôpital', 'urgences', 'danger', 'grave'],
    kw_en: ['emergency', 'urgent', 'rescue', 'ambulance', 'fire brigade', 'hospital', 'danger', 'serious'] },
  { id: 'contact', anchor: 'message-form', auth: true, domain: 'contact',
    title: 'Écrire à la ville', title_en: 'Write to the city',
    why: 'Pour poser une question ou demander quelque chose à un agent municipal.', why_en: 'To ask a question or request something from a city agent.',
    plain: 'Connectez-vous, puis écrivez votre message à la ville. Vous pourrez suivre la réponse.', plain_en: 'Sign in, then write your message to the city. You can follow the answer.',
    kw_fr: ['ecrire', 'écrire', 'contacter', 'contact', 'question', 'message', 'demande', 'demander', 'renseignement', 'information', 'agent', 'mairie', 'joindre', 'courrier', 'reclamation', 'réclamation', 'plainte'],
    kw_en: ['write', 'contact', 'question', 'message', 'request', 'ask', 'information', 'agent', 'town hall', 'complaint', 'help', 'reach'] },
  { id: 'report', anchor: 'message-form', auth: true, domain: 'problem',
    title: 'Signaler un problème', title_en: 'Report a problem',
    why: 'Pour signaler quelque chose de cassé, sale ou dangereux dans la ville (choisissez « Signaler un problème » dans le formulaire).', why_en: 'To report something broken, dirty or unsafe in the city (choose “Report a problem” in the form).',
    plain: 'Un lampadaire éteint, un trou dans la rue, des déchets ? Connectez-vous, choisissez « Signaler un problème » et dites où c’est.', plain_en: 'A street light that is out, a hole in the road, rubbish? Sign in, choose “Report a problem” and say where it is.',
    kw_fr: ['signaler', 'signalement', 'probleme', 'problème', 'panne', 'casse', 'cassé', 'lampadaire', 'eclairage', 'éclairage', 'route', 'voirie', 'trou', 'dechets', 'déchets', 'poubelle', 'ordures', 'sale', 'proprete', 'propreté', 'fuite', 'inondation', 'degat', 'dégât', 'banc', 'graffiti', 'bruit'],
    kw_en: ['report', 'problem', 'broken', 'street light', 'lamp', 'road', 'pothole', 'rubbish', 'trash', 'garbage', 'litter', 'dirty', 'leak', 'flood', 'damage', 'noise', 'bench', 'graffiti'] },
  { id: 'appointment', anchor: 'appointments-panel', auth: true, domain: 'appointment',
    title: 'Prendre rendez-vous avec un agent', title_en: 'Book an appointment with an agent',
    why: 'Pour voir un agent en personne : choisissez un horaire disponible.', why_en: 'To see an agent in person: choose an available time slot.',
    plain: 'Connectez-vous, choisissez un horaire libre et dites pourquoi vous venez. Vous recevez la confirmation.', plain_en: 'Sign in, choose a free time and say why you are coming. You get a confirmation.',
    kw_fr: ['rendez', 'rendez-vous', 'rdv', 'rencontrer', 'voir un agent', 'horaire', 'creneau', 'créneau', 'reserver', 'réserver', 'prendre rendez-vous', 'annuler', 'dossier', 'guichet'],
    kw_en: ['appointment', 'book', 'booking', 'meet', 'see an agent', 'slot', 'time slot', 'cancel', 'reserve', 'counter', 'desk'] },
  { id: 'services', anchor: 'services', auth: false, domain: 'services',
    title: 'Voir les services de la ville', title_en: 'Browse the city services',
    why: 'La liste des services avec leur description et leur disponibilité.', why_en: 'The list of services with their description and availability.',
    plain: 'Tous les services de la ville sont listés ici. Vous pouvez chercher par un mot.', plain_en: 'All the city services are listed here. You can search by a word.',
    kw_fr: ['service', 'services', 'demarche', 'démarche', 'demarches', 'démarches', 'liste', 'catalogue'],
    kw_en: ['service', 'services', 'procedure', 'procedures', 'list', 'catalogue', 'catalog'] },
  { id: 'places', anchor: 'lieux', auth: false, domain: 'places',
    title: 'Trouver un lieu (adresse, horaires)', title_en: 'Find a place (address, opening hours)',
    why: 'Adresses, horaires et arrêt le plus proche des lieux de la ville.', why_en: 'Addresses, opening hours and nearest stop of the city places.',
    plain: 'Pour savoir où aller et à quelle heure : adresse, horaires et arrêt de tram le plus proche.', plain_en: 'To know where to go and when: address, opening hours and nearest tram stop.',
    kw_fr: ['adresse', 'lieu', 'lieux', 'horaires', 'ouvert', 'ferme', 'fermé', 'localiser', 'situer', 'quartier'],
    kw_en: ['address', 'place', 'places', 'hours', 'opening', 'open', 'closed', 'locate', 'district'] },
  { id: 'transports', anchor: 'transports', auth: false, domain: 'transport',
    title: 'Transports : horaires et perturbations', title_en: 'Transport: times and disruptions',
    why: 'Les lignes de tram, leurs prochains passages et les perturbations.', why_en: 'The tram lines, their next departures and disruptions.',
    plain: 'Pour savoir quand passe le tram et s’il y a un problème sur la ligne.', plain_en: 'To know when the tram comes and whether the line has a problem.',
    kw_fr: ['tram', 'tramway', 'transport', 'transports', 'ligne', 'arret', 'arrêt', 'bus', 'metro', 'métro', 'passage', 'prochain', 'retard', 'perturbation', 'horaire'],
    kw_en: ['tram', 'transport', 'line', 'stop', 'bus', 'metro', 'next', 'delay', 'disruption', 'timetable', 'schedule'] },
  { id: 'alerts', anchor: 'actualites', auth: false, domain: 'alerts',
    title: 'Alertes et actualités', title_en: 'Alerts and news',
    why: 'Les alertes en cours et les informations officielles de la ville.', why_en: 'Current alerts and official city information.',
    plain: 'Les messages importants de la ville : alertes, travaux, informations pratiques.', plain_en: 'The important messages from the city: alerts, works, practical information.',
    kw_fr: ['alerte', 'alertes', 'actualite', 'actualité', 'actualites', 'actualités', 'information', 'annonce', 'nouvelles', 'inondation', 'canicule', 'chaleur', 'eau', 'meteo', 'météo', 'prevenir', 'prévenir', 'notification'],
    kw_en: ['alert', 'alerts', 'news', 'announcement', 'information', 'flood', 'heat', 'heatwave', 'water', 'weather', 'warn', 'notification'] },
  { id: 'account', anchor: 'espace', auth: false, domain: 'account',
    title: 'Créer un compte ou se connecter', title_en: 'Create an account or sign in',
    why: 'Pour écrire à la ville, prendre rendez-vous et suivre vos demandes, il faut un espace personnel.', why_en: 'To write to the city, book appointments and follow your requests you need a personal space.',
    plain: 'Un compte vous donne un espace personnel pour écrire à la ville et suivre vos demandes.', plain_en: 'An account gives you a personal space to write to the city and follow your requests.',
    kw_fr: ['compte', 'connecter', 'connexion', 'inscrire', 'inscription', 'creer', 'créer', 'mot de passe', 'identifiant', 'se connecter', 'espace personnel', 'login'],
    kw_en: ['account', 'sign in', 'log in', 'login', 'register', 'sign up', 'create', 'password', 'personal space'] },
  { id: 'track', anchor: 'citizen-messages', auth: true, domain: 'track',
    title: 'Suivre mes demandes', title_en: 'Follow my requests',
    why: 'Le statut de chacun de vos messages : reçu, en cours ou résolu.', why_en: 'The status of each of your messages: received, in progress or resolved.',
    plain: 'Pour voir où en est votre message : reçu, en cours ou résolu.', plain_en: 'To see where your message stands: received, in progress or resolved.',
    kw_fr: ['suivre', 'suivi', 'statut', 'etat', 'état', 'avancement', 'ma demande', 'mes demandes', 'reponse', 'réponse', 'ou en est', 'où en est'],
    kw_en: ['follow', 'track', 'status', 'progress', 'my request', 'my requests', 'answer', 'reply', 'where is'] },
  { id: 'profile', anchor: 'profile-form', auth: true, domain: 'account',
    title: 'Mon profil et mon quartier', title_en: 'My profile and district',
    why: 'Votre nom et votre quartier : le quartier sert à vous montrer le bon arrêt de tram.', why_en: 'Your name and district: the district is used to show you the right tram stop.',
    plain: 'Changez votre nom ou votre quartier ici.', plain_en: 'Change your name or your district here.',
    kw_fr: ['profil', 'quartier', 'nom', 'modifier', 'changer', 'adresse'],
    kw_en: ['profile', 'district', 'name', 'change', 'edit', 'update'] },
  { id: 'privacy', anchor: 'privacy-panel', auth: true, domain: 'privacy',
    title: 'Mes données : copie, export, suppression', title_en: 'My data: copy, export, deletion',
    why: 'Pour récupérer une copie de vos données ou supprimer votre compte.', why_en: 'To get a copy of your data or delete your account.',
    plain: 'Vous pouvez télécharger vos données ou supprimer votre compte depuis cette partie.', plain_en: 'You can download your data or delete your account from this part.',
    kw_fr: ['donnees', 'données', 'rgpd', 'confidentialite', 'confidentialité', 'vie privee', 'vie privée', 'supprimer', 'effacer', 'export', 'copie', 'telecharger', 'télécharger', 'appareils'],
    kw_en: ['data', 'privacy', 'gdpr', 'delete', 'erase', 'export', 'copy', 'download', 'devices'] },
  { id: 'public', anchor: 'public-panel', auth: true, domain: 'public',
    title: 'Soutenir une demande déposée par d’autres habitants', title_en: 'Support a request filed by other people',
    why: 'Pour appuyer une demande publique déjà déposée.', why_en: 'To back a public request already filed.',
    plain: 'Si d’autres habitants ont déjà fait la même demande, vous pouvez l’appuyer.', plain_en: 'If other residents already made the same request, you can back it.',
    kw_fr: ['soutenir', 'appuyer', 'soutien', 'demande publique', 'petition', 'pétition', 'autres habitants'],
    kw_en: ['support', 'back', 'public request', 'petition', 'other people'] },
];

// Reviewed plain-language explanations, tied to the service TITLE (ids are dynamic). They restate ONLY what the service text already says; `facts` are the
// details (conditions, steps, names) that must survive in both the original and the explanation (checked by tools/qa-orientation). A service that is not
// listed here (or whose title changed) gets no explanation: the UI then shows the original text intact. Reviewed by B on 2026-10-04 against the seed texts;
// the city should re-confirm them whenever the service text changes.
export const PLAIN = {
  'Relations citoyennes': {
    fr: 'Vous avez une question ou une difficulté ? Connectez-vous à votre espace personnel et envoyez un message aux services municipaux. Vous pouvez ensuite suivre son traitement.',
    en: 'Do you have a question or a difficulty? Sign in to your personal space and send a message to the city services. You can then follow how it is handled.',
    facts: ['espace personnel', 'message', 'traitement'], facts_en: ['personal space', 'message', 'handled'],
  },
  'Espace personnel': {
    fr: 'Pour voir vos informations et retrouver vos échanges avec la ville, créez un compte. Tout est au même endroit.',
    en: 'To see your information and find your conversations with the city, create an account. Everything is in one place.',
    facts: ['compte', 'échanges avec la ville'], facts_en: ['account', 'conversations with the city'],
  },
  'Suivi des demandes': {
    fr: 'Pour chaque message envoyé, vous voyez où il en est : reçu, en cours de traitement ou résolu.',
    en: 'For each message you send, you can see where it stands: received, in progress or resolved.',
    facts: ['reçu', 'en cours de traitement', 'résolu'], facts_en: ['received', 'in progress', 'resolved'],
  },
  'Centre de santé': {
    fr: 'Le centre de santé de la ville reçoit les habitants pour la médecine générale (voir un médecin), les vaccinations et les soins infirmiers. Pour prendre rendez-vous, envoyez un message depuis votre espace personnel.',
    en: 'The city health centre welcomes residents for general medicine (seeing a doctor), vaccinations and nursing care. To book an appointment, send a message from your personal space.',
    facts: ['médecine générale', 'vaccinations', 'soins infirmiers', 'rendez-vous', 'message', 'espace personnel'], facts_en: ['general medicine', 'vaccinations', 'nursing care', 'appointment', 'message', 'personal space'],
  },
  'Signaler un problème': {
    fr: 'Quelque chose ne va pas dans la ville ? Dans votre espace personnel, choisissez « Signaler un problème », décrivez ce qui s’est passé et indiquez le lieu. Vous suivez ensuite son traitement.',
    en: 'Is something wrong in the city? In your personal space, choose “Report a problem”, describe what happened and give the location. You then follow how it is handled.',
    facts: ['Signaler un problème', 'lieu', 'espace personnel', 'traitement'], facts_en: ['Report a problem', 'location', 'personal space', 'handled'],
  },
  'Prévention et santé publique': {
    fr: 'Ce service explique les bons gestes en cas de chaleur, de montée des eaux ou d’épidémie, et accompagne les personnes vulnérables. Les alertes en cours sont affichées en haut de chaque page ; activez les notifications pour être prévenu.',
    en: 'This service explains what to do in case of heat, rising water or epidemics, and supports vulnerable people. Current alerts are shown at the top of every page; turn on notifications to be warned.',
    facts: ['personnes vulnérables', 'alertes', 'en haut de chaque page', 'notifications'], facts_en: ['vulnerable people', 'alerts', 'top of every page', 'notifications'],
  },
};

const text = (value) => (typeof value === 'string' ? value : null);
const safeAll = (db, sql) => { try { return db.prepare(sql).all(); } catch { return []; } }; // a table that does not exist yet means "nothing to index"

export function buildIndex(db, { cityNow } = {}) {
  const now = typeof cityNow === 'function' ? cityNow() : null;
  const services = safeAll(db, 'SELECT * FROM services ORDER BY featured DESC, id').slice(0, 200).map((row) => {
    const over = Boolean(now && row.available_again && row.available_again <= now);
    const plain = PLAIN[row.title] ?? null;
    return {
      id: row.id, title: text(row.title), title_en: text(row.title_en), description: text(row.description), description_en: text(row.description_en),
      details: text(row.details), details_en: text(row.details_en), featured: Boolean(row.featured),
      availability: row.availability === 'unavailable' && !over ? 'unavailable' : 'available',
      unavailableReason: text(row.unavailable_reason), unavailableReason_en: text(row.unavailable_reason_en), availableAgain: text(row.available_again),
      alternative: text(row.alternative), alternative_en: text(row.alternative_en),
      plain: plain && row.details ? { fr: plain.fr, en: plain.en, facts: plain.facts, facts_en: plain.facts_en, source: 'service' } : null,
    };
  });
  const places = safeAll(db, "SELECT * FROM places ORDER BY CASE kind WHEN 'emergency' THEN 0 WHEN 'hospital' THEN 1 ELSE 2 END, name").slice(0, 200).map((row) => ({
    code: row.code, kind: row.kind, name: text(row.name), name_en: text(row.name_en), district: text(row.district), stop: text(row.stop), address: text(row.address), address_en: text(row.address_en),
    hours: text(row.hours), hours_en: text(row.hours_en), open_24h: Boolean(row.open_24h), phone: text(row.phone), service_id: row.service_id ?? null,
  }));
  const phones = [...new Set(places.filter((place) => (place.kind === 'emergency' || place.kind === 'hospital') && place.phone).map((place) => place.phone))];
  return { version: INDEX_VERSION, services, places, actions: ACTIONS, emergency: { phones, anchor: 'urgences' } };
}

export async function handleOrientation(ctx) {
  if (ctx.path !== '/api/orientation/index') return false;
  if (ctx.method !== 'GET') ctx.fail(405, 'Méthode non autorisée.');
  ctx.sendJson(ctx.response, 200, buildIndex(ctx.db, { cityNow: ctx.cityNow }));
  return true;
}
