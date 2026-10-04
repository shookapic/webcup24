const $ = (selector) => document.querySelector(selector);
const statusLabels = { new: 'À traiter', in_progress: 'En cours', resolved: 'Résolu' };
let user = null;
let feed = null;
let knownCodes = null;
let loadingFeed = false;
let services = [];
let transports = [];
let messageCount = 0;
let alertsKey = null;
let knownAlerts = null;
const memoryPreferences = new Map();

function preference(key, value) {
  if (value !== undefined) memoryPreferences.set(key, String(value));
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return memoryPreferences.get(key) || null;
  }
}

let lang = preference('lang') === 'en' ? 'en' : 'fr';

// The English dictionary (about 60 KB) is fetched only when English is wanted. French visitors never download it.
// Resolves true when the page can be shown in the wanted language, false when English was wanted but the dictionary could not be loaded (the caller then
// goes back to French, so the lang attribute, the toggle and the visible text always agree).
let englishLoading = null;
function ensureEnglish() {
  if (lang !== 'en' || Object.keys(english).length) return Promise.resolve(true);
  englishLoading ||= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = '/i18n-en.js';
    script.onload = () => { if (!Object.keys(english).length) englishLoading = null; resolve(Object.keys(english).length > 0); };
    script.onerror = () => { englishLoading = null; script.remove(); resolve(false); }; // the next switch tries again
    document.head.append(script);
  });
  return englishLoading;
}
// Said in both languages: the person asked for English and cannot read this in French as easily. Clears itself.
let languageNoticeTimer = null;
function showLanguageFailure() {
  const notice = $('#lang-status');
  const inFrench = element('span', '', 'L’anglais n’a pas pu être chargé : la page reste en français. Appuyez sur « English » pour réessayer.');
  inFrench.lang = 'fr';
  const inEnglish = element('span', '', ' English could not be loaded: the page stays in French. Press “English” to try again.');
  inEnglish.lang = 'en';
  notice.replaceChildren(inFrench, inEnglish);
  notice.hidden = false;
  clearTimeout(languageNoticeTimer);
  languageNoticeTimer = setTimeout(() => { notice.hidden = true; notice.replaceChildren(); }, 15_000);
}

// Translate a French interface string; {name} placeholders are filled from vars.
function t(text, vars = {}) {
  const value = lang === 'en' ? english[text] ?? text : text;
  return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

function translateError(message) {
  const range = /^(.+) doit contenir entre (\d+) et (\d+) caractères\.$/.exec(message);
  if (range && range[1] !== 'Le mot de passe') return t('{label} doit contenir entre {min} et {max} caractères.', { label: t(range[1]), min: range[2], max: range[3] });
  if (range) return t('Le mot de passe doit contenir entre {min} et {max} caractères.', { min: range[2], max: range[3] });
  const wait = /^Trop de tentatives\. Réessayez dans (\d+) min\.$/.exec(message);
  if (wait) return t('Trop de tentatives. Réessayez dans {n} min.', { n: wait[1] });
  const quota = /^(.+\.) Réessayez dans (\d+) min\.$/.exec(message);
  if (quota) return t('{reason} Réessayez dans {n} min.', { reason: t(quota[1]), n: quota[2] });
  return t(message);
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

// F59: on a slow or cut connection the page says so, shows when the data was last good, and offers a retry; it recovers by itself.
let lastGoodAt = null;
let connectionLost = false;
function showConnection() {
  const banner = $('#connection-banner');
  banner.hidden = !connectionLost;
  if (!connectionLost) return banner.replaceChildren();
  const time = lastGoodAt ? new Date(lastGoodAt).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
  const retry = element('button', '', t('Réessayer maintenant'));
  retry.type = 'button';
  retry.addEventListener('click', () => refreshAll());
  banner.replaceChildren(element('strong', '', `${t('Connexion lente ou coupée')} · `), `${time ? t('Ce que vous voyez peut ne pas être à jour (dernière mise à jour : {time}).', { time }) : t('Les informations ne sont pas encore chargées.')} `, retry);
}
function setConnection(lost) {
  if (!lost) lastGoodAt = Date.now();
  if (lost === connectionLost) return;
  connectionLost = lost;
  showConnection();
}

// A refresh that fails must never replace data that is already on screen. A list that loaded once keeps its last good content and a status line
// above it says that it may be out of date and since when; only a list that never loaded shows the error in its place.
function noticeBefore(list) {
  const previous = list.previousElementSibling;
  return previous?.classList.contains('stale-notice') ? previous : null;
}
function markFresh(list) {
  list.dataset.loadedAt = String(Date.now());
  noticeBefore(list)?.remove();
}
function forgetLoaded(list) {
  delete list.dataset.loadedAt;
  noticeBefore(list)?.remove();
}
function listFailed(list, error) {
  if (!list.dataset.loadedAt) return list.replaceChildren(element(list.tagName === 'UL' ? 'li' : 'p', 'list-empty', error.message));
  const time = new Date(Number(list.dataset.loadedAt)).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });
  let notice = noticeBefore(list);
  if (!notice) {
    notice = element('p', 'stale-notice');
    notice.setAttribute('role', 'status');
    list.before(notice);
  }
  notice.textContent = `⚠ ${t('Erreur :')} ${error.message} ${t('La liste affichée date de {time} et peut ne pas être à jour.', { time })}`;
}

// F81 / F82: forms that create records carry a signed single-use token (asked for when the person starts using the form, so it is old enough by the time
// they have typed) and a hidden field a person never sees. A send that is "too fast" (autofill) is retried by itself, an expired token is replaced, and the
// same form sent twice is answered once by the server (it says "déjà reçue" instead of creating a second record).
const formTokens = new Map();
function formToken(name) {
  if (!formTokens.has(name)) {
    const pending = api(`/api/forms/token?form=${name}`).then((data) => data.token);
    formTokens.set(name, pending);
    pending.catch(() => formTokens.delete(name));
  }
  return formTokens.get(name);
}
function warmFormToken(name) {
  formToken(name).catch(() => {});
}
async function guardedSend(name, form, send) {
  for (let attempt = 0; ; attempt++) {
    const token = await formToken(name);
    try {
      const data = await send({ form_token: token, fax_ref: form.elements.fax_ref?.value || '' });
      formTokens.delete(name);
      return data;
    } catch (error) {
      if (attempt >= 2) throw error;
      if (error.code === 'form-too-fast') {
        await new Promise((resolve) => setTimeout(resolve, (error.retryAfterMs || 1000) + 150));
        continue;
      }
      if (error.code === 'form-expired') {
        formTokens.delete(name);
        continue;
      }
      throw error;
    }
  }
}

async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    setConnection(true);
    throw Object.assign(new Error(t('Connexion lente ou coupée. Réessayez dans un instant.')), { status: 0, network: true });
  }
  setConnection(false);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(translateError(data.error || 'Une erreur est survenue.')), { status: response.status, retryAfter: data.retryAfter, retryAfterMs: data.retryAfterMs, code: data.code, attemptsLeft: data.attemptsLeft, field: fieldsOf(data.error || '') });
  if (method !== 'GET') auditSoon();
  return data;
}

// Which form field a server message is about, so the field can be marked and focused (F42). Candidates: first one in the form wins.
const fieldByLabel = {
  'Le nom': ['name'], 'L’adresse e-mail': ['email'], 'Le mot de passe': ['password'], 'Le sujet': ['subject'], 'Le message': ['body', 'message'], 'Le lieu': ['location'],
  'Le titre': ['title'], 'La description': ['description'], 'Les informations': ['details'], 'Le contenu': ['body'], 'Le quartier': ['district'],
  'Le public concerné': ['audience'], 'Le motif': ['reason'], 'L’alternative': ['alternative'], 'Les consignes': ['instructions'],
  'La date de retour': ['until'], 'La date ou l’heure': ['date', 'start'], 'L’adresse': ['address'], 'Les horaires': ['hours'],
};
function fieldsOf(message) {
  const range = /^(.+?) (?:doit contenir|est invalide)/.exec(message);
  if (range && fieldByLabel[range[1]]) return fieldByLabel[range[1]];
  if (message === 'Identifiants incorrects.' || message === 'Mot de passe incorrect.') return ['password'];
  if (/^Adresse e-mail invalide|^Cette adresse est déjà/.test(message)) return ['email'];
  return undefined;
}

function formValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() || '';
}

function passwordValue(form) {
  return new FormData(form).get('password')?.toString() || '';
}

// Results always start with a word or sign, never colour alone: "Erreur :" for problems, a tick for successes.
function setFormStatus(selector, message, error = false) {
  const target = $(selector);
  target.closest('form')?.removeAttribute('aria-busy');
  target.dataset.error = String(error);
  if (!message) {
    target.textContent = '';
    return;
  }
  const cue = element('span', 'status-cue', error ? '⚠ ' : '✓ ');
  cue.setAttribute('aria-hidden', 'true');
  target.replaceChildren(cue, error ? `${t('Erreur :')} ${message}` : message);
}

// A failed submission: say what is wrong, mark the exact field, tie it to the message and put focus there.
function reportError(selector, error, message = error.message) {
  setFormStatus(selector, message, true);
  const status = $(selector);
  const form = status.closest('form');
  const name = (error.field || []).find((candidate) => form?.elements[candidate]);
  const field = name && form.elements[name];
  if (field?.setAttribute) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', [...new Set([...(field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean), status.id])].join(' '));
    field.focus();
    return;
  }
  status.tabIndex = -1;
  status.focus();
}
document.addEventListener('input', (event) => {
  const field = event.target;
  if (field.getAttribute?.('aria-invalid') !== 'true') return;
  field.removeAttribute('aria-invalid');
  const rest = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && !id.endsWith('-status'));
  if (rest.length) field.setAttribute('aria-describedby', rest.join(' '));
  else field.removeAttribute('aria-describedby');
});
// "Sending…" is announced as soon as a form is submitted, and the form is marked busy until the result replaces it.
document.addEventListener('submit', (event) => {
  const form = event.target;
  const status = form.querySelector?.('.form-status');
  if (!status) return;
  // A second submit while the first is still in flight (a slow link invites it) is ignored, so nothing is sent twice. A stuck form frees itself after 25 s.
  if (form.getAttribute('aria-busy') === 'true' && Date.now() - Number(form.dataset.busySince || 0) < 25_000) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  form.dataset.busySince = String(Date.now());
  form.setAttribute('aria-busy', 'true');
  status.dataset.error = 'false';
  status.textContent = t('Envoi en cours…');
}, true);

// Case- and accent-insensitive, so "sante" finds "Santé".
function fold(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr');
}

function renderServices() {
  const query = fold($('#service-search').value.trim());
  const shown = services.filter((service) => fold(`${service.title} ${service.description} ${service.details}`).includes(query));
  const list = $('#services-list');
  list.replaceChildren();
  for (const service of shown) {
    const card = element('article', service.featured ? 'service-card service-featured' : 'service-card');
    // Services without an English version stay in French, marked so screen readers pronounce them right.
    const translated = lang === 'en' && service.title_en;
    if (lang === 'en' && !translated) card.lang = 'fr';
    card.append(element('span', 'service-number', service.featured ? t('À la une') : String(service.id).padStart(2, '0')));
    if (service.availability === 'unavailable') card.append(element('strong', 'availability-badge', t('Indisponible')));
    card.append(element('h3', '', translated ? service.title_en : service.title));
    card.append(element('p', 'service-description', translated ? service.description_en || service.description : service.description));
    card.append(element('p', 'service-details', translated ? service.details_en || service.details : service.details));
    const notice = availabilityNotice(service);
    if (notice) {
      card.classList.add('service-unavailable');
      card.append(notice);
    }
    if (user?.role === 'citizen') {
      const ask = element('button', 'feature-button', t('Faire une demande'));
      ask.type = 'button';
      ask.setAttribute('aria-label', t('Faire une demande : {title}', { title: translated ? service.title_en : service.title }));
      ask.addEventListener('click', () => startRequest(service));
      card.append(ask);
    }
    if (user?.role === 'admin') {
      const toggle = element('button', 'feature-button', t(service.featured ? 'Retirer de la une' : 'Mettre à la une'));
      toggle.lang = lang;
      toggle.type = 'button';
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          await api(`/api/services/${service.id}`, 'PATCH', { featured: !service.featured });
          await loadServices();
        } catch (error) {
          alert(error.message);
          toggle.disabled = false;
        }
      });
      card.append(toggle, historyButton('service', service.id, translated ? service.title_en : service.title));
    }
    list.append(card);
  }
  $('#services-status').textContent = !services.length ? t('Aucun service publié pour le moment.')
    : !shown.length ? t('Aucun service ne correspond à votre recherche.')
    : query ? t(shown.length > 1 ? '{n} services trouvés.' : '{n} service trouvé.', { n: shown.length }) : '';
}

async function loadServices() {
  try {
    ({ services } = await api('/api/services'));
    renderServices();
    renderServiceOptions();
  } catch (error) {
    $('#services-status').textContent = error.message;
  }
}

async function loadNews() {
  try {
    // Announcements without an English version stay in French, marked so screen readers pronounce them right.
    const announcements = (await api('/api/announcements')).announcements.map((item) =>
      lang === 'en' && item.title_en ? { ...item, title: item.title_en, body: item.body_en || item.body, lang: 'en' } : { ...item, lang: 'fr' });
    renderAlerts(announcements.filter((item) => item.urgent));
    const list = $('#news-list');
    list.replaceChildren();
    for (const item of announcements) {
      const card = element('article', item.urgent ? 'news-card news-urgent' : 'news-card');
      const date = item.published_at ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long' }).format(new Date(`${item.published_at.replace(' ', 'T')}Z`)) : '';
      if (item.urgent) card.append(element('strong', 'news-badge', t('Alerte en cours')));
      card.append(element('time', 'news-date', date));
      const title = element('h3', '', item.title);
      const body = element('p', '', item.body);
      title.lang = body.lang = item.lang;
      card.append(title, element('p', 'news-audience', t('Public concerné : {audience}', { audience: t(item.audience) })), body);
      if (item.urgent && user?.role === 'admin') {
        const lift = element('button', 'lift-button', t('Lever l’alerte'));
        lift.type = 'button';
        lift.addEventListener('click', () => {
          const form = reasonForm({
            prompt: t('Pourquoi lever cette alerte ? Le motif est conservé dans le journal.'), confirmLabel: t('Confirmer : lever l’alerte'), danger: true,
            onConfirm: async (reason) => { await api(`/api/announcements/${item.id}`, 'PATCH', { urgent: false, reason }); await loadNews(); },
            onCancel: () => { form.replaceWith(lift); lift.focus(); },
          });
          lift.replaceWith(form);
        });
        card.append(lift);
      }
      list.append(card);
    }
    $('#news-status').textContent = announcements.length ? '' : t('Aucune actualité publiée pour le moment.');
  } catch (error) {
    $('#news-status').textContent = error.message;
  }
}

function renderAlerts(alerts) {
  const fresh = knownAlerts ? alerts.filter((item) => !knownAlerts.has(item.id)) : [];
  knownAlerts = new Set(alerts.map((item) => item.id));
  if ('Notification' in window && Notification.permission === 'granted') {
    for (const item of fresh) new Notification(t('Alerte Terra Nova · {audience}', { audience: t(item.audience) }), { body: item.title, tag: `alerte-${item.id}` });
  }
  // Only touch the live region when the alerts change, so screen readers don't repeat them every refresh.
  const key = alerts.map((item) => item.id).join();
  if (key === alertsKey) return;
  alertsKey = key;
  $('#alert-banner').replaceChildren(...alerts.map((item) => {
    const box = element('div', 'alert-item');
    box.lang = item.lang;
    box.append(Object.assign(element('p', 'alert-label', t('Alerte · {audience}', { audience: t(item.audience) })), { lang }), element('p', 'alert-title', item.title), element('p', 'alert-body', item.body));
    return box;
  }));
}

function renderNotifyButton() {
  const button = $('#notify-button');
  if (!('Notification' in window)) return;
  button.hidden = false;
  button.disabled = Notification.permission !== 'default';
  button.textContent = t(({ granted: 'Alertes activées sur cet appareil ✓', denied: 'Notifications bloquées par le navigateur' })[Notification.permission] || 'Me prévenir des alertes');
}
$('#notify-button').addEventListener('click', async () => {
  await Notification.requestPermission();
  renderNotifyButton();
});
renderNotifyButton();

async function loadTransports() {
  try {
    ({ lines: transports } = await api('/api/transports'));
    $('#transports-status').textContent = '';
    renderTransports();
    renderPlaces();
  } catch (error) {
    $('#transports-status').textContent = error.message;
  }
}

// Lines and stops in the user's district come first, so their next trams need no browsing.
function renderTransports() {
  const mine = (stop) => Boolean(user?.district) && stop.district === user.district;
  $('#transports-hint').hidden = user?.role !== 'citizen' || Boolean(user.district);
  const list = $('#transports-list');
  list.replaceChildren();
  for (const line of [...transports].sort((a, b) => b.stops.some(mine) - a.stops.some(mine))) {
    const card = element('article', 'transport-card');
    const head = element('div', 'transport-head');
    const code = element('span', 'transport-code', line.code);
    code.style.background = line.color;
    head.append(code, element('h3', '', line.name));
    card.append(head);
    if (line.status === 'perturbé') {
      const notice = element('p', 'transport-disrupted');
      const message = element('span', '', ` ${line.message || ''}`);
      message.lang = 'fr';
      notice.append(element('strong', '', t('Perturbé :')), message);
      card.append(notice);
    } else {
      card.append(element('p', 'transport-normal', t('Trafic normal')));
    }
    const stops = element('ul', 'transport-stops');
    for (const stop of [...line.stops].sort((a, b) => mine(b) - mine(a))) {
      const item = element('li', mine(stop) ? 'transport-stop transport-mine' : 'transport-stop');
      item.append(element('strong', '', stop.name));
      if (mine(stop)) item.append(element('span', 'transport-badge', t('Votre quartier')));
      item.append(element('span', 'transport-next', t('Prochains passages : {times}', { times: stop.next.join(' · ') })));
      stops.append(item);
    }
    card.append(stops);
    list.append(card);
  }
  const select = $('#traffic-form').elements.code;
  if (!select.options.length) {
    for (const line of transports) select.append(Object.assign(element('option', '', `${line.code} · ${line.name}`), { value: line.code }));
    fillTrafficForm();
  }
}

function fillTrafficForm() {
  const form = $('#traffic-form');
  const line = transports.find((item) => item.code === form.elements.code.value);
  if (!line) return;
  form.elements.status.value = line.status;
  form.elements.message.value = line.message || '';
}
$('#traffic-form').elements.code.addEventListener('change', fillTrafficForm);
$('#traffic-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api(`/api/transports/${form.elements.code.value}`, 'PATCH', { status: form.elements.status.value, message: formValue(form, 'message') });
    setFormStatus('#traffic-status', t('Info trafic mise à jour.'));
    await loadTransports();
  } catch (error) {
    reportError('#traffic-status', error);
  }
});

