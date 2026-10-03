// Session A world UI in a real browser (Chrome via puppeteer-core): dialog focus, keyboard, alerts, polling states,
// editor, reduced motion, 390x844 and 150% text, axe, screenshots.
// Needs: npm i --no-save puppeteer-core axe-core   (CHROME_PATH to override the browser, SHOTS_DIR for screenshots)
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const axeSource = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const react = (await import(pathToFileURL(req.resolve('@vitejs/plugin-react')).href)).default;
const shots = process.env.SHOTS_DIR || join(tmpdir(), 'terra-world-shots');
mkdirSync(shots, { recursive: true });

// ---------- fake API ----------
const state = { announcements: [], fail: false, avatarFail: false, calls: { announcements: 0 } };
const reset = () => {
  state.fail = false;
  state.avatarFail = false;
  state.calls.announcements = 0;
  state.announcements = [
    { id: 3, title: 'Montée des eaux dans le quartier sud', body: 'Le niveau de l’eau monte anormalement.\nÀ faire maintenant : éloignez-vous des berges et des passages souterrains.\nEn cas de danger immédiat, appelez le 112.', title_en: 'Rising water in the south district', body_en: 'The water level is rising unusually.\nDo this now: keep away from riverbanks and underpasses.\nIn immediate danger, call 112.', published_at: '2026-10-03 08:00:00', urgent: 1, audience: 'Quartier sud' },
    { id: 2, title: 'Vague de chaleur extrême', body: 'Buvez de l’eau régulièrement.\nRestez au frais entre 11 h et 17 h.', published_at: '2026-10-03 07:00:00', urgent: 1, audience: 'Personnes vulnérables' },
    { id: 1, title: 'Bienvenue sur le portail de Terra Nova', body: 'Le portail ouvre ses premiers services numériques.\nCréez votre espace pour contacter la ville et suivre vos échanges.', title_en: 'Welcome to the Terra Nova portal', body_en: 'The portal opens its first digital services.', published_at: '2026-10-01 09:00:00', urgent: 0, audience: 'Tous' },
  ];
};
reset();
const lines = [
  { code: 'T1', name: 'Habitat ↔ Quartier sud', color: '#b8336a', status: 'perturbé', message: 'Montée des eaux : ralentissements entre Mairie et Quartier sud.', stops: [{ name: 'Habitat', district: 'Quartier nord', next: ['10:00', '10:10', '10:20'] }, { name: 'Mairie', district: 'Centre-ville', next: ['10:04', '10:14', '10:24'] }, { name: 'Quartier sud', district: 'Quartier sud', next: ['10:08', '10:18', '10:28'] }] },
  { code: 'T2', name: 'Marché ↔ Santé', color: '#1d6fa5', status: 'normal', message: null, stops: [{ name: 'Marché', district: 'Quartier ouest', next: ['10:05', '10:20', '10:35'] }, { name: 'Mairie', district: 'Centre-ville', next: ['10:09', '10:24', '10:39'] }, { name: 'Santé', district: 'Quartier est', next: ['10:13', '10:28', '10:43'] }] },
];
const services = [
  { id: 1, title: 'Centre de santé', description: 'Consultations, vaccinations et soins de proximité.', details: 'Rendez-vous par message depuis votre espace personnel.', featured: 1, availability: 'unavailable', unavailable_reason: 'Maintenance du système de rendez-vous', unavailable_reason_en: 'Appointment system maintenance', available_again: '2026-10-06T09:30', alternative: 'Écrivez aux services depuis votre espace.', alternative_en: 'Write to the services from your space.', title_en: 'Health centre', description_en: 'Consultations, vaccinations and local care.', details_en: 'Book by message from your personal space.' },
  { id: 2, title: 'Espace personnel', description: 'Vos démarches au même endroit.', details: 'Créez un compte pour retrouver vos échanges.', featured: 0, availability: 'available' },
];
const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
const fakeApi = {
  name: 'fake-api',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const path = request.url.split('?')[0];
      if (path === '/api/announcements') { state.calls.announcements++; return state.fail ? json(response, 503, { error: 'down' }) : json(response, 200, { announcements: state.announcements }); }
      if (path === '/api/transports') return json(response, 200, { lines });
      if (path === '/api/services') return json(response, 200, { services });
      if (path === '/api/me/avatar' && request.method === 'PUT') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        return state.avatarFail ? json(response, 500, { error: 'Erreur interne.' }) : json(response, 200, { avatar: JSON.parse(Buffer.concat(chunks).toString()) });
      }
      if (path === '/__test') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (body.reset) reset();
        if ('fail' in body) state.fail = body.fail;
        if ('avatarFail' in body) state.avatarFail = body.avatarFail;
        if (body.add) state.announcements.unshift(body.add);
        if (body.withdraw) state.announcements = state.announcements.filter((item) => item.id !== body.withdraw);
        return json(response, 200, { ok: true, calls: state.calls });
      }
      next();
    });
  },
};
const vite = await createServer({ root, configFile: false, plugins: [react(), fakeApi], server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await vite.listen();
const base = `http://127.0.0.1:${vite.config.server.port || vite.httpServer.address().port}`;
const harness = `${base}/tools/qa-a/harness/index.html`;
const control = (body) => fetch(`${base}/__test`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });

async function open(query = '', width = 1440, height = 900, options = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, ...options });
  page.problems = [];
  page.on('pageerror', (error) => page.problems.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') page.problems.push(message.text()); });
  await page.goto(`${harness}${query}`, { waitUntil: 'networkidle0' });
  return page;
}
const text = (page, selector) => page.$eval(selector, (node) => node.textContent);
const active = (page) => page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, text: a?.textContent?.trim().slice(0, 40), cls: a?.className, inDialog: Boolean(a?.closest('[role=dialog]')) }; });
const axe = async (page, label, context) => {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async (selector) => (await axe.run(selector ? document.querySelector(selector) : document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => `${n.html.slice(0, 80)} :: ${(n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 200)}`) })), context);
  check(`axe (${label}): no violations`, violations.length === 0, JSON.stringify(violations, null, 1));
};
const clickByText = async (page, selector, label) => {
  const handle = await page.evaluateHandle((sel, text) => [...document.querySelectorAll(sel)].find((el) => el.textContent.trim().includes(text)), selector, label);
  await handle.asElement().click();
  await wait(150);
};

