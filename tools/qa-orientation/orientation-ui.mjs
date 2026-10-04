// Browser checks for public/orientation.js against the mini host (headless Edge). node tools/qa-orientation/orientation-ui.mjs [outDir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { seededDb } from './fixtures.mjs';
import { startHost } from './host.mjs';

const outDir = process.argv[2] ?? 'docs/qa-captures/orientation';
mkdirSync(outDir, { recursive: true });
let failures = 0;
const check = (name, ok, info = '') => { if (!ok) failures++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const problems = [];
async function open(host, { user = true, query = '', width = 1000 } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height: 900 });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|503|404/.test(m.text())) problems.push(m.text()); });
  if (user) await page.setCookie({ name: 'u', value: '1', url: host.base });
  await page.goto(`${host.base}/${query}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.to-root', { timeout: 10000 });
  return { page, context };
}
const ask = async (page, text) => { await page.$eval('#to-q', (el) => { el.value = ''; }); await page.type('#to-q', text, { delay: 5 }); await new Promise((r) => setTimeout(r, 400)); };
const textOf = (page, selector) => page.$eval(selector, (el) => el.textContent).catch(() => null);

const db = seededDb();
db.prepare("INSERT INTO services (title, description, details) VALUES ('Aide aux devoirs', 'Soutien scolaire', 'Le mercredi de 14 h à 17 h, salle 3. Inscription obligatoire avant le 15 du mois.')").run();
const host = await startHost({ db });

// ---- idle state, ordinary request, reason, destination, focus
{
  const { page, context } = await open(host);
  check('idle: labelled search field, hint, example chips, theme choices and the essentials in plain language', (await page.$('label[for="to-q"]')) !== null && (await page.$$eval('.to-examples .to-chip', (b) => b.length)) === 5 && (await page.$$eval('.to-choices .to-chip', (b) => b.length)) >= 5 && (await page.$('.to-essentials')) !== null);
  await page.screenshot({ path: `${outDir}/1-idle.png`, fullPage: true });
  await ask(page, 'Un lampadaire est cassé dans ma rue');
  const status = await textOf(page, '.to-status');
  check('result count is announced in a polite status region with the first result', /résultat\(s\) pour/.test(status) && /Signaler un problème/.test(status), status);
  check('the first card explains why (words the resident used)', /vous avez parlé de .*lampadaire/i.test(await textOf(page, '.to-card .to-why')));
  check('focus stays in the field while typing and results update', (await page.evaluate(() => document.activeElement.id)) === 'to-q');
  await page.screenshot({ path: `${outDir}/2-lampadaire.png`, fullPage: true });
  await page.click('.to-card.to-action .to-dest button');
  await new Promise((r) => setTimeout(r, 200));
  check('destination button moves focus to the real portal target (message form for a signed-in resident)', (await page.evaluate(() => document.activeElement.id)) === 'message-form');
  await context.close();
}
// ---- guest: login needed is stated, button leads to the account area
{
  const { page, context } = await open(host, { user: false });
  await ask(page, 'prendre rendez-vous avec un agent');
  check('guest: a procedure that needs an account says so and leads to sign-in', /Connexion nécessaire/.test(await textOf(page, '.to-card.to-action')) && /Se connecter ou créer un compte/.test(await textOf(page, '.to-card.to-action .to-dest button')));
  await page.click('.to-card.to-action .to-dest button');
  await new Promise((r) => setTimeout(r, 200));
  check('guest button focuses the sign-in area (#espace)', (await page.evaluate(() => document.activeElement.id)) === 'espace');
  await context.close();
}
// ---- plain language on demand, original always shown, unknown text left alone
{
  const { page, context } = await open(host);
  await ask(page, 'vaccination');
  const cardHandle = await page.$('.to-card.to-service');
  check('service card shows the official text and an on-demand explain button (explanation hidden by default)', (await cardHandle.$eval('.to-official', (el) => el.textContent.includes('médecine générale'))) && (await cardHandle.$eval('.to-plain', (el) => el.hidden)) && (await cardHandle.$eval('button[aria-expanded]', (b) => b.getAttribute('aria-expanded') === 'false')));
  await cardHandle.$eval('button[aria-expanded]', (b) => b.click());
  check('explain: the simple version appears, aria-expanded true, official text still visible, constraints kept (rendez-vous, message, espace personnel)', await cardHandle.$eval('.to-plain', (el) => !el.hidden && /rendez-vous/.test(el.textContent) && /message/.test(el.textContent) && /espace personnel/.test(el.textContent)) && await cardHandle.$eval('.to-official', (el) => el.checkVisibility?.() ?? true));
  await page.screenshot({ path: `${outDir}/3-explain.png`, fullPage: true });
  await cardHandle.$eval('button[aria-expanded]', (b) => b.click());
  check('hide the explanation again', await cardHandle.$eval('.to-plain', (el) => el.hidden));
  await ask(page, 'soutien scolaire');
  check('staff-added service: official text shown intact, no invented explanation, explicit note', (await textOf(page, '.to-card.to-service .to-official')).includes('Inscription obligatoire avant le 15') && /Pas d’explication simplifiée relue/.test(await textOf(page, '.to-card.to-service')) && (await page.$('.to-card.to-service button[aria-expanded]')) === null);
  await context.close();
}
// ---- emergency
{
  const { page, context } = await open(host);
  await ask(page, 'Mon père est inconscient, il ne respire plus');
  const em = await page.$('.to-emergency');
  check('emergency card is the FIRST result and carries a call link taken from the city data', em !== null && (await page.evaluate(() => document.querySelector('.to-results').firstElementChild.classList.contains('to-emergency'))) && (await em.$eval('a[href^="tel:"]', (a) => a.getAttribute('href'))) === 'tel:112' && /Appelez tout de suite le 112/.test(await em.evaluate((el) => el.textContent)));
  check('emergency card says not to use the message queue, offers no diagnosis, lists the emergency/hospital places with hours', /N’écrivez pas un message/.test(await textOf(page, '.to-emergency')) && /ne peux pas évaluer un état de santé/.test(await textOf(page, '.to-emergency')) && (await page.$$eval('.to-emergency .to-list li', (l) => l.length)) >= 3 && /24 h/.test(await textOf(page, '.to-emergency')));
  check('no ordinary "write to the city" action inside the emergency path (only behind the collapsed "other results")', (await page.$eval('.to-emergency', (el) => !/Écrire à la ville/.test(el.textContent))) && ((await page.$('.to-other')) === null || (await page.$eval('.to-other', (el) => !el.open))));
  check('the live status says the emergency instruction first', /^Urgence vitale/.test(await textOf(page, '.to-status')));
  await page.screenshot({ path: `${outDir}/4-emergency.png`, fullPage: true });
  await context.close();
}
// ---- emergency number comes from data; when absent, from the portal strip; when both absent, a pointer
{
  const dbNoPhone = seededDb();
  dbNoPhone.prepare("UPDATE places SET phone = NULL").run();
  const noPhone = await startHost({ db: dbNoPhone });
  const { page, context } = await open(noPhone);
  await ask(page, 'urgence');
  check('no phone in the places data: falls back to the portal strip number (tel:112 from #urgences)', (await page.$eval('.to-emergency a[href^="tel:"]', (a) => a.getAttribute('href'))) === 'tel:112');
  await page.evaluate(() => document.querySelector('.emergency-call').remove());
  await ask(page, 'urgence médicale');
  check('no number anywhere: the card points to the emergency banner instead of inventing a number', /bandeau/.test(await textOf(page, '.to-emergency')) && (await page.$('.to-emergency a[href^="tel:"]')) === null);
  await context.close(); await noPhone.close();
}
// ---- ambiguity, no match, outage
{
  const { page, context } = await open(host);
  await ask(page, 'santé');
  check('ambiguous request: "Vous parliez peut-être de…" choices are offered', (await page.$('.to-choices h4')) !== null && /Vous parliez/.test(await textOf(page, '.to-choices h4')));
  await ask(page, 'zzzzqqq');
  check('no match: honest message, theme choices, and the human fallback (write to the city) with a real destination', /Je n’ai rien trouvé/.test(await textOf(page, '.to-nomatch')) && (await page.$$eval('.to-choices .to-chip', (b) => b.length)) >= 5 && /Écrire à la ville/.test(await textOf(page, '.to-fallback')));
  await ask(page, 'carte de résident');
  check('a service the city does not list is not invented: no-match path', (await page.$('.to-nomatch')) !== null);
  await page.screenshot({ path: `${outDir}/5-nomatch.png`, fullPage: true });
  db.prepare("UPDATE services SET availability = 'unavailable', unavailable_reason = 'Maintenance du système', unavailable_reason_en = 'System maintenance', available_again = '2099-01-01T08:00', alternative = 'Passez à la Mairie', alternative_en = 'Visit the town hall' WHERE title = 'Centre de santé'").run();
  await page.evaluate(() => window.__mount());
  await page.waitForSelector('#to-q');
  await ask(page, 'vaccination');
  const outage = await textOf(page, '.to-card.to-service .to-outage');
  check('service outage: status, reason, return date and alternative are shown on the card, and the service stays listed', /Indisponible/.test(outage) && /Maintenance du système/.test(outage) && /2099-01-01 08:00/.test(outage) && /Passez à la Mairie/.test(outage));
  db.prepare("UPDATE services SET availability = 'available', unavailable_reason = NULL, available_again = NULL, alternative = NULL WHERE title = 'Centre de santé'").run();
  await context.close();
}
// ---- English
{
  const { page, context } = await open(host, { query: '?lang=en' });
  check('English UI: title, hint and examples', /Find the right service/.test(await textOf(page, '#to-title')) && /neither sent nor kept/.test(await textOf(page, '#to-hint')));
  await ask(page, 'I would like to see a doctor');
  check('English request finds the health centre and shows English official text and explanation button', /Health centre/.test(await textOf(page, '.to-card.to-service h3')) && /general medicine/.test(await textOf(page, '.to-card.to-service .to-official')) && /Explain simply/.test(await textOf(page, '.to-card.to-service button[aria-expanded]')));
  await ask(page, 'my father is unconscious');
  check('English emergency: call instruction, no message queue, no diagnosis', /Call 112 right now/.test(await textOf(page, '.to-emergency')) && /Do not write a message/.test(await textOf(page, '.to-emergency')));
  await context.close();
}
// ---- keyboard only
{
  const { page, context } = await open(host);
  await page.focus('#to-q');
  await page.keyboard.type('prendre le tram');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 250));
  check('keyboard: type + Enter returns the transport action; focus is still in the field', /Transports/.test(await textOf(page, '.to-card h3')) && (await page.evaluate(() => document.activeElement.id)) === 'to-q');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  check('Tab order reaches Search then Clear buttons (real buttons, visible focus ring is CSS :focus-visible)', await page.evaluate(() => document.activeElement.tagName === 'BUTTON' && /Effacer/.test(document.activeElement.textContent)));
  await page.keyboard.press('Enter');
  check('Clear empties the field and returns to the idle state', (await page.$eval('#to-q', (el) => el.value)) === '' && /Écrivez quelques mots/.test(await textOf(page, '.to-status')));
  await context.close();
}
// ---- 320 px and 200 % zoom
for (const [name, width, zoom] of [['320 px', 320, 1], ['200 % zoom at 640 px', 640, 2]]) {
  const { page, context } = await open(host, { width });
  if (zoom !== 1) await page.evaluate((z) => { document.body.style.zoom = String(z); }, zoom);
  await ask(page, 'Mon père est inconscient');
  await ask(page, 'vaccination');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${name}: no horizontal scroll`, wide <= 1, `${wide}px over`);
  if (width === 320) await page.screenshot({ path: `${outDir}/6-320px.png`, fullPage: true });
  await context.close();
}
// ---- hostile input, privacy, bounds
{
  const { page, context } = await open(host);
  const before = await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length, cookie: document.cookie }));
  const marker = 'quelquechosedetresconfidentiel';
  await ask(page, `<img src=x onerror="window.__x=1"> ${marker}`);
  check('hostile markup typed by the resident is never interpreted (no img/script element, no handler ran)', (await page.evaluate(() => window.__x)) === undefined && (await page.$$eval('.to-root img, .to-root script', (e) => e.length)) === 0);
  await ask(page, 'x'.repeat(5000));
  check('input is capped at 300 characters', (await page.$eval('#to-q', (el) => el.value.length)) <= 300);
  const after = await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length, cookie: document.cookie }));
  check('privacy: nothing stored (localStorage, sessionStorage, cookies unchanged)', JSON.stringify(before) === JSON.stringify(after));
  check('privacy: no request ever carried the typed text (only the one public index request)', host.requests.filter((r) => /confidentiel|img|xxxx/.test(decodeURIComponent(r))).length === 0 && host.requests.filter((r) => r.includes('/api/orientation')).every((r) => r === 'GET /api/orientation/index'));
  await context.close();
}
// ---- load failure, retry, unmount, stale response
{
  const flaky = await startHost({ failIndex: 1 });
  const { page, context } = await open(flaky);
  check('index load failure: role=alert message and a Retry button', /pas pu être chargés/.test(await textOf(page, '.to-error')) && (await page.$('.to-error[role=alert]')) !== null);
  await page.click('.to-error + button');
  await page.waitForFunction(() => !document.querySelector('.to-error') && document.querySelector('.to-choices'));
  check('Retry loads the index and shows the search', (await page.$('.to-error')) === null && (await page.$$eval('.to-examples .to-chip', (b) => b.length)) === 5);
  await context.close(); await flaky.close();
  const slow = await startHost({ delayMs: 600 });
  const second = await browser.createBrowserContext();
  const p2 = await second.newPage();
  p2.on('pageerror', (e) => problems.push(e.message));
  await p2.goto(`${slow.base}/`, { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.__handle);
  await p2.evaluate(() => window.__handle.unmount()); // the index response arrives after unmount
  await new Promise((r) => setTimeout(r, 1200));
  check('unmount before the slow index arrives: nothing is rendered afterwards, no error', (await p2.$eval('#orientation-root', (el) => el.childElementCount)) === 0);
  await second.close(); await slow.close();
  const { page: p3, context: c3 } = await open(host);
  await p3.evaluate(() => window.__handle.unmount());
  check('unmount empties the root', (await p3.$eval('#orientation-root', (el) => el.childElementCount)) === 0);
  await c3.close();
}
check('no console / page errors during the whole run', problems.length === 0, problems.slice(0, 3).join(' | '));
await host.close();
await browser.close();
console.log(failures ? `FAILURES (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