function renderIdentity() {
  $('#guest-area').hidden = Boolean(user);
  $('#member-area').hidden = !user;
  $('#citizen-area').hidden = user?.role !== 'citizen';
  $('#staff-area').hidden = !['agent', 'admin'].includes(user?.role);
  $('#admin-area').hidden = user?.role !== 'admin';
  for (const link of document.querySelectorAll('.admin-only')) link.hidden = user?.role !== 'admin';
  renderGuide();
  renderTips();
  renderNotices(true);
  renderDashboard();
  fillTopicSelects();
  renderFactors();
  renderStaffConcerns();
  renderPublic();
  renderDevices();
  updateDocumentLinks();
  loadConcerns();
  renderPlaces();
  renderEmergency();
  renderTransports();
  if (!user) return;
  $('#member-name').textContent = user.name;
  $('#member-role').textContent = t(({ citizen: 'Espace citoyen', agent: 'Espace agent', admin: 'Administration' })[user.role]);
  $('#profile-form').elements.name.value = user.name;
  $('#profile-form').elements.district.value = user.district || '';
}

function renderGuide() {
  const show = user?.role === 'citizen' && preference(`guideDone:${user.id}`) !== 'true';
  $('#guide').hidden = !show;
  if (!show) return;
  for (const [selector, done] of [['#guide-profile', Boolean(user.district)], ['#guide-request', messageCount > 0]]) {
    $(selector).dataset.done = String(done);
    $(`${selector} .guide-check`).textContent = done ? t('✓ Fait') : '';
  }
}
$('#guide-dismiss').addEventListener('click', () => {
  preference(`guideDone:${user.id}`, 'true');
  renderGuide();
  $('#member-name').focus();
});

function clearIdentity() {
  user = null;
  mountParticipation();
  messageCount = 0;
  feed = null;
  knownCodes = null;
  $('#citizen-messages').replaceChildren();
  $('#staff-messages').replaceChildren();
  $('#requests-list').replaceChildren();
  for (const list of [$('#citizen-messages'), $('#staff-messages'), $('#dashboard-todo')]) forgetLoaded(list);
  formTokens.clear();
  drafts.clear();
  securityState = null;
  factorsView = { mode: 'status' };
  passkeysView = { mode: 'list' };
  $('#access-code-notice').hidden = true;
  $('#passkeys-body').replaceChildren();
  $('#identity-line').textContent = '';
  $('#factors-body').replaceChildren();
  $('#factors-state').textContent = '';
  citizens = [];
  pendingDelete = null;
  pendingCitizen = null;
  audit = { entries: [], next: null, facets: null };
  auditTarget = null;
  renderAudit();
  notices = [];
  devices = [];
  deviceConfirm = null;
  staffConcerns = [];
  publicRequests = [];
  mySupports = [];
  publishOpen = null;
  for (const key of Object.keys(publishDrafts)) delete publishDrafts[key];
  noticeKey = null;
  dashboard = null;
  for (const id of ['#notices-list', '#devices-list', '#public-list', '#supports-list', '#concerns-list', '#staff-concerns', '#notice-banner', '#dashboard-todo', '#dashboard-tiles', '#dashboard-recent']) $(id).replaceChildren();
  $('#notice-banner').hidden = true;
  $('#dashboard-time').textContent = '';
  $('#citizens-list').replaceChildren();
  $('#citizens-secret').hidden = true;
  slots = [];
  appointments = [];
  staffSlots = [];
  security = null;
  pendingCancel = pendingStaffCancel = null;
  $('#appointment-confirmation').hidden = true;
  $('#security-notice').hidden = true;
  renderSlotSelect();
  renderMyAppointments();
  renderStaffSlots();
  renderReminders(true);
  renderIdentity();
  loadNews();
  renderServices();
}

// F79: every request has a theme (the same list for the form, the cards and the filters; names come from the server in both languages). Requests sent before
// themes existed have none and are shown as "Non précisé".
let topics = [];
const topicLabel = (code) => { const topic = topics.find((item) => item.code === code); return topic ? topic[lang === 'en' ? 'en' : 'fr'] : t('Non précisé'); };
const topicMatches = (item, wanted) => !wanted || (wanted === 'none' ? !item.topic : item.topic === wanted);
function fillTopicSelects() {
  const fill = (selector, first) => {
    const select = $(selector);
    const previous = select.value;
    select.replaceChildren(...(first ? [first] : []), ...topics.map((item) => new Option(item[lang === 'en' ? 'en' : 'fr'], item.code)));
    if (!first) { select.value = previous && topics.some((item) => item.code === previous) ? previous : 'autre'; return; }
    if (select !== $('#public-filter-topic')) select.append(new Option(t('Thème non précisé'), 'none'));
    select.value = [...select.options].some((option) => option.value === previous) ? previous : '';
  };
  fill('#message-topic');
  for (const selector of ['#staff-filter-topic', '#mine-filter-topic', '#public-filter-topic']) fill(selector, new Option(t('Tous les thèmes'), ''));
}
async function loadTopics() {
  try { topics = (await api('/api/topics')).topics; } catch { topics = []; }
  fillTopicSelects();
}

// F80: agents classify requests by priority (internal: residents never see it). A badge says it in words and with a symbol, never by colour alone.
const priorityLabels = { urgent: 'Urgente', high: 'Prioritaire', normal: 'Normale' };
const priorityRank = { urgent: 0, high: 1, normal: 2 };
// F75: groups of requests that talk about the same problem (computed by the server for staff). `groupFilter` is the group the list is narrowed to, if any.
let staffGroups = [];
let groupFilter = null;
let groupSignature = '';
const groupWords = (group) => group.shared.length ? t('Mots communs : {words}', { words: group.shared.join(', ') }) : '';
const groupSummary = (group) => t(group.open === group.size ? '{n} demandes similaires' : '{n} demandes similaires, dont {open} non résolues', { n: group.size, open: group.open });
function showGroup(group) {
  groupFilter = group.id;
  $('#staff-filter-status').value = '';
  $('#staff-filter-priority').value = '';
  $('#staff-filter-topic').value = '';
  $('#staff-filter-similar').value = '';
  renderMessages(staffMessages);
  $('#staff-messages-panel').focus();
}
function clearGroup() {
  groupFilter = null;
  renderMessages(staffMessages);
  $('#similar-panel button')?.focus();
}
function renderSimilar() {
  const focusedGroup = document.activeElement?.dataset?.showGroup;
  const note = $('#similar-note');
  const current = groupFilter && staffGroups.find((group) => group.id === groupFilter);
  if (groupFilter && !current) groupFilter = null;
  note.replaceChildren();
  if (current) {
    note.append(document.createTextNode(`${t('Affichage du groupe « {subject} » : {n} demandes similaires.', { subject: current.subject, n: current.size })} `));
    const clear = element('button', 'link-button', t('Afficher toutes les demandes'));
    clear.type = 'button';
    clear.addEventListener('click', clearGroup);
    note.append(clear);
  }
  const open = staffGroups.filter((group) => group.open >= 2).slice(0, 8);
  const signature = JSON.stringify(open.map((group) => [group.id, group.size, group.open, group.shared, group.topic]).concat([lang]));
  $('#similar-panel').hidden = !open.length;
  if (signature === groupSignature) return; // the block is only rebuilt when its content changed, so keyboard focus is not lost every 30 seconds
  groupSignature = signature;
  $('#similar-list').replaceChildren(...open.map((group) => {
    const line = element('li', 'notice-item similar-item');
    line.append(element('strong', '', groupSummary(group)));
    const detail = [group.topic ? t('Thème : {topic}', { topic: topicLabel(group.topic) }) : null, t(group.residents === 1 ? 'envoyées par 1 habitant' : 'envoyées par {n} habitants', { n: group.residents }), t('Exemple : « {subject} »', { subject: group.subject }), groupWords(group)].filter(Boolean).join(' · ');
    line.append(element('span', '', detail));
    const button = element('button', 'button', t('Voir ces demandes'));
    button.type = 'button';
    button.dataset.showGroup = group.id;
    button.setAttribute('aria-label', t('Voir les {n} demandes similaires : « {subject} »', { n: group.size, subject: group.subject }));
    button.addEventListener('click', () => showGroup(group));
    line.append(button);
    return line;
  }));
  if (focusedGroup) $(`[data-show-group="${focusedGroup}"]`)?.focus();
}

const priorityBadge = (priority) => element('span', `message-priority priority-${priority}`, `${priority === 'urgent' ? '⚠' : '▲'} ${t(priorityLabels[priority])}`);

// F50: the staff list can be narrowed by state, type and the resident's profile district; the dashboard numbers open it already filtered.
let staffMessages = [];
let citizenMessages = [];
const staffFilter = () => ({ status: $('#staff-filter-status').value, kind: $('#staff-filter-kind').value, district: $('#staff-filter-district').value, reply: $('#staff-filter-reply').value, topic: $('#staff-filter-topic').value, priority: $('#staff-filter-priority').value, similar: $('#staff-filter-similar').value });
const staffMatches = (item, { status, kind, district, reply, topic, priority, similar }) => (!groupFilter || item.group === groupFilter) && (!similar || item.group) && (!status || (status === 'open' ? item.status !== 'resolved' : item.status === status)) && (!priority || item.priority === priority) && (!kind || item.kind === kind) && (!district || (district === 'none' ? !item.citizen_district : item.citizen_district === district))
  && (!reply || (reply === 'none' ? !(item.replies || []).length : (item.replies || []).length > 0)) && topicMatches(item, topic);
for (const id of ['#staff-filter-status', '#staff-filter-kind', '#staff-filter-district', '#staff-filter-reply', '#staff-filter-topic', '#staff-filter-priority', '#staff-sort', '#staff-filter-similar']) $(id).addEventListener('change', () => renderMessages(staffMessages));
for (const id of ['#mine-filter-topic', '#mine-filter-status']) $(id).addEventListener('change', () => renderMessages(citizenMessages));
$('#public-filter-topic').addEventListener('change', renderPublic);
$('#public-sort').addEventListener('change', renderPublic);

// Stored times are UTC; the city lives at UTC+4 and the receipts, the summary and the journal say so, so the cards say the same.
function cityTime(utc) {
  const date = new Date(`${String(utc).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return String(utc || '');
  const city = new Date(date.getTime() + 4 * 3600_000);
  const pad = (n) => String(n).padStart(2, '0');
  return t('{date} à {time} (heure de la cité)', { date: `${pad(city.getUTCDate())}/${pad(city.getUTCMonth() + 1)}/${city.getUTCFullYear()}`, time: `${pad(city.getUTCHours())}:${pad(city.getUTCMinutes())}` });
}
// F83: the receipt of a request (a page to read, print or save), opened in a new tab and announced as such.
function receiptLink(id) {
  const link = element('a', 'receipt-link', t('Accusé de réception (à imprimer ou enregistrer)'));
  link.href = `/api/messages/${id}/receipt?lang=${lang}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.append(element('span', 'visually-hidden', ` ${t('(s’ouvre dans un nouvel onglet)')}`));
  return link;
}
// F84: one answer of the town hall (residents read "la ville", staff read who wrote it).
function replyBox(reply, staffView) {
  const box = element('div', 'reply');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t('Réponse de la ville'));
  box.append(element('p', 'reply-head', `${staffView ? t('Réponse de {author}', { author: reply.author }) : t('Réponse de la ville')} · ${cityTime(reply.created_at)}`), element('p', 'reply-text', reply.body));
  return box;
}
// A half-written answer or note survives the list being rebuilt (every poll, every filter change): drafts are kept by request and field, and the focus and
// the caret come back where they were.
const drafts = new Map();
function keepDraft(field, key) {
  field.dataset.draft = key;
  field.value = drafts.get(key) || '';
  field.addEventListener('input', () => drafts.set(key, field.value));
}
const focusSnapshot = () => {
  const active = document.activeElement;
  return active?.dataset?.draft ? { key: active.dataset.draft, start: active.selectionStart, end: active.selectionEnd } : null;
};
function restoreFocus(snapshot) {
  if (!snapshot) return;
  const field = document.querySelector(`[data-draft="${CSS.escape(snapshot.key)}"]`);
  if (!field) return;
  field.focus();
  try { field.setSelectionRange(snapshot.start, snapshot.end); } catch { /* not a text field */ }
}

function renderMessages(messages) {
  const staff = ['agent', 'admin'].includes(user?.role);
  const list = staff ? $('#staff-messages') : $('#citizen-messages');
  const snapshot = focusSnapshot();
  list.replaceChildren();
  messageCount = messages.length;
  renderGuide();
  if (staff) $('#pending-count').textContent = t('{n} à traiter', { n: messages.filter((item) => item.status === 'new').length });
  if (staff) { staffMessages = messages; renderSimilar(); } else citizenMessages = messages;
  const shown = staff ? messages.filter((item) => staffMatches(item, staffFilter()))
    : messages.filter((item) => topicMatches(item, $('#mine-filter-topic').value) && (!$('#mine-filter-status').value || item.status === $('#mine-filter-status').value));
  if (!messages.length) {
    list.append(element('p', 'list-empty', t(staff ? 'Aucun message reçu pour le moment.' : 'Vous n’avez pas encore envoyé de message.')));
    return;
  }
  if (!shown.length) {
    list.append(element('p', 'list-empty', t('Aucun message ne correspond à ces filtres.')));
    return;
  }
  const priority = { new: 0, in_progress: 1, resolved: 2 };
  const order = staff ? $('#staff-sort').value : '';
  // Staff: by default what is not resolved comes first, most urgent first, then by state and the newest; "recent" and "oldest" sort by date only.
  const byPriority = (a, b) => (a.status === 'resolved') - (b.status === 'resolved') || priorityRank[a.priority || 'normal'] - priorityRank[b.priority || 'normal'] || priority[a.status] - priority[b.status] || b.id - a.id;
  const groupSize = (item) => (item.group ? staffGroups.find((group) => group.id === item.group)?.size || 1 : 1);
  const byGroup = (a, b) => groupSize(b) - groupSize(a) || (a.group || a.id) - (b.group || b.id) || b.id - a.id;
  const sorter = !staff ? (a, b) => priority[a.status] - priority[b.status] || b.id - a.id : order === 'group' ? byGroup : order === 'recent' ? (a, b) => b.id - a.id : order === 'oldest' ? (a, b) => a.id - b.id : byPriority;
  for (const item of [...shown].sort(sorter)) {
    const card = element('article', 'message-card');
    const heading = element('div', 'message-heading');
    heading.append(element('h4', '', item.subject));
    const badges = element('span', 'message-badges');
    if (staff && item.priority && item.priority !== 'normal' && item.status !== 'resolved') badges.append(priorityBadge(item.priority));
    badges.append(element('span', `message-status status-${item.status}`, t(statusLabels[item.status] || item.status)));
    heading.append(badges);
    card.append(heading);
    card.append(element('p', 'message-kind', t(item.kind === 'incident' ? 'Signalement de problème' : 'Message aux services')));
    card.append(element('p', 'message-topic', t('Thème : {topic}', { topic: topicLabel(item.topic) })));
    if (item.service_title) card.append(element('p', 'message-service', t('Service concerné : {title}', { title: (lang === 'en' && item.service_title_en) || item.service_title })));
    const ownGroup = staff && item.group ? staffGroups.find((group) => group.id === item.group) : null;
    if (ownGroup) {
      const row = element('p', 'message-similar', `${groupSummary(ownGroup)}. `);
      if (groupFilter !== ownGroup.id) {
        const see = element('button', 'link-button', t('Voir ces demandes'));
        see.type = 'button';
        see.setAttribute('aria-label', t('Voir les {n} demandes similaires : « {subject} »', { n: ownGroup.size, subject: ownGroup.subject }));
        see.addEventListener('click', () => showGroup(ownGroup));
        row.append(see);
      }
      card.append(row);
    }
    if (staff) card.append(element('p', 'message-author', `${item.citizen_name} · ${item.citizen_email}`));
    if (item.location) card.append(element('p', 'message-location', t('Lieu : {location}', { location: item.location })));
    card.append(element('p', 'message-body', item.body));
    if (!staff) {
      const order = ['new', 'in_progress', 'resolved'];
      const labels = ['Demande reçue', 'En cours de traitement', 'Résolue'];
      const current = order.indexOf(item.status);
      const steps = element('ol', 'status-steps');
      steps.setAttribute('aria-label', t('Avancement de la demande'));
      labels.forEach((label, index) => {
        const step = element('li', index < current || (index === current && current === 2) ? 'step-done' : index === current ? 'step-current' : '', `${index < current || (index === current && current === 2) ? '✓ ' : ''}${t(label)}`);
        if (index === current) step.setAttribute('aria-current', 'step');
        steps.append(step);
      });
      card.append(steps);
      for (const reply of item.replies || []) card.append(replyBox(reply, false));
      const receiptRow = element('p', 'receipt-row');
      receiptRow.append(receiptLink(item.id));
      card.append(receiptRow);
    }
    card.dataset.message = item.id;
    if (staff && item.public_id) card.append(element('p', 'message-public', t(item.support_count === 1 ? 'Publié pour les habitants : 1 soutien.' : 'Publié pour les habitants : {n} soutiens.', { n: item.support_count })));
    if (!staff && item.kind === 'incident') card.append(publicControls(item));
    card.append(element('p', 'message-reference', t('Référence {reference}', { reference: item.reference || `M-${item.id}` })));
    card.append(element('p', 'message-dates', t('Reçu le {created} · Dernière mise à jour le {updated}', { created: cityTime(item.created_at), updated: cityTime(item.updated_at) })));
    if (staff) {
      const label = element('label', 'status-field', t('État '));
      const select = element('select');
      select.setAttribute('aria-label', t('État du message {id}', { id: item.id }));
      for (const [value, title] of Object.entries(statusLabels)) {
        const option = element('option', '', t(title));
        option.value = value;
        select.append(option);
      }
      select.value = item.status;
      const noteField = element('label', 'status-field', t('Message pour l’habitant (facultatif) '));
      const note = element('input');
      note.maxLength = 300;
      note.setAttribute('aria-label', t('Message pour l’habitant, demande {id}', { id: item.id }));
      keepDraft(note, `note:${item.id}`);
      noteField.append(note);
      const failure = element('p', 'status-failure');
      failure.setAttribute('role', 'alert');
      failure.hidden = true;
      select.addEventListener('change', async () => {
        failure.hidden = true;
        select.disabled = true;
        try {
          await api(`/api/messages/${item.id}`, 'PATCH', note.value.trim() ? { status: select.value, note: note.value.trim() } : { status: select.value });
          drafts.delete(`note:${item.id}`);
          await loadMessages();
        } catch (error) {
          if (error.status === 401) return clearIdentity();
          // The server did not take the change: the selector goes back to the state the city really holds, the typed note is kept, and the failure
          // is said next to the control (not in a dialog).
          select.value = item.status;
          select.disabled = false;
          failure.textContent = `⚠ ${t('Erreur :')} ${t('Le changement d’état n’a pas été enregistré : {error}', { error: error.message })} ${t('L’état affiché est celui que la ville a enregistré.')}`;
          failure.hidden = false;
          select.focus();
        }
      });
      label.append(select);
      const priorityLabel = element('label', 'status-field', t('Priorité '));
      const prioritySelect = element('select');
      prioritySelect.dataset.priorityFor = item.id;
      prioritySelect.setAttribute('aria-label', t('Priorité de la demande {id}', { id: item.id }));
      for (const [value, title] of Object.entries(priorityLabels)) {
        const option = element('option', '', t(title));
        option.value = value;
        prioritySelect.append(option);
      }
      prioritySelect.value = item.priority || 'normal';
      prioritySelect.addEventListener('change', async () => {
        failure.hidden = true;
        prioritySelect.disabled = true;
        try {
          await api(`/api/messages/${item.id}/priority`, 'PUT', { priority: prioritySelect.value });
          setFormStatus('#staff-reply-status', t('Priorité de la demande {reference} : {priority}.', { reference: `M-${item.id}`, priority: t(priorityLabels[prioritySelect.value]).toLowerCase() }));
          await loadMessages();
          document.querySelector(`[data-priority-for="${item.id}"]`)?.focus();
        } catch (error) {
          if (error.status === 401) return clearIdentity();
          prioritySelect.value = item.priority || 'normal';
          prioritySelect.disabled = false;
          failure.textContent = `⚠ ${t('Erreur :')} ${t('La priorité n’a pas été enregistrée : {error}', { error: error.message })} ${t('La priorité affichée est celle que la ville a enregistrée.')}`;
          failure.hidden = false;
          prioritySelect.focus();
        }
      });
      priorityLabel.append(prioritySelect);
      card.append(label, priorityLabel, noteField, failure);
      // F84: answer the resident directly; the state of the request does not change.
      for (const reply of item.replies || []) card.append(replyBox(reply, true));
      const replyField = element('label', 'status-field', t('Répondre directement à l’habitant '));
      const answer = element('textarea');
      answer.rows = 3;
      answer.maxLength = 2000;
      answer.setAttribute('aria-label', t('Réponse à l’habitant, demande {id}', { id: item.id }));
      keepDraft(answer, `reply:${item.id}`);
      replyField.append(answer);
      const sendReply = element('button', 'button', t('Envoyer la réponse'));
      sendReply.type = 'button';
      sendReply.addEventListener('click', async () => {
        const body = answer.value.trim();
        if (!body) {
          setFormStatus('#staff-reply-status', t('Écrivez d’abord la réponse.'), true);
          answer.focus();
          return;
        }
        sendReply.disabled = true;
        try {
          await api(`/api/messages/${item.id}/replies`, 'POST', { body });
          drafts.delete(`reply:${item.id}`);
          setFormStatus('#staff-reply-status', t('Réponse envoyée à l’habitant (demande {reference}). L’état de la demande n’a pas changé.', { reference: item.reference || `M-${item.id}` }));
          await loadMessages();
          document.querySelector(`[data-draft="reply:${item.id}"]`)?.focus();
        } catch (error) {
          if (error.status === 401) return clearIdentity();
          setFormStatus('#staff-reply-status', error.message, true);
          sendReply.disabled = false;
          answer.focus();
        }
      });
      card.append(replyField, sendReply);
    }
    list.append(card);
  }
  restoreFocus(snapshot);
}

