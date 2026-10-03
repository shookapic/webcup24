// Session A world UI checks: PhoneScreen/PhoneFallback/useAnnouncements/WorldHud/AvatarEditor in jsdom, via Vite SSR transform.
// Needs jsdom, which is not a project dependency: npm i --no-save jsdom  (then: node tools/qa-a/<this file>)
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mock } from 'node:test';
import { JSDOM } from 'jsdom';

const project = fileURLToPath(new URL('../..', import.meta.url));
process.chdir(project);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/monde/', pretendToBeVisual: true });
const { window } = dom;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'localStorage', 'MutationObserver', 'getComputedStyle', 'KeyboardEvent', 'MouseEvent', 'Event', 'HTMLInputElement', 'HTMLDialogElement']) {
  if (!(key in globalThis) || key === 'navigator') Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no <dialog> behaviour.
window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

const req = createRequire(project + 'package.json');
const React = await import(pathToFileURL(req.resolve('react')).href).then((m) => m.default ?? m);
const { act } = React;
const { createRoot } = await import(pathToFileURL(req.resolve('react-dom/client')).href).then((m) => m.default ?? m);
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const vite = await createServer({ configFile: project + 'vite.config.js', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const phone = await vite.ssrLoadModule('/src/Phone.jsx');
const hud = await vite.ssrLoadModule('/src/ui/WorldHud.jsx');
const editor = await vite.ssrLoadModule('/src/AvatarEditor.jsx');
const storage = await vite.ssrLoadModule('/src/ui/storage.js');
const h = React.createElement;

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };

// ---------- fixtures ----------
const announcements = [
  { id: 3, title: 'Montée des eaux', body: 'Ligne un.\nLigne deux complète.', title_en: 'Rising water', body_en: 'Line one.\nLine two in full.', published_at: '2026-10-03 08:00:00', urgent: 1, audience: 'Quartier sud' },
  { id: 2, title: 'Chaleur extrême', body: 'Buvez de l’eau.', published_at: '2026-10-03 07:00:00', urgent: 1, audience: 'Personnes vulnérables' },
  { id: 1, title: 'Bienvenue', body: 'Premier paragraphe du message de bienvenue qui est assez long pour dépasser le résumé de cent dix caractères au total, oui.\nSecond paragraphe complet.', title_en: 'Welcome', body_en: 'Welcome text in English that is long enough to be shortened in the list view because it exceeds the limit.', published_at: '2026-10-01 09:00:00', urgent: 0, audience: 'Tous' },
];
const services = [
  { id: 1, title: 'Centre de santé', description: 'Consultations.', details: 'Rendez-vous par message.', featured: 1, title_en: 'Health centre', description_en: 'Consultations.', details_en: 'Book by message.' },
  { id: 2, title: 'Espace personnel', description: 'Vos démarches.', details: 'Créez un compte.', featured: 0 },
];
const lines = [
  { code: 'T1', name: 'Habitat ↔ Quartier sud', color: '#b8336a', status: 'perturbé', message: 'Montée des eaux : ralentissements.', stops: [{ name: 'Habitat', district: 'Quartier nord', next: ['10:00', '10:10', '10:20'] }, { name: 'Mairie', district: 'Centre-ville', next: ['10:04', '10:14', '10:24'] }, { name: 'Quartier sud', district: 'Quartier sud', next: ['10:08', '10:18', '10:28'] }] },
  { code: 'T2', name: 'Marché ↔ Santé', color: '#1d6fa5', status: 'normal', message: null, stops: [{ name: 'Marché', district: 'Quartier ouest', next: ['10:05'] }, { name: 'Mairie', district: 'Centre-ville', next: ['10:09', '10:24', '10:39'] }, { name: 'Santé', district: 'Quartier est', next: [] }] },
];

let root;
let container;
async function render(element) {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(element); });
}
const text = () => container.textContent;
const q = (selector) => container.querySelector(selector);
const qa = (selector) => [...container.querySelectorAll(selector)];
const clickEl = async (el) => act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
const press = async (key, target = document.activeElement || document.body, extra = {}) => act(async () => { target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })); });
const navButton = (label) => qa('.phone-nav button').find((b) => b.textContent.startsWith(label));

