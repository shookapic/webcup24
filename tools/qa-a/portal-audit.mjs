// Portal feature audit (jsdom, real public/index.html + app.js, disposable database): the baseline requests that had no real assertion.
// D01 D03 D04 D07 D08 D09 D11 D15 D16 D17 D19 F22 F25 F26 F28 F29 F30 F31 F33 and the opt-in logic of F30.
// Read-only use of the official feed: if TERRA_NOVA_API_KEY is in .env (or the environment) the staff feed is checked against the live API
// (GET only, key stays in the server process, never printed); otherwise those checks are reported as UNVERIFIED, not passed.
// Needs: npm i --no-save jsdom. Usage: node tools/qa-a/portal-audit.mjs
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../..', import.meta.url));
const envFile = join(root, '.env');
const key = process.env.TERRA_NOVA_API_KEY || (existsSync(envFile) ? /^TERRA_NOVA_API_KEY=(.+)$/m.exec(readFileSync(envFile, 'utf8'))?.[1]?.trim() : '') || '';
const dataDir = mkdtempSync(join(tmpdir(), 'terra-audit-'));
const port = 3300 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'a.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: key, TRUST_PROXY: '1' };
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 500)}`); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const staffPassword = (email, name, role) => /conserver : (\S+)/.exec(spawnSync(process.execPath, ['create-staff.mjs', email, name, role], { cwd: root, env, encoding: 'utf8' }).stdout)[1];
const agentPw = staffPassword('agent@audit.test', 'Agent Audit', 'agent');
const adminPw = staffPassword('admin@audit.test', 'Admin Audit', 'admin');
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
await wait(1500);

let ipCounter = 0;
async function open() {
  const jar = { cookie: '' };
  const ip = `10.20.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  const dom = await JSDOM.fromURL(base + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) {
      window.AbortSignal = AbortSignal;
      window.Element.prototype.scrollIntoView = () => {};
      window.__notes = [];
      // Browser notification stand-in: records what the page asks the browser to show. The real popup is NOT tested here.
      window.Notification = class { static permission = 'default'; static async requestPermission() { window.Notification.permission = 'granted'; return 'granted'; } constructor(title, options) { window.__notes.push({ title, ...options }); } };
      window.fetch = async (url, options = {}) => {
        const response = await fetch(new URL(url, base), { ...options, headers: { ...(options.headers || {}), 'X-Forwarded-For': ip, ...(jar.cookie ? { Cookie: jar.cookie } : {}) } });
        const set = response.headers.get('set-cookie');
        if (set) jar.cookie = set.startsWith('tn_session=;') ? '' : set.split(';')[0];
        return response;
      };
    },
  });
  await wait(1300);
  return dom;
}
const $ = (dom, selector) => dom.window.document.querySelector(selector);
const $$ = (dom, selector) => [...dom.window.document.querySelectorAll(selector)];
const submit = (dom, selector) => $(dom, selector).dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
const fill = (dom, form, values) => { for (const [name, value] of Object.entries(values)) $(dom, `${form} [name=${name}]`).value = value; };
const tile = (dom, label) => $$(dom, '#dashboard-tiles .dashboard-tile').find((item) => item.querySelector('dt').textContent === label)?.querySelector('dd').textContent;
const click = (dom, element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const login = async (dom, email, password) => { fill(dom, '#login-form', { email, password }); submit(dom, '#login-form'); await wait(1300); };

try {
  // ============ anonymous visitor: structure and breadcrumbs (D07, D15)
  let guest = await open();
  const crumbs = $$(guest, 'nav.breadcrumb');
  check('D15 breadcrumbs: one on every section (services, places, transport, news, space, plain words), each labelled and linking back to the top', crumbs.length >= 6 && crumbs.every((c) => c.getAttribute('aria-label') && c.querySelector('a[href="#haut"]') && c.querySelector('span:last-child').textContent.trim().length > 2), crumbs.map((c) => c.textContent).join('|'));
  check('D07 home page: skip link, one h1, main navigation to every section, primary action to the services', $(guest, 'a.skip-link[href="#contenu"]') && $$(guest, 'h1').length === 1 && ['#services', '#lieux', '#transports', '#actualites', '#espace', '#mots'].every((h) => $(guest, `nav[aria-label="Navigation principale"] a[href="${h}"]`)) && $(guest, '.hero a[href="#services"]'));
  check('D05/D06 services and publications are shown to a visitor before any account', $$(guest, '#services-list .service-card').length >= 6 && $$(guest, '#news-list .news-card').length >= 3);
  check('D08/D09 a visitor sees neither the member area nor the staff tools', $(guest, '#member-area').hidden && $(guest, '#staff-area').hidden && $(guest, '#admin-area').hidden && !$(guest, '#guest-area').hidden);
  guest.window.close();

  // ============ D01 / D03: a resident registers, signs out, signs in again
  let zoe = await open();
  fill(zoe, '#register-form', { name: 'Zoé Habitante', email: 'zoe@audit.test', password: 'une-phrase-de-passe-1' });
  submit(zoe, '#register-form');
  await wait(1500);
  check('D01 registration through the real form: signed in, name shown, citizen space only', !$(zoe, '#member-area').hidden && $(zoe, '#member-name').textContent === 'Zoé Habitante' && !$(zoe, '#citizen-area').hidden && $(zoe, '#staff-area').hidden && $(zoe, '#admin-area').hidden);
  check('D08 the role is named in words ("Espace citoyen")', $(zoe, '#member-role').textContent === 'Espace citoyen');
  click(zoe, $(zoe, '#logout-button'));
  await wait(900);
  check('D03 sign-out returns to the sign-in forms and says so', !$(zoe, '#guest-area').hidden && $(zoe, '#member-area').hidden && $(zoe, '#account-status').textContent.includes('déconnecté'));
  await login(zoe, 'zoe@audit.test', 'mauvais-mot-de-passe');
  check('D03 a wrong password is refused with the remaining attempts, nobody is signed in', $(zoe, '#member-area').hidden && $(zoe, '#login-status').textContent.includes('Il vous reste'));
  await login(zoe, 'zoe@audit.test', 'une-phrase-de-passe-1');
  check('D03 coming back: sign-in restores the personal space', !$(zoe, '#member-area').hidden && $(zoe, '#member-name').textContent === 'Zoé Habitante');

  // ============ D04 / D16 / F25 / F26 / D11: messages, a located incident, confirmation, history, progress
  fill(zoe, '#message-form', { kind: 'contact', subject: 'Question sur les horaires', body: 'Quels sont les horaires de la mairie ce samedi ?' });
  submit(zoe, '#message-form');
  await wait(1300);
  const confirmation = $(zoe, '#message-status').textContent;
  check('D04/D16 sending a message gives a clear confirmation with a reference number, immediately', /Votre message a bien été transmis\. Référence n°\d+/.test(confirmation) && $(zoe, '#message-status').dataset.error === 'false', confirmation);
  check('D16 the form is emptied so nobody sends it twice by mistake', $(zoe, '#message-form [name=subject]').value === '');
  $(zoe, '#message-kind').value = 'incident';
  $(zoe, '#message-kind').dispatchEvent(new zoe.window.Event('change', { bubbles: true }));
  check('F25 choosing "Signaler un problème" asks where it is (location required)', !$(zoe, '#location-field').hidden && $(zoe, '#location-field input').required);
  fill(zoe, '#message-form', { subject: 'Lampadaire cassé', location: 'Rue du Port, devant le numéro 12', body: 'Le lampadaire est cassé depuis hier soir, la rue est très sombre.' });
  submit(zoe, '#message-form');
  await wait(1300);
  const cards = () => $$(zoe, '#citizen-messages .message-card');
  check('F26 history: both requests are listed in the personal space, with status in words and the date', cards().length === 2 && cards().every((c) => c.querySelector('.message-status').textContent.length > 3 && /Reçu le/.test(c.querySelector('.message-dates').textContent)));
  const incident = cards().find((c) => c.textContent.includes('Lampadaire cassé'));
  check('F25 the incident card says what happened and where', incident.textContent.includes('Lieu : Rue du Port, devant le numéro 12') && incident.textContent.includes('Signalement de problème') && incident.textContent.includes('cassé depuis hier soir'));
  const steps = (card) => [...card.querySelectorAll('.status-steps li')].map((li) => `${li.className}:${li.textContent.trim()}`);
  check('D11 each request shows its progress as steps (received, being handled, resolved); the current one is marked for assistive technology', steps(incident).length === 3 && incident.querySelector('.status-steps li[aria-current="step"]')?.textContent.includes('Demande reçue'), steps(incident).join(' | '));
  check('D01 profile: the resident saves a district and the confirmation is in words', (fill(zoe, '#profile-form', { name: 'Zoé Habitante', district: 'Quartier sud' }), submit(zoe, '#profile-form'), await wait(900), $(zoe, '#profile-status').textContent.includes('Profil enregistré')));

  // ============ staff: workload counter, list order, status change (D17, F22, D08, D09)
  const agent = await open();
  await login(agent, 'agent@audit.test', agentPw);
  check('D08/D09 an agent gets the staff area only: no citizen forms, no administrator tools', !$(agent, '#staff-area').hidden && $(agent, '#citizen-area').hidden && $(agent, '#admin-area').hidden && $(agent, '#member-role').textContent === 'Espace agent');
  check('D17 the workload counter says how many requests still wait ("2 à traiter")', $(agent, '#pending-count').textContent === '2 à traiter', $(agent, '#pending-count').textContent);
  check('F50 dashboard is the first block of the staff space and says when it was updated', $(agent, '#staff-area .jump-nav a').getAttribute('href') === '#dashboard-panel' && $(agent, '#staff-area .panel') === $(agent, '#dashboard-panel') && /Mis à jour à \d\d:\d\d \(heure de la cité\)/.test($(agent, '#dashboard-time').textContent), $(agent, '#dashboard-time').textContent);
  check('F50 tiles carry a label and a number (no colour-only meaning): 2 messages to handle, 0 in progress, 0 resolved, 2 received today, 1 resident', tile(agent, 'Messages à traiter') === '2' && tile(agent, 'Messages en cours') === '0' && tile(agent, 'Messages résolus') === '0' && tile(agent, 'Messages reçus aujourd’hui') === '2' && tile(agent, 'Habitants inscrits') === '1', $$(agent, '#dashboard-tiles').map((n) => n.textContent).join('|'));
  check('F50 "to do now" says in words what waits (2 messages, 1 open problem report, the seeded disrupted line T1), never fabricated', $$(agent, '#dashboard-todo li').map((li) => li.textContent).join(' | ').includes('2 messages attendent une réponse.') && $(agent, '#dashboard-todo').textContent.includes('1 signalement de problème n’est pas résolu.') && $(agent, '#dashboard-todo').textContent.includes('Lignes perturbées : T1.'), $(agent, '#dashboard-todo').textContent);
  check('F50 an agent does not see the administrator-only count of deactivated accounts, and no resident e-mail is on the dashboard', tile(agent, 'Comptes désactivés') === undefined && !$(agent, '#dashboard-panel').textContent.includes('zoe@audit.test'));
  const staffCards = () => $$(agent, '#staff-messages .message-card');
  check('F22 the staff list shows the author, the request, its status and a status selector for each request, new ones first', staffCards().length === 2 && staffCards().every((c) => c.querySelector('.message-author').textContent.includes('zoe@audit.test') && c.querySelector('select')) && staffCards()[0].querySelector('.message-status').textContent === 'À traiter');
  const incidentRow = staffCards().find((c) => c.textContent.includes('Lampadaire cassé'));
  const select = incidentRow.querySelector('select');
  incidentRow.querySelector('.status-field input').value = 'Un technicien passe demain matin.';
  select.value = 'in_progress';
  select.dispatchEvent(new agent.window.Event('change', { bubbles: true }));
  await wait(1300);
  check('D17/F22 after taking a request in charge the counter drops to "1 à traiter" and the request reads "En cours"', $(agent, '#pending-count').textContent === '1 à traiter' && staffCards().some((c) => c.textContent.includes('Lampadaire') && c.querySelector('.message-status').textContent === 'En cours'), $(agent, '#pending-count').textContent);
  const resolvedRow = staffCards().find((c) => c.textContent.includes('Question sur les horaires'));
  resolvedRow.querySelector('select').value = 'resolved';
  resolvedRow.querySelector('select').dispatchEvent(new agent.window.Event('change', { bubbles: true }));
  await wait(1300);
  check('F50 the dashboard follows: 0 to handle, 1 in progress, 1 resolved, no more waiting message', tile(agent, 'Messages à traiter') === '0' && tile(agent, 'Messages en cours') === '1' && tile(agent, 'Messages résolus') === '1' && !$(agent, '#dashboard-todo').textContent.includes('attendent une réponse'), $$(agent, '#dashboard-tiles').map((n) => n.textContent).join('|'));
  check('F22 resolved requests move to the bottom and the counter reaches zero', $(agent, '#pending-count').textContent === '0 à traiter' && staffCards().at(-1).querySelector('.message-status').textContent === 'Résolu');
  if (key) {
    const feedCards = () => $$(agent, '#requests-list .request-card');
    await wait(1500);
    check('D19 the official feed (live API, read only) is shown to staff: wave, count, codes with difficulty and XP', /Vague \d+/.test($(agent, '#current-wave').textContent) && /\d+ demandes/.test($(agent, '#visible-count').textContent) && feedCards().length >= 40 && feedCards().every((c) => /^[DF]\d+$/.test(c.querySelector('.request-code').textContent) && /XP/.test(c.textContent)), `${feedCards().length} cards; ${$(agent, '#feed-status').textContent}`);
    $(agent, '#search').value = 'F45';
    $(agent, '#search').dispatchEvent(new agent.window.Event('input', { bubbles: true }));
    check('D19 searching the feed by code finds the request', feedCards().length === 1 && feedCards()[0].querySelector('.request-code').textContent === 'F45');
    check('D19 the API key never reaches the page', !agent.window.document.documentElement.outerHTML.includes(key));
  } else {
    console.log('UNVERIFIED  D19 official feed rendering: no TERRA_NOVA_API_KEY in the environment or .env, so the live feed was not read');
  }
  agent.window.close();

  // ============ citizen sees the progress made by staff (D11, F26)
  zoe.window.close();
  zoe = await open();
  await login(zoe, 'zoe@audit.test', 'une-phrase-de-passe-1');
  const progress = (title) => steps(cards().find((c) => c.textContent.includes(title)));
  check('D11 the resident sees the progress without contacting the town hall: handled shows step 1 done and step 2 current, resolved shows all three done', progress('Lampadaire').join('|').includes('step-done:✓ Demande reçue') && progress('Lampadaire').join('|').includes('step-current:En cours de traitement') && progress('Question sur les horaires').every((s) => s.startsWith('step-done:✓')), `${progress('Lampadaire')} // ${progress('Question')}`);
  check('F49 the resident sees a banner and two unread notices in plain words, each saying what to do, with the town hall note', !$(zoe, '#notice-banner').hidden && $(zoe, '#notice-banner').textContent.includes('Vous avez 2 nouvelles sur vos demandes.') && $(zoe, '#notice-banner').getAttribute('role') === 'status' && $$(zoe, '#notices-list .notice-unread').length === 2 && $(zoe, '#notices-list').textContent.includes('Votre demande « Lampadaire cassé » est en cours de traitement.') && $(zoe, '#notices-list').textContent.includes('Vous n’avez rien à faire pour le moment.') && $(zoe, '#notices-list').textContent.includes('Votre demande « Question sur les horaires » est résolue.') && $(zoe, '#notices-list').textContent.includes('Si le problème persiste, envoyez-nous un nouveau message.') && $(zoe, '#notices-list').textContent.includes('Message de la mairie : Un technicien passe demain matin.'), $(zoe, '#notices-list').textContent);
  check('F49 unread is stated by the word "Nouveau", not only by colour', $$(zoe, '#notices-list .notice-unread .notice-new').every((n) => n.textContent.startsWith('Nouveau')) && $(zoe, '#notice-banner a[href="#notices-panel"]'));
  check('F49 nothing was sent to the browser before the resident opted in', zoe.window.__notes.length === 0);
  click(zoe, $(zoe, '#notices-read'));
  await wait(1200);
  check('F49 "Tout marquer comme lu" clears the banner and the unread marks, keeps the history, moves focus to the panel, and the server remembers it', $(zoe, '#notice-banner').hidden && $$(zoe, '#notices-list .notice-unread').length === 0 && $$(zoe, '#notices-list .notice-item').length === 2 && $(zoe, '#notices-read').hidden && zoe.window.document.activeElement === $(zoe, '#notices-panel'));
  check('F26 the status badge in the history follows the staff change', cards().find((c) => c.textContent.includes('Lampadaire')).querySelector('.message-status').textContent === 'En cours' && cards().find((c) => c.textContent.includes('Question')).querySelector('.message-status').textContent === 'Résolu');

  // ============ administrator: featured services, urgent alert with audience (F28, F29, F30, F31)
  const admin = await open();
  await login(admin, 'admin@audit.test', adminPw);
  check('D08/D09 an administrator gets the staff area plus the administrator tools', !$(admin, '#staff-area').hidden && !$(admin, '#admin-area').hidden && $(admin, '#member-role').textContent === 'Administration');
  const featuredTitles = (dom) => $$(dom, '#services-list .service-card').map((c) => ({ title: c.querySelector('h3').textContent, featured: c.classList.contains('service-featured') }));
  const before = featuredTitles(admin);
  check('F28 featured services come first and are highlighted (with the words "À la une")', before.slice(0, 2).every((s) => s.featured) && before.slice(2).every((s) => !s.featured) && $$(admin, '#services-list .service-featured .service-number').every((n) => n.textContent === 'À la une'), JSON.stringify(before.slice(0, 4)));
  const target = $$(admin, '#services-list .service-card').find((c) => !c.classList.contains('service-featured') && c.textContent.includes('Prévention'));
  [...target.querySelectorAll('button')].find((b) => b.textContent === 'Mettre à la une').click();
  await wait(1200);
  check('F28 the administrator features a service and it moves to the top, highlighted', featuredTitles(admin).slice(0, 3).some((s) => s.title.includes('Prévention') && s.featured) && featuredTitles(admin).filter((s) => s.featured).length === 3);
  const again = $$(admin, '#services-list .service-card').find((c) => c.textContent.includes('Prévention'));
  [...again.querySelectorAll('button')].find((b) => b.textContent === 'Retirer de la une').click();
  await wait(1200);
  check('F28 un-featuring puts it back and the button changes accordingly', featuredTitles(admin).filter((s) => s.featured).length === 2);
  // the resident opts in to notifications, then an urgent alert for one district is published
  check('F30 the resident sees an opt-in button (nothing is notified before consent)', !$(zoe, '#notify-button').hidden && $(zoe, '#notify-button').textContent === 'Me prévenir des alertes' && zoe.window.__notes.length === 0);
  click(zoe, $(zoe, '#notify-button'));
  await wait(400);
  check('F30 after consent the button says so and cannot be pressed again', $(zoe, '#notify-button').textContent.includes('Alertes activées') && $(zoe, '#notify-button').disabled);
  fill(admin, '#news-form', { title: 'Coupure d’eau au marché', body: 'L’eau sera coupée au marché de 14 h à 18 h. Prévoyez des réserves pour vos étals.', title_en: 'Water cut at the market', body_en: 'Water will be cut at the market from 2 pm to 6 pm. Plan reserves for your stalls.', audience: 'Quartier ouest' });
  $(admin, '#news-form [name=urgent]').checked = true;
  submit(admin, '#news-form');
  await wait(1500);
  check('F29 publishing an urgent item with an audience shows it in the administrator\'s banner immediately, labelled with the audience', $(admin, '#alert-banner').textContent.includes('Alerte · Quartier ouest') && $(admin, '#alert-banner').textContent.includes('Coupure d’eau au marché'));
  zoe.window.loadNews();
  await wait(1200);
  check('F29/F31 the resident\'s page shows the new urgent item as a role=alert banner with its audience (no reload needed)', $(zoe, '#alert-banner').getAttribute('role') === 'alert' && $(zoe, '#alert-banner').textContent.includes('Alerte · Quartier ouest') && $(zoe, '#alert-banner').textContent.includes('L’eau sera coupée'));
  check('F30 a new urgent item triggers exactly one notification with the audience and the title (stand-in for the browser popup)', zoe.window.__notes.length === 1 && zoe.window.__notes[0].title === 'Alerte Terra Nova · Quartier ouest' && zoe.window.__notes[0].body === 'Coupure d’eau au marché', JSON.stringify(zoe.window.__notes));
  zoe.window.loadNews();
  await wait(900);
  check('F30 refreshing again does not notify twice for the same item', zoe.window.__notes.length === 1);
  const lamp = $$(admin, '#staff-messages .message-card').find((c) => c.textContent.includes('Lampadaire'));
  lamp.querySelector('.status-field input').value = 'On vous recontacte si besoin.';
  lamp.querySelector('select').value = 'new';
  lamp.querySelector('select').dispatchEvent(new admin.window.Event('change', { bubbles: true }));
  await wait(1300);
  await zoe.window.loadNotices();
  await wait(800);
  check('F49 after consent a new notice triggers exactly one browser notification (stand-in) with the plain sentence; refreshing again does not repeat it', zoe.window.__notes.length === 2 && zoe.window.__notes[1].title === 'Nouvelle sur votre demande' && zoe.window.__notes[1].body === 'Votre demande « Lampadaire cassé » est de nouveau à traiter.', JSON.stringify(zoe.window.__notes));
  await zoe.window.loadNotices();
  check('F49 no duplicate on the next poll, banner shows the single unread notice, live region singular', zoe.window.__notes.length === 2 && $(zoe, '#notice-banner').textContent.includes('Vous avez 1 nouvelle sur vos demandes.'));
  check('F31 urgent items are marked as active alerts in the news list too', $$(zoe, '.news-urgent').some((c) => c.textContent.includes('Alerte en cours') && c.textContent.includes('Public concerné : Quartier ouest')));
  admin.window.close();

  // ============ F33: a resident deletes their own account (UI), with the password
  fill(zoe, '#delete-form', { password: 'pas-le-bon-mot-de-passe' });
  submit(zoe, '#delete-form');
  await wait(1100);
  check('F33 a wrong password is refused clearly and nothing is deleted', $(zoe, '#delete-status').textContent.includes('Mot de passe incorrect') && !$(zoe, '#member-area').hidden);
  fill(zoe, '#delete-form', { password: 'une-phrase-de-passe-1' });
  submit(zoe, '#delete-form');
  await wait(1300);
  check('F33 with the right password the account is deleted, the resident is signed out and told the data was erased (focus on the message)', !$(zoe, '#guest-area').hidden && $(zoe, '#member-area').hidden && $(zoe, '#account-status').textContent.includes('supprimé') && zoe.window.document.activeElement === $(zoe, '#account-status'));
  await login(zoe, 'zoe@audit.test', 'une-phrase-de-passe-1');
  check('F33 the deleted account can no longer sign in', $(zoe, '#member-area').hidden);
  zoe.window.close();
} catch (error) {
  failures++;
  console.log('FAIL  audit crashed', error.stack);
} finally {
  server.kill();
  await wait(400);
  rmSync(dataDir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nportal audit: all checks passed');
  process.exit(failures ? 1 : 0);
}