// ---- F49: notices. The server writes one for the owner when a request really changes state; we poll and show them.
// No e-mail or SMS exists: they appear on the page and, if the person opted in with the alerts button, as a browser notification.
let notices = [];
let noticeKey = null;
const noticeLines = {
  'message.in_progress': ['Votre demande « {label} » est en cours de traitement.', 'Vous n’avez rien à faire pour le moment.'],
  'message.resolved': ['Votre demande « {label} » est résolue.', 'Si le problème persiste, envoyez-nous un nouveau message.'],
  'message.reply': ['La ville a répondu à votre demande « {label} ».', 'Lisez la réponse dans « Mes messages » ou ci-dessous.'],
  'message.new': ['Votre demande « {label} » est de nouveau à traiter.', 'Vous n’avez rien à faire : un agent la reprendra.'],
  'public.in_progress': ['La demande « {label} » que vous soutenez est en cours de traitement.', 'Vous n’avez rien à faire. Merci de votre soutien.'],
  'public.resolved': ['La demande « {label} » que vous soutenez est résolue.', 'Merci de votre soutien.'],
  'public.new': ['La demande « {label} » que vous soutenez est de nouveau à traiter.', 'Vous n’avez rien à faire.'],
  'device.new': ['Connexion à votre compte depuis un nouvel appareil : {label}.', 'Si c’était vous, il n’y a rien à faire. Sinon, retirez cet appareil dans « Mes appareils » : ses connexions sont fermées. Les services municipaux peuvent aussi changer votre mot de passe.'],
  'security.recovery_used': ['Un code de secours a servi à vous connecter. Il vous en reste {label}.', 'Si ce n’était pas vous, changez votre mot de passe et générez de nouveaux codes dans « Sécurité de mon compte ».'],
  'security.2fa_off': ['La vérification en deux étapes de votre compte a été désactivée.', 'Si ce n’était pas vous, changez votre mot de passe et réactivez-la dans « Sécurité de mon compte ».'],
  'security.password_changed': ['Le mot de passe de votre compte a été changé.', 'Si ce n’était pas vous, contactez les services municipaux.'],
  'security.passkey_added': ['Une clé d’accès a été ajoutée à votre compte : {label}.', 'Si ce n’était pas vous, retirez-la dans « Sécurité de mon compte » et changez votre mot de passe.'],
  'security.passkey_removed': ['Une clé d’accès a été retirée de votre compte : {label}.', 'Si ce n’était pas vous, changez votre mot de passe.'],
  'security.2fa_reset': ['Un agent de la ville a retiré la vérification en deux étapes de votre compte après une demande de récupération.', 'Vous pouvez la réactiver dans « Sécurité de mon compte ».'],
  'concern.read': ['Votre inquiétude {label} a été lue par un agent.', 'Vous n’avez rien à faire : une réponse peut suivre.'],
  'concern.answered': ['Votre inquiétude {label} a reçu une réponse.', 'Lisez la réponse ci-dessous ou dans « Mes inquiétudes envoyées ».'],
};
const noticeText = (item) => (noticeLines[item.code] ? t(noticeLines[item.code][0], { label: item.label }) : item.label);

async function loadNotices() {
  if (user?.role !== 'citizen') return;
  try {
    ({ notices } = await api('/api/me/notices'));
    renderNotices();
    if (notices.some((item) => item.code === 'device.new' && !item.seen_at)) loadDevices();
  } catch (error) {
    if (error.status === 401) clearIdentity();
  }
}

function renderNotices(force = false) {
  const unread = notices.filter((item) => !item.seen_at);
  if (user && 'Notification' in window && Notification.permission === 'granted') {
    for (const item of unread) {
      const seen = `noticeNotified:${user.id}:${item.id}`;
      if (preference(seen) === 'true') continue;
      preference(seen, 'true');
      new Notification(t('Nouvelle sur votre demande'), { body: noticeText(item), tag: `notice-${item.id}` });
    }
  }
  $('#notices-list').replaceChildren(...(notices.length ? notices : [null]).map((item) => {
    if (!item) return element('li', 'list-empty', t('Aucune nouvelle pour le moment. Vous serez prévenu ici quand une de vos demandes changera d’état.'));
    const line = element('li', item.seen_at ? 'notice-item' : 'notice-item notice-unread');
    const [, action] = noticeLines[item.code] || [];
    if (!item.seen_at) line.append(element('strong', 'notice-new', `${t('Nouveau')} · `));
    line.append(noticeText(item));
    if (action) line.append(element('span', 'notice-action', t(action)));
    if (item.note) line.append(element('span', 'notice-note', t('Message de la mairie : {note}', { note: item.note })));
    if (item.code === 'device.new') {
      const link = element('a', '', t('Voir mes appareils'));
      link.href = '#devices-panel';
      line.append(link);
    }
    if (item.code.startsWith('public.')) {
      const link = element('a', '', t('Voir la demande publique'));
      link.href = '#public-panel';
      line.append(link);
    }
    line.append(element('span', 'notice-time', item.at));
    return line;
  }));
  $('#notices-read').hidden = !unread.length;
  // Touch the live region only when the count changes, so a screen reader does not repeat it at every poll.
  const key = unread.map((item) => item.id).join();
  if (key === noticeKey && !force) return;
  noticeKey = key;
  const banner = $('#notice-banner');
  banner.hidden = !unread.length;
  if (!unread.length) return banner.replaceChildren();
  banner.replaceChildren(element('strong', '', `${t('Nouvelles')} · `), `${t(unread.length === 1 ? 'Vous avez 1 nouvelle sur vos demandes.' : 'Vous avez {n} nouvelles sur vos demandes.', { n: unread.length })} ${t('Elles sont en haut de « Mon espace ».')}`);
}

$('#notices-read').addEventListener('click', async () => {
  try {
    await api('/api/me/notices/seen', 'POST', { ids: notices.filter((item) => !item.seen_at).map((item) => item.id) });
    await loadNotices();
    $('#notices-panel').focus();
  } catch (error) {
    if (error.status === 401) clearIdentity();
  }
});

// ---- F50: the staff dashboard. The server counts everything from the database; here we only lay it out.
let dashboard = null;
// A dashboard number that counts messages opens the staff list already narrowed to exactly those messages.
$('#dashboard-panel').addEventListener('click', (event) => {
  const anchor = event.target.closest('a[data-filter]');
  if (!anchor) return;
  const filter = JSON.parse(anchor.dataset.filter);
  $('#staff-filter-status').value = filter.status || '';
  $('#staff-filter-kind').value = filter.kind || '';
  $('#staff-filter-district').value = filter.district || '';
  $('#staff-filter-reply').value = filter.reply || '';
  $('#staff-filter-topic').value = filter.topic || '';
  $('#staff-filter-priority').value = filter.priority || '';
  $('#staff-filter-similar').value = '';
  groupFilter = null;
  $('#staff-sort').value = '';
  renderMessages(staffMessages);
  $('#staff-messages-panel').focus();
});

async function loadDashboard() {
  if (!['agent', 'admin'].includes(user?.role)) return;
  try {
    dashboard = await api('/api/admin/dashboard');
    renderDashboard();
    markFresh($('#dashboard-todo'));
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    listFailed($('#dashboard-todo'), error);
  }
}