// ---------- PhoneScreen pages ----------
function Screen(props) {
  const [page, setPage] = React.useState(props.page ?? 'home');
  return h(phone.PhoneScreen, { announcements, services, transports: { lines, status: 'ready' }, nearestStop: 'Mairie', locale: 'fr', ...props, page, onPageChange: setPage });
}
await render(h(Screen));
check('home: alert count, nearest stop, latest news, portal link', text().includes('2 alertes en cours') && text().includes('Arrêt le plus proche') && text().includes('Mairie') && text().includes('10:04 · 10:14 · 10:24') && text().includes('Bienvenue') && q('a[href="/"]') !== null, text().slice(0, 300));
check('home: disrupted line flagged next to nearest stop', text().includes('Perturbé'));
check('semantics: nav, region, h2, aria-current', q('nav[aria-label]') && q('[role=region]') && q('h2') && navButton('Accueil').getAttribute('aria-current') === 'page');
check('no Canvas / fixed positioning inside the screen', !q('canvas') && !container.innerHTML.includes('position:fixed'));
await clickEl(navButton('Alertes'));
check('alerts page: full body (all paragraphs), audience, date, no truncation', text().includes('Ligne deux complète.') && text().includes('Public concerné : Quartier sud') && qa('.phone-alert').length === 2);
check('alerts page: focus moves to page title', document.activeElement === q('.phone-title'), document.activeElement?.className);
await clickEl(navButton('Actualités'));
check('news list shows only non-urgent with excerpt', qa('.phone-row').length === 1 && text().includes('…'));
await clickEl(q('.phone-row'));
check('news detail: full content + back', text().includes('Second paragraphe complet.') && text().includes('Retour aux actualités'));
await press('Escape');
check('Escape in detail goes back to the list (not close)', qa('.phone-row').length === 1);
await clickEl(navButton('Services'));
check('services: featured first, details expandable, portal handoffs', qa('.phone-card h3')[0].textContent.includes('Centre de santé') && qa('details').length === 2 && q('a[href="/#services"]') && q('a[href="/#message-form"]'));
const search = q('input[type=search]');
const typeInto = async (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
});
await typeInto(search, 'sante');
check('services search ignores accents', qa('article').length === 1 && q('.phone-count').textContent.includes('1 service trouvé'));
await typeInto(search, 'zzz');
check('services search: no results message', text().includes('Aucun service ne correspond'));
await clickEl(navButton('Transports'));
const cards = qa('.phone-line-card');
check('transports: both lines, nearest stop first in each, tag shown', cards.length === 2 && cards.every((c) => c.querySelector('.phone-stop').textContent.includes('Mairie') && c.querySelector('.phone-tag-nearest')), cards.map((c) => c.querySelector('.phone-stop').textContent).join('|'));
check('transports: line with nearest-stop first, departures + disruption text + empty departures', text().includes('10:04 · 10:14 · 10:24') && text().includes('Montée des eaux : ralentissements.') && text().includes('Pas de passage prévu'));
check('transports: line badge contrast colour set', qa('.phone-line').every((b) => b.style.color));

// nearest stop that is not Mairie → reorders lines
await render(h(Screen, { page: 'transports', nearestStop: { name: 'Santé' } }));
check('nearest stop Santé puts T2 first and Santé first inside it', qa('.phone-line-card')[0].textContent.includes('T2') && qa('.phone-line-card')[0].querySelector('.phone-stop').textContent.includes('Santé'));
await render(h(Screen, { page: 'transports', nearestStop: undefined }));
check('no nearest stop: no invented highlight', qa('.phone-tag-nearest').length === 0 && qa('.phone-line-card')[0].textContent.includes('T1'));

// English + fallback marking
await render(h(Screen, { page: 'alerts', locale: 'en' }));
check('English: translated chrome and content', text().includes('Active alerts') === false && text().includes('Rising water') && text().includes('Line two in full.') && text().includes('Audience: South district'), text().slice(0, 200));
check('English: untranslated alert marked FR (lang attr + tag)', qa('h3').some((x) => x.getAttribute('lang') === 'fr' && x.querySelector('[role=img]')) && qa('h3').some((x) => x.getAttribute('lang') === 'en'));
await render(h(Screen, { page: 'services', locale: 'en' }));
check('English services: translated + FR fallback for untranslated', text().includes('Health centre') && qa('[role=img]').length === 1);

