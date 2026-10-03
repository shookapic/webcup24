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
  if (!response.ok) throw Object.assign(new Error(translateError(data.error || 'Une erreur est survenue.')), { status: response.status, retryAfter: data.retryAfter, attemptsLeft: data.attemptsLeft });
  return data;
}

function formValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() || '';
}

function passwordValue(form) {
  return new FormData(form).get('password')?.toString() || '';
}

function setFormStatus(selector, message, error = false) {
  const target = $(selector);
  target.textContent = message;
  target.dataset.error = String(error);
}

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
      card.append(toggle);
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
        lift.addEventListener('click', async () => {
          lift.disabled = true;
          try {
            await api(`/api/announcements/${item.id}`, 'PATCH', { urgent: false });
            await loadNews();
          } catch (error) {
            alert(error.message);
            lift.disabled = false;
          }
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
    setFormStatus('#traffic-status', error.message, true);
  }
});

function renderIdentity() {
  $('#guest-area').hidden = Boolean(user);
  $('#member-area').hidden = !user;
  $('#citizen-area').hidden = user?.role !== 'citizen';
  $('#staff-area').hidden = !['agent', 'admin'].includes(user?.role);
  $('#admin-area').hidden = user?.role !== 'admin';
  renderGuide();
  renderTips();
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
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await api(`/api/messages/${item.id}`, 'PATCH', { status: select.value });
          await loadMessages();
        } catch (error) {
          alert(error.message);
          select.disabled = false;
        }
      });
      label.append(select);
      card.append(label);
    }
    list.append(card);
  }
}

async function loadMessages() {
  if (!user) return;
  try {
    const { messages } = await api('/api/messages');
    renderMessages(messages);
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

function renderCitizens() {
  const list = $('#citizens-list');
  list.replaceChildren();
  for (const citizen of citizens) {
    const item = element('li', citizen.active ? 'citizen-item' : 'citizen-item citizen-inactive');
    item.dataset.citizen = citizen.id;
    const head = element('div', 'citizen-head');
    head.append(element('strong', '', citizen.name), element('span', `citizen-state state-${citizen.active ? 'on' : 'off'}`, t(citizen.active ? 'Actif' : 'Désactivé')));
    item.append(head, element('p', 'citizen-meta', [citizen.email, citizen.district].filter(Boolean).join(' · ')));
    const actions = element('div', 'citizen-actions');
    const action = (label, handler, danger) => {
      const button = element('button', danger ? 'citizen-danger' : '', t(label, { name: citizen.name }));
      button.type = 'button';
      button.addEventListener('click', handler);
      return button;
    };
    if (pendingDelete === citizen.id) {
      item.append(element('p', 'citizen-confirm', t('Supprimer définitivement le compte de {name} ? Ses messages et signalements seront aussi effacés.', { name: citizen.name })));
      actions.append(
        action('Confirmer la suppression de {name}', () => citizenAction(citizen, 'delete'), true),
        action('Annuler', () => { pendingDelete = null; renderCitizens(); focusCitizen(citizen.id); }),
      );
    } else {
      actions.append(
        action(citizen.active ? 'Désactiver {name}' : 'Réactiver {name}', () => citizenAction(citizen, 'toggle')),
        action('Réinitialiser le mot de passe de {name}', () => citizenAction(citizen, 'reset')),
        action('Supprimer {name}', () => { pendingDelete = citizen.id; $('#citizens-secret').hidden = true; renderCitizens(); focusCitizen(citizen.id); }, true),
      );
    }
    item.append(actions);
    list.append(item);
  }
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

async function citizenAction(citizen, kind) {
  $('#citizens-secret').hidden = true;
  try {
    if (kind === 'toggle') await api(`/api/admin/citizens/${citizen.id}`, 'PATCH', { active: !citizen.active });
    else if (kind === 'reset') showTemporaryPassword(citizen, (await api(`/api/admin/citizens/${citizen.id}/password`, 'POST')).password);
    else await api(`/api/admin/citizens/${citizen.id}`, 'DELETE');
    pendingDelete = null;
    await loadCitizens();
    if (kind === 'toggle') setCitizensStatus(t(citizen.active ? 'Compte de {name} désactivé.' : 'Compte de {name} réactivé.', { name: citizen.name }));
    if (kind === 'delete') setCitizensStatus(t('Compte de {name} supprimé.', { name: citizen.name }));
    if (kind === 'toggle') focusCitizen(citizen.id);
    if (kind === 'delete') $('#citizen-search').focus();
  } catch (error) {
    if (error.status === 401) return clearIdentity();
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
    setFormStatus('#availability-status', error.message, true);
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
  row(t('Heure'), t('de {start} à {end} (heure de Terra Nova, UTC+4)', { start: timeOf(item.starts_at), end: timeOf(item.ends_at) }));
  row(t('Avec'), item.agent);
  row(t('Lieu'), item.location, 'fr');
  row(t('À préparer'), item.instructions, 'fr');
  if (item.reason) row(t('Motif'), item.reason, 'fr');
  return box;
}

function renderSlotSelect() {
  const select = $('#appointment-slot');
  const keep = select.value;
  select.replaceChildren(Object.assign(element('option', '', t('Choisir un créneau…')), { value: '' }));
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
  $('#slot-preview').replaceChildren(...(slot ? [element('h4', '', t('Vous allez réserver')), appointmentDetails(slot)] : [element('p', 'slot-empty', slots.length ? '' : t('Aucun créneau libre pour le moment. Revenez plus tard.'))]));
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
    setFormStatus('#appointment-status', error.message, true);
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
      const calendar = element('a', 'button-link', t('Ajouter à mon agenda (.ics)'));
      calendar.href = `/api/appointments/${item.id}/ics`;
      actions.append(calendar);
      if (pendingCancel === item.id) {
        li.append(element('p', 'citizen-confirm', t('Annuler ce rendez-vous ? Le créneau sera proposé à d’autres habitants.')));
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
    setFormStatus('#appointment-status', t('Rendez-vous annulé. Le créneau est de nouveau proposé.'));
    $('#appointment-slot').focus();
  } catch (error) {
    setFormStatus('#appointment-status', error.message, true);
  }
}

$('#appointment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.elements.slot.value) {
    setFormStatus('#appointment-status', t('Choisissez d’abord un créneau.'), true);
    form.elements.slot.focus();
    return;
  }
  try {
    const { appointment } = await api(`/api/appointments/${form.elements.slot.value}/book`, 'POST', { reason: formValue(form, 'reason') });
    form.reset();
    setFormStatus('#appointment-status', '');
    const box = $('#appointment-confirmation');
    const calendar = element('a', 'button-link', t('Ajouter à mon agenda (.ics)'));
    calendar.href = `/api/appointments/${appointment.id}/ics`;
    box.replaceChildren(element('h4', '', t('Rendez-vous confirmé')), appointmentDetails(appointment),
      element('p', '', t('Rappel : un message s’affichera en haut de cette page 24 h puis 1 h avant. Vous pouvez aussi l’ajouter à votre agenda.')), calendar);
    box.hidden = false;
    await loadAppointments();
    box.focus();
  } catch (error) {
    setFormStatus('#appointment-status', error.message, true);
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
    setFormStatus('#slots-status', error.message, true);
  }
}

function renderStaffSlots() {
  const list = $('#staff-appointments');
  list.replaceChildren();
  if (!staffSlots.length) list.append(element('li', 'list-empty', t('Aucun créneau publié.')));
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
      li.append(element('p', 'citizen-confirm', t('Annuler ce rendez-vous ? {name} verra qu’il est annulé par la mairie.', { name: item.citizen.name })));
      actions.append(button(t('Confirmer l’annulation'), () => removeSlot(item), true), button(t('Garder le rendez-vous'), () => { pendingStaffCancel = null; renderStaffSlots(); }));
    } else if (booked) {
      actions.append(button(t('Annuler le rendez-vous'), () => { pendingStaffCancel = item.id; renderStaffSlots(); $(`[data-appointment="${item.id}"] .citizen-danger`).focus(); }, true));
    } else {
      actions.append(button(t('Retirer le créneau'), () => removeSlot(item), true));
    }
    li.append(actions);
    list.append(li);
  }
}

async function removeSlot(item) {
  try {
    await api(`/api/appointments/${item.id}`, 'DELETE');
    pendingStaffCancel = null;
    await loadStaffSlots();
    setFormStatus('#slots-status', t('Créneau mis à jour.'));
  } catch (error) {
    setFormStatus('#slots-status', error.message, true);
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
    setFormStatus('#slots-status', t(created > 1 ? '{n} créneaux publiés.' : '{n} créneau publié.', { n: created }));
    await loadStaffSlots();
  } catch (error) {
    setFormStatus('#slots-status', error.message, true);
  }
});