function renderDashboard() {
  if (!dashboard) return;
  const d = dashboard;
  const when = d.generated_at.replace('T', ' ');
  $('#dashboard-time').textContent = t('Mis à jour à {time} (heure de la cité)', { time: when.slice(11) });
  const todo = [];
  const plural = (n, one, many, params = {}) => t(n === 1 ? one : many, { n, ...params });
  if (d.messages.urgent_open) todo.push(plural(d.messages.urgent_open, '1 demande urgente n’est pas résolue.', '{n} demandes urgentes ne sont pas résolues.'));
  if (d.messages.new) todo.push(plural(d.messages.new, '1 message attend une réponse.', '{n} messages attendent une réponse.') + (d.messages.waiting_hours ? ` ${t('Le plus ancien attend depuis {h} h.', { h: d.messages.waiting_hours })}` : ''));
  if (d.messages.incidents_open) todo.push(plural(d.messages.incidents_open, '1 signalement de problème n’est pas résolu.', '{n} signalements de problèmes ne sont pas résolus.'));
  if (d.concerns.received) todo.push(plural(d.concerns.received, '1 inquiétude sur les données attend une lecture.', '{n} inquiétudes sur les données attendent une lecture.'));
  if (d.appointments.booked_today) todo.push(plural(d.appointments.booked_today, '1 rendez-vous à venir aujourd’hui.', '{n} rendez-vous à venir aujourd’hui.'));
  if (d.services.unavailable.length) todo.push(t('Services indisponibles : {names}.', { names: d.services.unavailable.join(', ') }));
  if (d.alerts.active) todo.push(plural(d.alerts.active, '1 alerte urgente est affichée.', '{n} alertes urgentes sont affichées.'));
  if (d.transports.disrupted.length) todo.push(t('Lignes perturbées : {names}.', { names: d.transports.disrupted.join(', ') }));
  if (d.security.blocked_attempts || d.security.failed_logins >= 10) todo.push(t('Connexions : {failed} échecs et {blocked} tentatives bloquées (voir Sécurité).', { failed: d.security.failed_logins, blocked: d.security.blocked_attempts }));
  $('#dashboard-todo').replaceChildren(...(todo.length ? todo : [t('Rien d’urgent : aucune demande n’attend et rien n’est perturbé.')]).map((line) => element('li', '', line)));
  // Every number opens what it counts: the message ones open the staff list already filtered, the others jump to their panel.
  const tiles = [
    ['Demandes urgentes non résolues', d.messages.urgent_open, { status: 'open', priority: 'urgent' }], ['Demandes prioritaires non résolues', d.messages.high_open, { status: 'open', priority: 'high' }],
    ['Messages à traiter', d.messages.new, { status: 'new' }], ['Messages en cours', d.messages.in_progress, { status: 'in_progress' }], ['Messages résolus', d.messages.resolved, { status: 'resolved' }],
    ['Inquiétudes à lire', d.concerns.received, '#concerns-panel'], ['Signalements publiés', d.public.requests], ['Soutiens donnés', d.public.supports],
    ['Messages reçus aujourd’hui', d.messages.received_today, {}], ['Messages reçus sur 7 jours', d.messages.received_week, {}],
    ['Rendez-vous réservés aujourd’hui', d.appointments.booked_today, '#slots-panel'], ['Rendez-vous réservés sur 7 jours', d.appointments.booked_week, '#slots-panel'], ['Horaires libres sur 7 jours', d.appointments.open_week, '#slots-panel'],
    ['Habitants inscrits', d.residents.total, '#citizens-panel'], ['Nouveaux habitants sur 7 jours', d.residents.new_week, '#citizens-panel'],
    ...(d.residents.deactivated === undefined ? [] : [['Comptes désactivés', d.residents.deactivated, '#citizens-panel']]),
    ['Services', d.services.total, '#availability-form'], ['Services indisponibles', d.services.unavailable.length, '#availability-form'], ['Alertes urgentes affichées', d.alerts.active, '#actualites'], ['Lignes perturbées', d.transports.disrupted.length, '#traffic-form'], ['Lieux de la ville', d.places, '#lieux'],
    ['Échecs de connexion (15 min)', d.security.failed_logins, '#security-panel'], ['Tentatives bloquées (15 min)', d.security.blocked_attempts, '#security-panel'],
  ];
  const numberLink = (label, value, target) => {
    const anchor = element('a', '', String(value));
    anchor.href = typeof target === 'string' ? target : '#staff-messages-panel';
    if (typeof target === 'object') anchor.dataset.filter = JSON.stringify(target);
    anchor.setAttribute('aria-label', `${value} · ${t(label)} · ${t('voir la liste')}`);
    return anchor;
  };
  $('#dashboard-tiles').replaceChildren(...tiles.map(([label, value, target]) => {
    const tile = element('div', 'dashboard-tile');
    tile.append(element('dt', '', t(label)), element('dd', '', target ? '' : String(value)));
    if (target) tile.querySelector('dd').append(numberLink(label, value, target));
    return tile;
  }));
  const hours = d.messages.avg_resolution_hours;
  $('#dashboard-average').textContent = hours === null
    ? t('Temps moyen de résolution : aucune demande résolue pour le moment.')
    : t('Temps moyen de résolution : {value} (de la réception au dernier changement d’état des demandes résolues).', { value: hours < 1 ? t('{n} min', { n: Math.round(hours * 60) }) : hours < 48 ? t('{n} h', { n: String(hours).replace('.', lang === 'en' ? '.' : ',') }) : t('{n} jours', { n: String(Math.round(hours / 2.4) / 10).replace('.', lang === 'en' ? '.' : ',') }) });
  const peak = Math.max(1, ...d.activity.map((row) => row.received));
  $('#dashboard-activity').replaceChildren(...d.activity.map((row) => {
    const day = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${row.day}T00:00:00Z`));
    const line = element('li', 'activity-row');
    const bar = element('meter', '', String(row.received));
    Object.assign(bar, { min: 0, max: peak, value: row.received });
    bar.setAttribute('aria-label', `${day} : ${t('Reçus')} ${row.received}`);
    line.append(element('span', 'activity-day', day), bar, element('span', 'activity-values', `${t('Reçus')} ${row.received} · ${t('Résolus')} ${row.resolved}`));
    return line;
  }));
  $('#dashboard-districts').replaceChildren(...(d.messages.incidents_by_district.length ? d.messages.incidents_by_district : [null]).map((row) => {
    if (!row) return element('li', 'list-empty', t('Aucun signalement pour le moment.'));
    const line = element('li');
    const anchor = element('a', '', t('{district} : {total} (non résolus : {open})', { district: row.district || t('Quartier non précisé'), total: row.total, open: row.open }));
    anchor.href = '#staff-messages-panel';
    anchor.dataset.filter = JSON.stringify({ kind: 'incident', district: row.district || 'none' });
    line.append(anchor);
    return line;
  }));
  $('#dashboard-recent').replaceChildren(...(d.recent.length ? d.recent : [null]).map((row) => element('li', row ? '' : 'list-empty', row ? `${row.at.replace('T', ' ').slice(0, 16)} · ${row.actor_name} ${row.summary}` : t('Aucune action enregistrée.'))));
}

// ---- F54: the devices this account has been used from. The cookie only recognises a browser; it proves nothing about who is using it.
let devices = [];
let deviceConfirm = null;
async function loadDevices() {
  if (user?.role !== 'citizen') return;
  try {
    ({ devices } = await api('/api/me/devices'));
    renderDevices();
  } catch (error) {
    if (error.status === 401) clearIdentity();
  }
}

function renderDevices() {
  $('#devices-list').replaceChildren(...(devices.length ? devices : [null]).map((item) => {
    if (!item) return element('li', 'list-empty', t('Aucun appareil enregistré pour le moment.'));
    const line = element('li', 'notice-item');
    line.dataset.device = item.id;
    line.append(element('strong', '', item.current ? `${item.label} · ${t('Cet appareil')}` : item.label));
    line.append(element('span', 'notice-time', t('Première connexion : {first} · Dernière : {last} · Connexions ouvertes : {n}', { first: item.first_seen, last: item.last_seen, n: item.open_sessions })));
    if (deviceConfirm === item.id) {
      line.append(element('span', 'notice-note', t(item.current ? 'Vous serez déconnecté de cet appareil. Confirmer le retrait ?' : 'Cet appareil sera déconnecté. Confirmer le retrait ?')));
      const actions = element('span', 'notice-actions');
      const yes = element('button', '', t('Confirmer le retrait'));
      yes.type = 'button';
      yes.addEventListener('click', () => removeDevice(item));
      const no = element('button', '', t('Annuler'));
      no.type = 'button';
      no.addEventListener('click', () => { deviceConfirm = null; renderDevices(); $(`[data-device="${item.id}"] button`)?.focus(); });
      actions.append(yes, no);
      line.append(actions);
    } else {
      const button = element('button', '', t('Retirer cet appareil'));
      button.type = 'button';
      button.setAttribute('aria-label', t('Retirer l’appareil {label}', { label: item.label }));
      button.addEventListener('click', () => { deviceConfirm = item.id; renderDevices(); $(`[data-device="${item.id}"] .notice-actions button`)?.focus(); });
      line.append(button);
    }
    return line;
  }));
}

async function removeDevice(item) {
  try {
    const result = await api(`/api/me/devices/${item.id}`, 'DELETE');
    deviceConfirm = null;
    if (result.signed_out) {
      clearIdentity();
      setFormStatus('#account-status', t('Cet appareil est retiré et vous êtes déconnecté.'));
      $('#account-status').focus();
      return;
    }
    setFormStatus('#devices-status', t('Appareil retiré : ses connexions sont fermées.'));
    await loadDevices();
    loadNotices();
    $('#devices-panel').focus();
  } catch (error) {
    reportError('#devices-status', error);
  }
}

// F55 / F56: the readable pages and the recap files follow the interface language
function updateDocumentLinks() {
  for (const link of document.querySelectorAll('#info-open, #info-save, #recap-open, #recap-save, #recap-csv')) {
    const url = new URL(link.getAttribute('href'), location.origin);
    url.searchParams.set('lang', lang);
    link.setAttribute('href', url.pathname + url.search);
  }
}

// ---- F51: concerns about data use (resident writes, staff reads and answers) and the personal export
const concernTopics = { usage: 'À quoi servent mes données', sharing: 'Qui peut voir mes données', storage: 'Combien de temps elles sont gardées', access: 'Voir, corriger ou effacer mes données', other: 'Autre sujet' };
const concernStatuses = { received: 'Reçue', read: 'Lue', answered: 'Répondue' };

function concernSteps(status) {
  const order = ['received', 'read', 'answered'];
  const current = order.indexOf(status);
  const steps = element('ol', 'status-steps');
  steps.setAttribute('aria-label', t('Avancement de la demande'));
  order.forEach((key, index) => {
    const done = index < current || (index === current && current === 2);
    const step = element('li', done ? 'step-done' : index === current ? 'step-current' : '', `${done ? '✓ ' : ''}${t(concernStatuses[key])}`);
    if (index === current) step.setAttribute('aria-current', 'step');
    steps.append(step);
  });
  return steps;
}

async function loadConcerns() {
  if (user?.role !== 'citizen') return;
  try {
    const { concerns } = await api('/api/concerns');
    $('#concerns-list').replaceChildren(...(concerns.length ? concerns : [null]).map((item) => {
      if (!item) return element('li', 'list-empty', t('Vous n’avez encore envoyé aucune inquiétude.'));
      const line = element('li', 'notice-item');
      line.append(element('strong', '', `C-${item.id} · ${t(concernTopics[item.topic])}`), element('span', 'notice-action', item.body), concernSteps(item.status));
      if (item.response) line.append(element('span', 'notice-note', t('Réponse de la mairie : {note}', { note: item.response })));
      line.append(element('span', 'notice-time', t('Envoyée le {created}', { created: item.created_at })));
      return line;
    }));
  } catch (error) {
    if (error.status === 401) clearIdentity();
  }
}

$('#concern-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await guardedSend('concern', form, (guard) => api('/api/concerns', 'POST', { topic: formValue(form, 'topic'), body: formValue(form, 'body'), ...guard }));
    form.reset();
    setFormStatus('#concern-status', t('{confirmation} Référence {reference}.', { confirmation: t(data.confirmation), reference: data.reference }));
    await loadConcerns();
  } catch (error) {
    reportError('#concern-status', error);
  }
});

let staffConcerns = [];
async function loadStaffConcerns() {
  if (!['agent', 'admin'].includes(user?.role)) return;
  try {
    ({ concerns: staffConcerns } = await api('/api/admin/concerns'));
    renderStaffConcerns();
  } catch (error) {
    if (error.status === 401) clearIdentity();
  }
}

function renderStaffConcerns() {
  $('#concerns-count').textContent = t('{n} à lire', { n: staffConcerns.filter((item) => item.status === 'received').length });
  $('#staff-concerns').replaceChildren(...(staffConcerns.length ? staffConcerns : [null]).map((item) => {
    if (!item) return element('li', 'list-empty', t('Aucune inquiétude reçue pour le moment.'));
    const line = element('li', 'notice-item');
    line.dataset.concern = item.id;
    line.append(element('strong', '', `C-${item.id} · ${t(concernTopics[item.topic])} · ${t(concernStatuses[item.status])}`), element('span', 'notice-time', `${item.author} · ${item.created_at}`), element('span', 'notice-action', item.body));
    if (item.status === 'answered') {
      line.append(element('span', 'notice-note', t('Réponse envoyée : {note}', { note: item.response })));
      return line;
    }
    const answer = element('label', 'status-field', t('Réponse à l’habitant '));
    const input = element('textarea');
    input.rows = 3;
    input.maxLength = 1000;
    input.setAttribute('aria-label', t('Réponse à l’inquiétude C-{id}', { id: item.id }));
    answer.append(input);
    const actions = element('span', 'notice-actions');
    const send = async (status, response) => {
      try {
        await api(`/api/admin/concerns/${item.id}`, 'PATCH', status === 'read' ? { status } : { status, response });
        setFormStatus('#concerns-status', t(status === 'read' ? 'Marquée comme lue : l’habitant est prévenu.' : 'Réponse envoyée : l’habitant est prévenu.'));
        await loadStaffConcerns();
        loadDashboard();
        $(`[data-concern="${item.id}"] button`)?.focus();
      } catch (error) {
        reportError('#concerns-status', error);
      }
    };
    if (item.status === 'received') {
      const read = element('button', '', t('Marquer comme lue'));
      read.type = 'button';
      read.addEventListener('click', () => send('read'));
      actions.append(read);
    }
    const reply = element('button', '', t('Envoyer la réponse'));
    reply.type = 'button';
    reply.addEventListener('click', () => send('answered', input.value));
    actions.append(reply);
    line.append(answer, actions);
    return line;
  }));
}

// ---- F52: a resident chooses to publish an incident report as a separate public record; others can support it once.
const districtList = ['Centre-ville', 'Quartier nord', 'Quartier est', 'Quartier ouest', 'Quartier sud'];
let publicRequests = [];
let mySupports = [];
let publishOpen = null;
const publishDrafts = {};
const focusMessageControl = (id) => $(`[data-message="${id}"] .public-controls button`)?.focus();

function publicControls(item) {
  const box = element('div', 'public-controls');
  const button = (label, handler) => {
    const control = element('button', '', t(label));
    control.type = 'button';
    control.addEventListener('click', handler);
    return control;
  };
  if (item.public_id) {
    box.append(element('p', 'message-public', t(item.support_count === 1 ? 'Visible par les autres habitants : « {title} » · 1 soutien.' : 'Visible par les autres habitants : « {title} » · {n} soutiens.', { title: item.public_title, n: item.support_count })));
    box.append(button('Retirer la publication', async () => {
      try {
        await api(`/api/messages/${item.id}/public`, 'DELETE');
        setFormStatus('#public-status', t('La publication est retirée : les autres habitants ne la voient plus.'));
        await loadMessages();
        loadPublic();
        focusMessageControl(item.id);
      } catch (error) {
        reportError('#public-status', error);
      }
    }));
    return box;
  }
  if (item.status === 'resolved') return box;
  if (publishOpen === item.id) {
    box.append(publishForm(item));
    return box;
  }
  box.append(button('Rendre visible aux autres habitants', () => {
    publishOpen = item.id;
    loadMessages().then(() => $(`[data-message="${item.id}"] .public-form input`)?.focus());
  }));
  return box;
}

function publishForm(item) {
  const draft = (publishDrafts[item.id] ||= { title: '', summary: '', district: districtList.includes(user?.district) ? user.district : districtList[0], consent: false });
  const form = element('form', 'public-form');
  form.setAttribute('aria-label', t('Publier le signalement « {title} »', { title: item.subject }));
  form.append(element('p', '', t('Ce que les autres habitants liront : le titre, le résumé et le quartier ci-dessous, et rien d’autre. Votre nom, votre adresse e-mail, votre message et le lieu précis ne sont pas montrés. N’écrivez ni numéro de téléphone ni adresse e-mail.')));
  const field = (label, control, key) => {
    const wrapper = element('label', '', `${t(label)} `);
    control.value = draft[key];
    control.addEventListener('input', () => { draft[key] = control.value; });
    wrapper.append(control);
    return wrapper;
  };
  const title = element('input');
  Object.assign(title, { name: 'public_title', required: true, minLength: 5, maxLength: 100, autocomplete: 'off' });
  const summary = element('textarea');
  Object.assign(summary, { name: 'public_summary', required: true, minLength: 10, maxLength: 300, rows: 3 });
  const district = element('select');
  district.name = 'district';
  for (const name of districtList) district.append(Object.assign(element('option', '', name), { value: name }));
  const consent = element('input');
  Object.assign(consent, { type: 'checkbox', name: 'consent', required: true, checked: draft.consent });
  consent.addEventListener('change', () => { draft.consent = consent.checked; });
  const consentLabel = element('label', 'consent-field');
  consentLabel.append(consent, ` ${t('Je comprends que ce titre, ce résumé et ce quartier seront lus par les autres habitants.')}`);
  const status = element('p', 'form-status');
  status.id = `public-form-status-${item.id}`;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const send = element('button', 'button button-primary', t('Publier mon signalement'));
  send.type = 'submit';
  const cancel = element('button', '', t('Annuler'));
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    publishOpen = null;
    loadMessages().then(() => focusMessageControl(item.id));
  });
  form.append(field('Titre public', title, 'title'), field('Résumé public', summary, 'summary'), field('Quartier', district, 'district'), consentLabel, send, cancel, status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/api/messages/${item.id}/public`, 'POST', { public_title: title.value, public_summary: summary.value, district: district.value, consent: consent.checked });
      publishOpen = null;
      delete publishDrafts[item.id];
      setFormStatus('#public-status', t('Votre signalement est maintenant visible par les autres habitants. Vous pouvez le retirer à tout moment.'));
      await loadMessages();
      loadPublic();
      focusMessageControl(item.id);
    } catch (error) {
      reportError(`#${status.id}`, error);
    }
  });
  return form;
}

async function loadPublic() {
  if (user?.role !== 'citizen') return;
  try {
    const [list, own] = await Promise.all([api('/api/public-requests'), api('/api/me/supports')]);
    publicRequests = list.requests;
    mySupports = own.supports;
    renderPublic();
  } catch (error) {
    if (error.status === 401) clearIdentity();
  }
}

function renderPublic() {
  const wanted = $('#public-filter-topic').value;
  const visible = publicRequests.filter((item) => topicMatches(item, wanted));
  if ($('#public-sort').value === 'supported') visible.sort((a, b) => b.support_count - a.support_count || b.id - a.id);
  $('#public-list').replaceChildren(...(visible.length ? visible : [null]).map((item) => {
    if (!item) return element('li', 'list-empty', t(publicRequests.length ? 'Aucune demande publiée ne correspond à ce thème.' : 'Aucun habitant n’a publié de signalement pour le moment.'));
    const line = element('li', 'notice-item');
    line.dataset.public = item.id;
    line.append(element('strong', '', item.public_title), element('span', 'notice-action', item.public_summary));
    line.append(element('span', '', `${t('Thème : {topic}', { topic: topicLabel(item.topic) })} · ${t('Quartier : {district}', { district: item.district })} · ${t('État : {state}', { state: t(statusLabels[item.status]) })}`));
    line.append(element('span', 'notice-time', item.support_count === 0 ? t('Aucun soutien pour le moment.') : t(item.support_count === 1 ? '1 habitant soutient cette demande.' : '{n} habitants soutiennent cette demande.', { n: item.support_count })));
    if (item.mine) line.append(element('span', 'notice-note', t('C’est votre demande : vous ne pouvez pas la soutenir.')));
    else if (item.status === 'resolved') line.append(element('span', 'notice-note', t('Demande résolue : le soutien n’est plus possible.')));
    else {
      if (item.supported_by_me) line.append(element('span', 'notice-note', t('Vous soutenez cette demande depuis le {date}.', { date: item.supported_at })));
      const button = element('button', '', t(item.supported_by_me ? 'Retirer mon soutien' : 'Je soutiens cette demande'));
      button.type = 'button';
      button.setAttribute('aria-label', t(item.supported_by_me ? 'Retirer mon soutien à « {title} »' : 'Soutenir la demande « {title} »', { title: item.public_title }));
      button.addEventListener('click', () => toggleSupport(item));
      line.append(button);
    }
    return line;
  }));
  $('#supports-list').replaceChildren(...(mySupports.length ? mySupports : [null]).map((item) => (item
    ? element('li', 'notice-item', t('« {title} » · soutenue le {date} · état : {state}', { title: item.public_title, date: item.supported_at, state: t(statusLabels[item.status]) }))
    : element('li', 'list-empty', t('Vous ne soutenez aucune demande pour le moment.')))));
}

async function toggleSupport(item) {
  try {
    await api(`/api/public-requests/${item.id}/support`, item.supported_by_me ? 'DELETE' : 'POST');
    setFormStatus('#public-status', t(item.supported_by_me ? 'Votre soutien est retiré.' : 'Merci : votre soutien à « {title} » est enregistré.', { title: item.public_title }));
    await loadPublic();
    $(`[data-public="${item.id}"] button`)?.focus();
  } catch (error) {
    reportError('#public-status', error);
    if ([404, 409].includes(error.status)) await loadPublic();
  }
}

async function loadMessages() {
  if (!user) return;
  const list = ['agent', 'admin'].includes(user.role) ? $('#staff-messages') : $('#citizen-messages');
  try {
    const { messages, groups, scope } = await api('/api/messages');
    staffGroups = groups || [];
    if (scope) $('#scope-note').textContent = scope.limited ? t('Votre périmètre : les demandes des services {names} et celles sans service. Les autres demandes ne vous sont pas montrées.', { names: scope.services.map((item) => (lang === 'en' && item.title_en) || item.title).join(', ') }) : '';
    renderMessages(messages);
    markFresh(list);
    loadDashboard();
  } catch (error) {
    if (error.status === 401) {
      clearIdentity();
      return;
    }
    listFailed(list, error);
  }
}

function renderRequests() {
  const query = fold($('#search').value.trim());
  const requests = (feed?.requests || []).filter((item) =>
    fold(`${item.request_code || ''} ${item.requester_name || ''} ${item.message_public || ''}`).includes(query)
  );
  const list = $('#requests-list');
  list.replaceChildren();
  for (const item of requests) {
    const card = element('article', 'request-card');
    const top = element('div', 'request-top');
    top.append(element('span', 'request-code', item.request_code || '—'));
    top.append(element('span', 'request-difficulty', item.difficulty || t('Difficulté inconnue')));
    card.append(top);
    card.append(element('h4', 'request-message', item.message_public || t('Demande sans description publique.')));
    card.append(element('p', 'requester', [item.requester_name, item.requester_type].filter(Boolean).join(' · ')));
    const bottom = element('div', 'request-bottom');
    bottom.append(element('span', '', item.is_initial ? t('Disponible au lancement') : t('Vague {n}', { n: item.wave_number ?? item.visible_since_wave ?? '—' })));
    bottom.append(element('strong', '', `${item.xp_available ?? item.xp_total ?? '—'} XP`));
    card.append(bottom);
    list.append(card);
  }
  $('#requests-empty').textContent = requests.length ? '' : t(feed ? 'Aucune demande ne correspond à la recherche.' : 'Le flux est en cours de chargement.');
}

async function loadFeed() {
  if (!['agent', 'admin'].includes(user?.role) || loadingFeed) return;
  loadingFeed = true;
  $('#refresh-button').disabled = true;
  try {
    const data = await api('/api/requests');
    if (!data.session || !Array.isArray(data.requests)) throw new Error(t('Réponse API invalide.'));
    const codes = new Set(data.requests.map((item) => item.request_code).filter(Boolean));
    const added = knownCodes ? [...codes].filter((code) => !knownCodes.has(code)).length : 0;
    knownCodes = codes;
    feed = data;
    $('#visible-count').textContent = t('{n} demandes', { n: data.session.visible_requests_count ?? data.requests.length });
    $('#current-wave').textContent = t('Vague {n}', { n: data.session.current_wave ?? '—' });
    $('#next-wave').textContent = Number(data.session.next_wave_number) > 0
      ? t('Vague {n} dans environ {minutes} min', { n: data.session.next_wave_number, minutes: data.session.minutes_until_next_wave ?? '—' })
      : t('Aucune nouvelle vague annoncée');
    $('#feed-status').textContent = added ? t(added > 1 ? '{n} nouvelles demandes publiées.' : '{n} nouvelle demande publiée.', { n: added }) : t('Flux officiel à jour.');
    renderRequests();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      clearIdentity();
      return;
    }
    $('#feed-status').textContent = error.message;
    if (!feed) renderRequests();
  } finally {
    loadingFeed = false;
    $('#refresh-button').disabled = false;
  }
}

// F35: short tips at the moment of first use, dismissible and remembered per user (guests: per browser).
const tipTexts = {
  search: 'Astuce : tapez quelques lettres, la liste se filtre au fil de la frappe. Les accents sont ignorés.',
  message: 'Astuce : décrivez votre demande avec précision. La ville vous répond ici et vous suivez son état dans « Mes messages ».',
  report: 'Astuce : indiquez un lieu précis (rue, repère) pour que les équipes retrouvent le problème rapidement.',
};
const shownTips = new Set();
let tipOwner = null;
const tipKey = (name) => `tipDone:${user?.id ?? 'guest'}:${name}`;

function renderTips() {
  const owner = user?.id ?? 'guest';
  if (owner !== tipOwner) { shownTips.clear(); tipOwner = owner; }
  for (const name of Object.keys(tipTexts)) {
    const slot = $(`#tip-${name}`);
    if (!shownTips.has(name) || preference(tipKey(name)) === 'true') { slot.replaceChildren(); continue; }
    const box = element('div', 'tip');
    const dismiss = element('button', '', t('Compris'));
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => dismissTip(name, true));
    box.append(element('p', '', t(tipTexts[name])), dismiss);
    slot.replaceChildren(box);
  }
}

function showTip(name) {
  if (preference(tipKey(name)) === 'true' || shownTips.has(name)) return;
  shownTips.add(name);
  renderTips();
}

function dismissTip(name, refocus) {
  const field = {
    search: $('#service-search'), message: $('#message-form [name=subject]'), report: $('#message-kind'),
  }[name];
  preference(tipKey(name), 'true');
  shownTips.delete(name);
  renderTips();
  if (refocus) field.focus();
}
$('#service-search').addEventListener('focus', () => showTip('search'));
$('#message-form').addEventListener('focusin', () => showTip('message'));
for (const [selector, name] of [['#register-form', 'register'], ['#message-form', 'message'], ['#concern-form', 'concern']]) $(selector).addEventListener('focusin', () => warmFormToken(name));
$('#message-kind').addEventListener('change', () => { if ($('#message-kind').value === 'incident') showTip('report'); });

