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
  return t(message);
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(translateError(data.error || 'Une erreur est survenue.')), { status: response.status, retryAfter: data.retryAfter, attemptsLeft: data.attemptsLeft, field: fieldsOf(data.error || '') });
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
  renderStaffConcerns();
  renderPublic();
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
  messageCount = 0;
  feed = null;
  knownCodes = null;
  $('#citizen-messages').replaceChildren();
  $('#staff-messages').replaceChildren();
  $('#requests-list').replaceChildren();
  citizens = [];
  pendingDelete = null;
  pendingCitizen = null;
  audit = { entries: [], next: null, facets: null };
  auditTarget = null;
  renderAudit();
  notices = [];
  staffConcerns = [];
  publicRequests = [];
  mySupports = [];
  publishOpen = null;
  for (const key of Object.keys(publishDrafts)) delete publishDrafts[key];
  noticeKey = null;
  dashboard = null;
  for (const id of ['#notices-list', '#public-list', '#supports-list', '#concerns-list', '#staff-concerns', '#notice-banner', '#dashboard-todo', '#dashboard-tiles', '#dashboard-recent']) $(id).replaceChildren();
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

function renderMessages(messages) {
  const staff = ['agent', 'admin'].includes(user?.role);
  const list = staff ? $('#staff-messages') : $('#citizen-messages');
  list.replaceChildren();
  messageCount = messages.length;
  renderGuide();
  if (staff) $('#pending-count').textContent = t('{n} à traiter', { n: messages.filter((item) => item.status === 'new').length });
  if (!messages.length) {
    list.append(element('p', 'list-empty', t(staff ? 'Aucun message reçu pour le moment.' : 'Vous n’avez pas encore envoyé de message.')));
    return;
  }
  const priority = { new: 0, in_progress: 1, resolved: 2 };
  for (const item of [...messages].sort((a, b) => priority[a.status] - priority[b.status] || b.id - a.id)) {
    const card = element('article', 'message-card');
    const heading = element('div', 'message-heading');
    heading.append(element('h4', '', item.subject));
    heading.append(element('span', `message-status status-${item.status}`, t(statusLabels[item.status] || item.status)));
    card.append(heading);
    card.append(element('p', 'message-kind', t(item.kind === 'incident' ? 'Signalement de problème' : 'Message aux services')));
    if (item.service_title) card.append(element('p', 'message-service', t('Service concerné : {title}', { title: (lang === 'en' && item.service_title_en) || item.service_title })));
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
    }
    card.dataset.message = item.id;
    if (staff && item.public_id) card.append(element('p', 'message-public', t(item.support_count === 1 ? 'Publié pour les habitants : 1 soutien.' : 'Publié pour les habitants : {n} soutiens.', { n: item.support_count })));
    if (!staff && item.kind === 'incident') card.append(publicControls(item));
    card.append(element('p', 'message-dates', t('Reçu le {created} · Dernière mise à jour le {updated}', { created: item.created_at, updated: item.updated_at })));
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
      noteField.append(note);
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await api(`/api/messages/${item.id}`, 'PATCH', note.value.trim() ? { status: select.value, note: note.value.trim() } : { status: select.value });
          await loadMessages();
        } catch (error) {
          alert(error.message);
          select.disabled = false;
        }
      });
      label.append(select);
      card.append(label, noteField);
    }
    list.append(card);
  }
}

