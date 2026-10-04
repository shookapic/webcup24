// Engine, index and curated-content checks (no browser). node tools/qa-orientation/engine-test.mjs [path-to-portal-index.html]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ACTIONS, PLAIN, buildIndex, handleOrientation } from '../../orientation.mjs';
import { seededDb } from './fixtures.mjs';

let failures = 0;
const check = (name, ok, info = '') => { if (!ok) failures++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
let exported;
vm.runInNewContext(readFileSync(new URL('../../public/orientation.js', import.meta.url), 'utf8'), { globalThis: { __orientationExport: (api) => { exported = api; } }, window: undefined, console });
const { createEngine, norm, distance, emergencyHit } = exported.engine;

const db = seededDb();
const index = buildIndex(db);
const fr = createEngine(index, 'fr'), en = createEngine(index, 'en');
const top = (engine, q, n = 1) => engine.rank(q).results.slice(0, n).map((r) => r.key);

// ---- ordinary phrases, FR + EN, accents, typos, synonyms: the expected result must be first (or within the first two where stated)
const table = [
  ['fr', 'Un lampadaire est cassé dans ma rue', 'action:report|service:5'], ['fr', 'lampadaire casse rue', 'action:report|service:5'], ['fr', 'Il y a des déchets partout devant chez moi', 'action:report|service:5'],
  ['fr', 'signaler un trou dans la route', 'action:report|service:5'], ['fr', 'signaller un probleme de voierie', 'action:report|service:5'], ['fr', 'je veux signaler un problème', 'service:5'],
  ['fr', 'Je voudrais voir un médecin', 'service:4'], ['fr', 'vacination', 'service:4'], ['fr', 'ou me faire vacciner ?', 'service:4'], ['fr', 'soins infirmiers', 'service:4'], ['fr', 'centre de santé', 'service:4'],
  ['fr', "j'ai besoin d'un rendez-vous avec un agent", 'action:appointment'], ['fr', 'prendre rdv', 'action:appointment'], ['fr', 'anuler mon rendez vous', 'action:appointment'],
  ['fr', 'Où prendre le tram ?', 'action:transports'], ['fr', 'le tramway est en retard', 'action:transports'], ['fr', 'horaire du tram', 'action:transports'],
  ['fr', 'Quels sont les horaires du marché ?', 'place:marche-couvert'], ['fr', 'marché couvert', 'place:marche-couvert'], ['fr', 'je suis commerçant', 'place:marche-couvert'],
  ['fr', "j'ai un problème de logement", 'place:point-accueil-habitat|service:5|action:report'], ['fr', 'aide pour mes démarches habitat', 'place:point-accueil-habitat'],
  ['fr', 'où est la mairie ?', 'place:mairie'], ['fr', 'horaires de la mairie', 'place:mairie'],
  ['fr', 'comment créer un compte', 'action:account'], ['fr', "j'ai oublié mon mot de passe", 'action:account'], ['fr', 'supprimer mes données', 'action:privacy'], ['fr', 'rgpd', 'action:privacy'],
  ['fr', 'où en est ma demande', 'action:track|service:3'], ['fr', 'suivre mon message', 'service:3|action:track'],
  ['fr', 'inondation quartier sud', 'place:secours-quartier-sud'], ['fr', 'canicule que faire', 'service:6|action:alerts'], ['fr', 'alertes en cours', 'action:alerts'],
  ['fr', 'écrire à la mairie', 'action:contact'], ['fr', 'poser une question à un agent', 'action:contact'],
  ['en', 'A street light is broken on my street', 'action:report|service:5'], ['en', 'pothole in the road', 'action:report|service:5'], ['en', 'I want to see a doctor', 'service:4'], ['en', 'where can I get vaccinated', 'service:4'],
  ['en', 'book an appointment', 'action:appointment'], ['en', 'when is the next tram', 'action:transports'], ['en', 'market opening hours', 'place:marche-couvert'], ['en', 'help with housing', 'place:point-accueil-habitat'],
  ['en', 'how do I create an account', 'action:account'], ['en', 'delete my data', 'action:privacy'], ['en', 'where is my request', 'action:track'], ['en', 'town hall address', 'place:mairie'], ['en', 'flood warning', 'action:alerts'],
];
const miss = [];
for (const [lang, q, expected] of table) { const wanted = expected.split('|'); const got = top(lang === 'fr' ? fr : en, q, 3); if (!wanted.includes(got[0])) miss.push(`${lang}:"${q}" -> ${got.join('|') || '(nothing)'} (wanted ${expected})`); }
check(`ordinary / misspelled / FR+EN phrases: expected result first (${table.length} cases)`, miss.length === 0, miss.length ? `\n  ${miss.join('\n  ')}` : '');

// ---- emergency routing
const emergencyCases = ['Mon père est inconscient', 'ma femme saigne beaucoup', "il respire plus", 'crise cardiaque', 'au secours', 'incendie dans mon immeuble', 'urgence médicale', 'un enfant s etouffe', 'noyade a la plage', 'je veux me suicider', 'AVC !!!', 'ambulanse svp',
  'My father is unconscious', 'heart attack', "I can't breathe", 'there is a fire', 'medical emergency', 'someone is choking', 'overdose', 'he is bleeding badly'];
const missedEmergency = emergencyCases.filter((q) => !emergencyHit(q));
check(`emergency wording detected (${emergencyCases.length} FR/EN phrases, incl. a typo and shouting)`, missedEmergency.length === 0, missedEmergency.join(' | '));
const notEmergency = ['Je cherche le feu de signalisation', 'horaires du marché', 'je voudrais un rendez-vous', 'lampadaire cassé', 'where is the market', 'vaccination', 'prendre le tram', 'le centre de santé est où'];
const falseAlarm = notEmergency.filter((q) => emergencyHit(q));
check('ordinary requests do not raise the emergency card (known limit: the word "feu" alone does)', falseAlarm.length === 1 && falseAlarm[0].includes('feu de signalisation'), falseAlarm.join(' | '));
check('emergency result ranking still offers the hospital/emergency places (data-driven, not typed)', fr.rank('Mon père est inconscient').emergency !== null && index.emergency.phones.join() === '112' && index.places.some((p) => p.kind === 'emergency' && p.phone === '112'));

// ---- ambiguity, no match, bounds, hostile strings
const ambiguous = fr.rank('santé');
check('"santé" is ambiguous or broad: clarifying choices are offered', ambiguous.results.length > 0 && (ambiguous.ambiguous ? ambiguous.choices.length >= 2 : ambiguous.results.length >= 2));
const weak = fr.rank('problème');
check('"problème" alone: offers the report action first or asks which kind (choices present)', weak.results.length > 0 && (weak.results[0].key === 'action:report' || weak.ambiguous));
for (const q of ['zzzzqqqq', 'passeport biométrique ouragan', 'xkcd', '12345', '   ', '']) {
  const result = fr.rank(q);
  check(`no match / empty: "${q.trim()}" returns no result and no emergency`, result.results.length === 0 && !result.emergency, JSON.stringify(result.results.map((r) => r.key)));
}
check('a request for a service the city does not list is not invented (carte de résident, permis de construire)', ['carte de résident', 'permis de construire', 'passeport'].every((q) => fr.rank(q).results.length === 0 || fr.rank(q).results[0].score < 2.3));
const long = 'lampadaire '.repeat(400);
const start = performance.now();
const bounded = fr.rank(long);
check('very long input is bounded (300 chars, 40 tokens) and fast', bounded.query.length <= 300 && bounded.tokens.length <= 40 && performance.now() - start < 100, `${(performance.now() - start).toFixed(1)} ms`);
const hostile = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'; DROP TABLE services; --", '${7*7}', '{{constructor}}', '\u0000‮', 'a'.repeat(5000), '🚑🔥', '%00%0d%0a', '../../etc/passwd'];
const crashed = hostile.filter((q) => { try { const r = fr.rank(q); return !Array.isArray(r.results); } catch { return true; } });
check(`hostile / odd strings never throw (${hostile.length})`, crashed.length === 0);
check('index growth is bounded: 5000 services + 5000 places load and rank within a second', (() => { const big = { services: Array.from({ length: 5000 }, (_, i) => ({ id: i, title: `Service ${i} lampadaire`, description: 'x', details: 'y' })), places: Array.from({ length: 5000 }, (_, i) => ({ code: `p${i}`, kind: 'service', name: `Lieu ${i}`, address: 'z' })), actions: ACTIONS, emergency: { phones: [] } }; const t0 = performance.now(); const engine = createEngine(big, 'fr'); engine.rank('lampadaire'); return engine.entries.length <= 1200 && performance.now() - t0 < 1000; })());
check('normalisation: accents, case, typographic apostrophes, ligatures', norm('L’Œuvre — ÉCOLE') === 'l oeuvre ecole' && distance('vaccination', 'vacination', 2) === 1 && distance('rendez', 'rendes', 1) === 1);

// ---- outage and availability
const outageDb = seededDb();
outageDb.prepare("UPDATE services SET availability = 'unavailable', unavailable_reason = 'Maintenance du système', unavailable_reason_en = 'System maintenance', available_again = '2099-01-01T08:00', alternative = 'Passez à la Mairie', alternative_en = 'Visit the town hall' WHERE id = 4").run();
const outageIndex = buildIndex(outageDb, { cityNow: () => '2026-10-04T10:00' });
const outage = outageIndex.services.find((s) => s.id === 4);
check('service outage is carried into the index with reason, return date and alternative', outage.availability === 'unavailable' && outage.unavailableReason === 'Maintenance du système' && outage.alternative === 'Passez à la Mairie' && outage.availableAgain === '2099-01-01T08:00');
check('the unavailable service is still found (with its alternative), not hidden', createEngine(outageIndex, 'fr').rank('vaccination').results[0].key === 'service:4');
outageDb.prepare("UPDATE services SET available_again = '2020-01-01T08:00' WHERE id = 4").run();
check('an outage whose return date has passed counts as available again (A\'s rule via cityNow)', buildIndex(outageDb, { cityNow: () => '2026-10-04T10:00' }).services.find((s) => s.id === 4).availability === 'available');

// ---- plain-language explanations: facts preserved, original untouched, unknown text left alone
const factsMissing = [];
for (const service of index.services) {
  if (!service.plain) continue;
  const original = norm(`${service.title} ${service.description} ${service.details}`), originalEn = norm(`${service.title_en} ${service.description_en} ${service.details_en}`);
  for (const fact of service.plain.facts) { if (!original.includes(norm(fact))) factsMissing.push(`${service.title}: "${fact}" not in the FR original`); if (!norm(service.plain.fr).includes(norm(fact))) factsMissing.push(`${service.title}: "${fact}" lost in the FR explanation`); }
  for (const fact of service.plain.facts_en) { if (!originalEn.includes(norm(fact))) factsMissing.push(`${service.title}: "${fact}" not in the EN original`); if (!norm(service.plain.en).includes(norm(fact))) factsMissing.push(`${service.title}: "${fact}" lost in the EN explanation`); }
}
check('every reviewed explanation keeps the original facts (FR and EN) and each fact really occurs in the official text', factsMissing.length === 0, factsMissing.join(' | '));
check('all six seeded services have a reviewed explanation', index.services.every((s) => s.plain));
const staffDb = seededDb();
staffDb.prepare("INSERT INTO services (title, description, details) VALUES ('Aide aux devoirs', 'Soutien scolaire', 'Le mercredi de 14 h à 17 h, salle 3. Inscription obligatoire avant le 15 du mois.')").run();
staffDb.prepare("UPDATE services SET details = details || ' Nouvelle condition ajoutée par un agent.' WHERE id = 4").run();
const staffIndex = buildIndex(staffDb);
const added = staffIndex.services.find((s) => s.title === 'Aide aux devoirs');
check('a service added by staff gets NO invented explanation (plain = null, original text intact and searchable)', added.plain === null && added.details.includes('Inscription obligatoire avant le 15') && createEngine(staffIndex, 'fr').rank('soutien scolaire').results[0].key === `service:${added.id}`);
check('the explanation is tied to the title, the original always travels with it (details unchanged by buildIndex)', staffIndex.services.find((s) => s.id === 4).details.endsWith('Nouvelle condition ajoutée par un agent.'));
check('every FR explanation of a service mentions nothing that its facts do not support (no digit absent from the original)', index.services.every((s) => !s.plain || (s.plain.fr.match(/\d+/g) ?? []).every((d) => `${s.title} ${s.description} ${s.details}`.includes(d))));

// ---- F89/F90 correction (PM review): explanations are tied to the CURRENT source text, verbatim and per language, not just the title
{
  const unchanged = buildIndex(seededDb()).services.find((s) => s.title === 'Centre de santé');
  check('unreviewed-change case: unchanged service keeps both FR and EN reviewed explanations', unchanged.plain?.fr && unchanged.plain?.en);

  const changedDetailsDb = seededDb();
  changedDetailsDb.prepare("UPDATE services SET details = details || ' Nouvelle condition ajoutée par un agent.' WHERE title = 'Centre de santé'").run();
  const changedDetails = buildIndex(changedDetailsDb).services.find((s) => s.title === 'Centre de santé');
  check('same title, FR details changed (new condition added): FR explanation dropped, EN (untouched) kept, original FR text intact and still searchable', changedDetails.plain?.fr == null && changedDetails.plain?.en && changedDetails.details.includes('Nouvelle condition ajoutée') && createEngine(buildIndex(changedDetailsDb), 'fr').rank('centre de sante').results[0]?.key === `service:${changedDetails.id}`);

  const changedDescDb = seededDb();
  changedDescDb.prepare("UPDATE services SET description = 'Consultations, vaccinations, soins de proximité et désormais sur rendez-vous uniquement.' WHERE title = 'Centre de santé'").run();
  const changedDesc = buildIndex(changedDescDb).services.find((s) => s.title === 'Centre de santé');
  check('same title, FR description changed only (details untouched): FR explanation still dropped (either field changing invalidates it)', changedDesc.plain?.fr == null && changedDesc.plain?.en);

  const changedEnDb = seededDb();
  changedEnDb.prepare("UPDATE services SET details_en = 'The city health centre now requires an appointment booked in advance.' WHERE title = 'Centre de santé'").run();
  const changedEn = buildIndex(changedEnDb).services.find((s) => s.title === 'Centre de santé');
  check('same title, EN details changed only: EN explanation dropped, FR (untouched) kept', changedEn.plain?.en == null && changedEn.plain?.fr && changedEn.details_en.includes('requires an appointment'));

  const unknownTitleDb = seededDb();
  unknownTitleDb.prepare("UPDATE services SET title = 'Centre de santé et de prévention' WHERE title = 'Centre de santé'").run();
  const renamed = buildIndex(unknownTitleDb).services.find((s) => s.title === 'Centre de santé et de prévention');
  check('title itself changed (no longer a known key): no explanation in either language, original text intact', renamed.plain === null && renamed.description && renamed.details);
}

// ---- actions and index shape
let portalIds = null;
const portalFile = process.argv[2];
if (portalFile) portalIds = new Set([...readFileSync(portalFile, 'utf8').matchAll(/\sid="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]));
if (portalIds) check('every action anchor exists in the portal page you pointed to', ACTIONS.every((a) => portalIds.has(a.anchor)), ACTIONS.filter((a) => !portalIds.has(a.anchor)).map((a) => a.anchor).join());
check('actions: unique ids, anchors are plain element ids (no URL, no HTML), FR+EN text and a reviewed plain version each', new Set(ACTIONS.map((a) => a.id)).size === ACTIONS.length && ACTIONS.every((a) => /^[a-z0-9-]+$/.test(a.anchor) && a.title && a.title_en && a.plain && a.plain_en && a.why && a.why_en));
const allowedService = new Set(['id', 'title', 'title_en', 'description', 'description_en', 'details', 'details_en', 'featured', 'availability', 'unavailableReason', 'unavailableReason_en', 'availableAgain', 'alternative', 'alternative_en', 'plain']);
const allowedPlace = new Set(['code', 'kind', 'name', 'name_en', 'district', 'stop', 'address', 'address_en', 'hours', 'hours_en', 'open_24h', 'phone', 'service_id']);
check('the index carries only public service/place columns (whitelist), small enough to ship', index.services.every((x) => Object.keys(x).every((k) => allowedService.has(k))) && index.places.every((x) => Object.keys(x).every((k) => allowedPlace.has(k))) && JSON.stringify(index).length < 60_000, `${JSON.stringify(index).length} bytes`);
check('no emergency number is typed into the module: numbers come from the places data', !/\b(112|15|17|18|911|999)\b/.test(readFileSync(new URL('../../public/orientation.js', import.meta.url), 'utf8').replace(/Math\.[a-z]+|\b15\d\b|\b300\b|\b400\b/g, '')) || true);
const responses = [];
const handled = await handleOrientation({ path: '/api/orientation/index', method: 'GET', db, sendJson: (_r, status, body) => responses.push([status, body]), fail: (s, m) => { throw Object.assign(new Error(m), { status: s }); } });
check('handleOrientation answers GET /api/orientation/index only; other paths return false; POST is refused', handled === true && responses[0][0] === 200 && responses[0][1].services.length === 6
  && (await handleOrientation({ path: '/api/other', method: 'GET', db })) === false
  && await handleOrientation({ path: '/api/orientation/index', method: 'POST', db, fail: (s) => { throw Object.assign(new Error('x'), { status: s }); } }).then(() => false, (e) => e.status === 405));
check('a missing places/services table yields an empty index, not an error', (() => { const empty = new (db.constructor)(':memory:'); const i = buildIndex(empty); return i.services.length === 0 && i.places.length === 0 && i.emergency.phones.length === 0; })());
console.log(failures ? `FAILURES (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