// F71: an account opened at the counter: the code and the one-time password are shown once to the agent.
$('#counter-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api('/api/admin/citizens', 'POST', { name: formValue(form, 'name'), district: formValue(form, 'district') });
    const box = $('#citizens-secret');
    box.replaceChildren(
      element('p', '', t('Compte ouvert pour {name}. À remettre à l’habitant :', { name: data.citizen.name })),
      element('p', '', `${t('Code d’accès')} : `), element('code', 'citizen-password', data.access_code),
      element('p', '', `${t('Mot de passe à usage unique')} : `), element('code', 'citizen-password', data.password),
      element('p', '', t('Affichés une seule fois. L’habitant se connecte avec le code d’accès à la place de l’adresse e-mail, puis choisit son mot de passe dans « Sécurité de mon compte ».')),
    );
    box.hidden = false;
    form.reset();
    setFormStatus('#citizens-status', t('Compte ouvert pour {name}.', { name: data.citizen.name }));
    box.focus();
    loadCitizens();
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    reportError('#citizens-status', error);
  }
});

// F34: staff administer citizen accounts (the server enforces the role and protects staff accounts).
let citizens = [];
let pendingDelete = null;
let pendingCitizen = null;
let citizenTimer;

function setCitizensStatus(message, error = false) {
  setFormStatus('#citizens-status', message, error);
}

function showTemporaryPassword(citizen, password) {
  const box = $('#citizens-secret');
  box.replaceChildren(
    element('p', '', t('Mot de passe temporaire de {name} :', { name: citizen.name })),
    element('code', 'citizen-password', password),
    element('p', '', t('Affiché une seule fois : notez-le et transmettez-le de façon sécurisée. Les sessions ouvertes de cet habitant sont fermées.')),
  );
  box.hidden = false;
  box.focus();
}

function focusCitizen(id) {
  ($(`[data-citizen="${id}"] button`) || $('#citizen-search')).focus();
}

async function loadCitizens() {
  if (!['agent', 'admin'].includes(user?.role)) return;
  try {
    ({ citizens } = await api(`/api/admin/citizens?q=${encodeURIComponent($('#citizen-search').value.trim())}`));
    setCitizensStatus(citizens.length ? t(citizens.length > 1 ? '{n} habitants.' : '{n} habitant.', { n: citizens.length }) : t('Aucun habitant ne correspond.'));
    renderCitizens();
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    setCitizensStatus(error.message, true);
  }
}

async function citizenAction(citizen, kind, reason) {
  $('#citizens-secret').hidden = true;
  try {
    if (kind === 'deactivate') await api(`/api/admin/citizens/${citizen.id}`, 'PATCH', { active: false, reason });
    else if (kind === 'reactivate') await api(`/api/admin/citizens/${citizen.id}`, 'PATCH', { active: true });
    else if (kind === 'reset2fa') await api(`/api/admin/citizens/${citizen.id}/2fa-reset`, 'POST', { reason });
    else if (kind === 'reset') showTemporaryPassword(citizen, (await api(`/api/admin/citizens/${citizen.id}/password`, 'POST', { reason })).password);
    else await api(`/api/admin/citizens/${citizen.id}`, 'DELETE', { reason });
    pendingCitizen = null;
    await loadCitizens();
    if (kind === 'deactivate' || kind === 'reactivate') setCitizensStatus(t(kind === 'reactivate' ? 'Compte de {name} réactivé.' : 'Compte de {name} désactivé.', { name: citizen.name }));
    if (kind === 'delete') setCitizensStatus(t('Compte de {name} supprimé.', { name: citizen.name }));
    if (kind === 'reset2fa') { setCitizensStatus(t('Vérification en deux étapes retirée pour {name}. Ses sessions sont fermées.', { name: citizen.name })); focusCitizen(citizen.id); }
    if (kind === 'deactivate' || kind === 'reactivate') focusCitizen(citizen.id);
    if (kind === 'delete') $('#citizen-search').focus();
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    if (reason) throw error;
    setCitizensStatus(error.message, true);
  }
}
$('#citizen-search').addEventListener('input', () => { clearTimeout(citizenTimer); citizenTimer = setTimeout(loadCitizens, 250); });

// ---- City time. Appointment and return times are 'YYYY-MM-DDTHH:MM' in Terra Nova time (UTC+4): shown as written, never shifted.
function formatLocal(value, options = { dateStyle: 'full', timeStyle: 'short' }) {
  const date = new Date(`${value}:00Z`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { ...options, timeZone: 'UTC' }).format(date);
}
const timeOf = (value) => formatLocal(value, { timeStyle: 'short' });
const dayOf = (value) => formatLocal(value, { dateStyle: 'full' });
const cityToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

// ---- F37: sign-in protection, visible to the person signing in, to the account owner and to staff.
let loginUnlock;
function loginErrorMessage(error) {
  if (error.status === 429 && error.retryAfter) return t('Connexion suspendue pour protéger ce compte. Réessayez dans {n} min.', { n: Math.ceil(error.retryAfter / 60) });
  if (error.status === 401 && Number.isInteger(error.attemptsLeft)) {
    const left = error.attemptsLeft;
    return `${error.message} ${left > 0 ? t(left > 1 ? 'Il vous reste {n} tentatives avant une pause de sécurité.' : 'Il vous reste {n} tentative avant une pause de sécurité.', { n: left }) : t('Pause de sécurité : la connexion est suspendue quelques minutes pour protéger le compte.')}`;
  }
  return error.message;
}

// Keeps the button off, and the remaining time current, until the pause is over.
function lockLogin(seconds) {
  const button = $('#login-form button[type=submit]');
  const until = Date.now() + seconds * 1000;
  let shown = 0;
  clearInterval(loginUnlock);
  button.disabled = true;
  loginUnlock = setInterval(() => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(loginUnlock);
      button.disabled = false;
      setFormStatus('#login-status', t('Vous pouvez réessayer.'));
      return;
    }
    const minutes = Math.ceil(left / 60);
    if (minutes !== shown) {
      shown = minutes;
      setFormStatus('#login-status', t('Connexion suspendue pour protéger ce compte. Réessayez dans {n} min.', { n: minutes }), true);
    }
  }, 2000);
}

function showSecurityNotice(notice) {
  const box = $('#security-notice');
  box.hidden = !notice?.failedAttempts;
  if (box.hidden) return;
  $('#security-notice-text').textContent = t('Alerte sécurité : {n} tentatives de connexion échouées sur votre compte depuis un autre appareil pendant votre absence. Si ce n’était pas vous, signalez-le aux services municipaux avec « Contacter ou signaler ».', { n: notice.failedAttempts });
}
$('#security-notice-dismiss').addEventListener('click', () => { $('#security-notice').hidden = true; });

let security = null;
async function loadSecurity() {
  if (!['agent', 'admin'].includes(user?.role)) return;
  try {
    security = await api('/api/admin/security');
    renderSecurity();
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    $('#security-summary').textContent = error.message;
  }
}

function renderSecurity() {
  if (!security) return;
  const forms = security.forms || { automated: 0, tooFast: 0, rateLimited: 0, duplicates: 0 };
  const unusual = security.blockedAttempts > 0 || security.failedLogins >= 10 || security.targeted.length > 0 || forms.automated >= 3 || forms.rateLimited >= 3;
  $('#security-panel').classList.toggle('security-alert', unusual);
  $('#security-summary').textContent = `${t('{failed} échecs de connexion et {blocked} tentatives bloquées sur les {m} dernières minutes.', { failed: security.failedLogins, blocked: security.blockedAttempts, m: security.windowMinutes })} ${t(unusual ? 'Activité inhabituelle : la protection est active.' : 'Aucune activité inhabituelle.')} ${t('Formulaires (dernière heure) : {automated} envois refusés comme automatiques, {fast} envois trop rapides, {quota} refus pour quota, {dup} doublons évités.', { automated: forms.automated, fast: forms.tooFast, quota: forms.rateLimited, dup: forms.duplicates })}`;
  const list = $('#security-targets');
  list.replaceChildren(...security.targeted.map((item) => element('li', '', t('Compte visé : {account} ({n} échecs)', { account: item.account, n: item.failures }))));
  if (security.unknownAddresses) list.append(element('li', '', t('Adresses inexistantes visées : {n}', { n: security.unknownAddresses })));
}

// ---- F38: availability of a service, shown before anyone starts a procedure.
const pickText = (service, field) => {
  const english = lang === 'en' && service[`${field}_en`];
  return { text: english || service[field], lang: english ? 'en' : 'fr' };
};

function availabilityNotice(service) {
  if (service.availability !== 'unavailable') return null;
  const box = element('div', 'availability-notice');
  const reason = pickText(service, 'unavailable_reason');
  const reasonLine = element('p', '', reason.text);
  reasonLine.lang = reason.lang;
  box.append(element('strong', '', t('Service indisponible')), reasonLine,
    element('p', '', service.available_again ? t('Retour prévu : {date} (heure de Terra Nova)', { date: formatLocal(service.available_again) }) : t('Date de reprise non communiquée.')));
  if (service.alternative) {
    const alternative = pickText(service, 'alternative');
    const line = element('p', '');
    const text = element('span', '', alternative.text);
    text.lang = alternative.lang;
    line.append(element('strong', '', `${t('En attendant :')} `), text);
    box.append(line);
  }
  return box;
}

function renderServiceOptions() {
  const label = (service) => `${service.title_en && lang === 'en' ? service.title_en : service.title}${service.availability === 'unavailable' ? ` (${t('indisponible')})` : ''}`;
  const options = (list) => list.map((service) => Object.assign(element('option', '', label(service)), { value: service.id }));
  const message = $('#message-service');
  const keepMessage = message.value;
  message.replaceChildren(Object.assign(element('option', '', t('Aucun service en particulier')), { value: '' }), ...options(services));
  message.value = keepMessage;
  const staffSelect = $('#availability-service');
  const keepStaff = staffSelect.value;
  staffSelect.replaceChildren(...options(services));
  if (keepStaff) staffSelect.value = keepStaff;
  const placeSelect = $('#place-service');
  const keepPlace = placeSelect.value;
  placeSelect.replaceChildren(Object.assign(element('option', '', t('Aucun')), { value: '' }), ...options(services));
  placeSelect.value = keepPlace;
  renderServiceNotice();
  fillAvailabilityForm(false);
}

function renderServiceNotice() {
  const service = services.find((item) => String(item.id) === $('#message-service').value);
  const notice = service && availabilityNotice(service);
  $('#service-notice').replaceChildren(...(notice ? [notice, element('p', 'availability-hint', t('Vous pouvez tout de même envoyer votre message : il sera traité à la reprise du service.'))] : []));
}
$('#message-service').addEventListener('change', renderServiceNotice);

function startRequest(service) {
  $('#message-service').value = service.id;
  renderServiceNotice();
  $('#message-form').scrollIntoView({ block: 'start' });
  $('#message-form [name=subject]').focus();
}

function fillAvailabilityForm(force = true) {
  const form = $('#availability-form');
  const service = services.find((item) => String(item.id) === form.elements.service.value);
  if (!service || (!force && form.dataset.filled === String(service.id))) return;
  form.dataset.filled = service.id;
  form.elements.availability.value = service.availability;
  form.elements.reason.value = service.unavailable_reason || '';
  form.elements.reason_en.value = service.unavailable_reason_en || '';
  form.elements.until.value = service.available_again || '';
  form.elements.alternative.value = service.alternative || '';
  form.elements.alternative_en.value = service.alternative_en || '';
  syncAvailabilityDetails();
}

function syncAvailabilityDetails() {
  const form = $('#availability-form');
  const down = form.elements.availability.value === 'unavailable';
  $('#availability-details').hidden = !down;
  form.elements.reason.required = down;
}
$('#availability-form').elements.service.addEventListener('change', () => fillAvailabilityForm(true));
$('#availability-form').elements.availability.addEventListener('change', syncAvailabilityDetails);
$('#availability-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const down = form.elements.availability.value === 'unavailable';
  try {
    await api(`/api/services/${form.elements.service.value}/availability`, 'PATCH', down
      ? { availability: 'unavailable', reason: formValue(form, 'reason'), reason_en: formValue(form, 'reason_en'), until: formValue(form, 'until'), alternative: formValue(form, 'alternative'), alternative_en: formValue(form, 'alternative_en') }
      : { availability: 'available' });
    setFormStatus('#availability-status', t('Disponibilité enregistrée.'));
    form.dataset.filled = '';
    await loadServices();
  } catch (error) {
    reportError('#availability-status', error);
  }
});

// ---- F39: appointments (citizen side)
let slots = [];
let appointments = [];
let pendingCancel = null;

function appointmentDetails(item) {
  const box = element('dl', 'appointment-details');
  const row = (label, value, valueLang) => {
    const term = element('dt', '', label);
    const detail = element('dd', '', value);
    if (valueLang) detail.lang = valueLang;
    box.append(term, detail);
  };
  row(t('Date'), dayOf(item.starts_at));
  row(t('Heure'), t('de {start} à {end} (heure de Terra Nova)', { start: timeOf(item.starts_at), end: timeOf(item.ends_at) }));
  row(t('Avec'), item.agent);
  row(t('Lieu'), item.location, 'fr');
  row(t('À préparer'), item.instructions, 'fr');
  if (item.reason) row(t('Motif'), item.reason, 'fr');
  return box;
}

function renderSlotSelect() {
  const select = $('#appointment-slot');
  const keep = select.value;
  select.replaceChildren(Object.assign(element('option', '', t('Choisir un horaire…')), { value: '' }));
  const groups = new Map();
  for (const slot of slots) {
    const day = slot.starts_at.slice(0, 10);
    if (!groups.has(day)) groups.set(day, Object.assign(element('optgroup'), { label: dayOf(slot.starts_at) }));
    groups.get(day).append(Object.assign(element('option', '', `${timeOf(slot.starts_at)}–${timeOf(slot.ends_at)} · ${slot.agent} · ${slot.location}`), { value: slot.id }));
  }
  select.append(...groups.values());
  select.value = slots.some((slot) => String(slot.id) === keep) ? keep : '';
  renderSlotPreview();
}

function renderSlotPreview() {
  const slot = slots.find((item) => String(item.id) === $('#appointment-slot').value);
  $('#slot-preview').replaceChildren(...(slot ? [element('h4', '', t('Vous allez réserver')), appointmentDetails(slot)] : [element('p', 'slot-empty', slots.length ? '' : t('Aucun horaire libre pour le moment. Revenez plus tard.'))]));
}
$('#appointment-slot').addEventListener('change', renderSlotPreview);

async function loadAppointments() {
  if (user?.role !== 'citizen') return;
  try {
    [{ slots }, { appointments }] = await Promise.all([api('/api/appointments/slots'), api('/api/appointments/mine')]);
    renderSlotSelect();
    renderMyAppointments();
    renderReminders();
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    reportError('#appointment-status', error);
  }
}

function renderMyAppointments() {
  const list = $('#my-appointments');
  list.replaceChildren();
  if (!appointments.length) {
    list.append(element('li', 'list-empty', t('Vous n’avez aucun rendez-vous.')));
    return;
  }
  for (const item of appointments) {
    const upcoming = item.status === 'booked' && item.minutes_until > 0;
    const li = element('li', `appointment-card status-${item.status === 'booked' && !upcoming ? 'past' : item.status}`);
    li.dataset.appointment = item.id;
    const head = element('div', 'appointment-head');
    head.append(element('strong', '', `${dayOf(item.starts_at)}, ${timeOf(item.starts_at)}`),
      element('span', 'appointment-state', t(item.status === 'cancelled' ? 'Annulé par la mairie' : upcoming ? 'Confirmé' : 'Passé')));
    li.append(head, appointmentDetails(item));
    if (upcoming) {
      const actions = element('div', 'appointment-actions');
      const calendar = element('a', 'button-link', t('Ajouter à mon agenda (fichier calendrier)'));
      calendar.href = `/api/appointments/${item.id}/ics`;
      actions.append(calendar);
      if (pendingCancel === item.id) {
        li.append(element('p', 'citizen-confirm', t('Annuler ce rendez-vous ? L’horaire sera proposé à d’autres habitants.')));
        const yes = element('button', 'citizen-danger', t('Confirmer l’annulation'));
        const no = element('button', '', t('Garder le rendez-vous'));
        yes.type = no.type = 'button';
        yes.addEventListener('click', () => cancelAppointment(item));
        no.addEventListener('click', () => { pendingCancel = null; renderMyAppointments(); focusAppointment(item.id); });
        actions.append(yes, no);
      } else {
        const cancel = element('button', 'citizen-danger', t('Annuler ce rendez-vous'));
        cancel.type = 'button';
        cancel.addEventListener('click', () => { pendingCancel = item.id; renderMyAppointments(); focusAppointment(item.id, 'button.citizen-danger'); });
        actions.append(cancel);
      }
      li.append(actions);
    }
    list.append(li);
  }
}

function focusAppointment(id, selector = 'button, a') {
  ($(`[data-appointment="${id}"] ${selector}`) || $('#appointment-slot')).focus();
}

async function cancelAppointment(item) {
  try {
    await api(`/api/appointments/${item.id}`, 'DELETE');
    pendingCancel = null;
    $('#appointment-confirmation').hidden = true;
    await loadAppointments();
    setFormStatus('#appointment-status', t('Rendez-vous annulé. L’horaire est de nouveau proposé.'));
    $('#appointment-slot').focus();
  } catch (error) {
    reportError('#appointment-status', error);
  }
}

$('#appointment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.elements.slot.value) {
    reportError('#appointment-status', Object.assign(new Error(t('Choisissez d’abord un horaire.')), { field: ['slot'] }));
    return;
  }
  try {
    const { appointment } = await api(`/api/appointments/${form.elements.slot.value}/book`, 'POST', { reason: formValue(form, 'reason') });
    form.reset();
    setFormStatus('#appointment-status', '');
    const box = $('#appointment-confirmation');
    const calendar = element('a', 'button-link', t('Ajouter à mon agenda (fichier calendrier)'));
    calendar.href = `/api/appointments/${appointment.id}/ics`;
    box.replaceChildren(element('h4', '', t('Rendez-vous confirmé')), appointmentDetails(appointment),
      element('p', '', t('Rappel : un message s’affichera en haut de cette page 24 h puis 1 h avant. Vous pouvez aussi l’ajouter à votre agenda.')), calendar);
    box.hidden = false;
    await loadAppointments();
    box.focus();
  } catch (error) {
    reportError('#appointment-status', error);
    // Someone else may have taken the slot: show the up-to-date list so the next choice is a real one.
    if (error.status === 409) await loadAppointments();
  }
});

// ---- F40: reminders. No e-mail or SMS exists here, so: a banner on the page, a browser notification if the
// person opted in (the alerts button), and a calendar file with alarms.
let reminderKey = null;
const reminderStage = (item) => (item.status !== 'booked' || item.minutes_until <= 0 || item.minutes_until > 1440 ? null : item.minutes_until <= 60 ? 'hour' : 'day');

function reminderText(item, stage) {
  return stage === 'hour'
    ? t('Votre rendez-vous commence dans moins d’une heure : {time}, {place}.', { time: timeOf(item.starts_at), place: item.location })
    : t('Rendez-vous dans moins de 24 h : {when}, {place}.', { when: formatLocal(item.starts_at), place: item.location });
}

