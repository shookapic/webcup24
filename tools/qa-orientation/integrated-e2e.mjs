// The orientation helper inside A's real server and portal (a disposable scratch copy of A's committed source with B's integration applied).
// node tools/qa-orientation/integrated-e2e.mjs <base> [outDir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const [base, outDir = 'docs/qa-captures/orientation'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
let failures = 0;
const check = (name, ok, info = '') => { if (!ok) failures++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const problems = [];
const otherFailures = []; // failing requests that belong to the portal itself (not to the orientation helper)
const ask = async (page, text) => { await page.$eval('#to-q', (el) => { el.value = ''; }); await page.type('#to-q', text, { delay: 5 }); await new Promise((r) => setTimeout(r, 450)); };
const textOf = (page, selector) => page.$eval(selector, (el) => el.textContent).catch(() => null);

// ---- the real index
const index = await (await fetch(`${base}/api/orientation/index`)).json();
check('real index: services, places, emergency numbers from the real places table', index.services.length >= 6 && index.places.length >= 7 && index.emergency.phones.length >= 1, `${index.services.length} services, ${index.places.length} places, phones ${index.emergency.phones.join()}`);
check('real index: every action anchor exists in the real portal page', await (async () => { const html = await (await fetch(`${base}/`)).text(); const missing = index.actions.filter((a) => !new RegExp(`\\sid="${a.anchor}"`).test(html)); if (missing.length) console.log('  missing anchors:', missing.map((a) => a.anchor).join()); return missing.length === 0; })());
const allowedService = new Set(['id', 'title', 'title_en', 'description', 'description_en', 'details', 'details_en', 'featured', 'availability', 'unavailableReason', 'unavailableReason_en', 'availableAgain', 'alternative', 'alternative_en', 'plain']);
const allowedPlace = new Set(['code', 'kind', 'name', 'name_en', 'district', 'stop', 'address', 'address_en', 'hours', 'hours_en', 'open_24h', 'phone', 'service_id']);
check('real index: whitelisted public columns only (no user, session or contact data)', index.services.every((x) => Object.keys(x).every((k) => allowedService.has(k))) && index.places.every((x) => Object.keys(x).every((k) => allowedPlace.has(k))));
check('real index: reviewed explanations are attached only to services whose title matches', index.services.filter((s) => s.plain).every((s) => ['Relations citoyennes', 'Espace personnel', 'Suivi des demandes', 'Centre de santé', 'Signaler un problème', 'Prévention et santé publique'].includes(s.title)));

// ---- guest in the real portal
async function open(user) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|status of 4\d\d/.test(m.text())) problems.push(m.text()); }); // 4xx resource lines are judged by URL below
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) { (r.url().includes('orientation') ? problems : otherFailures).push(`${r.status()} ${new URL(r.url()).pathname}`); } });
  const response = await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
  if (user) { // register through the real form (A's civic forms carry signed tokens and a hidden field; the UI handles both)
    await page.type('#register-form [name=name]', user.name);
    await page.type('#register-form [name=email]', user.email);
    await page.type('#register-form [name=password]', user.password);
    await page.click('#register-form button[type=submit]');
    await page.waitForSelector('#member-area:not([hidden])', { timeout: 20000 });
  }
  const openBtn = await page.$('[data-open-module="orientation"]');
  if (openBtn) await openBtn.click(); // deployed index.html lazy-loads the module behind an "Ouvrir l'aide à l'orientation" button (F95/F96)
  await page.waitForSelector('#orientation-root .to-root', { timeout: 15000 });
  return { page, context, response };
}
{
  const { page, context, response } = await open(null);
  check('portal CSP forbids inline script and still serves the module (same-origin external script)', /script-src 'self'/.test(response.headers()['content-security-policy'] ?? '') && (await page.$('#orientation-root #to-q')) !== null);
  await ask(page, 'un lampadaire est cassé dans ma rue');
  check('real portal, guest: the report procedure is found, with its reason AND the required sign-in hint/action (both independently true)', /Signaler un problème/.test(await textOf(page, '.to-card h3')) && /Connexion nécessaire/.test(await textOf(page, '.to-card.to-action')) && /Se connecter ou créer un compte/.test(await textOf(page, '.to-card.to-action .to-dest button')));
  await ask(page, 'je voudrais me faire vacciner');
  check('real data: the health centre service is found for a vaccination request, official text shown, explanation on demand', /Centre de santé/.test(await textOf(page, '.to-card.to-service h3')) && (await page.$('.to-card.to-service button[aria-expanded]')) !== null);
  await ask(page, 'ma mère est inconsciente');
  const phone = await page.$eval('.to-emergency a[href^="tel:"]', (a) => a.getAttribute('href')).catch(() => null);
  check('real data: the emergency path comes first with the number taken from the real places table, and lists the real emergency places', phone === `tel:${index.emergency.phones[0].replace(/[^0-9+]/g, '')}` && (await page.$$eval('.to-emergency .to-list li', (l) => l.length)) >= 3);
  await page.screenshot({ path: `${outDir}/7-integrated-emergency.png` });
  await ask(page, 'quels sont les horaires du marché');
  check('real data: the covered market place is found (hours + stop)', /Marché couvert/.test(await textOf(page, '.to-card h3')));
  await page.click('#lang-toggle');
  await page.waitForFunction(() => document.querySelector('#orientation-root .to-root h2')?.textContent === 'Find the right service', { timeout: 15000 });
  check('portal language switch remounts the helper in English without a reload', true);
  await context.close();
}
// ---- signed-in resident: destination leads into the real form
{
  const { page, context } = await open({ name: 'Camille Citoyenne', email: `orient${Date.now()}@example.org`, password: 'motdepasse-solide-123' });
  await ask(page, 'je veux prendre rendez-vous');
  await page.click('.to-card.to-action .to-dest button');
  await new Promise((r) => setTimeout(r, 300));
  check('signed in: the destination focuses the real appointments panel', (await page.evaluate(() => document.activeElement.id)) === 'appointments-panel');
  await ask(page, 'zzzqqq');
  await page.click('.to-fallback .to-dest button');
  await new Promise((r) => setTimeout(r, 300));
  check('signed in: the human fallback leads to the real message form', (await page.evaluate(() => document.activeElement.id)) === 'message-form');
  check('the helper stays mounted after the resident signed in (update, not a second instance)', (await page.$$eval('#orientation-root .to-root', (e) => e.length)) === 1);
  await context.close();
}
check('no page error, console error or failing orientation request while using the helper in the real portal', problems.length === 0, problems.slice(0, 3).join(' | '));
if (otherFailures.length) console.log('INFO portal requests answered 4xx during the run (not orientation):', [...new Set(otherFailures)].join(', '));
await browser.close();
console.log(failures ? `FAILURES (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
