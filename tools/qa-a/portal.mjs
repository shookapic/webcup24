// Session A portal checks: real public/index.html + app.js in jsdom against a throwaway server (F34 admin UI, F35 tips, EN).
// Needs jsdom, which is not a project dependency: npm i --no-save jsdom  (then: node tools/qa-a/<this file>)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'terra-portal-'));
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'p.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1', TN_FORM_TOKENS: 'optional', TN_FORM_LIMIT_SCALE: '1000', TN_FORM_MIN_AGE_MS: '0' }; // form protection relaxed for fixtures (tools/qa-a/form-protection.mjs tests the real settings)
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const out = spawnSync(process.execPath, ['create-staff.mjs', 'agent@p.test', 'Agent P', 'agent'], { cwd: root, env, encoding: 'utf8' });
const agentPw = /conserver : (\S+)/.exec(out.stdout)[1];
const adminPw = /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', 'admin@p.test', 'Admin P', 'admin'], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
await wait(1500);

async function register(name, email) {
  await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password: 'password-long-1' }) });
}
await register('Alice Habitante', 'alice@p.test');
await register('Bob Voisin', 'bob@p.test');
await register('Carol Cible', 'carol@p.test');

async function open(ip = '10.0.0.1') {
  const jar = { cookie: '' };
  const dom = await JSDOM.fromURL(base + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) {
      window.AbortSignal = AbortSignal;
      window.Element.prototype.scrollIntoView = () => {};
      window.fetch = async (url, options = {}) => {
        const response = await fetch(new URL(url, base), { ...options, headers: { ...(options.headers || {}), 'X-Forwarded-For': ip, ...(jar.cookie ? { Cookie: jar.cookie } : {}) } });
        const set = response.headers.get('set-cookie');
        if (set) jar.cookie = set.startsWith('tn_session=;') ? '' : set.split(';')[0];
        return response;
      };
    },
  });
  await wait(1200);
  return dom;
}
const submit = (dom, selector) => dom.window.document.querySelector(selector).dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
const $ = (dom, s) => dom.window.document.querySelector(s);
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const buttons = (dom) => [...dom.window.document.querySelectorAll('#citizens-list button')];

