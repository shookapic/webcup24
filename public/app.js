const $ = (selector) => document.querySelector(selector);
const statusLabels = { new: 'À traiter', in_progress: 'En cours', resolved: 'Résolu' };
let user = null;
let feed = null;
let knownCodes = null;
let loadingFeed = false;
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
  if (!response.ok) throw Object.assign(new Error(data.error || 'Une erreur est survenue.'), { status: response.status });
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

async function loadServices() {
  try {
    const { services } = await api('/api/services');
    const list = $('#services-list');
    list.replaceChildren();
    for (const service of services) {
      const card = element('article', 'service-card');
      card.append(element('span', 'service-number', String(service.id).padStart(2, '0')));
      card.append(element('h3', '', service.title));
      card.append(element('p', 'service-description', service.description));
      card.append(element('p', 'service-details', service.details));
      list.append(card);
    }
    $('#services-status').textContent = services.length ? '' : 'Aucun service publié pour le moment.';
  } catch (error) {
    $('#services-status').textContent = error.message;
  }
}

async function loadNews() {
  try {
    const { announcements } = await api('/api/announcements');
    renderAlerts(announcements.filter((item) => item.urgent));
    const list = $('#news-list');
    list.replaceChildren();
    for (const item of announcements) {
      const card = element('article', item.urgent ? 'news-card news-urgent' : 'news-card');
      const date = item.published_at ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(`${item.published_at.replace(' ', 'T')}Z`)) : '';
      if (item.urgent) card.append(element('strong', 'news-badge', 'Alerte en cours'));
      card.append(element('time', 'news-date', date));
      card.append(element('h3', '', item.title));
      card.append(element('p', 'news-audience', `Public concerné : ${item.audience}`));
      card.append(element('p', '', item.body));
      if (item.urgent && user?.role === 'admin') {
        const lift = element('button', 'lift-button', 'Lever l’alerte');
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
    $('#news-status').textContent = announcements.length ? '' : 'Aucune actualité publiée pour le moment.';
  } catch (error) {
    $('#news-status').textContent = error.message;
  }
}

function renderAlerts(alerts) {
  const fresh = knownAlerts ? alerts.filter((item) => !knownAlerts.has(item.id)) : [];
  knownAlerts = new Set(alerts.map((item) => item.id));
  if ('Notification' in window && Notification.permission === 'granted') {
    for (const item of fresh) new Notification(`Alerte Terra Nova · ${item.audience}`, { body: item.title, tag: `alerte-${item.id}` });
  }
  // Only touch the live region when the alerts change, so screen readers don't repeat them every refresh.
  const key = alerts.map((item) => item.id).join();
  if (key === alertsKey) return;
  alertsKey = key;
  $('#alert-banner').replaceChildren(...alerts.map((item) => {
    const box = element('div', 'alert-item');
    box.append(element('p', 'alert-label', `Alerte · ${item.audience}`), element('p', 'alert-title', item.title), element('p', 'alert-body', item.body));
    return box;
  }));
}

function renderNotifyButton() {
  const button = $('#notify-button');
  if (!('Notification' in window)) return;
  button.hidden = false;
  button.disabled = Notification.permission !== 'default';
  button.textContent = ({ granted: 'Alertes activées sur cet appareil ✓', denied: 'Notifications bloquées par le navigateur' })[Notification.permission] || 'Me prévenir des alertes';
}
$('#notify-button').addEventListener('click', async () => {
  await Notification.requestPermission();
  renderNotifyButton();
});
renderNotifyButton();

function renderIdentity() {
  $('#guest-area').hidden = Boolean(user);
  $('#member-area').hidden = !user;
  $('#citizen-area').hidden = user?.role !== 'citizen';
  $('#staff-area').hidden = !['agent', 'admin'].includes(user?.role);
  $('#admin-area').hidden = user?.role !== 'admin';
  if (!user) return;
  $('#member-name').textContent = user.name;
  $('#member-role').textContent = ({ citizen: 'Espace citoyen', agent: 'Espace agent', admin: 'Administration' })[user.role];
}

function clearIdentity() {
  user = null;
  feed = null;
  knownCodes = null;
  $('#citizen-messages').replaceChildren();
  $('#staff-messages').replaceChildren();
  $('#requests-list').replaceChildren();
  renderIdentity();
  loadNews();
}

function renderMessages(messages) {
  const staff = ['agent', 'admin'].includes(user?.role);
  const list = staff ? $('#staff-messages') : $('#citizen-messages');
  list.replaceChildren();
  if (staff) $('#pending-count').textContent = `${messages.filter((item) => item.status === 'new').length} à traiter`;
  if (!messages.length) {
    list.append(element('p', 'list-empty', staff ? 'Aucun message reçu pour le moment.' : 'Vous n’avez pas encore envoyé de message.'));
    return;
  }
  const priority = { new: 0, in_progress: 1, resolved: 2 };
  for (const item of [...messages].sort((a, b) => priority[a.status] - priority[b.status] || b.id - a.id)) {
    const card = element('article', 'message-card');
    const heading = element('div', 'message-heading');
    heading.append(element('h4', '', item.subject));
    heading.append(element('span', `message-status status-${item.status}`, statusLabels[item.status] || item.status));
    card.append(heading);
    card.append(element('p', 'message-kind', item.kind === 'incident' ? 'Signalement de problème' : 'Message aux services'));
    if (staff) card.append(element('p', 'message-author', `${item.citizen_name} · ${item.citizen_email}`));
    if (item.location) card.append(element('p', 'message-location', `Lieu : ${item.location}`));
    card.append(element('p', 'message-body', item.body));
    card.append(element('p', 'message-dates', `Reçu le ${item.created_at} · Dernière mise à jour le ${item.updated_at}`));
    if (staff) {
      const label = element('label', 'status-field', 'État ');
      const select = element('select');
      select.setAttribute('aria-label', `État du message ${item.id}`);
      for (const [value, title] of Object.entries(statusLabels)) {
        const option = element('option', '', title);
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
  const query = $('#search').value.trim().toLocaleLowerCase('fr');
  const requests = (feed?.requests || []).filter((item) =>
    `${item.request_code || ''} ${item.requester_name || ''} ${item.message_public || ''}`.toLocaleLowerCase('fr').includes(query)
  );
  const list = $('#requests-list');
  list.replaceChildren();
  for (const item of requests) {
    const card = element('article', 'request-card');
    const top = element('div', 'request-top');
    top.append(element('span', 'request-code', item.request_code || '—'));
    top.append(element('span', 'request-difficulty', item.difficulty || 'Difficulté inconnue'));
    card.append(top);
    card.append(element('h4', 'request-message', item.message_public || 'Demande sans description publique.'));
    card.append(element('p', 'requester', [item.requester_name, item.requester_type].filter(Boolean).join(' · ')));
    const bottom = element('div', 'request-bottom');
    bottom.append(element('span', '', item.is_initial ? 'Disponible au lancement' : `Vague ${item.wave_number ?? item.visible_since_wave ?? '—'}`));
    bottom.append(element('strong', '', `${item.xp_available ?? item.xp_total ?? '—'} XP`));
    card.append(bottom);
    list.append(card);
  }
  $('#requests-empty').textContent = requests.length ? '' : feed ? 'Aucune demande ne correspond à la recherche.' : 'Le flux est en cours de chargement.';
}

async function loadFeed() {
  if (!['agent', 'admin'].includes(user?.role) || loadingFeed) return;
  loadingFeed = true;
  $('#refresh-button').disabled = true;
  try {
    const data = await api('/api/requests');
    if (!data.session || !Array.isArray(data.requests)) throw new Error('Réponse API invalide.');
    const codes = new Set(data.requests.map((item) => item.request_code).filter(Boolean));
    const added = knownCodes ? [...codes].filter((code) => !knownCodes.has(code)).length : 0;
    knownCodes = codes;
    feed = data;
    $('#visible-count').textContent = `${data.session.visible_requests_count ?? data.requests.length} demandes`;
    $('#current-wave').textContent = `Vague ${data.session.current_wave ?? '—'}`;
    $('#next-wave').textContent = Number(data.session.next_wave_number) > 0
      ? `Vague ${data.session.next_wave_number} dans environ ${data.session.minutes_until_next_wave ?? '—'} min`
      : 'Aucune nouvelle vague annoncée';
    $('#feed-status').textContent = added ? `${added} nouvelle${added > 1 ? 's' : ''} demande${added > 1 ? 's' : ''} publiée${added > 1 ? 's' : ''}.` : 'Flux officiel à jour.';
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

async function afterAuthentication(nextUser) {
  user = nextUser;
  renderIdentity();
  if (user?.role === 'admin') loadNews();
  await loadMessages();
  await loadFeed();
}

$('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api('/api/auth/register', 'POST', {
      name: formValue(form, 'name'), email: formValue(form, 'email'), password: passwordValue(form),
    });
    form.reset();
    setFormStatus('#register-status', 'Compte créé. Bienvenue !');
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
    setFormStatus('#login-status', 'Connexion réussie.');
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
    setFormStatus('#message-status', `${data.confirmation} Référence n°${data.id}.`);
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

$('#service-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/api/services', 'POST', { title: formValue(form, 'title'), description: formValue(form, 'description'), details: formValue(form, 'details') });
    form.reset();
    setFormStatus('#service-form-status', 'Service publié.');
    await loadServices();
  } catch (error) {
    setFormStatus('#service-form-status', error.message, true);
  }
});

$('#news-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/api/announcements', 'POST', { title: formValue(form, 'title'), body: formValue(form, 'body'), audience: formValue(form, 'audience'), urgent: form.elements.urgent.checked });
    form.reset();
    setFormStatus('#news-form-status', 'Actualité publiée.');
    await loadNews();
  } catch (error) {
    setFormStatus('#news-form-status', error.message, true);
  }
});

$('#search').addEventListener('input', renderRequests);
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
$('#contrast-toggle').addEventListener('click', () => { preference('highContrast', String(preference('highContrast') !== 'true')); applyContrast(); });
applyContrast();

Promise.allSettled([loadServices(), loadNews(), api('/api/me').then(({ user: savedUser }) => afterAuthentication(savedUser))]);
setInterval(() => { loadNews(); if (user) loadMessages(); if (['agent', 'admin'].includes(user?.role)) loadFeed(); }, 30_000);
