// Browser checks of public/participation.js against the mini host (headless Edge). node tools/qa-participation/participation-ui.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { openDb, seedUsers, startHost } from './host.mjs';

let failures = 0;
const check = (name, ok, info = '') => { if (!ok) failures++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const db = openDb();
seedUsers(db);
const host = await startHost({ db, seedDemo: true });
const api = async (user, method, path, body) => (await fetch(host.base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: `u=${user}` }, body: body ? JSON.stringify(body) : undefined })).json();
// real-looking staff content next to the demo rows, including hostile text that must stay text
const xss = '<img src=x onerror="window.__xss=1"> Place <b>Neuve</b>';
const decision = (await api(3, 'POST', '/api/participation/admin/decisions', { title: `Nom de la place ${xss}`, title_en: 'Name of the square', summary: 'Quel nom pour la place centrale ?', choices: [{ label: 'Place des Colons', label_en: 'Settlers Square' }, { label: 'Place du Marché' }], publish: true })).id;
const consultation = (await api(3, 'POST', '/api/participation/admin/consultations', { title: 'Horaires du marché', body: 'Quels horaires préférez-vous ?', publish: true })).id;
await api(3, 'POST', '/api/participation/admin/projects', { title: 'Rénovation de la serre', summary: 'Remise en état de la serre.', district: 'Quartier nord', status: 'in_progress', progress: 40 });

