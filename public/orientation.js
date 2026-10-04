// Orientation + plain language UI (D10, F89, F90, F91, F92). Classic script, no dependency, no remote asset.
//   TerraOrientation.mount(root, { user, lang, api, index?, onNavigate? }) -> { update({ user, lang }), unmount() }
//   TerraOrientation.engine = { createEngine, norm, ... }   (pure matching, also run by Node tests)
// The resident's words are matched HERE, in the browser, against the index served by GET /api/orientation/index: nothing is sent, logged or stored.
// Deterministic matching (accents, typos, FR/EN synonyms): it is a finder over the city's real services/places/actions, not a chatbot. Every string is
// written with textContent; destinations are fixed portal anchors; emergency numbers come from the city's own data (places.phone or the portal strip).
(() => {
  const MAX_QUERY = 300;
  const MAX_TOKENS = 40;
  const MAX_ENTRIES = 400;

  // ------------------------------------------------------------------ text normalisation
  const norm = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'").replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, ' ').trim();
  const STOP = new Set(('le la les l un une des du de d et ou a au aux en dans sur sous par pour avec sans ce ces cet cette mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs je j tu il elle on nous vous ils elles ' +
    'me m te t se s moi toi lui y qui que qu quoi dont ne n pas plus tres trop est suis es sommes etes sont ai as avons avez ont fait faire veux veut voudrais voudrai peux peut puis pouvoir comment quel quelle quels quelles ' +
    'partout devant chez derriere pres loin tout toute tous toutes bien besoin prendre voir aller avoir encore aussi si ici la-bas cherche chercher savoir quelque quelques rien ' +
    'the a an and or of to in on at for with without my your our their i you he she it we they me is am are was be been do does did have has had can could would want need how what which who when why this that these those there here please s get got see go ' +
    'looking look find some any about').split(' '));
  const keepShort = new Set(['tv', 'id', 'cv']);
  // a few multi-word intents that single words cannot carry: the phrase adds a keyword the vocabulary knows
  const PHRASES = [
    { pattern: /\bou (est|se trouve|se situe|sont|puis je (trouver|aller))\b/, boost: { place: 1.25 } }, { pattern: /\bwhere (is|are|can i find|do i go|to find)\b/, boost: { place: 1.25 } },
    { pattern: /\b(ou en est|suivre|suivi de) (ma|mon|mes)\b/, words: 'suivi statut' }, { pattern: /\bwhere is my (request|message|file)\b/, words: 'status track' },
  ];
  const GENERIC_ACTIONS = new Set(['places', 'services']); // fallback destinations: a specific service/place that matches equally well comes first
  const tokenize = (value) => norm(value).split(' ').filter((t) => t && (t.length > 1 || /\d/.test(t)) && (!STOP.has(t) || keepShort.has(t))).slice(0, MAX_TOKENS);
  const stem = (t) => {
    if (t.length > 5 && t.endsWith('aux')) return `${t.slice(0, -3)}al`;
    if (t.length > 5 && /(?:ings|ies|ees)$/.test(t)) return t.slice(0, -1);
    if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
    if (t.length > 3 && /[sxe]$/.test(t)) return t.slice(0, -1);
    return t;
  };

  // bounded Levenshtein (returns max+1 when farther than max)
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let best = row[0];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], previous[j - 2] + 1); // transposition
        best = Math.min(best, row[j]);
      }
      if (best > max) return max + 1;
      previous = row;
    }
    return previous[b.length];
  }

  // ------------------------------------------------------------------ vocabulary: concept groups (FR + EN, accents removed) and emergency phrases
  const GROUPS = {
    health: 'sante health medecin medecine doctor docteur generaliste malade ill sick soin soigner care vaccin vaccination vaccine vaccinate infirmier infirmiere nurse nursing consultation medical medicale dentiste dent teeth mal douleur pain fievre fever grippe flu ordonnance prescription pharmacie pharmacy',
    hospital: 'hopital hospital clinique urgences emergency-room',
    emergency: 'urgence urgent secours rescue ambulance samu pompier pompiers firefighters danger',
    problem: 'probleme problem signaler signalement report casse broken panne lampadaire lamp streetlight voirie road route trou pothole dechet dechets rubbish trash garbage poubelle ordures sale dirty proprete litter fuite leak degat damage graffiti banc bench eclairage lighting',
    appointment: 'rendez rdv appointment booking book reserver reserve creneau slot rencontrer meet guichet counter desk',
    hours: 'horaire horaires hours ouvert open ferme closed heure heures time',
    housing: 'logement logements housing habitat appartement apartment flat loyer rent hlm',
    market: 'marche market commerce commercant commercants trader traders etal etals stall stalls',
    transport: 'tram tramway transport transports bus metro ligne line arret stop passage retard delay perturbation timetable',
    water: 'inondation flood eau water crue berge berges riverbank montee rising',
    heat: 'chaleur canicule heat heatwave',
    account: 'compte account connexion login connecter inscription inscrire register password passe identifiant',
    data: 'donnee donnees data rgpd gdpr confidentialite privacy supprimer delete effacer erase export copie telecharger download',
    contact: 'ecrire write contacter contact message question courrier mail email renseignement information joindre',
    track: 'suivre suivi track follow statut status avancement progress reponse answer reply',
    place: 'adresse address lieu lieux place places situer locate quartier district',
    news: 'alerte alertes alert alerts actualite actualites news annonce announcement notification',
  };
  const conceptOf = new Map();
  for (const [concept, words] of Object.entries(GROUPS)) for (const w of words.split(' ')) { const key = stem(w); (conceptOf.get(key) ?? conceptOf.set(key, new Set()).get(key)).add(concept); }

  // a token the vocabulary does not know exactly may still be a typo or a derived form of a known word (vaccinated, vacciner, vacination)
  const conceptCache = new Map();
  function conceptsFor(token) {
    if (conceptOf.has(token)) return conceptOf.get(token);
    if (conceptCache.has(token)) return conceptCache.get(token);
    let found = null;
    if (token.length >= 5) for (const [key, set] of conceptOf) { if (key.length >= 5 && ((key.length >= 6 && token.startsWith(key) && token.length - key.length <= 4) || (token.length >= 6 && key.startsWith(token) && key.length - token.length <= 3) || (token.length >= 6 && key.length >= 6 && distance(token, key, 1) <= 1))) { found = set; break; } }
    conceptCache.set(token, found);
    return found;
  }

  // Emergency wording that must be routed to the emergency path first. Phrases are normalised and matched on word boundaries; single words also match with one typo.
  const EMERGENCY_PHRASES = [
    'urgence', 'urgent', 'urgences', 'secours', 'ambulance', 'samu', 'pompiers', 'au secours', 'a l aide', 'malaise', 'crise cardiaque', 'infarctus', 'crise de coeur', 'inconscient', 'inconsciente', 'evanoui', 'evanouie', 'perdu connaissance',
    'saigne', 'saignement', 'hemorragie', 'etouffe', 'etouffement', 'respire plus', 'respire pas', 'ne respire', 'plus de respiration', 'noyade', 'noye', 'noyee', 'incendie', 'feu', 'brule', 'brulure grave', 'overdose', 'suicide', 'me suicider',
    'avc', 'empoisonne', 'empoisonnement', 'accident grave', 'agression', 'agresse', 'convulsion', 'convulsions', 'enceinte accouche', 'accouchement', 'douleur poitrine', 'mal a la poitrine', 'danger de mort', 'urgence medicale', 'urgence vitale',
    'emergency', 'help me', 'heart attack', 'unconscious', 'bleeding', 'not breathing', 'cant breathe', 'cannot breathe', 'can t breathe', 'choking', 'drowning', 'on fire', 'overdose', 'stroke', 'poisoned', 'severe burn', 'serious accident',
    'attacked', 'seizure', 'chest pain', 'life threatening', 'medical emergency', 'fainted', 'collapsed', 'fire', 'a fire', 'house fire',
  ].map(norm);
  const EMERGENCY_SINGLE = new Set(EMERGENCY_PHRASES.filter((p) => !p.includes(' ')));
  function emergencyHit(query) {
    const q = ` ${norm(query)} `;
    for (const phrase of EMERGENCY_PHRASES) if (q.includes(` ${phrase} `)) return phrase;
    for (const token of norm(query).split(' ')) if (token.length >= 6) for (const single of EMERGENCY_SINGLE) if (single.length >= 6 && distance(token, single, 1) <= 1) return single;
    return null;
  }

  // ------------------------------------------------------------------ the engine
  function fieldTokens(value) { return tokenize(value).map(stem); }
  function createEngine(index, lang = 'fr') {
    const pick = (row, field) => (lang === 'en' && row[`${field}_en`]) || row[field] || '';
    const entries = [];
    for (const s of (index.services ?? []).slice(0, MAX_ENTRIES)) {
      entries.push({ kind: 'service', key: `service:${s.id}`, row: s, fields: [[3, fieldTokens(`${s.title} ${s.title_en ?? ''}`)], [2, fieldTokens(`${s.description} ${s.description_en ?? ''}`)], [1, fieldTokens(`${s.details} ${s.details_en ?? ''}`)]] });
    }
    for (const p of (index.places ?? []).slice(0, MAX_ENTRIES)) {
      const kindWords = p.kind === 'hospital' ? 'hopital hospital' : p.kind === 'emergency' ? 'urgence urgences secours emergency rescue' : '';
      entries.push({ kind: 'place', key: `place:${p.code}`, row: p, fields: [[3, fieldTokens(`${p.name} ${p.name_en ?? ''}`)], [2, fieldTokens(kindWords)], [1, fieldTokens(`${p.address} ${p.address_en ?? ''} ${p.district ?? ''} ${p.stop ?? ''}`)], [1.6, fieldTokens(p.hours || p.open_24h ? 'horaire hours ouvert open' : '')]] });
    }
    for (const a of (index.actions ?? []).slice(0, MAX_ENTRIES)) {
      entries.push({ kind: 'action', key: `action:${a.id}`, row: a, fields: [[3, fieldTokens(`${a.title} ${a.title_en ?? ''}`)], [2.4, fieldTokens([...(a.kw_fr ?? []), ...(a.kw_en ?? [])].join(' '))], [0.8, fieldTokens(`${a.why} ${a.why_en ?? ''}`)]] });
    }
    const emergencyPhones = index.emergency?.phones ?? [];

    function tokenScore(qToken, qConcepts, field) {
      let best = 0;
      for (const t of field) {
        if (t === qToken) return 1;
        let q = 0;
        if (qConcepts && conceptOf.get(t) && [...qConcepts].some((c) => conceptOf.get(t).has(c))) q = 0.8;
        else if (qToken.length >= 4 && t.length >= 4 && (t.startsWith(qToken) || qToken.startsWith(t)) && (Math.min(qToken.length, t.length) >= 6 || Math.abs(qToken.length - t.length) <= 3)) q = 0.65;
        else if (qToken.length >= 5 && t.length >= 5) { const max = qToken.length >= 9 ? 2 : 1; if (distance(qToken, t, max) <= max) q = max === 2 ? 0.6 : 0.7; }
        if (q > best) best = q;
      }
      return best;
    }

    function rank(query, { domain } = {}) {
      const raw = String(query ?? '').slice(0, MAX_QUERY);
      const words = tokenize(raw);
      const qTokens = words.map(stem);
      const normalised = norm(raw);
      const boosts = {};
      for (const phrase of PHRASES) if (phrase.pattern.test(normalised)) { Object.assign(boosts, phrase.boost ?? {}); for (const w of (phrase.words ?? '').split(' ').filter(Boolean)) { words.push(w); qTokens.push(stem(w)); } }
      const out = { query: raw, tokens: qTokens, emergency: emergencyHit(raw), results: [], ambiguous: false, choices: [] };
      if (!qTokens.length) return out;
      const scored = [];
      for (const entry of entries) {
        let total = 0, matched = 0;
        const why = [];
        qTokens.forEach((qt, i) => {
          const concepts = conceptsFor(qt);
          let best = 0, via = '';
          for (const [weight, field] of entry.fields) { const q = tokenScore(qt, concepts, field) * weight; if (q > best) { best = q; via = weight; } }
          if (best > 0) { total += best; matched += 1; if (why.length < 3 && !why.includes(words[i])) why.push(words[i]); }
          void via;
        });
        if (!matched) continue;
        const coverage = matched / qTokens.length;
        let score = (total / Math.sqrt(matched)) * (0.75 + 0.25 * coverage); // unmatched filler words cost little; each extra matched word adds
        if (entry.kind === 'service' && entry.row.featured) score *= 1.05;
        if (entry.kind === 'action' && GENERIC_ACTIONS.has(entry.row.id)) score *= 0.8;
        if (boosts[entry.kind]) score *= boosts[entry.kind];
        if (domain && entry.kind === 'action' && entry.row.domain !== domain && entry.row.id !== domain) score *= 0.5;
        if (score >= 1.1) scored.push({ entry, score, why, coverage });
      }
      scored.sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key));
      out.results = scored.slice(0, 6).map((s) => ({ kind: s.entry.kind, key: s.entry.key, row: s.entry.row, score: Math.round(s.score * 100) / 100, matched: s.why }));
      const [first, second] = scored;
      // ambiguity: a weak best match, or two near-equal candidates of different kinds/domains
      if (first && (first.score < 2.3 || (second && second.score / first.score > 0.82 && first.entry.kind !== second.entry.kind))) {
        out.ambiguous = true;
        const seen = new Set();
        for (const s of scored) { const label = s.entry.kind === 'action' ? s.entry.row.id : s.entry.key; if (!seen.has(label) && out.choices.length < 3) { seen.add(label); out.choices.push({ kind: s.entry.kind, key: s.entry.key, row: s.entry.row }); } }
      }
      return out;
    }
    return { rank, entries, emergencyPhones, lang, pick };
  }

  // ------------------------------------------------------------------ UI strings
  const STR = {
    fr: {
      title: 'Trouver le bon service', intro: 'Décrivez votre besoin avec vos mots. Je vous propose les services, les lieux et les démarches de la ville qui correspondent. Je ne suis pas un conseiller : je cherche dans les informations de la ville.',
      label: 'Décrivez votre besoin', hint: 'Par exemple : « un lampadaire est cassé dans ma rue ». 300 caractères au plus. Votre texte reste sur cette page : il n’est ni envoyé ni conservé.', search: 'Chercher', clear: 'Effacer',
      examples: 'Exemples', ex1: 'Un lampadaire est cassé dans ma rue', ex2: 'Je voudrais voir un médecin', ex3: 'Où prendre le tram ?', ex4: 'Je cherche mon rendez-vous', ex5: 'Quels sont les horaires du marché ?',
      loading: 'Chargement des services…', loadError: 'Les services n’ont pas pu être chargés.', retry: 'Réessayer', none: 'Écrivez quelques mots pour commencer.',
      count: '{n} résultat(s) pour « {q} ». Premier résultat : {first}.', noMatch: 'Je n’ai rien trouvé qui corresponde à « {q} » dans les services et lieux de la ville.', noMatchHelp: 'Essayez avec d’autres mots, choisissez un thème ci-dessous, ou écrivez à la ville : un agent vous répondra.',
      choose: 'Vous parliez peut-être de…', themes: 'Thèmes fréquents', why: 'Pourquoi ce résultat : vous avez parlé de {words}.', whyWeak: 'Ce résultat est proche de votre demande, sans plus.',
      kind_service: 'Service', kind_place: 'Lieu', kind_action: 'Démarche', kind_hospital: 'Hôpital', kind_emergency: 'Urgences / secours',
      unavailable: 'Indisponible en ce moment', reason: 'Raison : {r}', back: 'De retour : {d}', alt: 'En attendant : {a}',
      official: 'Texte officiel', explain: 'Expliquer simplement', hideExplain: 'Masquer l’explication', plain: 'Explication simple', plainNote: 'Rédigée et relue par l’équipe à partir du texte officiel, sans en retirer les conditions. En cas de doute, c’est le texte officiel qui compte.', noPlain: 'Pas d’explication simplifiée relue pour ce texte : le voici tel quel.',
      goTo: 'Aller à : {t}', needLogin: 'Connexion nécessaire : créez un compte ou connectez-vous d’abord.', signIn: 'Se connecter ou créer un compte',
      writeCity: 'Écrire à la ville', writeCityHelp: 'Si rien ne convient, envoyez un message : un agent vous répondra (ce n’est pas pour une urgence vitale).',
      address: 'Adresse', hours: 'Horaires', open24: 'Ouvert 24 h sur 24', stop: 'Arrêt', call: 'Appeler le {phone}',
      emTitle: 'Urgence vitale ?', emCall: 'Appelez tout de suite le {phone}.', emNoNumber: 'Regardez le bandeau « Urgence » en haut de la page pour le numéro à appeler.', emNoQueue: 'N’écrivez pas un message à la ville : il ne serait pas lu à temps.', emNoDiag: 'Je ne peux pas évaluer un état de santé.', emPlaces: 'Où aller', emWorld: 'Dans le monde 3D, la touche G vous guide vers l’urgence la plus proche.', emOther: 'Ce n’est pas une urgence vitale ? Voir les autres résultats',
      essentials: 'Les informations essentielles en langage clair', essentialsNote: 'Courtes explications rédigées par l’équipe. Le détail officiel reste dans les services et lieux de la ville.',
      limits: 'Limites : je ne connais que les services, lieux et démarches de la ville affichés ici. Je ne donne pas de conseil médical ou juridique.',
    },
    en: {
      title: 'Find the right service', intro: 'Describe your need in your own words. I suggest the city services, places and procedures that match. I am not an adviser: I search the city’s information.',
      label: 'Describe your need', hint: 'For example: “a street light is broken on my street”. 300 characters at most. Your text stays on this page: it is neither sent nor kept.', search: 'Search', clear: 'Clear',
      examples: 'Examples', ex1: 'A street light is broken on my street', ex2: 'I would like to see a doctor', ex3: 'Where do I take the tram?', ex4: 'I am looking for my appointment', ex5: 'What are the market opening hours?',
      loading: 'Loading services…', loadError: 'Services could not be loaded.', retry: 'Try again', none: 'Type a few words to begin.',
      count: '{n} result(s) for “{q}”. First result: {first}.', noMatch: 'I found nothing matching “{q}” in the city services and places.', noMatchHelp: 'Try other words, pick a theme below, or write to the city: an agent will answer.',
      choose: 'Did you mean…', themes: 'Common themes', why: 'Why this result: you mentioned {words}.', whyWeak: 'This result is close to your request, no more.',
      kind_service: 'Service', kind_place: 'Place', kind_action: 'Procedure', kind_hospital: 'Hospital', kind_emergency: 'Emergency / rescue',
      unavailable: 'Not available right now', reason: 'Reason: {r}', back: 'Back on: {d}', alt: 'Meanwhile: {a}',
      official: 'Official text', explain: 'Explain simply', hideExplain: 'Hide the explanation', plain: 'Simple explanation', plainNote: 'Written and reviewed by the team from the official text, without removing its conditions. If in doubt, the official text prevails.', noPlain: 'No reviewed simplified explanation for this text: here it is as it is.',
      goTo: 'Go to: {t}', needLogin: 'Sign-in needed: create an account or sign in first.', signIn: 'Sign in or create an account',
      writeCity: 'Write to the city', writeCityHelp: 'If nothing fits, send a message: an agent will answer (not for a life-threatening emergency).',
      address: 'Address', hours: 'Opening hours', open24: 'Open 24 hours a day', stop: 'Stop', call: 'Call {phone}',
      emTitle: 'Life-threatening emergency?', emCall: 'Call {phone} right now.', emNoNumber: 'Look at the “Emergency” banner at the top of the page for the number to call.', emNoQueue: 'Do not write a message to the city: it would not be read in time.', emNoDiag: 'I cannot assess anyone’s health.', emPlaces: 'Where to go', emWorld: 'In the 3D world, the G key guides you to the nearest emergency.', emOther: 'Not a life-threatening emergency? See the other results',
      essentials: 'The essentials in plain language', essentialsNote: 'Short explanations written by the team. The official details stay in the city services and places.',
      limits: 'Limits: I only know the services, places and procedures of the city shown here. I do not give medical or legal advice.',
    },
  };

  // ------------------------------------------------------------------ UI
  function mount(root, options) {
    let { user, lang, api } = options;
    let index = options.index ?? null;
    let alive = true;
    let ticket = 0; // stale-result guard: only the latest query may render
    let timer = 0;
    let state = { loading: !index, error: null, query: '', domain: null };
    let engine = index ? createEngine(index, lang) : null;
    const T = (key, vars = {}) => (STR[lang] ?? STR.fr)[key].replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
    const pick = (row, field) => (lang === 'en' && row[`${field}_en`]) || row[field] || '';

    function h(tag, attrs, ...children) {
      const el = document.createElement(tag);
      for (const [name, value] of Object.entries(attrs ?? {})) {
        if (value === undefined || value === null || value === false) continue;
        if (name === 'class') el.className = value;
        else if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
        else if (value === true) el.setAttribute(name, '');
        else el.setAttribute(name, String(value));
      }
      for (const child of children.flat()) if (child !== undefined && child !== null && child !== false) el.append(child.nodeType ? child : document.createTextNode(String(child)));
      return el;
    }
    const present = (id) => Boolean(document.getElementById(id));
    const go = (anchor, action) => {
      if (options.onNavigate?.({ anchor, action }) === true) return;
      const el = document.getElementById(anchor);
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    };
    const emergencyPhone = () => {
      const fromData = engine?.emergencyPhones?.[0];
      if (fromData) return fromData;
      const link = document.querySelector('#urgences a[href^="tel:"], .emergency-call');
      const href = link?.getAttribute('href') ?? '';
      return /^tel:[0-9+ ().-]{3,20}$/.test(href) ? href.slice(4) : null;
    };
    const telHref = (phone) => `tel:${String(phone).replace(/[^0-9+]/g, '')}`;

    // ---- cards
    function placeFacts(p) {
      return h('ul', { class: 'to-facts' },
        p.address ? h('li', null, `${T('address')} : `, pick(p, 'address')) : null,
        (p.open_24h || p.hours) ? h('li', null, `${T('hours')} : `, p.open_24h ? T('open24') : pick(p, 'hours')) : null,
        p.stop ? h('li', null, `${T('stop')} : ${p.stop}${p.district ? ` · ${p.district}` : ''}`) : null);
    }
    function emergencyCard(emergencyWord) {
      const phone = emergencyPhone();
      const places = (index.places ?? []).filter((p) => p.kind === 'emergency' || p.kind === 'hospital').slice(0, 4);
      const card = h('section', { class: 'to-card to-emergency', 'aria-labelledby': 'to-em-title', role: 'region' },
        h('h3', { id: 'to-em-title' }, '⚠ ', T('emTitle')),
        h('p', { class: 'to-em-call' }, phone ? h('a', { class: 'to-button', href: telHref(phone) }, T('emCall', { phone })) : T('emNoNumber')),
        h('p', null, T('emNoQueue'), ' ', T('emNoDiag')),
        places.length ? h('div', null, h('h4', null, T('emPlaces')), h('ul', { class: 'to-list' }, places.map((p) => h('li', null, h('strong', null, pick(p, 'name')), placeFacts(p), p.phone ? h('a', { href: telHref(p.phone) }, T('call', { phone: p.phone })) : null)))) : null,
        present('urgences') ? h('p', null, h('button', { type: 'button', class: 'to-button to-secondary', onclick: () => go('urgences') }, T('goTo', { t: lang === 'en' ? 'Emergency' : 'Urgences' }))) : null,
        h('p', { class: 'to-hint' }, T('emWorld')));
      void emergencyWord;
      return card;
    }
    function destination(entry) {
      if (entry.kind === 'action') {
        const a = entry.row;
        if (!present(a.anchor) && !(a.auth && present('espace'))) return null;
        const blocked = a.auth && !user;
        return h('p', { class: 'to-dest' },
          blocked ? h('span', { class: 'to-note' }, T('needLogin')) : null, blocked ? ' ' : null,
          h('button', { type: 'button', class: 'to-button', onclick: () => go(blocked ? 'espace' : a.anchor, a) }, blocked ? T('signIn') : T('goTo', { t: pick(a, 'title') })));
      }
      if (entry.kind === 'service') return present('services') ? h('p', { class: 'to-dest' }, h('button', { type: 'button', class: 'to-button', onclick: () => go('services', entry.row) }, T('goTo', { t: pick(entry.row, 'title') }))) : null;
      return present('lieux') ? h('p', { class: 'to-dest' }, h('button', { type: 'button', class: 'to-button', onclick: () => go('lieux', entry.row) }, T('goTo', { t: pick(entry.row, 'name') }))) : null;
    }
    function explainBlock(card, plainText, hasPlain) {
      if (!hasPlain) return h('p', { class: 'to-note' }, T('noPlain'));
      const region = h('div', { class: 'to-plain', hidden: true }, h('h5', null, T('plain')), h('p', null, plainText), h('p', { class: 'to-hint' }, T('plainNote')));
      const button = h('button', { type: 'button', class: 'to-button to-secondary', 'aria-expanded': 'false', onclick: () => {
        const open = region.hidden;
        region.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        button.textContent = open ? T('hideExplain') : T('explain');
      } }, T('explain'));
      return h('div', null, button, region);
    }
    function card(entry, position) {
      const { row, kind } = entry;
      const headingId = `to-r${position}`;
      const title = kind === 'place' ? pick(row, 'name') : pick(row, 'title');
      const tag = kind === 'place' ? T(`kind_${row.kind === 'hospital' ? 'hospital' : row.kind === 'emergency' ? 'emergency' : 'place'}`) : T(`kind_${kind}`);
      const el = h('article', { class: `to-card to-${kind}`, 'aria-labelledby': headingId },
        h('h3', { id: headingId }, title, ' ', h('span', { class: 'to-badge' }, tag)));
      if (entry.matched?.length) el.append(h('p', { class: 'to-why' }, T('why', { words: entry.matched.map((w) => `« ${w} »`).join(', ') })));
      else if (entry.weak) el.append(h('p', { class: 'to-why' }, T('whyWeak')));
      if (kind === 'service') {
        if (row.availability === 'unavailable') el.append(h('div', { class: 'to-outage', role: 'note' }, h('strong', null, '⚠ ', T('unavailable')), row.unavailableReason || row.unavailableReason_en ? h('p', null, T('reason', { r: pick(row, 'unavailableReason') })) : null, row.availableAgain ? h('p', null, T('back', { d: row.availableAgain.replace('T', ' ') })) : null, row.alternative || row.alternative_en ? h('p', null, T('alt', { a: pick(row, 'alternative') })) : null));
        const original = [pick(row, 'description'), pick(row, 'details')].filter(Boolean);
        el.append(h('div', { class: 'to-official' }, h('h4', null, T('official')), original.map((paragraph) => h('p', null, paragraph))));
        const plain = row.plain ? (lang === 'en' ? row.plain.en : row.plain.fr) : null;
        el.append(explainBlock(el, plain, Boolean(plain)));
      } else if (kind === 'place') {
        el.append(placeFacts(row), row.phone && (row.kind === 'emergency' || row.kind === 'hospital') ? h('p', null, h('a', { class: 'to-button', href: telHref(row.phone) }, T('call', { phone: row.phone }))) : null);
      } else {
        el.append(h('p', null, pick(row, 'why')), explainBlock(el, lang === 'en' ? row.plain_en : row.plain, true));
      }
      const dest = destination(entry);
      if (dest) el.append(dest);
      return el;
    }
    function fallbackCard() {
      const action = (index.actions ?? []).find((a) => a.id === 'contact');
      if (!action) return null;
      const blocked = !user;
      return h('section', { class: 'to-card to-fallback', 'aria-labelledby': 'to-fb' },
        h('h3', { id: 'to-fb' }, T('writeCity')), h('p', null, T('writeCityHelp')),
        (present('message-form') || present('espace')) ? h('p', { class: 'to-dest' }, blocked ? h('span', { class: 'to-note' }, T('needLogin')) : null, blocked ? ' ' : null, h('button', { type: 'button', class: 'to-button', onclick: () => go(blocked ? 'espace' : 'message-form', action) }, blocked ? T('signIn') : T('goTo', { t: T('writeCity') }))) : null);
    }
    const THEMES = ['report', 'contact', 'appointment', 'places', 'transports', 'alerts'];
    function choices(entries, heading) {
      return h('div', { class: 'to-choices' }, h('h4', null, heading), h('ul', { class: 'to-chips' }, entries.map((e) => {
        const label = e.kind === 'place' ? pick(e.row, 'name') : pick(e.row, 'title');
        return h('li', null, h('button', { type: 'button', class: 'to-chip', onclick: () => { state.domain = e.kind === 'action' ? e.row.id : null; run(e.kind === 'action' ? state.query : label, true); } }, label));
      })));
    }

    // ---- render
    const els = {};
    function build() {
      root.replaceChildren();
      const wrap = h('div', { class: 'to-root', lang });
      els.status = h('p', { class: 'to-status', role: 'status', 'aria-live': 'polite' });
      els.results = h('div', { class: 'to-results' });
      els.input = h('input', { type: 'search', id: 'to-q', maxlength: MAX_QUERY, autocomplete: 'off', enterkeyhint: 'search', 'aria-describedby': 'to-hint', spellcheck: 'true' });
      els.input.value = state.query;
      const form = h('form', { role: 'search', class: 'to-form', onsubmit: (event) => { event.preventDefault(); clearTimeout(timer); run(els.input.value, true); } },
        h('label', { for: 'to-q' }, T('label')), els.input,
        h('p', { id: 'to-hint', class: 'to-hint' }, T('hint')),
        h('div', { class: 'to-row' }, h('button', { type: 'submit', class: 'to-button' }, T('search')), ' ', h('button', { type: 'button', class: 'to-button to-secondary', onclick: () => { els.input.value = ''; state.query = ''; state.domain = null; run('', true); els.input.focus(); } }, T('clear'))));
      els.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(els.input.value, false), 150); });
      const examples = h('div', { class: 'to-examples' }, h('span', { class: 'to-hint' }, `${T('examples')} : `), h('ul', { class: 'to-chips' }, ['ex1', 'ex2', 'ex3', 'ex4', 'ex5'].map((k) => h('li', null, h('button', { type: 'button', class: 'to-chip', onclick: () => { els.input.value = T(k); state.domain = null; run(T(k), true); els.input.focus(); } }, T(k))))));
      wrap.append(h('h2', { id: 'to-title' }, T('title')), h('p', { class: 'to-intro' }, T('intro')), form, examples, els.status, els.results);
      root.append(wrap);
      els.wrap = wrap;
    }
    function essentials() {
      const list = (index.actions ?? []).filter((a) => a.plain && ['emergency', 'contact', 'report', 'appointment', 'account', 'track'].includes(a.id));
      return h('details', { class: 'to-essentials' }, h('summary', null, T('essentials')), h('p', { class: 'to-hint' }, T('essentialsNote')),
        h('ul', { class: 'to-list' }, list.map((a) => h('li', null, h('strong', null, pick(a, 'title')), ': ', lang === 'en' ? a.plain_en : a.plain))));
    }
    function showIdle() {
      els.results.replaceChildren(choices((index.actions ?? []).filter((a) => THEMES.includes(a.id)).map((a) => ({ kind: 'action', key: `action:${a.id}`, row: a })), T('themes')), essentials(), h('p', { class: 'to-hint' }, T('limits')));
      els.status.textContent = T('none');
    }
    function run(query, immediate) {
      void immediate;
      if (!alive || !engine) return;
      const mine = ++ticket;
      state.query = String(query ?? '').slice(0, MAX_QUERY);
      if (!state.query.trim()) { showIdle(); return; }
      // work is synchronous and bounded; the ticket still protects against a slower path (future server-backed index) overwriting a newer query
      const result = engine.rank(state.query, { domain: state.domain });
      if (!alive || mine !== ticket) return;
      els.results.replaceChildren();
      const shown = result.results.map((r, i) => ({ ...r, matched: r.matched, weak: !r.matched?.length }));
      if (result.emergency) {
        els.results.append(emergencyCard(result.emergency));
        els.status.textContent = `${T('emTitle')} ${emergencyPhone() ? T('emCall', { phone: emergencyPhone() }) : T('emNoNumber')}`;
        if (shown.length) els.results.append(h('details', { class: 'to-other' }, h('summary', null, T('emOther')), h('div', { class: 'to-grid' }, shown.map((r, i) => card(r, i)))));
        els.results.append(h('p', { class: 'to-hint' }, T('limits')));
        return;
      }
      if (!shown.length) {
        els.status.textContent = T('noMatch', { q: state.query });
        els.results.append(h('p', { class: 'to-nomatch' }, T('noMatch', { q: state.query }), ' ', T('noMatchHelp')),
          choices((index.actions ?? []).filter((a) => THEMES.includes(a.id)).map((a) => ({ kind: 'action', key: `action:${a.id}`, row: a })), T('themes')),
          fallbackCard(), h('p', { class: 'to-hint' }, T('limits')));
        return;
      }
      const name = (r) => (r.kind === 'place' ? pick(r.row, 'name') : pick(r.row, 'title'));
      els.status.textContent = T('count', { n: shown.length, q: state.query, first: name(shown[0]) });
      if (result.ambiguous) els.results.append(choices(result.choices, T('choose')));
      els.results.append(h('div', { class: 'to-grid' }, shown.map((r, i) => card(r, i))));
      els.results.append(fallbackCard(), h('p', { class: 'to-hint' }, T('limits')));
    }
    function boot() {
      build();
      if (state.loading) { els.status.textContent = T('loading'); return; }
      if (state.error) {
        els.results.append(h('p', { role: 'alert', class: 'to-error' }, T('loadError')), h('button', { type: 'button', class: 'to-button', onclick: load }, T('retry')));
        return;
      }
      if (state.query) run(state.query, true); else showIdle();
    }
    async function load() {
      state.loading = true; state.error = null; boot();
      try {
        const data = await api('/api/orientation/index');
        if (!alive) return;
        index = data; engine = createEngine(index, lang);
        state.loading = false;
      } catch (error) { if (!alive) return; state.loading = false; state.error = error; }
      boot();
    }
    if (index) boot(); else load();
    return {
      update(next) {
        if (next.user !== undefined) user = next.user;
        if (next.lang && next.lang !== lang) { lang = next.lang; if (index) engine = createEngine(index, lang); }
        if (alive) boot();
      },
      unmount() { alive = false; ticket++; clearTimeout(timer); root.replaceChildren(); },
    };
  }

  const api = { mount, engine: { createEngine, norm, tokenize, stem, distance, emergencyHit, GROUPS } };
  if (typeof window !== 'undefined') window.TerraOrientation = api;
  if (typeof globalThis !== 'undefined' && globalThis.__orientationExport) globalThis.__orientationExport(api);
})();