try {
  // ---------- HUD over a bright background ----------
  let page = await open('?user=7');
  await page.screenshot({ path: join(shots, 'w01-hud-bright.png') });
  const hudButtons = await page.$$eval('.hud-controls :is(button, a)', (nodes) => nodes.map((n) => ({ label: n.textContent.trim(), h: Math.round(n.getBoundingClientRect().height), w: Math.round(n.getBoundingClientRect().width) })));
  check('HUD: 5 labeled controls, all >= 44px high', hudButtons.length === 5 && hudButtons.every((b) => b.h >= 44 && b.w >= 44), JSON.stringify(hudButtons));
  await page.mouse.click(5, 5);
  check('HUD does not block the scene: container ignores pointer events', await page.$eval('.world-hud', (n) => getComputedStyle(n).pointerEvents) === 'none');
  check('HUD: alert on load → phone opened by pending alert, with unread badge', (await text(page, '[role=dialog]')).includes('Nouvelles alertes') && (await text(page, '.hud-badge')) === '2');
  // ---------- pending alert takeover, Escape acknowledges, persistence, reload ----------
  await page.screenshot({ path: join(shots, 'w02-alert-takeover.png') });
  const act = await active(page);
  check('alert takeover: focus is inside the dialog on the alert title', act.inDialog && /phone-title/.test(act.cls), JSON.stringify(act));
  check('alert takeover: live region (role=alert) present, nav hidden', (await page.$('[role=dialog] [role=alert]')) !== null && (await page.$('.phone-nav')) === null);
  await page.keyboard.press('Escape');
  await wait(300);
  check('Escape acknowledges the shown alerts; an alert-opened phone closes again', (await page.$('[role=dialog]')) === null);
  const seen = await page.evaluate(() => localStorage.getItem('world-seen-alerts:7'));
  check('acknowledged IDs stored for this user only', JSON.parse(seen).sort().join() === '2,3' && (await page.evaluate(() => localStorage.getItem('world-seen-alerts:guest'))) === null, seen);
  await page.reload({ waitUntil: 'networkidle0' });
  check('reload: acknowledged alerts do not come back', (await page.$('[role=dialog]')) === null);
  check('no console/page errors so far', page.problems.length === 0, page.problems.join(' | '));
  // ---------- manual open: focus, trap, escape, return ----------
  const phoneButton = await page.evaluateHandle(() => [...document.querySelectorAll('.hud-controls button')].find((b) => b.textContent.includes('Téléphone')));
  await phoneButton.asElement().focus();
  await page.keyboard.press('Enter');
  await wait(300);
  const opened = await active(page);
  check('keyboard: Enter on the HUD phone button opens the dialog and focus enters it', opened.inDialog, JSON.stringify(opened));
  await page.screenshot({ path: join(shots, 'w03-phone-home.png') });
  const order = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); const a = await active(page); order.push(a.inDialog); }
  check('Tab x14 never leaves the dialog (trap works with a real focus order)', order.every(Boolean), order.join());
  await page.keyboard.down('Shift');
  const back = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); back.push((await active(page)).inDialog); }
  await page.keyboard.up('Shift');
  check('Shift+Tab also stays inside', back.every(Boolean));
  // focus ring visible
  const ring = await page.evaluate(() => { const n = document.activeElement; const s = getComputedStyle(n); return { w: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor }; });
  check('focus ring is drawn on the focused control (3px amber)', ring.style !== 'none' && parseFloat(ring.w) >= 3, JSON.stringify(ring));
  // pages
  for (const [label, shot, expect] of [['Alertes', 'w04-alerts', 'Ligne'], ['Actualités', 'w05-news', 'Bienvenue'], ['Services', 'w06-services', 'Service indisponible'], ['Transports', 'w07-transports', 'Arrêt le plus proche']]) {
    await clickByText(page, '.phone-nav button', label);
    await page.screenshot({ path: join(shots, `${shot}.png`) });
    const body = await text(page, '.phone-body');
    check(`page "${label}" renders real content`, expect === 'Ligne' ? body.includes('Montée des eaux') && body.includes('éloignez-vous des berges') : body.includes(expect) || body.includes('Mairie'), body.slice(0, 120));
    check(`page "${label}": focus moved to the page title`, (await active(page)).cls?.includes('phone-title'));
  }
  const nearest = await page.$$eval('.phone-line-card', (cards) => cards.map((c) => c.querySelector('.phone-stop').textContent));
  check('transports: nearest stop (Mairie) listed first in each line, with the tag', nearest.every((t) => t.startsWith('Mairie') && t.includes('Arrêt le plus proche')), nearest.join(' | '));
  await clickByText(page, '.phone-nav button', 'Actualités');
  await clickByText(page, '.phone-row', 'Bienvenue');
  check('news detail opens with full text, Escape goes back (does not close)', (await text(page, '.phone-body')).includes('Créez votre espace') && (await (async () => { await page.keyboard.press('Escape'); await wait(200); return page.$('[role=dialog]'); })()) !== null && (await page.$('.phone-row')) !== null);
  await page.keyboard.press('Escape');
  await wait(300);
  const returned = await page.evaluate(() => document.activeElement?.textContent?.trim());
  check('Escape closes the phone and focus returns to the HUD button that opened it', (await page.$('[role=dialog]')) === null && /Téléphone/.test(returned), returned);
  // services search with accents
  await phoneButton.asElement().click();
  await wait(200);
  await clickByText(page, '.phone-nav button', 'Services');
  await page.type('input[type=search]', 'sante');
  await wait(150);
  check('services search ignores accents ("sante" finds "Centre de santé")', (await page.$$('.phone-card h3')).length === 1 && (await text(page, '.phone-count')).includes('1 service trouvé'));
  await axe(page, 'phone dialog, services page', '[role=dialog]');
  await clickByText(page, '.phone-nav button', 'Transports');
  await axe(page, 'phone dialog, transports page', '[role=dialog]');
  await clickByText(page, '.phone-nav button', 'Alertes');
  await axe(page, 'phone dialog, alerts page', '[role=dialog]');
  await page.keyboard.press('Escape');
  await axe(page, 'HUD (over bright background)', '.world-hud');

  // ---------- new alert while playing → pending; withdrawal; polling ----------
  await control({ add: { id: 9, title: 'Alerte test', body: 'Ceci est une nouvelle alerte urgente.', urgent: 1, audience: 'Tous', published_at: '2026-10-03 12:00:00' } });
  await page.evaluate(() => new Promise((resolve) => { const t = setTimeout(resolve, 16_500); window.__t = t; }));
  check('15 s poll: a new urgent alert opens the takeover once', (await text(page, '[role=dialog]')).includes('Alerte test') && (await page.$$('[role=dialog] [role=alert] article')).length === 1);
  await control({ withdraw: 9 });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 16_500)));
  check('withdrawal while displayed: the takeover disappears by itself, the phone returns to the normal screen', (await page.$('[role=dialog] [role=alert]')) === null || (await page.$('[role=dialog]')) === null);
  // ---------- API failure states ----------
  await control({ fail: true });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 16_500)));
  await phoneButton.asElement().click().catch(() => {});
  await wait(300);
  if (!(await page.$('[role=dialog]'))) { await phoneButton.asElement().click(); await wait(300); }
  await clickByText(page, '.phone-nav button', 'Alertes');
  check('API down after data: stale notice with retry, alerts kept', (await text(page, '.phone-body')).includes('Informations enregistrées') && (await page.$('.phone-note button')) !== null);
  await control({ fail: false });
  await clickByText(page, '.phone-note button', 'Réessayer');
  await wait(500);
  check('retry recovers (stale notice gone)', !(await text(page, '.phone-body')).includes('Informations enregistrées'));
  await page.close();

  // ---------- initial API failure ----------
  await control({ fail: true });
  page = await open('?user=21');
  await clickByText(page, '.hud-controls button', 'Téléphone');
  await clickByText(page, '.phone-nav button', 'Alertes');
  const failedBody = await text(page, '.phone-body');
  check('initial API failure: error + retry, never "Aucune alerte en cours"', failedBody.includes('Impossible de charger') && !failedBody.includes('Aucune alerte en cours'), failedBody.slice(0, 160));
  await page.screenshot({ path: join(shots, 'w08-initial-error.png') });
  await control({ fail: false });
  await clickByText(page, '.phone-note button', 'Réessayer');
  await wait(500);
  check('retry after initial failure shows the alerts', (await text(page, '.phone-body')).includes('Montée des eaux') || (await text(page, '[role=dialog]')).includes('Nouvelles alertes'));
  await page.close();

  // ---------- corrupt storage ----------
  const ctx = await browser.createBrowserContext();
  page = await ctx.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto(harness + '?user=33', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('world-seen-alerts:33', '{"not":"an array"'));
  await page.reload({ waitUntil: 'networkidle0' });
  check('corrupt localStorage does not crash the UI; alerts are shown as unseen', problems.length === 0 && (await text(page, '[role=dialog]')).includes('Nouvelles alertes'), problems.join());
  await page.close();

  // ---------- avatar editor ----------
  page = await open('?user=8');
  await page.keyboard.press('Escape');
  await clickByText(page, '.phone-ack', 'J’ai compris').catch(() => {});
  await page.evaluate(() => localStorage.setItem('world-seen-alerts:8', '[2,3]'));
  await page.reload({ waitUntil: 'networkidle0' });
  await clickByText(page, '.hud-controls button', 'Mon colon');
  await wait(200);
  check('editor opens as a modal dialog and takes focus', await page.evaluate(() => document.querySelector('dialog.avatar-editor').open && document.activeElement.closest('dialog') !== null));
  await page.screenshot({ path: join(shots, 'w09-editor.png') });
  await page.$eval('dialog input[type=color]', (input) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#112233'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  check('colour change applies live', (await text(page, '#state')).includes('#112233'));
  await page.keyboard.press('Escape');
  await wait(200);
  check('Escape cancels: saved colours restored, editor closed', (await text(page, '#state')).includes('#e0ac69') && !(await page.$eval('dialog.avatar-editor', (d) => d.open)));
  await control({ avatarFail: true });
  await clickByText(page, '.hud-controls button', 'Mon colon');
  await page.$eval('dialog input[type=color]', (input) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#445566'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await clickByText(page, 'dialog button', 'Enregistrer');
  await wait(500);
  check('failed save: editor stays open with a visible alert; colours kept for retry', await page.evaluate(() => document.querySelector('dialog.avatar-editor').open && document.querySelector('dialog [role=alert]')?.textContent.includes('Enregistrement impossible')));
  await page.screenshot({ path: join(shots, 'w10-editor-error.png') });
  await axe(page, 'avatar editor with error', 'dialog.avatar-editor');
  await control({ avatarFail: false });
  await clickByText(page, 'dialog button', 'Enregistrer');
  await wait(500);
  check('retry saves and closes', !(await page.$eval('dialog.avatar-editor', (d) => d.open)) && (await text(page, '#state')).includes('#445566'));
  await page.close();

  // ---------- English ----------
  page = await open('?user=9&lang=en');
  check('English: HUD, alert takeover translated and localized content used', (await text(page, '.hud-controls')).includes('Accessible version') && (await text(page, '[role=dialog]')).includes('New alerts') && (await text(page, '[role=dialog]')).includes('Rising water in the south district'));
  check('English: untranslated alert marked FR', await page.$$eval('[role=dialog] h3', (nodes) => nodes.some((n) => n.lang === 'fr' && n.querySelector('[role=img]'))));
  await page.screenshot({ path: join(shots, 'w11-english-takeover.png') });
  await page.close();

  // ---------- mobile 390x844 + 150% text ----------
  page = await open('?user=10', 390, 844, { isMobile: true, hasTouch: true });
  await clickByText(page, '.phone-ack', 'J’ai compris').catch(() => {});
  await page.evaluate(() => localStorage.setItem('world-seen-alerts:10', '[2,3]'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
  await clickByText(page, '.hud-controls button', 'Téléphone');
  await wait(300);
  const dims = await page.evaluate(() => { const sheet = document.querySelector('.phone-sheet').getBoundingClientRect(); const nav = document.querySelector('.phone-nav').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, sheet: [Math.round(sheet.width), Math.round(sheet.height)], navBottom: Math.round(nav.bottom), ih: innerHeight }; });
  check('390px + 150% text: dialog fills the screen, no horizontal scroll, navigation still reachable', dims.sw <= dims.iw && dims.sheet[0] === 390 && dims.navBottom <= dims.ih, JSON.stringify(dims));
  await page.screenshot({ path: join(shots, 'w12-phone-mobile-150.png') });
  await clickByText(page, '.phone-nav button', 'Services');
  const small = await page.$$eval('.phone-screen :is(button, a, summary, input)', (nodes) => nodes.filter((n) => n.getBoundingClientRect().height && n.getBoundingClientRect().height < 44).map((n) => `${n.tagName}:${n.textContent.trim().slice(0, 20)}:${Math.round(n.getBoundingClientRect().height)}`));
  check('touch targets in the phone are >= 44px high at 150% text', small.length === 0, small.join(' | '));
  await page.screenshot({ path: join(shots, 'w13-services-mobile-150.png') });
  await axe(page, 'phone dialog mobile 150%', '[role=dialog]');
  await page.close();

  // ---------- reduced motion + embedded host (no fixed positioning in PhoneScreen) ----------
  page = await open('?user=11&embed=1');
  await page.evaluate(() => localStorage.setItem('world-seen-alerts:11', '[2,3]'));
  await page.reload({ waitUntil: 'networkidle0' });
  const embed = await page.evaluate(() => { const screen = document.querySelector('#device .phone-screen'); const box = document.querySelector('#device').getBoundingClientRect(); const s = screen.getBoundingClientRect(); return { fixed: [...screen.querySelectorAll('*'), screen].some((n) => getComputedStyle(n).position === 'fixed'), inside: s.left >= box.left && s.right <= box.right + 1 && s.bottom <= box.bottom + 1, scrollW: screen.scrollWidth <= screen.clientWidth }; });
  check('PhoneScreen embedded in a 360x740 host: no fixed positioning, stays inside, no horizontal overflow', !embed.fixed && embed.inside && embed.scrollW, JSON.stringify(embed));
  await page.screenshot({ path: join(shots, 'w14-embedded-device.png') });
  await page.close();
  const reduced = await browser.createBrowserContext();
  page = await reduced.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(harness + '?user=12', { waitUntil: 'networkidle0' });
  check('prefers-reduced-motion: phone opens without animation', await page.$eval('.phone-sheet', (n) => getComputedStyle(n).animationName) === 'none');
  await page.close();
  const normal = await open('?user=13');
  check('(control) without reduced motion the phone animates in', await normal.$eval('.phone-sheet', (n) => getComputedStyle(n).animationName) !== 'none');
  await normal.close();
} catch (error) {
  failures++;
  console.log('FAIL  browser script crashed', error.stack);
} finally {
  await browser.close();
  await vite.close();
  console.log(failures ? `\n${failures} FAILED` : '\nall world browser checks passed');
  console.log('screenshots:', shots);
  process.exit(failures ? 1 : 0);
}