function renderReminders(force = false) {
  const due = appointments.map((item) => [item, reminderStage(item)]).filter(([, stage]) => stage);
  const key = due.map(([item, stage]) => `${item.id}:${stage}`).join();
  if ('Notification' in window && Notification.permission === 'granted') {
    for (const [item, stage] of due) {
      const seen = `apptNotified:${user.id}:${item.id}:${stage}`;
      if (preference(seen) === 'true') continue;
      preference(seen, 'true');
      new Notification(t('Rappel de rendez-vous'), { body: reminderText(item, stage), tag: `rdv-${item.id}-${stage}` });
    }
  }
  // Touch the live region only when the reminders change, so screen readers do not repeat them every minute.
  if (key === reminderKey && !force) return;
  reminderKey = key;
  const banner = $('#reminder-banner');
  banner.hidden = !due.length;
  banner.replaceChildren(...due.map(([item, stage]) => {
    const line = element('p', 'reminder-item');
    const link = element('a', '', t('Voir les détails'));
    link.href = '#appointments-panel';
    line.append(element('strong', '', `${t('Rappel')} · `), `${reminderText(item, stage)} `, link);
    return line;
  }));
}

// ---- F39: appointments (staff side)
let staffSlots = [];
let pendingStaffCancel = null;

async function loadStaffSlots() {
  if (!['agent', 'admin'].includes(user?.role)) return;
  try {
    ({ appointments: staffSlots } = await api('/api/appointments/staff'));
    renderStaffSlots();
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    reportError('#slots-status', error);
  }
}

function renderStaffSlots() {
  const list = $('#staff-appointments');
  list.replaceChildren();
  if (!staffSlots.length) list.append(element('li', 'list-empty', t('Aucun horaire publié.')));
  for (const item of staffSlots) {
    const li = element('li', `appointment-card status-${item.status}`);
    li.dataset.appointment = item.id;
    const booked = item.status === 'booked';
    const head = element('div', 'appointment-head');
    head.append(element('strong', '', `${formatLocal(item.starts_at, { dateStyle: 'medium' })} ${timeOf(item.starts_at)}–${timeOf(item.ends_at)}`),
      element('span', 'appointment-state', t(booked ? 'Réservé' : item.status === 'cancelled' ? 'Annulé' : 'Libre')));
    li.append(head, element('p', 'citizen-meta', `${item.agent} · ${item.location}`));
    if (booked) li.append(element('p', '', t('Réservé par {name} ({email}){reason}', { name: item.citizen.name, email: item.citizen.email, reason: item.reason ? ` · ${item.reason}` : '' })));
    const actions = element('div', 'appointment-actions');
    const button = (label, handler, danger) => {
      const node = element('button', danger ? 'citizen-danger' : '', label);
      node.type = 'button';
      node.addEventListener('click', handler);
      return node;
    };
    if (booked && pendingStaffCancel === item.id) {
      li.append(reasonForm({
        prompt: t('Annuler ce rendez-vous ? {name} verra qu’il est annulé par la mairie. Le motif est conservé dans le journal.', { name: item.citizen.name }), confirmLabel: t('Confirmer l’annulation'), danger: true,
        onConfirm: (reason) => removeSlot(item, reason),
        onCancel: () => { pendingStaffCancel = null; renderStaffSlots(); },
      }));
    } else if (booked) {
      actions.append(button(t('Annuler le rendez-vous'), () => { pendingStaffCancel = item.id; renderStaffSlots(); $(`[data-appointment="${item.id}"] .citizen-danger`).focus(); }, true));
    } else {
      actions.append(button(t('Retirer l’horaire'), () => removeSlot(item), true));
    }
    li.append(actions);
    list.append(li);
  }
}

async function removeSlot(item, reason) {
  try {
    await api(`/api/appointments/${item.id}`, 'DELETE', reason ? { reason } : undefined);
    pendingStaffCancel = null;
    await loadStaffSlots();
    setFormStatus('#slots-status', t('Horaire mis à jour.'));
  } catch (error) {
    if (reason) throw error;
    reportError('#slots-status', error);
  }
}

$('#slots-form').elements.date.min = cityToday();
$('#slots-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const { created } = await api('/api/appointments', 'POST', {
      date: formValue(form, 'date'), start: formValue(form, 'start'), count: Number(formValue(form, 'count')), duration: Number(formValue(form, 'duration')),
      location: formValue(form, 'location'), instructions: formValue(form, 'instructions'),
    });
    setFormStatus('#slots-status', t(created > 1 ? '{n} horaires publiés.' : '{n} horaire publié.', { n: created }));
    await loadStaffSlots();
  } catch (error) {
    reportError('#slots-status', error);
  }
});

// ---- F47: sensitive staff actions ask for a reason, kept in the journal of actions.
function reasonForm({ prompt, confirmLabel, onConfirm, onCancel, danger = false }) {
  const form = element('form', 'reason-form');
  const input = element('input');
  Object.assign(input, { name: 'reason', required: true, minLength: 5, maxLength: 200, autocomplete: 'off' });
  const label = element('label', '', `${t('Motif (obligatoire)')} `);
  label.append(input);
  const error = element('p', 'reason-error');
  error.setAttribute('role', 'alert');
  const ok = element('button', danger ? 'citizen-danger' : '', confirmLabel);
  ok.type = 'submit';
  const cancel = element('button', '', t('Annuler'));
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  form.append(element('p', 'citizen-confirm', prompt), label, error, ok, cancel);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    ok.disabled = true;
    error.textContent = '';
    try {
      await onConfirm(input.value.trim());
    } catch (failure) {
      error.textContent = `⚠ ${t('Erreur :')} ${failure.message}`;
      input.setAttribute('aria-invalid', 'true');
      ok.disabled = false;
      input.focus();
    }
  });
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  queueMicrotask(() => input.focus());
  return form;
}

// ---- F45 / F46: places residents look for (hospitals, emergency services, city services)
let places = [];
let placeKind = 'all';
const placeRank = { emergency: 0, hospital: 1, service: 2 };
const sortedPlaces = (list) => [...list].sort((a, b) => (placeRank[a.kind] ?? 3) - (placeRank[b.kind] ?? 3)
  || Number(Boolean(user?.district) && b.district === user.district) - Number(Boolean(user?.district) && a.district === user.district) || a.name.localeCompare(b.name));
const kindLabel = (kind) => t(({ emergency: 'Urgences', hospital: 'Hôpital', service: 'Service de la ville' })[kind] || kind);
const phoneHref = (phone) => `tel:${String(phone).replace(/[^0-9+]/g, '')}`;

async function loadPlaces() {
  try {
    ({ places } = await api('/api/places'));
    $('#places-status').textContent = '';
    renderPlaces();
    renderEmergency();
    renderPlaceAdmin();
  } catch (error) {
    $('#places-status').textContent = error.message;
  }
}

// Next trams at the nearest stop, from the same data as the transports section.
function placeTransport(place) {
  const out = [];
  for (const line of transports) {
    const stop = line.stops?.find((entry) => entry.name === place.stop);
    if (!stop) continue;
    out.push(`${line.code} : ${stop.next.join(' · ')}${line.status === 'perturbé' ? ` (${t('Trafic perturbé')})` : ''}`);
  }
  return out.join(' — ');
}

function placeCard(place) {
  const name = pickText(place, 'name');
  const address = pickText(place, 'address');
  const hours = pickText(place, 'hours');
  const card = element('article', place.kind === 'emergency' ? 'place-card place-emergency' : 'place-card');
  const title = element('h3', '', name.text);
  title.lang = name.lang;
  const where = element('p', 'place-where', address.text);
  where.lang = address.lang;
  card.append(element('p', 'place-kind', kindLabel(place.kind)), title, element('p', 'place-district', `${place.district} · ${t('Arrêt de tram : {stop}', { stop: place.stop })}`), where);
  const trams = placeTransport(place);
  if (trams) card.append(element('p', 'place-trams', `${t('Prochains passages')} ${trams}`));
  const opening = place.open_24h ? t('Ouvert 24 h sur 24') : hours.text;
  if (opening) {
    const line = element('p', 'place-hours', opening);
    if (!place.open_24h) line.lang = hours.lang;
    card.append(line);
  }
  if (place.phone) {
    const call = element('a', 'button-link place-call', t('Appeler le {phone}', { phone: place.phone }));
    call.href = phoneHref(place.phone);
    card.append(call);
  }
  if (place.service_id) {
    const service = element('a', 'button-link', t('Voir le service'));
    service.href = '#services';
    card.append(service);
  }
  return card;
}

function renderPlaces() {
  const needle = fold($('#place-search').value.trim());
  const shown = sortedPlaces(places).filter((place) => (placeKind === 'all' || (placeKind === 'care' ? place.kind !== 'service' : place.kind === 'service'))
    && fold(['name', 'address'].map((field) => pickText(place, field).text).join(' ')).includes(needle));
  $('#places-list').replaceChildren(...shown.map(placeCard));
  $('#places-status').textContent = !places.length ? t('Aucun lieu publié pour le moment.') : !shown.length ? t('Aucun lieu ne correspond à votre recherche.')
    : (needle || placeKind !== 'all') ? t(shown.length > 1 ? '{n} lieux trouvés.' : '{n} lieu trouvé.', { n: shown.length }) : '';
}
$('#place-search').addEventListener('input', renderPlaces);
for (const radio of document.querySelectorAll('input[name=place-kind]')) radio.addEventListener('change', () => { placeKind = radio.value; renderPlaces(); });

// The first thing on the page: the number to call and the closest hospital or emergency services.
function renderEmergency() {
  const care = sortedPlaces(places.filter((place) => place.kind !== 'service')).slice(0, 3);
  $('#urgences-list').replaceChildren(...care.map((place) => {
    const name = pickText(place, 'name');
    const item = element('li', 'emergency-item');
    const label = element('strong', '', name.text);
    label.lang = name.lang;
    item.append(label, ` — ${place.district}, ${t('Arrêt de tram : {stop}', { stop: place.stop })}${place.open_24h ? ` · ${t('Ouvert 24 h sur 24')}` : ''} `);
    if (place.phone) {
      const call = element('a', 'emergency-phone', t('Appeler le {phone}', { phone: place.phone }));
      call.href = phoneHref(place.phone);
      item.append(call);
    }
    return item;
  }));
}

// Admin: add, edit, delete places (every change is journalled).
let editingPlace = null;
let pendingPlaceDelete = null;

function renderPlaceAdmin() {
  const list = $('#places-admin-list');
  list.replaceChildren();
  for (const place of sortedPlaces(places)) {
    const li = element('li', 'appointment-card');
    li.dataset.place = place.id;
    const head = element('div', 'appointment-head');
    head.append(element('strong', '', place.name), element('span', 'appointment-state', kindLabel(place.kind)));
    li.append(head, element('p', 'citizen-meta', `${place.district} · ${t('Arrêt de tram : {stop}', { stop: place.stop })}${place.open_24h ? ` · ${t('Ouvert 24 h sur 24')}` : ''}`));
    const actions = element('div', 'appointment-actions');
    const button = (label, handler, danger) => {
      const node = element('button', danger ? 'citizen-danger' : '', label);
      node.type = 'button';
      node.addEventListener('click', handler);
      return node;
    };
    if (pendingPlaceDelete === place.id) {
      li.append(reasonForm({
        prompt: t('Supprimer le lieu « {name} » ? Il disparaît du portail et du téléphone. Le motif est conservé dans le journal.', { name: place.name }), confirmLabel: t('Confirmer la suppression'), danger: true,
        onConfirm: async (reason) => { await api(`/api/places/${place.id}`, 'DELETE', { reason }); pendingPlaceDelete = null; await loadPlaces(); setFormStatus('#place-status', t('Lieu supprimé.')); $('#place-form').elements.name.focus(); },
        onCancel: () => { pendingPlaceDelete = null; renderPlaceAdmin(); $(`[data-place="${place.id}"] button`)?.focus(); },
      }));
    } else {
      actions.append(button(t('Modifier'), () => editPlace(place)), button(t('Historique'), () => showHistory('place', place.id, place.name)), button(t('Supprimer'), () => { pendingPlaceDelete = place.id; renderPlaceAdmin(); }, true));
      li.append(actions);
    }
    list.append(li);
  }
}

function editPlace(place) {
  const form = $('#place-form');
  editingPlace = place.id;
  for (const key of ['kind', 'name', 'name_en', 'district', 'stop', 'address', 'address_en', 'hours', 'hours_en', 'phone', 'service_id']) form.elements[key].value = place[key] ?? '';
  form.elements.open_24h.checked = Boolean(place.open_24h);
  $('#place-submit').textContent = t('Enregistrer les changements');
  $('#place-cancel').hidden = false;
  form.elements.name.focus();
}

function resetPlaceForm() {
  editingPlace = null;
  $('#place-form').reset();
  $('#place-submit').textContent = t('Enregistrer le lieu');
  $('#place-cancel').hidden = true;
}
$('#place-cancel').addEventListener('click', () => { resetPlaceForm(); setFormStatus('#place-status', ''); $('#place-form').elements.name.focus(); });
$('#place-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(['kind', 'name', 'name_en', 'district', 'stop', 'address', 'address_en', 'hours', 'hours_en', 'phone', 'service_id'].map((key) => [key, formValue(form, key)]));
  body.open_24h = form.elements.open_24h.checked;
  try {
    await (editingPlace ? api(`/api/places/${editingPlace}`, 'PATCH', body) : api('/api/places', 'POST', body));
    setFormStatus('#place-status', t(editingPlace ? 'Lieu modifié.' : 'Lieu ajouté.'));
    resetPlaceForm();
    await loadPlaces();
  } catch (error) {
    reportError('#place-status', error);
  }
});

// ---- F47 / F48: journal of actions (who, what, when, why), staff only
let audit = { entries: [], next: null, facets: null };
let auditTarget = null;
let auditTimer;
const auditRoles = { admin: 'Administrateur', agent: 'Agent', citizen: 'Habitant' };
const auditCategories = { service: 'Services', announcement: 'Actualités et alertes', transport: 'Transports', message: 'Messages des habitants', account: 'Comptes des habitants', appointment: 'Rendez-vous', place: 'Lieux', security: 'Sécurité', concern: 'Inquiétudes sur les données' };
const auditTime = (iso) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Indian/Reunion' }).format(new Date(iso));

// Any change made by staff refreshes the journal a moment later, so "what I just did" is there.
function auditSoon() {
  if (!['agent', 'admin'].includes(user?.role)) return;
  clearTimeout(auditTimer);
  auditTimer = setTimeout(() => { if (!document.activeElement?.closest?.('#audit-panel')) loadAudit(); }, 600);
}

function auditQuery() {
  const form = $('#audit-filter');
  const query = {};
  for (const key of ['actor', 'category', 'q', 'from', 'to']) if (form.elements[key].value) query[key] = form.elements[key].value;
  if (auditTarget) Object.assign(query, { target_type: auditTarget.type, target_id: auditTarget.id });
  return query;
}

async function loadAudit({ more = false } = {}) {
  if (!['agent', 'admin'].includes(user?.role)) return;
  const params = new URLSearchParams(auditQuery());
  if (more && audit.next) params.set('before', audit.next);
  try {
    const data = await api(`/api/admin/audit?${params}`);
    audit = { entries: more ? [...audit.entries, ...data.entries] : data.entries, next: data.next_before, facets: data.facets || audit.facets };
    $('#audit-csv').href = `/api/admin/audit?${new URLSearchParams({ ...auditQuery(), format: 'csv' })}`;
    renderAudit();
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    setFormStatus('#audit-status', error.message, true);
  }
}

function renderAuditFacets() {
  if (!audit.facets) return;
  const fill = (select, options) => {
    const keep = select.value;
    select.replaceChildren(Object.assign(element('option', '', t('Tous')), { value: '' }), ...options);
    select.value = keep;
  };
  fill($('#audit-actor'), audit.facets.actors.map((actor) => Object.assign(element('option', '', `${actor.name} (${t(auditRoles[actor.role] || actor.role)}, ${actor.actions})`), { value: actor.id ?? '' })));
  fill($('#audit-category'), audit.facets.categories.map((entry) => Object.assign(element('option', '', t(auditCategories[entry.category] || entry.category)), { value: entry.category })));
}

function auditDetails(details) {
  const labels = { avant: 'Avant', apres: 'Après', debut: 'Début', nombre: 'Nombre', duree_min: 'Durée (min)', lieu: 'Lieu', agent: 'Agent', public: 'Public concerné', urgent: 'Alerte', featured: 'À la une', type: 'Type', quartier: 'Quartier', arret: 'Arrêt', etat: 'État', motif: 'Motif', reprise: 'Reprise', alternative: 'Alternative', availability: 'Disponibilité', status: 'État', message: 'Message' };
  const show = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return t(value ? 'oui' : 'non');
    if (typeof value === 'object') return Object.entries(value).map(([key, inner]) => `${t(labels[key] || key)} : ${show(inner)}`).join(' · ');
    return String(value);
  };
  const list = element('dl', 'audit-details');
  for (const [key, value] of Object.entries(details)) list.append(element('dt', '', t(labels[key] || key)), element('dd', '', show(value)));
  return list;
}

function renderAudit() {
  renderAuditFacets();
  const target = $('#audit-target');
  target.hidden = !auditTarget;
  if (auditTarget) {
    const clear = element('button', '', t('Voir tout le journal'));
    clear.type = 'button';
    clear.addEventListener('click', () => { auditTarget = null; loadAudit(); $('#audit-filter').elements.q.focus(); });
    target.replaceChildren(`${t('Historique de : {name}', { name: auditTarget.label })} `, clear);
  }
  const list = $('#audit-list');
  list.replaceChildren();
  for (const entry of audit.entries) {
    const li = element('li', `audit-item audit-${entry.category}`);
    li.dataset.audit = entry.id;
    const head = element('p', 'audit-head');
    const time = element('time', '', auditTime(entry.at));
    time.dateTime = entry.at;
    head.append(time, element('span', 'audit-tag', t(auditCategories[entry.category] || entry.category)), element('span', 'audit-tag audit-role', t(auditRoles[entry.actor_role] || entry.actor_role)));
    const sentence = element('p', 'audit-sentence');
    sentence.lang = 'fr';
    sentence.append(element('strong', '', entry.actor_name), ` ${entry.summary}`);
    li.append(head, sentence);
    if (entry.reason) {
      const reason = element('p', 'audit-reason', `${t('Motif')} : ${entry.reason}`);
      reason.lang = 'fr';
      li.append(reason);
    }
    if (entry.details && Object.keys(entry.details).length) {
      const details = element('details', 'audit-more');
      details.append(element('summary', '', t('Voir les valeurs')), auditDetails(entry.details));
      li.append(details);
    }
    list.append(li);
  }
  $('#audit-more').hidden = !audit.next;
  setFormStatus('#audit-status', audit.entries.length ? t(audit.entries.length > 1 ? '{n} actions affichées.' : '{n} action affichée.', { n: audit.entries.length }) : t('Aucune action ne correspond.'));
}

function showHistory(type, id, label) {
  auditTarget = { type, id: String(id), label };
  const form = $('#audit-filter');
  for (const key of ['actor', 'category', 'q', 'from', 'to']) form.elements[key].value = '';
  loadAudit().then(() => $('#audit-panel').focus());
  $('#audit-panel').scrollIntoView({ block: 'start' });
}
const historyButton = (type, id, label) => {
  const button = element('button', '', t('Historique'));
  button.type = 'button';
  button.setAttribute('aria-label', t('Historique : {name}', { name: label }));
  button.addEventListener('click', () => showHistory(type, id, label));
  return button;
};