const outage = [{ ...services[0], availability: 'unavailable', unavailable_reason: 'Maintenance du système', unavailable_reason_en: 'System maintenance', available_again: '2026-10-06T09:30', alternative: 'Écrivez aux services.', alternative_en: 'Write to the services.' }, services[1]];
await render(h(Screen, { page: 'services', services: outage }));
check('F38 phone: unavailable service shows reason, return time (as written, UTC+4 city time), alternative', text().includes('Service indisponible') && text().includes('Maintenance du système') && text().includes('Retour prévu') && text().includes('09:30') && text().includes('mardi 6 octobre 2026') && text().includes('Écrivez aux services.') && qa('.phone-unavailable').length === 1, text().slice(0, 300));
await render(h(Screen, { page: 'services', services: outage, locale: 'en' }));
check('F38 phone English: translated reason/alternative, no FR tag needed', text().includes('Service unavailable') && text().includes('System maintenance') && text().includes('Write to the services.') && text().includes('Tuesday, 6 October 2026'), text().slice(0, 300));

// ---------- F45 / F46: places ----------
const placeFixtures = [
  { id: 1, code: 'mairie', kind: 'service', name: 'Mairie', name_en: 'Town hall', district: 'Centre-ville', stop: 'Mairie', address: 'Place centrale.', address_en: 'Central square.', hours: 'Du lundi au vendredi', hours_en: 'Monday to Friday', open_24h: 0, phone: null },
  { id: 2, code: 'hopital', kind: 'hospital', name: 'Hôpital de Terra Nova', district: 'Quartier est', stop: 'Santé', address: 'Près de l’arrêt Santé.', open_24h: 1, phone: '112' },
  { id: 3, code: 'urgences', kind: 'emergency', name: 'Urgences de l’hôpital', district: 'Quartier est', stop: 'Santé', address: 'Entrée nord.', open_24h: 1, phone: '112' },
  { id: 4, code: 'secours', kind: 'emergency', name: 'Poste de secours du quartier sud', district: 'Quartier sud', stop: 'Quartier sud', address: 'Près des berges.', open_24h: 1, phone: '112' },
];
await render(h(Screen, { page: 'places', places: placeFixtures, nearestStop: 'Quartier sud' }));
const cardNames = () => qa('.phone-place h3').map((n) => n.textContent.replace(/FR$/, '').trim());
check('F45 phone: emergency first, hospital next, city services last; the one at the nearest stop leads its kind', cardNames().join('|') === 'Poste de secours du quartier sud|Urgences de l’hôpital|Hôpital de Terra Nova|Mairie', cardNames().join('|'));
check('F46 phone: "nearest" tag on the nearest-stop place only, as words', qa('.phone-tag-nearest').length === 1 && qa('.phone-place')[0].querySelector('.phone-tag-nearest').textContent === 'Le plus proche');
check('F46 phone: kind shown in words, 24 h opening, tram stop, and a call link', qa('.phone-place')[0].textContent.includes('Urgences') && text().includes('Ouvert 24 h sur 24') && text().includes('Arrêt de tram : Quartier sud') && q('a[href="tel:112"]')?.textContent === 'Appeler le 112');
check('F45 phone: the page has a search field and a labelled radio group (legend)', q('input[type=search]') !== null && qa('fieldset input[type=radio]').length === 3 && q('fieldset legend').textContent === 'Type de lieu');
await typeInto(q('input[type=search]'), 'hopital');
check('F45 phone: search ignores accents ("hopital" finds Hôpital and Urgences de l’hôpital)', cardNames().join('|') === 'Urgences de l’hôpital|Hôpital de Terra Nova' && q('.phone-count').textContent === '2 lieux trouvés.', cardNames().join('|'));
await typeInto(q('input[type=search]'), '');
await act(async () => { qa('fieldset input[type=radio]')[1].click(); });
check('F46 phone: the "Urgences et soins" filter hides city services', cardNames().length === 3 && !cardNames().includes('Mairie'));
await act(async () => { qa('fieldset input[type=radio]')[2].click(); });
check('F45 phone: the "Services" filter shows only city services', cardNames().join('|') === 'Mairie');
await render(h(Screen, { page: 'places', places: placeFixtures, nearestStop: 'Mairie', locale: 'en' }));
check('F45 phone English: translated names, hours and stop; untranslated places marked FR', text().includes('Town hall') && text().includes('Monday to Friday') && text().includes('Tram stop: Mairie') && qa('.phone-place [role=img]').length === 3 && text().includes('Places'), text().slice(0, 200));
await render(h(Screen, { page: 'places', places: { data: { places: [] }, status: 'error', retry: () => {} } }));
check('F45 phone: a failed load is said in words with a Retry button, never "no place published"', text().includes('Impossible de charger') && !text().includes('Aucun lieu publié') && q('.phone-note button') !== null);
await render(h(Screen, { page: 'places', places: { data: { places: [] }, status: 'ready' } }));
check('F45 phone: a loaded but empty list says so', text().includes('Aucun lieu publié pour le moment.'));
await render(h(Screen, { page: 'home', places: placeFixtures, nearestStop: 'Santé' }));
check('F46 phone home: emergency card answers first (call 112, closest care) without opening another page', text().includes('Urgence ?') && text().includes('Appelez le 112.') && text().includes('Soins les plus proches') && /Soins les plus proches : Urgences de l’hôpital — Arrêt de tram : Santé/.test(text()), text().slice(0, 400));
await clickEl(qa('.phone-emergency .phone-action')[0]);
check('F46 phone home: "Tous les lieux" opens the Places page', (await text()).includes('Type de lieu') || q('.phone-title').textContent === 'Lieux');
await render(h(Screen, { page: 'home', places: { data: { places: [] }, status: 'error' } }));
check('F46 phone home: the 112 line is still shown when places cannot load', text().includes('Appelez le 112.'));
check('F45 phone: six tabs including "Lieux", nothing else reordered', qa('.phone-nav button').map((b) => b.textContent.replace(/\d+$/, '')).join('|') === 'Accueil|Alertes|Actualités|Services|Lieux|Transports', qa('.phone-nav button').map((b) => b.textContent).join('|'));
const placeRequests = [];
globalThis.fetch = async (url) => { placeRequests.push(String(url)); return { ok: true, status: 200, json: async () => ({ places: placeFixtures }) }; };
await render(h(Screen, { page: 'places', nearestStop: 'Santé' }));
await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
check('F45 phone: with no places prop the screen loads them itself from /api/places (no host wiring needed)', placeRequests.some((u) => u.includes('/api/places')) && qa('.phone-place').length === 4, placeRequests.join());