// ---- F49: notices. The server writes one for the owner when a request really changes state; we poll and show them.
// No e-mail or SMS exists: they appear on the page and, if the person opted in with the alerts button, as a browser notification.
let notices = [];
let noticeKey = null;
const noticeLines = {
  'message.in_progress': ['Votre demande « {label} » est en cours de traitement.', 'Vous n’avez rien à faire pour le moment.'],
  'message.resolved': ['Votre demande « {label} » est résolue.', 'Si le problème persiste, envoyez-nous un nouveau message.'],
  'message.new': ['Votre demande « {label} » est de nouveau à traiter.', 'Vous n’avez rien à faire : un agent la reprendra.'],
  'public.in_progress': ['La demande « {label} » que vous soutenez est en cours de traitement.', 'Vous n’avez rien à faire. Merci de votre soutien.'],
  'public.resolved': ['La demande « {label} » que vous soutenez est résolue.', 'Merci de votre soutien.'],
  'public.new': ['La demande « {label} » que vous soutenez est de nouveau à traiter.', 'Vous n’avez rien à faire.'],
  'concern.read': ['Votre inquiétude {label} a été lue par un agent.', 'Vous n’avez rien à faire : une réponse peut suivre.'],
  'concern.answered': ['Votre inquiétude {label} a reçu une réponse.', 'Lisez la réponse ci-dessous ou dans « Mes inquiétudes envoyées ».'],
};
const noticeText = (item) => (noticeLines[item.code] ? t(noticeLines[item.code][0], { label: item.label }) : item.label);