async function verifyAudit() {
  const box = $('#audit-integrity');
  try {
    const result = await api('/api/admin/audit/verify');
    box.dataset.error = String(!result.ok);
    box.textContent = result.ok
      ? `✓ ${t('Intégrité vérifiée : {n} entrées, aucune modification détectée.', { n: result.checked })}`
      : `⚠ ${t('Erreur :')} ${t('le journal a été modifié : l’entrée n°{id} ne correspond plus à la précédente.', { id: result.brokenAt })}`;
  } catch (error) {
    box.dataset.error = 'true';
    box.textContent = `⚠ ${t('Erreur :')} ${error.message}`;
  }
}
$('#audit-verify').addEventListener('click', verifyAudit);
$('#audit-filter').addEventListener('submit', (event) => { event.preventDefault(); loadAudit(); });
$('#audit-reset').addEventListener('click', () => { auditTarget = null; $('#audit-filter').reset(); loadAudit(); });
$('#audit-more').addEventListener('click', () => loadAudit({ more: true }));

// ---- F34 (with F47 reasons): resident accounts
function renderCitizens() {
  const list = $('#citizens-list');
  list.replaceChildren();
  for (const citizen of citizens) {
    const item = element('li', citizen.active ? 'citizen-item' : 'citizen-item citizen-inactive');
    item.dataset.citizen = citizen.id;
    const head = element('div', 'citizen-head');
    head.append(element('strong', '', citizen.name), element('span', `citizen-state state-${citizen.active ? 'on' : 'off'}`, t(citizen.active ? 'Actif' : 'Désactivé')));
    item.append(head, element('p', 'citizen-meta', [citizen.email, citizen.district].filter(Boolean).join(' · ')));
    const pending = pendingCitizen?.id === citizen.id ? pendingCitizen.kind : null;
    if (pending) {
      const prompts = {
        deactivate: t('Désactiver le compte de {name} ? Ses sessions sont fermées. Le motif est conservé dans le journal.', { name: citizen.name }),
        reset2fa: t('Retirer la vérification en deux étapes de {name} ? À faire seulement pour une personne qui a perdu son téléphone et ses codes de secours. Ses sessions sont fermées. Le motif est conservé dans le journal.', { name: citizen.name }),
        reset: t('Réinitialiser le mot de passe de {name} ? Un mot de passe temporaire sera affiché une seule fois. Le motif est conservé dans le journal.', { name: citizen.name }),
        delete: t('Supprimer définitivement le compte de {name} ? Ses messages et signalements seront aussi effacés. Le motif est conservé dans le journal.', { name: citizen.name }),
      };
      const labels = { deactivate: 'Confirmer la désactivation', reset2fa: 'Confirmer le retrait pour {name}', reset: 'Confirmer la réinitialisation', delete: 'Confirmer la suppression de {name}' };
      item.append(reasonForm({
        prompt: prompts[pending], confirmLabel: t(labels[pending], { name: citizen.name }), danger: true,
        onConfirm: (reason) => citizenAction(citizen, pending, reason),
        onCancel: () => { pendingCitizen = null; renderCitizens(); focusCitizen(citizen.id); },
      }));
    } else {
      const actions = element('div', 'citizen-actions');
      const action = (label, handler, danger) => {
        const button = element('button', danger ? 'citizen-danger' : '', t(label, { name: citizen.name }));
        button.type = 'button';
        button.addEventListener('click', handler);
        return button;
      };
      const ask = (kind) => () => { pendingCitizen = { id: citizen.id, kind }; $('#citizens-secret').hidden = true; renderCitizens(); };
      actions.append(
        citizen.active ? action('Désactiver {name}', ask('deactivate')) : action('Réactiver {name}', () => citizenAction(citizen, 'reactivate')),
        action('Réinitialiser le mot de passe de {name}', ask('reset')),
        ...(citizen.second_step ? [action('Retirer la vérification en deux étapes de {name}', ask('reset2fa'))] : []),
        action('Supprimer {name}', ask('delete'), true),
        historyButton('user', citizen.id, citizen.name),
      );
      item.append(actions);
    }
    list.append(item);
  }
}

// F65-F68 / F76: the civic participation module (participation.js, owned by B), mounted once and updated when the user or the language changes.
let participationHandle = null;
function mountParticipation() {
  const root = document.getElementById('participation-root');
  if (!root || !window.TerraParticipation) return;
  if (participationHandle) participationHandle.update({ user, lang });
  // the module shows server error messages as they come: they are translated here with the portal's dictionary; it reads /api/services itself when it needs them
  else participationHandle = window.TerraParticipation.mount(root, { user, lang, api: async (...args) => { try { return await api(...args); } catch (error) { error.message = t(error.message); throw error; } } });
}

async function afterAuthentication(nextUser) {
  formTokens.clear();
  user = nextUser;
  mountParticipation();
  if (user) setFormStatus('#account-status', '');
  renderIdentity();
  if (user?.role === 'admin') loadNews();
  renderServices();
  await loadMessages();
  loadNotices();
  loadConcerns();
  loadStaffConcerns();
  loadPublic();
  loadDevices();
  loadFactors();
  loadScopes();
  await loadFeed();
  loadCitizens();
  loadAppointments();
  loadStaffSlots();
  loadSecurity();
  loadAudit();
  renderPlaces();
  renderEmergency();
}

// ---- F53: "Sécurité de mon compte": the second verification step, for every signed-in role.
let securityState = null;
let factorsView = { mode: 'status' };
async function loadFactors() {
  if (!user) return;
  try {
    securityState = await api('/api/me/security');
    renderFactors();
  } catch (error) {
    if (error.status === 401) clearIdentity();
  }
}
function factorField(label, name, { type = 'text', hint, inputmode, autocomplete, maxlength } = {}) {
  const field = element('label', '', `${t(label)} `);
  const input = element('input');
  input.name = name;
  input.type = type;
  input.required = true;
  if (inputmode) input.inputMode = inputmode;
  if (autocomplete) input.autocomplete = autocomplete;
  if (maxlength) input.maxLength = maxlength;
  field.append(input);
  if (hint) field.append(element('small', 'field-hint', t(hint)));
  return { field, input };
}
function factorForm(fields, submitLabel, onSubmit, onCancel) {
  const form = element('form', 'factors-form');
  form.noValidate = false;
  for (const { field } of fields) form.append(field);
  const actions = element('div', 'factors-actions');
  const submit = element('button', 'button button-primary', t(submitLabel));
  submit.type = 'submit';
  actions.append(submit);
  if (onCancel) {
    const cancel = element('button', 'button', t('Annuler'));
    cancel.type = 'button';
    cancel.addEventListener('click', onCancel);
    actions.append(cancel);
  }
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    setFormStatus('#factors-status', ''); // an earlier error is not left standing while the new attempt runs
    setFormStatus('#passkeys-status', '');
    try {
      await onSubmit(Object.fromEntries(fields.map(({ input }) => [input.name, input.value.trim()])));
    } catch (error) {
      if (error.status === 401) return clearIdentity();
      reportError('#factors-status', error);
      submit.disabled = false;
      form.removeAttribute('aria-busy');
      (fields.find(({ input }) => input.name === 'code') || fields[0])?.input.focus();
    }
  });
  return form;
}
const setFactorsView = (view, status = '') => {
  factorsView = view;
  setFormStatus('#factors-status', status);
  renderFactors();
  const focus = $('#factors-body [data-first]') || $('#factors-body input') || $('#factors-body button');
  focus?.focus();
};
function renderFactors() {
  if (!securityState || !user) return;
  const body = $('#factors-body');
  body.replaceChildren();
  const { enabled, since, recovery_left: left } = securityState.totp;
  const staff = user.role !== 'citizen';
  $('#factors-state').textContent = enabled
    ? t('Vérification en deux étapes : activée depuis le {date}. Codes de secours restants : {n}.', { date: cityTime(since).split(' ')[0] || '', n: left })
    : t(staff ? 'Vérification en deux étapes : désactivée. Elle est fortement conseillée pour un compte d’agent ou d’administrateur.' : 'Vérification en deux étapes : désactivée.');
  renderPasskeys();
  renderPassword();
  const needPassword = securityState.has_password;
  const passwordField = () => factorField('Mot de passe', 'password', { type: 'password', autocomplete: 'current-password' });
  const mode = factorsView.mode;
  if (mode === 'status') {
    if (enabled && left <= 2) body.append(element('p', 'factors-warning', `⚠ ${t(left === 0 ? 'Il ne vous reste aucun code de secours : générez-en de nouveaux.' : 'Il ne vous reste que {n} code(s) de secours : générez-en de nouveaux.', { n: left })}`));
    const actions = element('div', 'factors-actions');
    const button = (label, handler) => { const b = element('button', 'button', t(label)); b.type = 'button'; b.addEventListener('click', handler); actions.append(b); return b; };
    if (!enabled) {
      const first = button('Activer la vérification en deux étapes', async () => { if (needPassword) setFactorsView({ mode: 'setup-password' }); else { try { await startFactorSetup({ proof: await reauthProof() }); } catch (error) { reportError('#factors-status', error); } } });
      first.classList.add('button-primary');
      first.dataset.first = '';
    } else {
      button('Générer de nouveaux codes de secours', () => setFactorsView({ mode: 'renew' }));
      button('Désactiver la vérification en deux étapes', () => setFactorsView({ mode: 'disable' }));
    }
    body.append(actions);
    return;
  }
  if (mode === 'setup-password') {
    const password = passwordField();
    password.input.dataset.first = '';
    body.append(element('p', '', t('Pour votre sécurité, saisissez d’abord votre mot de passe.')), factorForm([password], 'Continuer', (values) => startFactorSetup(values), () => setFactorsView({ mode: 'status' })));
    return;
  }
  if (mode === 'setup') {
    const { secret, grouped, otpauth } = factorsView;
    const steps = element('ol', 'factors-steps');
    steps.append(element('li', '', t('Installez une application d’authentification sur votre téléphone (par exemple Google Authenticator, Microsoft Authenticator, Aegis ou FreeOTP).')));
    const second = element('li', '', `${t('Ajoutez un compte : ouvrez le lien ci-dessous depuis votre téléphone, ou saisissez cette clé dans l’application.')} `);
    const link = element('a', 'receipt-link', t('Ouvrir dans mon application'));
    link.href = otpauth;
    second.append(link, element('br'), element('code', 'factors-secret', grouped));
    second.querySelector('code').setAttribute('aria-label', t('Clé secrète : {key}', { key: secret.split('').join(' ') }));
    steps.append(second, element('li', '', t('Saisissez le code à 6 chiffres que l’application affiche, pour vérifier que tout fonctionne.')));
    const code = factorField('Code à 6 chiffres', 'code', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8 });
    code.input.dataset.first = '';
    body.append(steps, factorForm([code], 'Activer', async (values) => {
      const data = await api('/api/me/2fa/enable', 'POST', { code: values.code });
      await loadFactors();
      setFactorsView({ mode: 'codes', codes: data.recovery_codes }, t('La vérification en deux étapes est activée.'));
    }, () => setFactorsView({ mode: 'status' })));
    return;
  }
  if (mode === 'codes') {
    const { codes } = factorsView;
    body.append(element('h4', '', t('Vos codes de secours')), element('p', '', t('Notez-les maintenant, à part de votre téléphone : ils ne seront plus jamais affichés. Chacun ne sert qu’une fois, si vous perdez l’application.')));
    const list = element('ol', 'recovery-codes');
    for (const item of codes) list.append(element('li', '', item));
    body.append(list);
    const actions = element('div', 'factors-actions');
    const copy = element('button', 'button', t('Copier les codes'));
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(codes.join('\n')); setFormStatus('#factors-status', t('Codes copiés.')); } catch { setFormStatus('#factors-status', t('La copie n’est pas possible ici : recopiez les codes à la main ou enregistrez-les dans un fichier.'), true); }
    });
    const save = element('button', 'button', t('Enregistrer dans un fichier'));
    save.type = 'button';
    save.addEventListener('click', () => {
      const link = element('a');
      link.href = URL.createObjectURL(new Blob([`Terra Nova — codes de secours\n${codes.join('\n')}\n`], { type: 'text/plain' }));
      link.download = 'terra-nova-codes-de-secours.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
    actions.append(copy, save);
    const confirm = element('label', 'check-field');
    const check = element('input');
    check.type = 'checkbox';
    confirm.append(check, ` ${t('J’ai noté mes codes de secours.')}`);
    const done = element('button', 'button button-primary', t('Terminer'));
    done.type = 'button';
    done.disabled = true;
    check.addEventListener('change', () => { done.disabled = !check.checked; });
    done.addEventListener('click', () => setFactorsView({ mode: 'status' }, t('C’est fait. Vos codes de secours ne sont plus affichés.')));
    body.append(actions, confirm, done);
    return;
  }
  // 'disable' and 'renew': the password and a code prove who is asking
  const fields = [...(needPassword ? [passwordField()] : []), factorField('Code de l’application ou code de secours', 'code', { autocomplete: 'one-time-code', maxlength: 14 })];
  fields[0].input.dataset.first = '';
  const renew = mode === 'renew';
  body.append(element('p', '', t(renew ? 'Les anciens codes de secours seront annulés. Prouvez que c’est bien vous.' : 'La protection sera retirée de votre compte : un mot de passe suffira de nouveau pour vous connecter. Prouvez que c’est bien vous.')),
    factorForm(fields, renew ? 'Générer de nouveaux codes' : 'Désactiver', async (values) => {
      const data = await api(renew ? '/api/me/2fa/recovery-codes' : '/api/me/2fa/disable', 'POST', needPassword ? values : { ...values, proof: await reauthProof() });
      await loadFactors();
      if (renew) setFactorsView({ mode: 'codes', codes: data.recovery_codes }, t('Nouveaux codes de secours : les anciens ne fonctionnent plus.'));
      else setFactorsView({ mode: 'status' }, t('La vérification en deux étapes est désactivée.'));
    }, () => setFactorsView({ mode: 'status' })));
}
async function startFactorSetup(values) {
  try {
    const data = await api('/api/me/2fa/setup', 'POST', values);
    setFactorsView({ mode: 'setup', ...data });
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    reportError('#factors-status', error);
    throw error;
  }
}

// F71: change the password (or set one on a password-less account).
function renderPassword() {
  const body = $('#password-body');
  body.replaceChildren();
  const has = securityState.has_password;
  const current = factorField('Mot de passe actuel', 'current', { type: 'password', autocomplete: 'current-password' });
  const next = factorField('Nouveau mot de passe', 'next', { type: 'password', autocomplete: 'new-password', hint: '12 caractères minimum.', maxlength: 128 });
  next.input.minLength = 12;
  body.append(factorForm([...(has ? [current] : []), next], has ? 'Changer mon mot de passe' : 'Définir un mot de passe', async (values) => {
    await api('/api/me/password', 'POST', has ? values : { next: values.next, proof: await reauthProof() });
    await loadFactors();
    setFormStatus('#factors-status', t(has ? 'Mot de passe changé. Vos autres connexions ont été fermées.' : 'Mot de passe défini. Il vous permet de vous reconnecter si vous perdez vos appareils.'));
  }));
}

// ---- D02: the passkeys of the account, in "Sécurité de mon compte".
let passkeysView = { mode: 'list' };
function renderPasskeys() {
  const body = $('#passkeys-body');
  body.replaceChildren();
  $('#identity-line').textContent = securityState.access_code ? t('Votre identifiant de connexion est votre code d’accès : {code}. Notez-le : il remplace l’adresse e-mail.', { code: securityState.identifier }) : '';
  const deletePassword = $('#delete-password-field');
  deletePassword.hidden = !securityState.has_password;
  deletePassword.querySelector('input').disabled = !securityState.has_password;
  deletePassword.querySelector('input').required = securityState.has_password;
  $('#delete-proof-note').hidden = securityState.has_password;
  if (!passkeysSupported()) { body.append(element('p', '', t('Cet appareil ou ce navigateur ne gère pas les clés d’accès.'))); return; }
  const { passkeys, has_password: hasPassword } = securityState;
  const list = element('ul', 'passkey-list');
  for (const item of passkeys) {
    const row = element('li', 'passkey-item');
    row.append(element('strong', '', item.label), element('span', '', ` · ${t('ajoutée le {date}', { date: cityTime(item.created_at).split(' ')[0] })}${item.last_used_at ? ` · ${t('utilisée pour la dernière fois le {date}', { date: cityTime(item.last_used_at).split(' ')[0] })}` : ''}`));
    const remove = element('button', 'button', t('Retirer'));
    remove.type = 'button';
    remove.setAttribute('aria-label', t('Retirer la clé d’accès {label}', { label: item.label }));
    remove.addEventListener('click', async () => {
      if (hasPassword) { passkeysView = { mode: 'remove', id: item.id, label: item.label }; renderPasskeys(); $('#passkeys-body input')?.focus(); return; }
      await removePasskey(item.id, {});
    });
    row.append(' ', remove);
    list.append(row);
  }
  body.append(passkeys.length ? list : element('p', '', t('Aucune clé d’accès n’est enregistrée.')));
  if (passkeysView.mode === 'add' || passkeysView.mode === 'remove') {
    const field = factorField('Mot de passe', 'password', { type: 'password', autocomplete: 'current-password' });
    field.input.dataset.first = '';
    const adding = passkeysView.mode === 'add';
    body.append(element('p', '', t(adding ? 'Pour votre sécurité, saisissez votre mot de passe, puis suivez les instructions de votre appareil.' : 'Pour retirer « {label} », saisissez votre mot de passe.', { label: passkeysView.label })),
      factorForm([field], adding ? 'Ajouter cette clé d’accès' : 'Retirer', async (values) => {
        if (adding) await addPasskey(values); else await removePasskey(passkeysView.id, values);
      }, () => { passkeysView = { mode: 'list' }; renderPasskeys(); }));
    return;
  }
  const add = element('button', 'button button-primary', t('Ajouter une clé d’accès'));
  add.type = 'button';
  add.addEventListener('click', async () => {
    if (hasPassword) { passkeysView = { mode: 'add' }; renderPasskeys(); $('#passkeys-body input')?.focus(); return; }
    try { await addPasskey({}); } catch (error) { reportError('#passkeys-status', error); }
  });
  body.append(add);
}
async function addPasskey(values) {
  setFormStatus('#passkeys-status', t('Suivez les instructions de votre appareil…'));
  const proof = securityState.has_password ? values : { proof: await reauthProof() };
  const options = await api('/api/me/passkeys/options', 'POST', proof);
  const credential = await createCredential(options);
  await api('/api/me/passkeys', 'POST', credential);
  passkeysView = { mode: 'list' };
  await loadFactors();
  setFormStatus('#passkeys-status', t('Clé d’accès ajoutée. Vous pouvez maintenant vous connecter avec.'));
  $('#passkeys-body button')?.focus();
}
async function removePasskey(id, values) {
  try {
    const proof = securityState.has_password ? values : { proof: await reauthProof() };
    await api(`/api/me/passkeys/${id}`, 'DELETE', proof);
    passkeysView = { mode: 'list' };
    await loadFactors();
    setFormStatus('#passkeys-status', t('Clé d’accès retirée.'));
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    reportError('#passkeys-status', error);
    if (securityState.has_password) throw error;
  }
}