// loading / error / stale / empty states are distinct
await render(h(Screen, { page: 'alerts', announcements: [], status: 'loading' }));
check('loading: not "no alerts"', text().includes('Chargement') && !text().includes('Aucune alerte en cours'));
let retried = 0;
await render(h(Screen, { page: 'alerts', announcements: [], status: 'error', onRetry: () => { retried++; } }));
check('initial failure: error + retry, never "no alerts"', text().includes('Impossible de charger') && !text().includes('Aucune alerte en cours'));
await clickEl(q('.phone-note button'));
check('retry callback called', retried === 1);
await render(h(Screen, { page: 'alerts', status: 'stale', lastUpdated: Date.UTC(2026, 9, 3, 8, 30), onRetry: () => {} }));
check('stale: keeps old alerts and says so', text().includes('Montée des eaux') && text().includes('Informations enregistrées'));
await render(h(Screen, { page: 'alerts', announcements: [], status: 'ready' }));
check('ready + none: explicit empty state', text().includes('Aucune alerte en cours.'));
await render(h(Screen, { page: 'transports', transports: { lines: [], status: 'error', retry: () => {} }, status: 'ready' }));
check('transport error is independent from announcement status', text().includes('Impossible de charger') && !text().includes('Aucune information de transport'));
await render(h(Screen, { page: 'transports', transports: { lines, status: 'stale', lastUpdated: Date.now() } }));
check('transport stale shows data + notice', text().includes('Informations enregistrées') && qa('.phone-line-card').length === 2);
await render(h(Screen, { page: 'transports', transports: undefined }));
check('transport not fetched yet → loading', text().includes('Chargement'));
await render(h(Screen, { page: 'home', announcements: [{ id: 'x' }, null, { id: 5, title: 'T', body: 'B', urgent: 0, published_at: 'garbage' }], services: 'nope', transports: { lines: [{ code: 'T9' }, { stops: 3 }], status: 'ready' } }));
check('malformed data does not crash', true);