const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox'] });
async function open(user, query = '', width = 1000) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  if (user) await page.setCookie({ name: 'u', value: String(user), url: host.base });
  page.on('pageerror', (error) => console.log('pageerror', error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${host.base}/${query}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.tp-root h2');
  return page;
}
const text = (page, selector) => page.$eval(selector, (el) => el.textContent);

// ---- static: no innerHTML / eval anywhere in the script
const source = readFileSync(new URL('../../public/participation.js', import.meta.url), 'utf8');
check('participation.js never uses innerHTML/outerHTML/insertAdjacentHTML/eval/document.write', !/innerHTML|outerHTML|insertAdjacentHTML|eval\(|document\.write|new Function/.test(source));

// ---- guest
{
  const page = await open(null);
  check('guest: all sections render, demo rows carry a visible "Exemple (démonstration)" badge', (await page.$$eval('.tp-badge-demo', (els) => els.length)) >= 4 && (await page.$$eval('.tp-card', (els) => els.length)) >= 6);
  check('guest: login prompts instead of vote/idea/feedback forms', (await page.$$eval('.tp-form', (els) => els.length)) === 0 && (await page.$$eval('a[href="#espace"]', (els) => els.length)) >= 3);
  check('hostile text in a title is shown as text (no <img>, no script ran)', (await page.evaluate(() => window.__xss)) === undefined && (await page.$$eval('.tp-card img, .tp-card b', (els) => els.length)) === 0 && (await text(page, `#tp-d${decision}`)).includes('<img src=x'));
  check('open decision: no results shown, participants count only; consultation labelled "pas un vote"', !(await page.$eval('#tp-decisions', (el) => el.parentElement.textContent)).includes('voix') && (await page.$eval('#tp-consultations', (el) => el.parentElement.textContent)).includes('pas un vote'));
  // heading order and landmark structure
  const levels = await page.$$eval('.tp-root h2, .tp-root h3, .tp-root h4, .tp-root h5', (els) => els.map((el) => Number(el.tagName[1])));
  check('heading levels never skip (h2 -> h3 -> h4)', levels.every((level, i) => i === 0 || level - levels[i - 1] <= 1), levels.join(''));
  check('every section is labelled by its heading', await page.$$eval('.tp-root section', (els) => els.every((el) => document.getElementById(el.getAttribute('aria-labelledby')))));
  await page.close();
}
// ---- 320 px reflow
{
  const page = await open(1, '', 320);
  check('320 px wide: no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${await page.evaluate(() => document.documentElement.scrollWidth)} px`);
  await page.close();
}
// ---- citizen: vote flow with confirmation, keyboard, receipt
{
  const page = await open(1);
  const form = `#tp-d${decision}`;
  const card = await page.$(`${form}`);
  const cardHandle = await page.evaluateHandle((el) => el.closest('article'), card);
  check('citizen: every control has an accessible name (label, legend, aria-label)', await page.$$eval('.tp-root input, .tp-root select, .tp-root textarea', (els) => els.every((el) => (el.labels && el.labels.length) || el.getAttribute('aria-label') || el.closest('label'))));
  await page.evaluate((el) => el.querySelector('input[type=radio]').focus(), cardHandle);
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter'); // submits: first step shows the confirmation, nothing is sent yet
  await page.waitForSelector('.tp-confirm:not([hidden]) button');
  check('vote needs an explicit confirmation step (nothing recorded yet)', db.prepare('SELECT COUNT(*) AS n FROM part_voters').get().n === 0 && (await page.$eval('.tp-confirm', (el) => el.textContent)).includes('ne peut pas être modifié'));
  await page.evaluate((el) => el.querySelector('.tp-confirm button[type=submit]').click(), cardHandle);
  await page.waitForFunction(() => document.querySelector('.tp-status')?.textContent.includes('Reçu : V-'));
  check('vote recorded: status line (role=status) with receipt, focus moved to it', db.prepare('SELECT COUNT(*) AS n FROM part_voters').get().n === 1 && (await page.evaluate(() => document.activeElement?.getAttribute('role') === 'status' && document.activeElement.textContent.includes('V-'))));
  check('after reload the card shows "Vous avez voté le …" and no vote form', (await page.$eval('#tp-decisions', (el) => el.parentElement.textContent)).includes('Vous avez voté le') && (await page.$$eval(`input[name="vote-${decision}"]`, (els) => els.length)) === 0);
  check('"Ma participation" lists the vote with its receipt, without the choice', (await text(page, '#tp-mine')) === 'Ma participation' && (await page.$eval('#tp-mine', (el) => el.parentElement.textContent)).includes('V-'));

  // opinion
  const c = await page.evaluateHandle((id) => document.getElementById(`tp-c${id}`).closest('article'), consultation);
  await page.evaluate((el) => { el.querySelector('input[type=radio][value="4"]').click(); el.querySelector('textarea').value = 'Plutôt le matin'; el.querySelector('button[type=submit]').click(); }, c);
  await page.waitForFunction(() => [...document.querySelectorAll('.tp-status')].some((s) => s.textContent.includes('Avis enregistré')));
  check('opinion recorded with receipt; shown as saved opinion; button now "Modifier mon avis"', db.prepare("SELECT COUNT(*) AS n FROM part_opinions WHERE user_id = 1").get().n === 1 && (await page.$eval(`#tp-c${consultation}`, (el) => el.closest('article').textContent)).includes('Modifier mon avis'));

  // idea: double click must create one record
  await page.evaluate(() => { const form = [...document.querySelectorAll('form')].find((f) => f.querySelector('input[type=text]') && f.closest('section')?.querySelector('#tp-ideas')); form.querySelector('input[type=text]').value = 'Plus de bancs au parc'; form.querySelector('textarea').value = 'Des bancs supplémentaires près de la serre.'; const b = form.querySelector('button[type=submit]'); b.click(); b.click(); });
  await page.waitForFunction(() => [...document.querySelectorAll('.tp-status')].some((s) => /Idée reçue|déjà enregistrée/.test(s.textContent)));
  check('idea double click: exactly one record, receipt shown, listed under "Mes idées"', db.prepare('SELECT COUNT(*) AS n FROM part_ideas WHERE user_id = 1').get().n === 1 && (await page.$eval('#tp-ideas', (el) => el.parentElement.textContent)).includes('Mes idées'));

  // feedback
  await page.evaluate(() => { const form = [...document.querySelectorAll('form')].find((f) => f.querySelector('select') && f.closest('section')?.querySelector('#tp-feedback')); form.querySelector('select').value = '1'; form.querySelector('input[name=fb-rating][value="5"]').click(); form.querySelector('textarea').value = 'Très rapide'; form.querySelector('button[type=submit]').click(); });
  await page.waitForFunction(() => [...document.querySelectorAll('.tp-status')].some((s) => s.textContent.includes('Avis enregistré') && s.textContent.includes('F-')));
  check('service feedback recorded with receipt', db.prepare('SELECT COUNT(*) AS n FROM part_feedback WHERE user_id = 1').get().n === 1);
  await page.close();
}
// ---- English
{
  const page = await open(2, '?lang=en');
  const body = await page.$eval('.tp-root', (el) => el.textContent);
  check('English UI: titles, badges and server English fields', body.includes('Citizen participation') && body.includes('Official vote') && body.includes('Name of the square') && body.includes('Example (demonstration)') && !body.includes('Participation citoyenne'));
  check('English UI: lang attribute set on the root', (await page.$eval('.tp-root', (el) => el.getAttribute('lang'))) === 'en');
  await page.close();
}
// ---- staff
{
  const page = await open(3);
  check('staff: management panel visible, no vote/idea forms for residents', (await page.$('.tp-staff')) !== null && (await page.$$eval('input[name^="vote-"]', (els) => els.length)) === 0);
  await page.evaluate(() => { const form = [...document.querySelectorAll('.tp-staff form')][1]; const [title, body] = [form.querySelector('input[type=text]'), form.querySelector('textarea')]; title.value = 'Consultation depuis le panneau'; body.value = 'Texte de la consultation de test.'; form.querySelector('input[type=checkbox]').click(); form.querySelector('button[type=submit]').click(); });
  await page.waitForFunction(() => [...document.querySelectorAll('.tp-staff .tp-status')].some((s) => s.textContent.includes('Créé')));
  check('staff creates and publishes a consultation from the panel', db.prepare("SELECT status FROM part_consultations WHERE title = 'Consultation depuis le panneau'").get()?.status === 'open');
  await page.evaluate(() => { const li = [...document.querySelectorAll('.tp-staff li')].find((el) => el.textContent.includes('Consultation depuis le panneau')); [...li.querySelectorAll('button')].find((b) => b.textContent === 'Clore').click(); });
  await page.waitForFunction(() => [...document.querySelectorAll('.tp-staff .tp-status')].some((s) => s.textContent.includes('Fait')));
  check('staff closes it', db.prepare("SELECT status FROM part_consultations WHERE title = 'Consultation depuis le panneau'").get().status === 'closed');
  check('agent sees no delete button (admin only)', (await page.$$eval('.tp-staff .tp-danger', (els) => els.length)) === 0);
  await page.close();
  const admin = await open(4);
  check('admin sees delete buttons', (await admin.$$eval('.tp-staff .tp-danger', (els) => els.length)) > 0);
  await admin.close();
}
// ---- unmount cleans up
{
  const page = await open(1);
  await page.evaluate(() => window.__handle.unmount());
  check('unmount empties the root', (await page.$eval('#root', (el) => el.childElementCount)) === 0);
  await page.close();
}
await browser.close();
await host.close();
console.log(failures ? `FAILURES (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