// F70: administrators give each agent a perimeter of services.
async function loadScopes() {
  if (user?.role !== 'admin') return;
  try {
    const { agents } = await api('/api/admin/agents');
    const list = $('#scope-list');
    list.replaceChildren(...(agents.length ? agents : [null]).map((agent) => {
      if (!agent) return element('p', 'list-empty', t('Aucun agent.'));
      const box = element('fieldset', 'scope-agent');
      box.append(element('legend', '', `${agent.name} · ${agent.email}`));
      const checks = services.map((service) => {
        const label = element('label', 'check-field');
        const input = element('input');
        input.type = 'checkbox';
        input.value = service.id;
        input.checked = agent.services.includes(service.id);
        label.append(input, ` ${(lang === 'en' && service.title_en) || service.title}`);
        return { label, input };
      });
      for (const { label } of checks) box.append(label);
      const save = element('button', 'button', t('Enregistrer le périmètre de {name}', { name: agent.name }));
      save.type = 'button';
      save.addEventListener('click', async () => {
        try {
          const ids = checks.filter(({ input }) => input.checked).map(({ input }) => Number(input.value));
          await api(`/api/admin/agents/${agent.id}/scope`, 'PUT', { services: ids });
          setFormStatus('#scope-status', ids.length ? t('{name} ne voit plus que les demandes de {n} service(s) et celles sans service.', { name: agent.name, n: ids.length }) : t('{name} voit de nouveau toutes les demandes.', { name: agent.name }));
        } catch (error) { reportError('#scope-status', error); }
      });
      box.append(save);
      return box;
    }));
  } catch (error) { if (error.status === 401) clearIdentity(); }
}

// F83: anyone holding a reference and its code can ask whether the city received the request, and when. The answer never carries the content.
const requestKinds = { incident: 'Signalement de problème', contact: 'Question aux services' };
$('#verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api(`/api/receipts/verify?reference=${encodeURIComponent(formValue(form, 'reference'))}&code=${encodeURIComponent(formValue(form, 'code'))}&lang=${lang}`);
    if (data.valid) setFormStatus('#verify-status', t('Accusé valide : la ville a bien reçu la demande {reference} le {received} (heure de la cité). Type : {kind}. État actuel : {state}.', { reference: data.reference, received: data.received, kind: t(requestKinds[data.kind] || data.kind), state: t(statusLabels[data.status] || data.status) }));
    else setFormStatus('#verify-status', t('Cette référence et ce code ne correspondent à aucune demande reçue. Vérifiez-les ou demandez de l’aide à un agent.'), true);
  } catch (error) {
    reportError('#verify-status', error);
  }
});

$('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await guardedSend('register', form, (guard) => api('/api/auth/register', 'POST', {
      name: formValue(form, 'name'), email: formValue(form, 'email'), password: passwordValue(form), ...guard,
    }));
    form.reset();
    setFormStatus('#register-status', t('Compte créé. Bienvenue !'));
    await afterAuthentication(data.user);
    if (data.access_code) { showAccessCode(data.access_code); $('#access-code-notice').focus(); } else $('#member-name').focus();
  } catch (error) {
    reportError('#register-status', error);
  }
});

// ---- D02: passkeys (WebAuthn). The browser talks to the device; the server only ever sees public keys and signatures.
const passkeysSupported = () => Boolean(window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
const toBuffer = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)).buffer;
};
const fromBuffer = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function passkeyFailure(error) {
  const known = {
    NotAllowedError: 'La vérification a été annulée ou a pris trop de temps. Vous pouvez recommencer.',
    InvalidStateError: 'Cet appareil a déjà une clé d’accès pour ce compte.',
    SecurityError: 'Les clés d’accès demandent une connexion sécurisée (https).',
    NotSupportedError: 'Cet appareil ou ce navigateur ne prend pas en charge les clés d’accès.',
    AbortError: 'La vérification a été interrompue. Vous pouvez recommencer.',
  };
  if (error?.name in known) return Object.assign(new Error(t(known[error.name])), { passkey: true });
  return error;
}
async function createCredential(options) {
  try {
    const credential = await navigator.credentials.create({ publicKey: { ...options, challenge: toBuffer(options.challenge), user: { ...options.user, id: toBuffer(options.user.id) }, excludeCredentials: (options.excludeCredentials || []).map((item) => ({ ...item, id: toBuffer(item.id) })) } });
    return { id: credential.id, type: credential.type, response: { clientDataJSON: fromBuffer(credential.response.clientDataJSON), attestationObject: fromBuffer(credential.response.attestationObject) } };
  } catch (error) { throw passkeyFailure(error); }
}
async function getAssertion(options) {
  try {
    const credential = await navigator.credentials.get({ publicKey: { challenge: toBuffer(options.challenge), rpId: options.rpId, timeout: options.timeout, userVerification: options.userVerification, allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: toBuffer(item.id) })) } });
    const response = credential.response;
    return { id: credential.id, type: credential.type, response: { clientDataJSON: fromBuffer(response.clientDataJSON), authenticatorData: fromBuffer(response.authenticatorData), signature: fromBuffer(response.signature), userHandle: response.userHandle ? fromBuffer(response.userHandle) : null } };
  } catch (error) { throw passkeyFailure(error); }
}
// For an account with no password, a sensitive action is confirmed by a fresh passkey assertion made for that purpose.
const reauthProof = async () => getAssertion(await api('/api/me/reauth-options', 'POST', {}));

// F71: an account made without an e-mail address gets an access code, shown once and kept in "Sécurité de mon compte".
function showAccessCode(code) {
  $('#access-code-value').textContent = code;
  $('#access-code-notice').hidden = false;
}
$('#access-code-dismiss').addEventListener('click', () => { $('#access-code-notice').hidden = true; $('#member-name').focus(); });

async function afterPasskeyAuth(data, statusSelector) {
  setLoginStep(false);
  setFormStatus(statusSelector, t('Connexion réussie.'));
  await afterAuthentication(data.user);
  if (data.access_code) { showAccessCode(data.access_code); $('#access-code-notice').focus(); } else $('#member-name').focus();
}
$('#passkey-login').addEventListener('click', async () => {
  const button = $('#passkey-login');
  button.disabled = true;
  setFormStatus('#login-status', t('Suivez les instructions de votre appareil…'));
  try {
    const options = await api('/api/auth/passkey/options', 'POST', {});
    const assertion = await getAssertion(options);
    const data = await api('/api/auth/passkey/login', 'POST', assertion);
    $('#login-form').reset();
    await afterPasskeyAuth(data, '#login-status');
  } catch (error) {
    reportError('#login-status', error);
  } finally {
    button.disabled = false;
  }
});
$('#passkey-signup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type=submit]');
  submit.disabled = true;
  setFormStatus('#passkey-signup-status', t('Suivez les instructions de votre appareil…'));
  try {
    const data = await guardedSend('register', form, async (guard) => {
      const options = await api('/api/auth/passkey/signup-options', 'POST', { name: formValue(form, 'name'), email: formValue(form, 'email') });
      const credential = await createCredential(options);
      return api('/api/auth/passkey/signup', 'POST', { ...credential, ...guard });
    });
    form.reset();
    setFormStatus('#passkey-signup-status', t('Compte créé. Bienvenue !'));
    await afterPasskeyAuth(data, '#passkey-signup-status');
  } catch (error) {
    reportError('#passkey-signup-status', error);
  } finally {
    submit.disabled = false;
  }
});
$('#passkey-signup-form').addEventListener('focusin', () => warmFormToken('register'));
if (passkeysSupported()) { $('#login-alt').hidden = false; $('#passkey-signup-form').hidden = false; }

// F53: an account with a second step gets a ticket after the right password; the code (or a recovery code) then opens the session.
let loginTicket = null;
function setLoginStep(second) {
  const form = $('#login-form');
  $('#login-first').hidden = second;
  $('#login-second').hidden = !second;
  for (const input of form.querySelectorAll('#login-first input')) input.disabled = second;
  $('#login-alt').hidden = second || !passkeysSupported();
  const code = form.elements.code;
  code.disabled = !second;
  code.required = second;
  code.value = '';
  form.querySelector('button[type=submit]').textContent = t(second ? 'Vérifier le code' : 'Se connecter');
  $('#login-second-help').textContent = t('Votre mot de passe est correct. Saisissez maintenant le code à 6 chiffres affiché par votre application d’authentification.');
  $('#login-recovery-toggle').hidden = false;
  if (!second) loginTicket = null;
}
$('#login-recovery-toggle').addEventListener('click', () => {
  $('#login-second-help').textContent = t('Saisissez un de vos codes de secours (il ne sert qu’une fois), par exemple ABCDE-FGH23.');
  $('#login-recovery-toggle').hidden = true;
  $('#login-form').elements.code.value = '';
  $('#login-form').elements.code.focus();
});
$('#login-second-cancel').addEventListener('click', () => {
  setLoginStep(false);
  setFormStatus('#login-status', '');
  $('#login-form').elements.password.focus();
});
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = loginTicket
      ? await api('/api/auth/second-step', 'POST', { ticket: loginTicket, code: formValue(form, 'code') })
      : await api('/api/auth/login', 'POST', { email: formValue(form, 'email'), password: passwordValue(form) });
    if (data.second_step) {
      loginTicket = data.second_step.ticket;
      form.elements.password.value = '';
      setLoginStep(true);
      setFormStatus('#login-status', t('Mot de passe correct. Il reste à saisir le code de vérification.'));
      form.elements.code.focus();
      return;
    }
    setLoginStep(false);
    form.reset();
    setFormStatus('#login-status', t('Connexion réussie.'));
    await afterAuthentication(data.user);
    showSecurityNotice(data.notice);
    $('#member-name').focus();
  } catch (error) {
    if (error.code === 'second-step-expired') {
      setLoginStep(false);
      reportError('#login-status', error);
      $('#login-form').elements.password.focus();
      return;
    }
    reportError('#login-status', error, loginErrorMessage(error));
    if (error.status === 429 && error.retryAfter) lockLogin(error.retryAfter);
    if (loginTicket) $('#login-form').elements.code.select();
  }
});

$('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', 'POST');
    clearIdentity();
    setFormStatus('#account-status', t('Vous êtes déconnecté.'));
    $('#account-status').focus();
  } catch (error) {
    alert(error.message);
  }
});

$('#message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await guardedSend('message', form, (guard) => api('/api/messages', 'POST', { kind: formValue(form, 'kind'), topic: formValue(form, 'topic'), subject: formValue(form, 'subject'), location: formValue(form, 'location'), body: formValue(form, 'body'), service_id: formValue(form, 'service_id'), ...guard }));
    form.reset();
    renderServiceNotice();
    updateLocationField();
    dismissTip('message');
    dismissTip('report');
    setFormStatus('#message-status', t('{confirmation} Référence {reference}.', { confirmation: t(data.confirmation), reference: `M-${data.id}` }));
    $('#message-status').append(' ', receiptLink(data.id));
    await loadMessages();
  } catch (error) {
    reportError('#message-status', error);
  }
});

function updateLocationField() {
  const incident = $('#message-kind').value === 'incident';
  $('#location-field').hidden = !incident;
  $('#location-field input').required = incident;
}
$('#message-kind').addEventListener('change', updateLocationField);
updateLocationField();

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    ({ user } = await api('/api/me', 'PATCH', { name: formValue(form, 'name'), district: formValue(form, 'district') }));
    renderIdentity();
    setFormStatus('#profile-status', t('Profil enregistré.'));
  } catch (error) {
    reportError('#profile-status', error);
  }
});

$('#delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/api/me', 'DELETE', securityState && !securityState.has_password ? { proof: await reauthProof() } : { password: passwordValue(form) });
    form.reset();
    setFormStatus('#delete-status', '');
    clearIdentity();
    setFormStatus('#account-status', t('Votre compte a été supprimé. Vos données ont été effacées.'));
    $('#account-status').focus();
  } catch (error) {
    reportError('#delete-status', error);
  }
});

$('#service-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/api/services', 'POST', { title: formValue(form, 'title'), description: formValue(form, 'description'), details: formValue(form, 'details'), featured: form.elements.featured.checked, title_en: formValue(form, 'title_en'), description_en: formValue(form, 'description_en'), details_en: formValue(form, 'details_en') });
    form.reset();
    setFormStatus('#service-form-status', t('Service publié.'));
    await loadServices();
  } catch (error) {
    reportError('#service-form-status', error);
  }
});

$('#news-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/api/announcements', 'POST', { title: formValue(form, 'title'), body: formValue(form, 'body'), title_en: formValue(form, 'title_en'), body_en: formValue(form, 'body_en'), audience: formValue(form, 'audience'), urgent: form.elements.urgent.checked });
    form.reset();
    setFormStatus('#news-form-status', t('Actualité publiée.'));
    await loadNews();
  } catch (error) {
    reportError('#news-form-status', error);
  }
});

$('#search').addEventListener('input', renderRequests);
$('#service-search').addEventListener('input', renderServices);
$('#refresh-button').addEventListener('click', loadFeed);

// aria-disabled, not disabled: a button that becomes disabled while focused throws keyboard focus away.
const maxScale = 2;
let textScale = Math.min(maxScale, Math.max(1, Number(preference('textScale')) || 1));
const sizeStatus = Object.assign(element('span', 'visually-hidden'), { id: 'text-size-status' });
sizeStatus.setAttribute('role', 'status');
$('#font-up').closest('.accessibility-tools').append(sizeStatus);
function applyTextScale(announce = false) {
  document.documentElement.style.fontSize = `${textScale * 100}%`;
  document.documentElement.style.setProperty('--text-scale', textScale);
  $('#font-down').setAttribute('aria-disabled', String(textScale === 1));
  $('#font-up').setAttribute('aria-disabled', String(textScale === maxScale));
  if (announce) sizeStatus.textContent = t('Taille du texte : {n} %', { n: Math.round(textScale * 100) });
}
const changeScale = (step) => {
  const next = Math.min(maxScale, Math.max(1, textScale + step));
  if (next === textScale) return;
  textScale = next;
  preference('textScale', textScale);
  applyTextScale(true);
};
$('#font-up').addEventListener('click', () => changeScale(0.25));
$('#font-down').addEventListener('click', () => changeScale(-0.25));
applyTextScale();

function applyContrast() {
  // Without a choice of their own, follow the system's "more contrast" setting.
  const stored = preference('highContrast');
  const enabled = stored === null ? Boolean(window.matchMedia?.('(prefers-contrast: more)').matches) : stored === 'true';
  document.documentElement.dataset.contrast = enabled ? 'high' : 'normal';
  $('#contrast-toggle').setAttribute('aria-pressed', String(enabled));
}
// Static French text in index.html is translated in place; data lists ([data-content]) are re-rendered instead.
const originalText = new WeakMap();
function applyLanguage() {
  document.documentElement.lang = lang;
  document.title = t('Terra Nova — Le portail de la cité');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (node.parentElement.closest('[data-content]')) continue;
    if (!originalText.has(node)) {
      if (!(node.nodeValue.trim() in english)) continue;
      originalText.set(node, node.nodeValue);
    }
    const french = originalText.get(node);
    node.nodeValue = french.replace(french.trim(), t(french.trim()));
  }
  for (const target of document.querySelectorAll('[placeholder], [aria-label]')) {
    if (target.closest('[data-content]')) continue;
    if (!originalText.has(target)) originalText.set(target, { placeholder: target.getAttribute('placeholder'), 'aria-label': target.getAttribute('aria-label') });
    for (const [name, french] of Object.entries(originalText.get(target))) if (french) target.setAttribute(name, t(french));
  }
  const toggle = $('#lang-toggle');
  toggle.textContent = lang === 'en' ? 'Français' : 'English';
  toggle.lang = lang === 'en' ? 'fr' : 'en';
}
$('#lang-toggle').addEventListener('click', async () => {
  lang = lang === 'en' ? 'fr' : 'en';
  if (!(await ensureEnglish())) {
    // English was asked for and cannot be shown: stay in French, remember French (what the page really is) and say so.
    lang = 'fr';
    preference('lang', 'fr');
    applyLanguage();
    showLanguageFailure();
    return;
  }
  preference('lang', lang);
  $('#lang-status').hidden = true;
  applyLanguage();
  mountParticipation();
  renderIdentity();
  renderServices();
  renderTransports();
  renderNotifyButton();
  renderRequests();
  renderCitizens();
  renderTips();
  renderPlaces();
  renderEmergency();
  renderPlaceAdmin();
  renderAudit();
  renderServiceOptions();
  renderSlotSelect();
  renderMyAppointments();
  renderStaffSlots();
  renderSecurity();
  renderReminders(true);
  alertsKey = null;
  loadNews();
  loadMessages();
  loadFeed();
});
ensureEnglish().then((ready) => {
  // A stored English choice whose dictionary is unavailable right now: show French for this visit, keep the stored choice so the next visit tries again.
  if (!ready) { lang = 'fr'; showLanguageFailure(); }
  applyLanguage();
  updateDocumentLinks();
});

$('#contrast-toggle').addEventListener('click', () => { preference('highContrast', String(document.documentElement.dataset.contrast !== 'high')); applyContrast(); });
applyContrast();

// Polling (nothing live exists on this host). While the tab is hidden nothing is fetched, except what exists to alert someone who opted into browser
// notifications (urgent alerts, notices, appointment reminders). When the tab is visible again, or the network is back, stale data refreshes at once.
// With the browser's "data saver" on, every other tick is skipped.
const tabHidden = () => document.visibilityState === 'hidden';
const optedIn = () => 'Notification' in window && Notification.permission === 'granted';
let saverTick = 0;
const skipForSaver = () => Boolean(navigator.connection?.saveData) && saverTick++ % 2 === 1;
let lastFullRefresh = Date.now();
const staffRole = () => ['agent', 'admin'].includes(user?.role);

function refreshSlow() { loadTransports(); loadServices(); loadAppointments(); loadPlaces(); }
function refreshFast() {
  if (!document.activeElement?.closest?.('.reason-form')) loadNews();
  if (user) { loadMessages(); loadNotices(); loadConcerns(); loadStaffConcerns(); loadPublic(); }
  if (staffRole()) { loadFeed(); loadStaffSlots(); loadSecurity(); }
}
function refreshAll() { lastFullRefresh = Date.now(); refreshSlow(); refreshFast(); }
setInterval(() => {
  if (skipForSaver()) return;
  if (tabHidden()) { if (optedIn()) loadAppointments(); return; }
  lastFullRefresh = Date.now();
  refreshSlow();
}, 60_000);
setInterval(() => {
  if (skipForSaver()) return;
  if (tabHidden()) { if (optedIn()) { loadNews(); loadNotices(); } return; }
  refreshFast();
}, 30_000);
document.addEventListener('visibilitychange', () => { if (!tabHidden() && Date.now() - lastFullRefresh > 15_000) refreshAll(); });
window.addEventListener('online', () => refreshAll());
window.addEventListener('offline', () => setConnection(true));
ensureEnglish().then(() => Promise.allSettled([loadTopics(), loadServices(), loadTransports(), loadPlaces(), loadNews(), api('/api/me').then(({ user: savedUser }) => afterAuthentication(savedUser))]));