// pending alerts take over, acknowledge only shown IDs, Escape acknowledges
let acked = null;
const pendingFor = (items) => ({ pendingAlerts: items, onAcknowledge: (ids) => { acked = ids; } });
await render(h(Screen, { ...pendingFor([announcements[0], announcements[1]]), page: 'home' }));
check('pending alerts: role=alert region with full text, nav hidden', q('[role=alert]') && text().includes('Ligne deux complète.') && !q('.phone-nav') && text().includes('Nouvelles alertes'));
await clickEl(q('.phone-ack'));
check('acknowledge passes exactly the shown IDs', JSON.stringify(acked) === '[3,2]', JSON.stringify(acked));
acked = null;
await press('Escape', q('.phone-screen'));
check('Escape acknowledges while alerts pending', JSON.stringify(acked) === '[3,2]');
let closed = 0;
await render(h(Screen, { onClose: () => { closed++; } }));
await press('Escape', q('.phone-screen'));
check('Escape closes when nothing pending / no detail', closed === 1);
await clickEl(q('.phone-close'));
check('Close button calls onClose', closed === 2);

// ---------- dialog fallback: focus entry / trap / return ----------
const opener = document.createElement('button');
opener.textContent = 'open';
document.body.append(opener);
opener.focus();
function Host() {
  const [open, setOpen] = React.useState(true);
  return h(phone.PhoneFallback, { open, onClose: () => setOpen(false), announcements, services, transports: { lines, status: 'ready' }, nearestStop: 'Mairie', locale: 'fr', page: 'home', onPageChange: () => {} });
}
await render(h(Host));
const dlg = q('[role=dialog]');
check('fallback dialog semantics', dlg && dlg.getAttribute('aria-modal') === 'true' && dlg.getAttribute('aria-label') === 'Téléphone');
check('fallback: focus enters the dialog', dlg.contains(document.activeElement), document.activeElement?.outerHTML?.slice(0, 80));
const focusables = [...dlg.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')];
focusables.at(-1).focus();
await press('Tab');
check('Tab from last wraps to first', dlg.contains(document.activeElement) && document.activeElement === focusables[0], document.activeElement?.outerHTML?.slice(0, 80));
await press('Tab', focusables[0], { shiftKey: true });
check('Shift+Tab from first wraps to last', document.activeElement === focusables.at(-1));
opener.focus();
await press('Tab');
check('focus that escaped is pulled back in', dlg.contains(document.activeElement));
await press('Escape');
check('Escape closes dialog and returns focus to opener', !q('[role=dialog]') && document.activeElement === opener, document.activeElement?.outerHTML?.slice(0, 60));

// legacy export still works with the old props
const requests = [];
globalThis.fetch = async (url) => { requests.push(String(url)); const body = String(url).includes('transports') ? { lines } : { services }; return { ok: true, status: 200, json: async () => body }; };
await render(h(phone.Phone, { open: true, alerts: [announcements[0]], announcements, onAcknowledge: () => {}, onClose: () => {} }));
await act(async () => { await Promise.resolve(); });
check('legacy <Phone> renders and fetches services + transports itself', q('[role=dialog]') && requests.some((r) => r.includes('/api/transports')) && requests.some((r) => r.includes('/api/services')), requests.join());

// ---------- useAnnouncements ----------
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
let calls = 0;
let fail = false;
let pendingResolve = null;
let hold = false;
let currentList = announcements;
globalThis.fetch = async () => {
  calls++;
  if (hold) await new Promise((resolve) => { pendingResolve = resolve; });
  if (fail) throw new TypeError('offline');
  return { ok: true, status: 200, json: async () => ({ announcements: currentList }) };
};
let api;
function Probe({ userId }) {
  api = phone.useAnnouncements({ userId });
  return null;
}
const flush = async () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const tick = async (ms) => { mock.timers.tick(ms); await flush(); };

localStorage.clear();
localStorage.setItem('world-seen-alerts:7', 'not json at all');
localStorage.setItem('world-seen-alerts:8', '{"a":1}');
localStorage.setItem('world-seen-alerts:9', JSON.stringify([2, 'x', null, 1.5, 99]));
await render(h(Probe, { userId: 7 }));
await flush();
check('hook: corrupt JSON storage does not crash, starts empty', api.status === 'ready' && api.unseen.length === 2, `${api.status} ${api.unseen.length}`);
await render(h(Probe, { userId: 8 }));
await flush();
check('hook: non-array storage tolerated', api.unseen.length === 2);
await render(h(Probe, { userId: 9 }));
await flush();
check('hook: only valid integer IDs kept (id 2 seen, others ignored)', api.unseen.map((a) => a.id).join() === '3', api.unseen.map((a) => a.id).join());
await render(h(Probe, { userId: 1 }));
await flush();
check('hook: unseen = urgent only, newest first', api.unseen.map((a) => a.id).join() === '3,2' && api.announcements.length === 3);
await act(async () => { api.acknowledge([3]); });
check('acknowledge([3]) hides only 3', api.unseen.map((a) => a.id).join() === '2');
check('acknowledged IDs persisted per user', JSON.parse(localStorage.getItem('world-seen-alerts:1')).join() === '3' && localStorage.getItem('world-seen-alerts:2') === null);
await render(h(Probe, { userId: 1 }));
await flush();
check('reload keeps acknowledgement', api.unseen.map((a) => a.id).join() === '2');
await render(h(Probe, { userId: 2 }));
await flush();
check('second user in same browser sees alert 3 again', api.unseen.map((a) => a.id).join() === '3,2');
await act(async () => { api.acknowledge(); });
check('acknowledge() without args (legacy) clears all unseen', api.unseen.length === 0);
function ReadyProbe({ userId, ready }) {
  api = phone.useAnnouncements({ userId, ready });
  return null;
}
await render(h(ReadyProbe, { userId: undefined, ready: false }));
await flush();
check('hook: ready=false reports no unseen alerts but keeps data', api.unseen.length === 0 && api.announcements.length === 3);
await act(async () => { root.render(h(ReadyProbe, { userId: 1, ready: true })); });
check('hook: ready=true then applies the user seen list (id 3 acknowledged for user 1)', api.unseen.map((a) => a.id).join() === '2');
await render(h(Probe, { userId: 2 }));
await flush();
await act(async () => { api.acknowledge(); });
// userId switches within one mounted component
await act(async () => { root.render(h(Probe, { userId: 1 })); });
check('switching userId swaps seen set without remount', api.unseen.map((a) => a.id).join() === '2');
// withdrawal + new arrival
currentList = [{ ...announcements[0], urgent: 0 }, announcements[1], { id: 4, title: 'Nouvelle', body: 'Corps de la nouvelle alerte.', urgent: 1, audience: 'Tous', published_at: '2026-10-03 09:00:00' }, announcements[2]];
await tick(15_000);
check('15 s poll: withdrawn alert gone, new urgent appears', api.unseen.map((a) => a.id).join() === '2,4', api.unseen.map((a) => a.id).join());
const before = calls;
await tick(14_000);
check('no extra request before 15 s', calls === before);
// failures: stale then recovery
fail = true;
await tick(15_000);
check('failure after data → stale, data kept, error set', api.status === 'stale' && api.announcements.length === 4 && api.error && api.lastUpdated, api.status);
fail = false;
await act(async () => { api.retry(); });
await flush();
check('retry recovers to ready', api.status === 'ready' && api.error === null);
// initial failure → error not empty
fail = true;
await render(h(Probe, { userId: 1 }));
await flush();
check('initial failure → status error with no data', api.status === 'error' && api.announcements.length === 0);
fail = false;
await act(async () => { api.retry(); });
await flush();
check('retry after initial failure loads data', api.status === 'ready' && api.announcements.length === 4);
// unmount during pending request: nothing scheduled, nothing set
hold = true;
await render(h(Probe, { userId: 1 }));
await flush();
const callsBeforeUnmount = calls;
await act(async () => { root.unmount(); });
hold = false;
pendingResolve?.();
await flush();
await tick(60_000);
check('unmount with request in flight: no reschedule, no further polling', calls === callsBeforeUnmount, `${calls} vs ${callsBeforeUnmount}`);
mock.timers.reset();

// ---------- HUD ----------
const spy = { phone: 0, view: 0, avatar: 0, help: 0 };
await render(h(hud.WorldHud, { locale: 'fr', view: 'tps', phoneOpen: false, unreadCount: 2, district: 'Centre-ville', onTogglePhone: () => spy.phone++, onToggleView: () => spy.view++, onEditAvatar: () => spy.avatar++, onToggleHelp: () => spy.help++ }));
const btn = (label) => qa('button').find((b) => b.textContent.includes(label));
check('HUD: labeled controls (no icon-only)', ['Téléphone', 'Vue 1re personne', 'Mon colon', 'Aide'].every((l) => btn(l)) && q('a[href="/"]').textContent.includes('Version accessible'));
check('HUD: district block + unread badge with accessible text', text().includes('Centre-ville') && text().includes('2 alerte(s) non lue(s)'));
check('HUD: phone button exposes aria-expanded', btn('Téléphone').getAttribute('aria-expanded') === 'false');
for (const label of ['Téléphone', 'Vue 1re', 'Mon colon', 'Aide']) await clickEl(btn(label));
check('HUD: callbacks fire', spy.phone === 1 && spy.view === 1 && spy.avatar === 1 && spy.help === 1);
await render(h(hud.WorldHud, { locale: 'en', view: 'fps', phoneOpen: true, onTogglePhone: () => {} }));
check('HUD: English, view label flips, optional controls omitted, portal link kept', text().includes('Third-person view') === false && !btn('Help') && btn('Phone').getAttribute('aria-expanded') === 'true' && q('a[href="/"]').textContent.includes('Accessible version'));
let keyHandled = false;
window.addEventListener('keydown', () => { keyHandled = true; });
check('HUD registers no key listener of its own (nothing to observe on render)', !keyHandled);

// ---------- Avatar editor ----------
const apiCalls = [];
let saveFails = true;
globalThis.fetch = async (url, options) => {
  apiCalls.push([String(url), options?.method]);
  if (saveFails) return { ok: false, status: 500, json: async () => ({ error: 'Erreur interne.' }) };
  const body = JSON.parse(options.body);
  return { ok: true, status: 200, json: async () => ({ avatar: body }) };
};
const saved = { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' };
let state = saved;
let closedEditor = 0;
function Editor() {
  const [avatar, setAvatar] = React.useState(saved);
  const [open, setOpen] = React.useState(true);
  state = avatar;
  return h(editor.AvatarEditor, { open, avatar, onChange: setAvatar, onClose: () => { closedEditor++; setOpen(false); }, locale: 'fr', preview: h('p', { id: 'prev' }, 'APERCU') });
}
await render(h(Editor));
check('editor: preview slot rendered', q('#prev') !== null);
const color = qa('input[type=color]')[0];
await act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(color, '#112233');
  color.dispatchEvent(new window.Event('input', { bubbles: true }));
  color.dispatchEvent(new window.Event('change', { bubbles: true }));
});
check('editor: colour change updates avatar live', state.skin === '#112233', JSON.stringify(state));
await act(async () => { q('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
await flush();
check('editor: save failure stays open, visible role=alert message', q('dialog').hasAttribute('open') && q('[role=alert]')?.textContent.includes('Enregistrement impossible') && closedEditor === 0, q('.avatar-status')?.outerHTML);
check('editor: buttons re-enabled after failure', !qa('button').some((b) => b.disabled));
let keyReached = false;
window.addEventListener('keydown', () => { keyReached = true; }, { once: true });
await press('w', q('dialog'));
check('editor: keystrokes do not reach game key handlers', keyReached === false);
await clickEl(qa('button').find((b) => b.textContent === 'Annuler'));
check('editor: cancel restores saved colours and closes', state.skin === '#e0ac69' && closedEditor === 1, JSON.stringify(state));
saveFails = false;
await render(h(Editor));
await act(async () => {
  const c = qa('input[type=color]')[1];
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(c, '#445566');
  c.dispatchEvent(new window.Event('input', { bubbles: true }));
  c.dispatchEvent(new window.Event('change', { bubbles: true }));
});
await act(async () => { q('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
await flush();
check('editor: successful save PUTs the avatar and closes', apiCalls.some(([u, m]) => u === '/api/me/avatar' && m === 'PUT') && state.outfit === '#445566' && closedEditor === 2);

await vite.close();
console.log(failures ? `\n${failures} FAILED` : '\nall world UI checks passed');
process.exit(failures ? 1 : 0);
