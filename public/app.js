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
  if (!response.ok) throw Object.assign(new Error(translateError(data.error || 'Une erreur est survenue.')), { status: response.status });
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
    card.append(element('h3', '', translated ? service.title_en : service.title));
    card.append(element('p', 'service-description', translated ? service.description_en || service.description : service.description));
    card.append(element('p', 'service-details', translated ? service.details_en || service.details : service.details));
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
    if (staff) card.append(element('p', 'message-author', `${item.citizen_name} · ${item.citizen_email}`));
    if (item.location) card.append(element('p', 'message-location', t('Lieu : {location}', { location: item.location })));
    card.append(element('p', 'message-body', item.body));
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

async function afterAuthentication(nextUser) {
  user = nextUser;
  if (user) setFormStatus('#account-status', '');
  renderIdentity();
  if (user?.role === 'admin') { loadNews(); renderServices(); }
  await loadMessages();
  await loadFeed();
  loadCitizens();
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
  } catch (error) {
    setFormStatus('#login-status', error.message, true);
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
    const data = await api('/api/messages', 'POST', { kind: formValue(form, 'kind'), subject: formValue(form, 'subject'), location: formValue(form, 'location'), body: formValue(form, 'body') });
    form.reset();
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
  alertsKey = null;
  loadNews();
  loadMessages();
  loadFeed();
});
applyLanguage();

$('#contrast-toggle').addEventListener('click', () => { preference('highContrast', String(preference('highContrast') !== 'true')); applyContrast(); });
applyContrast();

setInterval(loadTransports, 60_000);
Promise.allSettled([loadServices(), loadTransports(), loadNews(), api('/api/me').then(({ user: savedUser }) => afterAuthentication(savedUser))]);
setInterval(() => { loadNews(); if (user) loadMessages(); if (['agent', 'admin'].includes(user?.role)) loadFeed(); }, 30_000);