async function loadNotices() {
  if (user?.role !== 'citizen') return;
  try {
    ({ notices } = await api('/api/me/notices'));
    renderNotices();
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
  const link = element('a', '', t('Voir mes nouvelles'));
  link.href = '#notices-panel';
  banner.replaceChildren(element('strong', '', `${t('Nouvelles')} · `), `${t(unread.length === 1 ? 'Vous avez 1 nouvelle sur vos demandes.' : 'Vous avez {n} nouvelles sur vos demandes.', { n: unread.length })} `, link);
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
async function loadDashboard() {
  if (!['agent', 'admin'].includes(user?.role)) return;
  try {
    dashboard = await api('/api/admin/dashboard');
    renderDashboard();
  } catch (error) {
    if (error.status === 401) return clearIdentity();
    $('#dashboard-todo').replaceChildren(element('li', 'list-empty', error.message));
  }
}

function renderDashboard() {
  if (!dashboard) return;
  const d = dashboard;
  const when = d.generated_at.replace('T', ' ');
  $('#dashboard-time').textContent = t('Mis à jour à {time} (heure de la cité)', { time: when.slice(11) });
  const todo = [];
  const plural = (n, one, many, params = {}) => t(n === 1 ? one : many, { n, ...params });
  if (d.messages.new) todo.push(plural(d.messages.new, '1 message attend une réponse.', '{n} messages attendent une réponse.') + (d.messages.waiting_hours ? ` ${t('Le plus ancien attend depuis {h} h.', { h: d.messages.waiting_hours })}` : ''));
  if (d.messages.incidents_open) todo.push(plural(d.messages.incidents_open, '1 signalement de problème n’est pas résolu.', '{n} signalements de problèmes ne sont pas résolus.'));
  if (d.concerns.received) todo.push(plural(d.concerns.received, '1 inquiétude sur les données attend une lecture.', '{n} inquiétudes sur les données attendent une lecture.'));
  if (d.appointments.booked_today) todo.push(plural(d.appointments.booked_today, '1 rendez-vous à venir aujourd’hui.', '{n} rendez-vous à venir aujourd’hui.'));
  if (d.services.unavailable.length) todo.push(t('Services indisponibles : {names}.', { names: d.services.unavailable.join(', ') }));
  if (d.alerts.active) todo.push(plural(d.alerts.active, '1 alerte urgente est affichée.', '{n} alertes urgentes sont affichées.'));
  if (d.transports.disrupted.length) todo.push(t('Lignes perturbées : {names}.', { names: d.transports.disrupted.join(', ') }));
  if (d.security.blocked_attempts || d.security.failed_logins >= 10) todo.push(t('Connexions : {failed} échecs et {blocked} tentatives bloquées (voir Sécurité).', { failed: d.security.failed_logins, blocked: d.security.blocked_attempts }));
  $('#dashboard-todo').replaceChildren(...(todo.length ? todo : [t('Rien d’urgent : aucune demande n’attend et rien n’est perturbé.')]).map((line) => element('li', '', line)));
  const tiles = [
    ['Messages à traiter', d.messages.new], ['Messages en cours', d.messages.in_progress], ['Messages résolus', d.messages.resolved],
    ['Inquiétudes à lire', d.concerns.received], ['Signalements publiés', d.public.requests], ['Soutiens donnés', d.public.supports], ['Messages reçus aujourd’hui', d.messages.received_today], ['Messages reçus sur 7 jours', d.messages.received_week],
    ['Rendez-vous réservés aujourd’hui', d.appointments.booked_today], ['Rendez-vous réservés sur 7 jours', d.appointments.booked_week], ['Horaires libres sur 7 jours', d.appointments.open_week],
    ['Habitants inscrits', d.residents.total], ['Nouveaux habitants sur 7 jours', d.residents.new_week],
    ...(d.residents.deactivated === undefined ? [] : [['Comptes désactivés', d.residents.deactivated]]),
    ['Services', d.services.total], ['Services indisponibles', d.services.unavailable.length], ['Alertes urgentes affichées', d.alerts.active], ['Lignes perturbées', d.transports.disrupted.length], ['Lieux de la ville', d.places],
    ['Échecs de connexion (15 min)', d.security.failed_logins], ['Tentatives bloquées (15 min)', d.security.blocked_attempts],
  ];
  $('#dashboard-tiles').replaceChildren(...tiles.map(([label, value]) => {
    const tile = element('div', 'dashboard-tile');
    tile.append(element('dt', '', t(label)), element('dd', '', String(value)));
    return tile;
  }));
  $('#dashboard-recent').replaceChildren(...(d.recent.length ? d.recent : [null]).map((row) => element('li', row ? '' : 'list-empty', row ? `${row.at.replace('T', ' ').slice(0, 16)} · ${row.actor_name} ${row.summary}` : t('Aucune action enregistrée.'))));
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
    const data = await api('/api/concerns', 'POST', { topic: formValue(form, 'topic'), body: formValue(form, 'body') });
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
  $('#public-list').replaceChildren(...(publicRequests.length ? publicRequests : [null]).map((item) => {
    if (!item) return element('li', 'list-empty', t('Aucun habitant n’a publié de signalement pour le moment.'));
    const line = element('li', 'notice-item');
    line.dataset.public = item.id;
    line.append(element('strong', '', item.public_title), element('span', 'notice-action', item.public_summary));
    line.append(element('span', '', `${t('Quartier : {district}', { district: item.district })} · ${t('État : {state}', { state: t(statusLabels[item.status]) })}`));
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
  try {
    const { messages } = await api('/api/messages');
    renderMessages(messages);
    loadDashboard();
  } catch (error) {
    if (error.status === 401) {
      clearIdentity();
      return;
    }
    const list = ['agent', 'admin'].includes(user.role) ? $('#staff-messages') : $('#citizen-messages');
    list.replaceChildren(element('p', 'list-empty', error.message));
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
$('#message-kind').addEventListener('change', () => { if ($('#message-kind').value === 'incident') showTip('report'); });

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
    else if (kind === 'reset') showTemporaryPassword(citizen, (await api(`/api/admin/citizens/${citizen.id}/password`, 'POST', { reason })).password);
    else await api(`/api/admin/citizens/${citizen.id}`, 'DELETE', { reason });
    pendingCitizen = null;
    await loadCitizens();
    if (kind === 'deactivate' || kind === 'reactivate') setCitizensStatus(t(kind === 'reactivate' ? 'Compte de {name} réactivé.' : 'Compte de {name} désactivé.', { name: citizen.name }));
    if (kind === 'delete') setCitizensStatus(t('Compte de {name} supprimé.', { name: citizen.name }));
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
  const unusual = security.blockedAttempts > 0 || security.failedLogins >= 10 || security.targeted.length > 0;
  $('#security-panel').classList.toggle('security-alert', unusual);
  $('#security-summary').textContent = `${t('{failed} échecs de connexion et {blocked} tentatives bloquées sur les {m} dernières minutes.', { failed: security.failedLogins, blocked: security.blockedAttempts, m: security.windowMinutes })} ${t(unusual ? 'Activité inhabituelle : la protection est active.' : 'Aucune activité inhabituelle.')}`;
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
        reset: t('Réinitialiser le mot de passe de {name} ? Un mot de passe temporaire sera affiché une seule fois. Le motif est conservé dans le journal.', { name: citizen.name }),
        delete: t('Supprimer définitivement le compte de {name} ? Ses messages et signalements seront aussi effacés. Le motif est conservé dans le journal.', { name: citizen.name }),
      };
      const labels = { deactivate: 'Confirmer la désactivation', reset: 'Confirmer la réinitialisation', delete: 'Confirmer la suppression de {name}' };
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
        action('Supprimer {name}', ask('delete'), true),
        historyButton('user', citizen.id, citizen.name),
      );
      item.append(actions);
    }
    list.append(item);
  }
}

async function afterAuthentication(nextUser) {
  user = nextUser;
  if (user) setFormStatus('#account-status', '');
  renderIdentity();
  if (user?.role === 'admin') loadNews();
  renderServices();
  await loadMessages();
  loadNotices();
  loadConcerns();
  loadStaffConcerns();
  loadPublic();
  await loadFeed();
  loadCitizens();
  loadAppointments();
  loadStaffSlots();
  loadSecurity();
  loadAudit();
  renderPlaces();
  renderEmergency();
}

$('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api('/api/auth/register', 'POST', {
      name: formValue(form, 'name'), email: formValue(form, 'email'), password: passwordValue(form),
    });
    form.reset();
    setFormStatus('#register-status', t('Compte créé. Bienvenue !'));
    await afterAuthentication(data.user);
    $('#member-name').focus();
  } catch (error) {
    reportError('#register-status', error);
  }
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api('/api/auth/login', 'POST', { email: formValue(form, 'email'), password: passwordValue(form) });
    form.reset();
    setFormStatus('#login-status', t('Connexion réussie.'));
    await afterAuthentication(data.user);
    showSecurityNotice(data.notice);
    $('#member-name').focus();
  } catch (error) {
    reportError('#login-status', error, loginErrorMessage(error));
    if (error.status === 429 && error.retryAfter) lockLogin(error.retryAfter);
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
    const data = await api('/api/messages', 'POST', { kind: formValue(form, 'kind'), subject: formValue(form, 'subject'), location: formValue(form, 'location'), body: formValue(form, 'body'), service_id: formValue(form, 'service_id') });
    form.reset();
    renderServiceNotice();
    updateLocationField();
    dismissTip('message');
    dismissTip('report');
    setFormStatus('#message-status', t('{confirmation} Référence n°{id}.', { confirmation: t(data.confirmation), id: data.id }));
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
    await api('/api/me', 'DELETE', { password: passwordValue(form) });
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
$('#lang-toggle').addEventListener('click', () => {
  lang = lang === 'en' ? 'fr' : 'en';
  preference('lang', lang);
  applyLanguage();
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
applyLanguage();

$('#contrast-toggle').addEventListener('click', () => { preference('highContrast', String(document.documentElement.dataset.contrast !== 'high')); applyContrast(); });
applyContrast();

setInterval(() => { loadTransports(); loadServices(); loadAppointments(); loadPlaces(); }, 60_000);
Promise.allSettled([loadServices(), loadTransports(), loadPlaces(), loadNews(), api('/api/me').then(({ user: savedUser }) => afterAuthentication(savedUser))]);
setInterval(() => { if (!document.activeElement?.closest?.('.reason-form')) loadNews(); if (user) { loadMessages(); loadNotices(); loadConcerns(); loadStaffConcerns(); loadPublic(); } if (['agent', 'admin'].includes(user?.role)) { loadFeed(); loadStaffSlots(); loadSecurity(); } }, 30_000);