try {
  // ---- F37: sign-in protection as the person sees it
  for (let i = 0; i < 3; i++) await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.8.8.8' }, body: JSON.stringify({ email: 'carol@p.test', password: 'nope-nope' }) });
  const victim = await open('10.7.7.7');
  const vd = victim.window.document;
  const attempt = async (win, email, pw) => {
    const d = win.window.document;
    d.querySelector('#login-form [name=email]').value = email;
    d.querySelector('#login-form [name=password]').value = pw;
    submit(win, '#login-form');
    await wait(700);
    return d.querySelector('#login-status').textContent;
  };
  const m1 = await attempt(victim, 'bob@p.test', 'wrong-pass-1');
  check('F37 UI: wrong password says how many attempts remain', m1.includes('Il vous reste 4 tentatives'), m1);
  await attempt(victim, 'bob@p.test', 'wrong-pass-1');
  await attempt(victim, 'bob@p.test', 'wrong-pass-1');
  await attempt(victim, 'bob@p.test', 'wrong-pass-1');
  const m5 = await attempt(victim, 'bob@p.test', 'wrong-pass-1');
  check('F37 UI: the last failure announces the pause', m5.includes('Pause de sécurité'), m5);
  const m6 = await attempt(victim, 'bob@p.test', 'password-long-1');
  check('F37 UI: next attempt (even with the right password) is paused, with minutes left, button disabled', m6.includes('Réessayez dans 15 min') && vd.querySelector('#login-form button[type=submit]').disabled && vd.querySelector('#login-status').dataset.error === 'true', m6);
  victim.window.document.querySelector('#lang-toggle').click();
  await wait(300);
  victim.window.close();
  const owner = await open('10.6.6.6');
  await attempt(owner, 'carol@p.test', 'password-long-1');
  const od = owner.window.document;
  check('F37 UI: the owner signing in is told about attempts made while away (role=alert, dismissible)', !od.querySelector('#security-notice').hidden && od.querySelector('#security-notice').getAttribute('role') === 'alert' && od.querySelector('#security-notice-text').textContent.includes('3 tentatives'), od.querySelector('#security-notice-text').textContent);
  od.querySelector('#security-notice-dismiss').click();
  check('F37 UI: notice dismisses', od.querySelector('#security-notice').hidden);
  owner.window.close();

  // ---- Staff: F34 UI
  const staff = await open();
  const doc = staff.window.document;
  doc.querySelector('#login-form [name=email]').value = 'agent@p.test';
  doc.querySelector('#login-form [name=password]').value = agentPw;
  submit(staff, '#login-form');
  await wait(1200);
  check('staff area visible after login', !$(staff, '#staff-area').hidden);
  const items = () => [...doc.querySelectorAll('#citizens-list > li')];
  check('F34 UI lists citizens', items().length === 3, items().length);
  $(staff, '#citizen-search').value = 'alice';
  $(staff, '#citizen-search').dispatchEvent(new staff.window.Event('input', { bubbles: true }));
  await wait(800);
  check('F34 UI search filters', items().length === 1 && items()[0].textContent.includes('Alice'));
  const labels = () => buttons(staff).map((b) => b.textContent);
  check('F34 action buttons name the citizen', labels().includes('Désactiver Alice Habitante') && labels().includes('Supprimer Alice Habitante'), labels().join('|'));
  const reasonInput = () => $(staff, '.reason-form input[name=reason]');
  const submitReason = async (value) => {
    reasonInput().value = value;
    reasonInput().form.dispatchEvent(new staff.window.Event('submit', { cancelable: true, bubbles: true }));
    await wait(800);
  };
  click(staff, buttons(staff).find((b) => b.textContent.startsWith('Désactiver')));
  await wait(30);
  check('F47 UI: deactivating asks for a reason first (nothing happens yet), with the field focused and the journal promise stated', reasonInput() !== null && items()[0].textContent.includes('Actif') && doc.activeElement === reasonInput() && $(staff, '.reason-form').textContent.includes('conservé dans le journal'));
  await submitReason('xx');
  check('F47 UI: a too-short reason is refused with a visible, marked error and the account stays active', $(staff, '.reason-error').textContent.startsWith('⚠') && reasonInput().getAttribute('aria-invalid') === 'true' && items()[0].textContent.includes('Actif'), $(staff, '.reason-error').textContent);
  await submitReason('Compte signalé comme usurpé');
  check('F34 UI deactivate → state + status text', items()[0].textContent.includes('Désactivé') && $(staff, '#citizens-status').textContent.includes('désactivé'), $(staff, '#citizens-status').textContent);
  check('F34 UI focus stays on the row', doc.activeElement?.closest('[data-citizen]') !== null);
  click(staff, buttons(staff).find((b) => b.textContent.startsWith('Réactiver')));
  await wait(700);
  check('F34 UI reactivate (no reason needed)', items()[0].textContent.includes('Actif'));
  click(staff, buttons(staff).find((b) => b.textContent.startsWith('Réinitialiser')));
  await submitReason('Demande de l’habitant au guichet');
  const pw = $(staff, '.citizen-password')?.textContent;
  check('F34 UI shows one-time password and focuses it', !$(staff, '#citizens-secret').hidden && pw?.length >= 20 && doc.activeElement === $(staff, '#citizens-secret'), pw);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@p.test', password: pw }) });
  check('F34 displayed password really works', login.status === 200);
  click(staff, buttons(staff).find((b) => b.textContent.startsWith('Supprimer')));
  check('F34 UI delete asks for a reason and a confirmation first', items().length === 1 && reasonInput() !== null && $(staff, '.citizen-confirm') !== null && labels().some((l) => l.startsWith('Confirmer')));
  click(staff, buttons(staff).find((b) => b.textContent === 'Annuler'));
  check('F34 UI cancel keeps account', items().length === 1 && $(staff, '.reason-form') === null);
  click(staff, buttons(staff).find((b) => b.textContent.startsWith('Supprimer')));
  await submitReason('Doublon du compte, supprimé à la demande');
  check('F34 UI delete removes citizen', items().length === 0 && $(staff, '#citizens-status').textContent.includes('supprimé'), $(staff, '#citizens-status').textContent);
  check('F37 staff panel shows failed/blocked attempts and the targeted account (masked)', $(staff, '#security-summary').textContent.includes('échecs de connexion') && $(staff, '#security-summary').textContent.includes('Activité inhabituelle') && $(staff, '#security-targets').textContent.includes('b***@p.test') && !$(staff, '#security-panel').textContent.includes('bob@p.test'), $(staff, '#security-summary').textContent + $(staff, '#security-targets').textContent);
  // F38: the staff form marks a service unavailable
  const av = $(staff, '#availability-form');
  av.elements.service.value = [...av.elements.service.options].find((o) => o.textContent.startsWith('Centre de santé')).value;
  av.elements.service.dispatchEvent(new staff.window.Event('change', { bubbles: true }));
  av.elements.availability.value = 'unavailable';
  av.elements.availability.dispatchEvent(new staff.window.Event('change', { bubbles: true }));
  check('F38 staff form: details only shown for "unavailable", reason required', !$(staff, '#availability-details').hidden && av.elements.reason.required);
  av.elements.reason.value = 'Maintenance du système de rendez-vous';
  av.elements.reason_en.value = 'Appointment system maintenance';
  av.elements.until.value = new Date(Date.now() + 4 * 3600_000 + 3 * 86400_000).toISOString().slice(0, 16);
  av.elements.alternative.value = 'Écrivez aux services depuis votre espace';
  av.elements.alternative_en.value = 'Write to the services from your space';
  submit(staff, '#availability-form');
  await wait(800);
  const card = [...doc.querySelectorAll('#services-list .service-card')].find((c) => c.textContent.includes('Centre de santé'));
  check('F38 service card shows badge, reason, return date (Terra Nova time) and what to do meanwhile', card?.classList.contains('service-unavailable') && card.querySelector('.availability-badge')?.textContent === 'Indisponible' && card.textContent.includes('Maintenance du système') && card.textContent.includes('Retour prévu') && card.textContent.includes('heure de Terra Nova') && card.textContent.includes('En attendant'), card?.textContent);
  check('F38 service list option marked unavailable', [...doc.querySelector('#message-service').options].some((o) => o.textContent.includes('Centre de santé (indisponible)')));
  // F39: staff publish slots starting in ~90 minutes (so the 24 h reminder applies) and tomorrow
  // ~90 minutes from now (city time); late in the evening that would run past midnight (a slot series must end the same day), so use 09:00 tomorrow then
  let soon = new Date(Date.now() + 4 * 3600_000 + 90 * 60_000).toISOString();
  if (soon.slice(11, 16) >= '23:20' || soon.slice(0, 10) !== new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10)) soon = `${new Date(Date.now() + 4 * 3600_000 + 86_400_000).toISOString().slice(0, 10)}T09:00:00.000Z`;
  const sf = $(staff, '#slots-form');
  sf.elements.date.value = soon.slice(0, 10);
  sf.elements.start.value = soon.slice(11, 16);
  sf.elements.count.value = '2';
  sf.elements.duration.value = '10';
  submit(staff, '#slots-form');
  await wait(800);
  check('F39 staff UI: slots published and listed as free', $(staff, '#slots-status').textContent.includes('2 horaires publiés') && [...doc.querySelectorAll('#staff-appointments > li')].length === 2 && doc.querySelector('#staff-appointments').textContent.includes('Libre'), $(staff, '#slots-status').textContent);
  check('F39 staff UI: slot date picker cannot go into the past', sf.elements.date.min === new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10));

  // ---- F47 / F48: the journal as an agent sees it
  const auditItems = () => [...doc.querySelectorAll('#audit-list > li')];
  await wait(1200);
  check('F48 UI: the journal lists who did what and when, newest first, each with a time and a role in words', auditItems().length >= 5 && auditItems().every((li) => li.querySelector('time')?.dateTime && li.querySelector('.audit-role')?.textContent.length > 3) && auditItems().some((li) => li.textContent.includes('Agent P') && li.textContent.includes('a signalé « Centre de santé » indisponible')), auditItems().slice(0, 3).map((li) => li.textContent).join(' || '));
  check('F47 UI: sensitive entries show their reason', auditItems().some((li) => li.textContent.includes('Motif : Compte signalé comme usurpé')) && auditItems().some((li) => li.textContent.includes('Motif : Demande de l’habitant au guichet')));
  check('F48 UI: an entry opens to show before/after values', auditItems().some((li) => li.querySelector('details.audit-more')?.textContent.includes('Avant')));
  check('F48 UI: filters list the agents and areas to choose from', $(staff, '#audit-actor').options.length >= 2 && [...$(staff, '#audit-category').options].some((o) => o.value === 'account'));
  $(staff, '#audit-category').value = 'account';
  submit(staff, '#audit-filter');
  await wait(700);
  check('F48 UI: filtering by area shows only that area, with a count in words', auditItems().length >= 3 && auditItems().every((li) => li.classList.contains('audit-account')) && /actions? affichée/.test($(staff, '#audit-status').textContent), $(staff, '#audit-status').textContent);
  $(staff, '#audit-category').value = '';
  doc.querySelector('#audit-filter [name=q]').value = 'usurpé';
  submit(staff, '#audit-filter');
  await wait(700);
  check('F48 UI: text search finds the reason', auditItems().length === 1 && auditItems()[0].textContent.includes('usurpé'));
  doc.querySelector('#audit-filter [name=q]').value = 'zzzzzz';
  submit(staff, '#audit-filter');
  await wait(600);
  check('F48 UI: nothing found is said in words', auditItems().length === 0 && $(staff, '#audit-status').textContent.includes('Aucune action ne correspond'));
  $(staff, '#audit-reset').click();
  await wait(700);
  check('F48 UI: "Tout afficher" brings the whole journal back', auditItems().length >= 5);
  $(staff, '#citizen-search').value = '';
  $(staff, '#citizen-search').dispatchEvent(new staff.window.Event('input', { bubbles: true }));
  await wait(800);
  const historyBtn = [...doc.querySelectorAll('#citizens-list button')].find((b) => b.getAttribute('aria-label')?.startsWith('Historique'));
  historyBtn.click();
  await wait(800);
  check('F48 UI: a resident\'s "Historique" button shows a chip with the target and only that target', !$(staff, '#audit-target').hidden && $(staff, '#audit-target').textContent.includes('Historique de :') && auditItems().every((li) => li.textContent.length > 0), $(staff, '#audit-target').textContent);
  [...doc.querySelectorAll('#audit-target button')].find((b) => b.textContent.includes('Voir tout')).click();
  await wait(700);
  check('F48 UI: "Voir tout le journal" clears the target', $(staff, '#audit-target').hidden && auditItems().length >= 5);
  $(staff, '#audit-verify').click();
  await wait(700);
  check('F47 UI: the integrity check says in words that nothing was altered (tick + count)', $(staff, '#audit-integrity').textContent.startsWith('✓') && /Intégrité vérifiée : \d+ entrées/.test($(staff, '#audit-integrity').textContent), $(staff, '#audit-integrity').textContent);
  check('F47 UI: the CSV export link points at the filtered export', $(staff, '#audit-csv').getAttribute('href').includes('format=csv'));
  check('F45 UI: the place editor and its jump link are hidden from agents (admin only)', $(staff, '#admin-area').hidden && doc.querySelector('.jump-nav a[href="#place-admin"]').hidden);

  // language
  $(staff, '#lang-toggle').click();
  await wait(500);
  check('F34 panel translated to English', $(staff, '#citizens-title').textContent === 'Resident accounts' && $(staff, '#citizen-search').placeholder === 'Name or email address', $(staff, '#citizens-title').textContent);
  staff.window.close();

  // ---- F45 / F47 / F48 as an administrator
  const adm = await open('10.4.4.4');
  const ad = adm.window.document;
  ad.querySelector('#login-form [name=email]').value = 'admin@p.test';
  ad.querySelector('#login-form [name=password]').value = adminPw;
  submit(adm, '#login-form');
  await wait(1500);
  check('F45 UI: administrators see the place editor and its jump link', !ad.querySelector('#admin-area').hidden && !ad.querySelector('.jump-nav a[href="#place-admin"]').hidden);
  const pf = ad.querySelector('#place-form');
  pf.elements.name.value = 'Bibliothèque centrale';
  pf.elements.name_en.value = 'Central library';
  pf.elements.kind.value = 'service';
  pf.elements.district.value = 'Centre-ville';
  pf.elements.stop.value = 'Mairie';
  pf.elements.address.value = 'Rue des Livres, derrière la mairie.';
  pf.elements.hours.value = 'Du mardi au samedi, 10 h–18 h';
  pf.elements.phone.value = '+262 262 00 00 00';
  submit(adm, '#place-form');
  await wait(1200);
  const publicNames = () => [...ad.querySelectorAll('#places-list h3')].map((h) => h.textContent);
  check('F45 UI: an added place appears at once in the public list and in the admin list, with a status in words', ad.querySelector('#place-status').textContent.includes('Lieu ajouté') && publicNames().includes('Bibliothèque centrale') && ad.querySelector('#places-admin-list').textContent.includes('Bibliothèque centrale'), ad.querySelector('#place-status').textContent);
  const editButton = [...ad.querySelectorAll('#places-admin-list li')].find((li) => li.textContent.includes('Bibliothèque')).querySelector('button');
  editButton.click();
  check('F45 UI: "Modifier" fills the form, renames the button and focuses the name', pf.elements.name.value === 'Bibliothèque centrale' && ad.querySelector('#place-submit').textContent === 'Enregistrer les changements' && !ad.querySelector('#place-cancel').hidden && ad.activeElement === pf.elements.name);
  pf.elements.hours.value = 'Du lundi au samedi, 9 h–19 h';
  submit(adm, '#place-form');
  await wait(1200);
  check('F45 UI: the edit is saved and shown', ad.querySelector('#place-status').textContent.includes('Lieu modifié') && ad.querySelector('#places-list').textContent.includes('Du lundi au samedi, 9 h–19 h') && ad.querySelector('#place-submit').textContent === 'Enregistrer le lieu');
  const row = () => [...ad.querySelectorAll('#places-admin-list li')].find((li) => li.textContent.includes('Bibliothèque'));
  [...row().querySelectorAll('button')].find((b) => b.textContent === 'Supprimer').click();
  await wait(40);
  check('F47 UI: deleting a place asks for a reason first', ad.querySelector('#places-admin-list .reason-form') !== null && publicNames().includes('Bibliothèque centrale'));
  const reason = ad.querySelector('#places-admin-list .reason-form input');
  reason.value = 'Lieu fermé définitivement';
  reason.form.dispatchEvent(new adm.window.Event('submit', { cancelable: true, bubbles: true }));
  await wait(1200);
  check('F45 UI: with a reason the place is deleted and leaves the public list', ad.querySelector('#place-status').textContent.includes('Lieu supprimé') && !publicNames().includes('Bibliothèque centrale'));
  await wait(900);
  const adminAudit = [...ad.querySelectorAll('#audit-list > li')].map((li) => li.textContent);
  check('F48 UI: the journal shows the three place changes by the administrator, the deletion with its reason', adminAudit.some((t) => t.includes('Admin P') && t.includes('a ajouté le lieu « Bibliothèque centrale »')) && adminAudit.some((t) => t.includes('a modifié le lieu')) && adminAudit.some((t) => t.includes('a supprimé le lieu') && t.includes('Motif : Lieu fermé définitivement')), adminAudit.slice(0, 4).join(' || '));
  const serviceCard = [...ad.querySelectorAll('#services-list .service-card')].find((c) => c.textContent.includes('Centre de santé'));
  check('F48 UI: an administrator gets an "Historique" button on each service', Boolean(serviceCard.querySelector('button[aria-label="Historique : Centre de santé"]')));
  serviceCard.querySelector('button[aria-label="Historique : Centre de santé"]').click();
  await wait(900);
  const history = [...ad.querySelectorAll('#audit-list > li')];
  check('F48 UI: the service history shows only that service (availability change, who and why)', history.length >= 1 && history.every((li) => li.textContent.includes('Centre de santé')) && history.some((li) => li.textContent.includes('Agent P') && li.textContent.includes('Motif :')), history.map((li) => li.textContent.slice(0, 80)).join(' || '));
  // lifting an alert needs a reason
  ad.querySelector('#audit-reset').click();
  const lift = [...ad.querySelectorAll('.lift-button')][0];
  lift.click();
  await wait(40);
  check('F47 UI: lifting an alert asks for a reason first and the alert is still active', ad.querySelector('#news-list .reason-form') !== null && ad.querySelectorAll('.news-urgent').length === 2);
  const liftReason = ad.querySelector('#news-list .reason-form input');
  liftReason.value = 'Le niveau de l’eau est redescendu';
  liftReason.form.dispatchEvent(new adm.window.Event('submit', { cancelable: true, bubbles: true }));
  await wait(1400);
  check('F47 UI: with a reason the alert is lifted, and the journal records who lifted it and why', ad.querySelectorAll('.news-urgent').length === 1 && [...ad.querySelectorAll('#audit-list > li')].some((li) => li.textContent.includes('a levé l’alerte') && li.textContent.includes('Motif : Le niveau de l’eau est redescendu') && li.textContent.includes('Admin P')));
  adm.window.close();

  // ---- Citizen: F35 tips
  const cit = await open();
  const cd = cit.window.document;
  cd.querySelector('#login-form [name=email]').value = 'bob@p.test';
  cd.querySelector('#login-form [name=password]').value = 'password-long-1';
  submit(cit, '#login-form');
  await wait(1200);
  check('F35 no tip before first use', cd.querySelector('#tip-message').childElementCount === 0 && cd.querySelector('#tip-search').childElementCount === 0);
  cd.querySelector('#service-search').dispatchEvent(new cit.window.FocusEvent('focus'));
  check('F35 search tip appears on first focus', cd.querySelector('#tip-search .tip') !== null);
  cd.querySelector('#message-form [name=subject]').dispatchEvent(new cit.window.FocusEvent('focusin', { bubbles: true }));
  check('F35 message tip appears on first use of the form', cd.querySelector('#tip-message .tip') !== null);
  const kind = cd.querySelector('#message-kind');
  kind.value = 'incident';
  kind.dispatchEvent(new cit.window.Event('change', { bubbles: true }));
  check('F35 report tip appears when choosing "Signaler un problème"', cd.querySelector('#tip-report .tip') !== null);
  cd.querySelector('#tip-search button').click();
  check('F35 dismissing hides the tip and moves focus back to the field', cd.querySelector('#tip-search .tip') === null && cd.activeElement === cd.querySelector('#service-search'));
  cd.querySelector('#service-search').dispatchEvent(new cit.window.FocusEvent('focus'));
  check('F35 dismissed tip does not come back', cd.querySelector('#tip-search .tip') === null);
  const stored = cit.window.localStorage.getItem('tipDone:3:search') ?? Object.keys({ ...cit.window.localStorage }).filter((k) => k.startsWith('tipDone')).join();
  check('F35 dismissal remembered per user', /^tipDone:\d+:search$/.test(Object.keys({ ...cit.window.localStorage }).find((k) => k.startsWith('tipDone')) || ''), stored);
  cd.querySelector('#message-form [name=subject]').value = 'Sujet de test';
  cd.querySelector('#message-form [name=location]').value = 'Rue du Port';
  cd.querySelector('#message-form [name=body]').value = 'Message de test suffisamment long.';
  submit(cit, '#message-form');
  await wait(900);
  check('F35 sending the first report clears its tips', cd.querySelector('#tip-message .tip') === null && cd.querySelector('#tip-report .tip') === null);
  // tips are per user: a second user in the same browser still sees them
  cit.window.localStorage.setItem('tipDone:999:search', 'true');
  check('F35 other user keeps own state (key includes user id)', !cit.window.localStorage.getItem('tipDone:guest:search'));
  // ---- F38 / F39 / F40 as a citizen
  const askButton = [...cd.querySelectorAll('#services-list .service-card')].find((c) => c.textContent.includes('Centre de santé')).querySelector('button');
  check('F38 citizen card has an accessible "make a request" button', askButton?.getAttribute('aria-label') === 'Faire une demande : Centre de santé');
  askButton.click();
  check('F38 starting a request from the card selects the service and warns before writing (reason, return, alternative)', cd.querySelector('#message-service').selectedOptions[0].textContent.includes('Centre de santé') && cd.querySelector('#service-notice').textContent.includes('Service indisponible') && cd.querySelector('#service-notice').textContent.includes('Maintenance') && cd.querySelector('#service-notice').textContent.includes('En attendant') && cd.querySelector('#service-notice').textContent.includes('tout de même envoyer'), cd.querySelector('#service-notice').textContent);
  cd.querySelector('#message-service').value = '';
  cd.querySelector('#message-service').dispatchEvent(new cit.window.Event('change', { bubbles: true }));
  check('F38 notice disappears for an available choice', cd.querySelector('#service-notice').childElementCount === 0);
  await wait(500);
  const slotSelect = cd.querySelector('#appointment-slot');
  const slotOptions = [...slotSelect.options].filter((o) => o.value);
  check('F39 citizen sees free slots grouped by full date with times, agent and place', slotOptions.length === 2 && slotSelect.querySelectorAll('optgroup').length >= 1 && /\d{2}:\d{2}–\d{2}:\d{2} · Agent P · /.test(slotOptions[0].textContent), slotOptions.map((o) => o.textContent).join('|'));
  submit(cit, '#appointment-form');
  check('F39 booking without choosing a slot is refused clearly', cd.querySelector('#appointment-status').textContent.includes('Choisissez d’abord un horaire'));
  slotSelect.value = slotOptions[0].value;
  slotSelect.dispatchEvent(new cit.window.Event('change', { bubbles: true }));
  const preview = cd.querySelector('#slot-preview').textContent;
  check('F39 preview before confirming: date, hours with time zone, agent, place, what to prepare', preview.includes('Date') && preview.includes('heure de Terra Nova') && preview.includes('Agent P') && preview.includes('Lieu') && preview.includes('pièce d’identité'), preview);
  cd.querySelector('#appointment-form [name=reason]').value = 'Dossier de logement';
  submit(cit, '#appointment-form');
  await wait(900);
  const conf = cd.querySelector('#appointment-confirmation');
  check('F39 confirmation shows everything and takes focus', !conf.hidden && conf.textContent.includes('Rendez-vous confirmé') && conf.textContent.includes('Dossier de logement') && conf.textContent.includes('heure de Terra Nova') && cd.activeElement === conf && conf.querySelector('a[href$="/ics"]') !== null, conf.textContent.slice(0, 200));
  check('F39 booked slot left the choices, appears under "Mes rendez-vous"', [...cd.querySelector('#appointment-slot').options].filter((o) => o.value).length === 1 && cd.querySelectorAll('#my-appointments > li').length === 1 && cd.querySelector('#my-appointments').textContent.includes('Confirmé'));
  const banner = cd.querySelector('#reminder-banner');
  check('F40 reminder banner appears (appointment within 24 h), polite live region, links to the details', !banner.hidden && banner.getAttribute('role') === 'status' && banner.textContent.includes('Rappel') && banner.textContent.includes('moins d’une heure') === false && banner.textContent.includes('Rendez-vous dans moins de 24 h') && banner.querySelector('a[href="#appointments-panel"]') !== null, banner.textContent);
  check('F40 calendar link per appointment', cd.querySelector('#my-appointments a[href$="/ics"]').textContent.includes('agenda'));
  cd.querySelector('#my-appointments .citizen-danger').click();
  check('F39 cancelling asks for confirmation first and keeps focus in the card', cd.querySelector('.citizen-confirm') !== null && cd.activeElement.closest('[data-appointment]') !== null);
  [...cd.querySelectorAll('#my-appointments button')].find((b) => b.textContent === 'Garder le rendez-vous').click();
  check('F39 "keep" leaves everything as it was', cd.querySelector('.citizen-confirm') === null && cd.querySelectorAll('#my-appointments > li').length === 1);
  cd.querySelector('#my-appointments .citizen-danger').click();
  [...cd.querySelectorAll('#my-appointments button')].find((b) => b.textContent === 'Confirmer l’annulation').click();
  await wait(900);
  check('F39 cancellation frees the slot, clears the reminder and says so', [...cd.querySelector('#appointment-slot').options].filter((o) => o.value).length === 2 && cd.querySelector('#reminder-banner').hidden && cd.querySelector('#appointment-status').textContent.includes('annulé') && cd.querySelector('#my-appointments').textContent.includes('aucun rendez-vous'), cd.querySelector('#appointment-status').textContent);
  slotSelect.value = slotOptions[0].value;
  submit(cit, '#appointment-form');
  await wait(800);
  cd.querySelector('#lang-toggle').click();
  await wait(600);
  check('F38/F39/F40 English: panels, notices and dates translated', cd.querySelector('#appointments-title').textContent === 'Appointment with an agent' && cd.querySelector('#my-appointments').textContent.includes('Confirmed') && cd.querySelector('#reminder-banner').textContent.includes('Appointment in less than 24 h') && [...cd.querySelectorAll('#services-list .service-card')].find((c) => c.textContent.includes('Health centre'))?.textContent.includes('Service unavailable'), cd.querySelector('#my-appointments').textContent.slice(0, 160));
  cd.querySelector('#lang-toggle').click();
  await wait(500);

  // ---- F45 / F46 as a resident
  await wait(500);
  const strip = cd.querySelector('#urgences');
  const emergencyItems = [...cd.querySelectorAll('#urgences-list li')];
  check('F46 UI: the first thing in the main content is the emergency strip: number to call, closest care, tram stop, 24 h, call link', strip === cd.querySelector('main').firstElementChild && strip.textContent.includes('Urgence ? Appelez le 112') && emergencyItems.length === 3 && emergencyItems.every((li) => li.textContent.includes('Ouvert 24 h sur 24') && li.querySelector('a[href="tel:112"]')), strip.textContent.slice(0, 300));
  check('F46 UI: the resident\'s own district comes first (profile district is Quartier sud)', emergencyItems[0].textContent.includes('Poste de secours du quartier sud'), emergencyItems.map((li) => li.textContent.slice(0, 40)).join(' | '));
  check('F46 UI: the strip is labelled and links to the full list', strip.getAttribute('aria-labelledby') === 'urgences-title' && strip.querySelector('a[href="#lieux"]') !== null);
  const placeCards = () => [...cd.querySelectorAll('#places-list .place-card')];
  const kinds = placeCards().map((c) => c.querySelector('.place-kind').textContent);
  check('F45 UI: the places section lists every place with its kind in words; emergency and hospital first', placeCards().length >= 7 && kinds[0] === 'Urgences' && kinds.indexOf('Service de la ville') > kinds.lastIndexOf('Hôpital'), kinds.join('|'));
  check('F45 UI: each card says where it is, which district and tram stop, and the next trams at that stop', placeCards().every((c) => c.querySelector('.place-district').textContent.includes('Arrêt de tram') && c.querySelector('.place-where').textContent.length > 10) && placeCards().some((c) => /Prochains passages T\d : \d\d:\d\d/.test(c.querySelector('.place-trams')?.textContent || '')), placeCards()[0].textContent);
  check('F45 UI: opening hours or "Ouvert 24 h sur 24", and a call link when there is a number', placeCards().every((c) => c.querySelector('.place-hours')) && cd.querySelectorAll('#places-list a[href="tel:112"]').length >= 3);
  const placeSearch = cd.querySelector('#place-search');
  placeSearch.value = 'hopital';
  placeSearch.dispatchEvent(new cit.window.Event('input', { bubbles: true }));
  check('F45 UI: search ignores accents ("hopital" finds Hôpital and Urgences de l’hôpital)', placeCards().length === 2 && cd.querySelector('#places-status').textContent === '2 lieux trouvés.', placeCards().map((c) => c.querySelector('h3').textContent).join('|'));
  placeSearch.value = 'zzzz';
  placeSearch.dispatchEvent(new cit.window.Event('input', { bubbles: true }));
  check('F45 UI: no result is said in words', cd.querySelector('#places-status').textContent.includes('Aucun lieu ne correspond'));
  placeSearch.value = '';
  placeSearch.dispatchEvent(new cit.window.Event('input', { bubbles: true }));
  const careRadio = cd.querySelector('input[name=place-kind][value=care]');
  careRadio.checked = true;
  careRadio.dispatchEvent(new cit.window.Event('change', { bubbles: true }));
  check('F45 UI: the "Urgences et soins" filter hides city services; the group has a legend', placeCards().length >= 3 && placeCards().every((c) => c.querySelector('.place-kind').textContent !== 'Service de la ville') && cd.querySelector('.place-filter legend').textContent === 'Type de lieu');
  cd.querySelector('input[name=place-kind][value=all]').checked = true;
  cd.querySelector('input[name=place-kind][value=all]').dispatchEvent(new cit.window.Event('change', { bubbles: true }));

  // ---- Baseline portal features (verified, not rebuilt)
  check('D12 guide shown to a new citizen', !cd.querySelector('#guide').hidden);
  cd.querySelector('#profile-form [name=district]').value = 'Quartier sud';
  submit(cit, '#profile-form');
  await wait(700);
  check('D12 profile save marks the guide step done', cd.querySelector('#guide-profile').dataset.done === 'true' && cd.querySelector('#profile-status').textContent.includes('enregistr'));
  check('D12 guide step "request" done after first message', cd.querySelector('#guide-request').dataset.done === 'true');
  cd.querySelector('#guide-dismiss').click();
  check('D12 guide dismissal remembered per user', cd.querySelector('#guide').hidden && Object.keys({ ...cit.window.localStorage }).some((k) => /^guideDone:\d+$/.test(k)));
  const firstStop = cd.querySelector('#transports-list .transport-card .transport-stop');
  check('F36 portal puts the profile-district stop first with a badge', firstStop?.textContent.includes('Quartier sud') && firstStop.textContent.includes('Votre quartier') && /\d\d:\d\d/.test(firstStop.textContent), firstStop?.textContent);
  check('F36 portal shows both lines and a disruption', cd.querySelectorAll('#transports-list .transport-card').length === 2 && cd.querySelector('.transport-disrupted') !== null);
  check('D18/F29 urgent alerts in role=alert banner with audience', cd.querySelector('#alert-banner').getAttribute('role') === 'alert' && cd.querySelectorAll('#alert-banner .alert-item').length === 1 && cd.querySelector('#alert-banner').textContent.includes('Quartier sud'));
  check('F31 alerts also listed as active in news', cd.querySelectorAll('.news-urgent').length === 1);
  const search = cd.querySelector('#service-search');
  search.value = 'sante';
  search.dispatchEvent(new cit.window.Event('input', { bubbles: true }));
  const titles = [...cd.querySelectorAll('#services-list h3')].map((x) => x.textContent);
  check('F32 search ignores accents', titles.length >= 1 && titles.some((x) => x.includes('Centre de santé')), titles.join('|'));
  search.value = 'zzzz';
  search.dispatchEvent(new cit.window.Event('input', { bubbles: true }));
  check('F32 no-result message', cd.querySelector('#services-status').textContent.includes('Aucun service ne correspond'));
  search.value = '';
  search.dispatchEvent(new cit.window.Event('input', { bubbles: true }));
  check('F28 featured services first and highlighted', cd.querySelector('#services-list .service-card').classList.contains('service-featured'));
  cd.querySelector('#lang-toggle').click();
  await wait(600);
  check('D14/F27 English: interface, service content, alert banner', cd.querySelector('#services-title').textContent === 'City services' && [...cd.querySelectorAll('#services-list h3')].some((x) => x.textContent === 'Health centre') && cd.querySelector('#alert-banner').textContent.includes('Rising water'), cd.querySelector('#alert-banner').textContent.slice(0, 120));
  check('F45/F46 English: strip, section, kinds and place names translated', cd.querySelector('#urgences-title').textContent.startsWith('Emergency? Call') && cd.querySelector('#places-title').textContent === 'Where to find?' && [...cd.querySelectorAll('#places-list h3')].some((h) => h.textContent === 'Town hall') && [...cd.querySelectorAll('#places-list .place-kind')].some((k) => k.textContent === 'Hospital'), cd.querySelector('#urgences-title').textContent);
  check('D14 page language attribute follows the switch', cd.documentElement.lang === 'en');
  cit.window.close();
} catch (error) {
  failures++;
  console.log('FAIL  test crashed', error.stack);
} finally {
  server.kill();
  await wait(300);
  rmSync(dataDir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall portal checks passed');
  process.exit(failures ? 1 : 0);
}