async function afterAuthentication(nextUser) {
  user = nextUser;
  if (user) setFormStatus('#account-status', '');
  renderIdentity();
  if (user?.role === 'admin') loadNews();
  renderServices();
  await loadMessages();
  await loadFeed();
  loadCitizens();
  loadAppointments();
  loadStaffSlots();
  loadSecurity();
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
  } catch (error) {
    setFormStatus('#register-status', error.message, true);
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
  } catch (error) {
    setFormStatus('#login-status', loginErrorMessage(error), true);
    if (error.status === 429 && error.retryAfter) lockLogin(error.retryAfter);
  }
});

$('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', 'POST');
    clearIdentity();
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
    setFormStatus('#message-status', error.message, true);
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
    setFormStatus('#profile-status', error.message, true);
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
    setFormStatus('#delete-status', error.message, true);
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
    setFormStatus('#service-form-status', error.message, true);
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
    setFormStatus('#news-form-status', error.message, true);
  }
});

$('#search').addEventListener('input', renderRequests);
$('#service-search').addEventListener('input', renderServices);
$('#refresh-button').addEventListener('click', loadFeed);

let textScale = Math.min(1.5, Math.max(1, Number(preference('textScale')) || 1));
function applyTextScale() {
  document.documentElement.style.fontSize = `${textScale * 100}%`;
  document.documentElement.style.setProperty('--text-scale', textScale);
  $('#font-down').disabled = textScale === 1;
  $('#font-up').disabled = textScale === 1.5;
}
$('#font-up').addEventListener('click', () => { textScale = Math.min(1.5, textScale + 0.25); preference('textScale', textScale); applyTextScale(); });
$('#font-down').addEventListener('click', () => { textScale = Math.max(1, textScale - 0.25); preference('textScale', textScale); applyTextScale(); });
applyTextScale();

function applyContrast() {
  const enabled = preference('highContrast') === 'true';
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

$('#contrast-toggle').addEventListener('click', () => { preference('highContrast', String(preference('highContrast') !== 'true')); applyContrast(); });
applyContrast();

setInterval(() => { loadTransports(); loadServices(); loadAppointments(); }, 60_000);
Promise.allSettled([loadServices(), loadTransports(), loadNews(), api('/api/me').then(({ user: savedUser }) => afterAuthentication(savedUser))]);
setInterval(() => { loadNews(); if (user) loadMessages(); if (['agent', 'admin'].includes(user?.role)) { loadFeed(); loadStaffSlots(); loadSecurity(); } }, 30_000);
