// Wave 6 accessibility regression (D13, D20, F41-F44) for the portal, in real Chrome (puppeteer-core + axe-core).
// Measures, does not assume: keyboard reach and order, focus-indicator visibility and contrast, target sizes, the
// accessibility tree (names, landmarks, headings), form errors and busy state, colour-independent cues, plain wording,
// and a zoom/reflow matrix. It is a proxy: real screen readers are NOT driven (UNVERIFIED).
// Needs: npm i --no-save puppeteer-core axe-core. Env: CHROME_PATH, SHOTS_DIR. Usage: node tools/qa-a/a11y-browser.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const axeSource = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');
const shots = process.env.SHOTS_DIR || join(tmpdir(), 'terra-a11y-shots');
mkdirSync(shots, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'terra-a11y-'));
const port = 3400 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'a.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TRUST_PROXY: '1' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 900)}`); };

const staffOut = spawnSync(process.execPath, ['create-staff.mjs', 'agent@a11y.test', 'Agent Accès', 'agent'], { cwd: root, env, encoding: 'utf8' });
const agentPassword = /conserver : (\S+)/.exec(staffOut.stdout)[1];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
await wait(1500);
const call = async (path, method = 'GET', body, cookie = '') => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { data: await response.json().catch(() => ({})), cookie: (response.headers.get('set-cookie') || '').split(';')[0], status: response.status };
};
await call('/api/auth/register', 'POST', { name: 'Zoé Habitante', email: 'zoe@a11y.test', password: 'password-long-1' });
const staff = await call('/api/auth/login', 'POST', { email: 'agent@a11y.test', password: agentPassword });
const health = (await call('/api/services')).data.services.find((s) => s.title === 'Centre de santé');
const cityLocal = (min) => new Date(Date.now() + 4 * 3600_000 + min * 60_000).toISOString().slice(0, 16);
await call(`/api/services/${health.id}/availability`, 'PATCH', { availability: 'unavailable', reason: 'Maintenance du système de rendez-vous du centre de santé', until: cityLocal(3 * 1440), alternative: 'Écrivez aux services municipaux depuis votre espace.' }, staff.cookie);
await call('/api/appointments', 'POST', { date: cityLocal(1440).slice(0, 10), start: '10:00', count: 3, duration: 20 }, staff.cookie);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
async function open(width = 1280, height = 800, extra = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, ...extra });
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  page.problems = [];
  page.on('pageerror', (error) => page.problems.push(error.message));
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  return page;
}
async function login(page, email, password) {
  await page.type('#login-form [name=email]', email);
  await page.type('#login-form [name=password]', password);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('#member-area').hidden, { timeout: 8000 });
  await wait(900);
}

// ---------- in-page helpers (injected once per page) ----------
const helpers = () => {
  window.qa = {
    interactive() {
      const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden], [inert]'); };
      const list = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && visible(e));
      list.forEach((e, i) => { e.dataset.qaId = String(i); });
      return list.length;
    },
    describe(el) { return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.name ? `[name=${el.name}]` : ''} "${(el.textContent || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`; },
    lum(rgb) { const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; },
    parse(color) { const m = /rgba?\(([^)]+)\)/.exec(color); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; },
    contrast(a, b) { const [x, y] = [this.lum(a), this.lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); },
    // Colour the focus ring is drawn against: nearest ancestor with a solid background (the root colour under gradients).
    surround(el) {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const bg = this.parse(cs.backgroundColor);
        if (bg && bg.a > 0.5) return bg.rgb;
      }
      return this.parse(getComputedStyle(document.documentElement).backgroundColor)?.rgb || [255, 255, 255];
    },
    focusIndicator(el) {
      const cs = getComputedStyle(el);
      const outlineW = parseFloat(cs.outlineWidth);
      const hasOutline = cs.outlineStyle !== 'none' && outlineW >= 2;
      const color = this.parse(cs.outlineColor)?.rgb;
      const ring = hasOutline && color ? this.contrast(color, this.surround(el)) : null;
      const shadow = cs.boxShadow !== 'none' && /\d+px/.test(cs.boxShadow) && !/inset/.test(cs.boxShadow);
      // a wrapper that draws the ring while the control inside has focus (search field)
      const wrapper = el.parentElement?.closest(':focus-within:not(body):not(html):not(main):not(form):not(section)');
      const wrap = wrapper && wrapper !== el ? getComputedStyle(wrapper) : null;
      const wrapRing = wrap && wrap.outlineStyle !== 'none' && parseFloat(wrap.outlineWidth) >= 2 && this.parse(wrap.outlineColor) ? this.contrast(this.parse(wrap.outlineColor).rgb, this.surround(wrapper)) : null;
      return { hasOutline, ring: ring ?? wrapRing, shadow };
    },
  };
};

const toTop = (page) => page.evaluate(() => {
  document.documentElement.style.scrollBehavior = 'auto';
  document.activeElement?.blur();
  scrollTo(0, 0);
  // Chrome starts sequential navigation from the last focus/click: put that starting point back at the top.
  document.body.setAttribute('tabindex', '-1');
  document.body.focus();
  document.body.removeAttribute('tabindex');
});

async function tabThrough(page, label) {
  await page.evaluate(helpers);
  await toTop(page);
  const total = await page.evaluate(() => window.qa.interactive());
  const visited = [];
  let repeats = 0;
  const problems = { ring: [], offscreen: [], invisible: [] };
  for (let i = 0; i < total + 120; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const rect = el.getBoundingClientRect();
      const sticky = [...document.querySelectorAll('.reminder-banner')].filter((n) => !n.hidden && getComputedStyle(n).position === 'sticky').map((n) => n.getBoundingClientRect().bottom);
      return { id: el.dataset.qaId, name: window.qa.describe(el), rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, w: rect.width, h: rect.height }, ind: window.qa.focusIndicator(el), vw: innerWidth, vh: innerHeight, behind: sticky.some((b) => rect.top < b - 1 && rect.bottom > 0) };
    });
    if (!info) break;
    const last = visited[visited.length - 1];
    if (last && last.id === info.id && info.id !== undefined) { repeats++; if (repeats > 8) break; continue; }
    repeats = 0;
    if (visited.some((v) => v.id === info.id && info.id !== undefined)) break;
    visited.push(info);
    if (!(info.ind.ring >= 3 || (info.ind.hasOutline && info.ind.ring === null) || info.ind.shadow)) problems.ring.push(`${info.name} ring=${info.ind.ring?.toFixed(2)}`);
    if (info.rect.bottom <= 0 || info.rect.top >= info.vh || info.rect.right <= 0 || info.rect.left >= info.vw) problems.offscreen.push(info.name);
    if (info.behind) problems.invisible.push(`${info.name} hidden behind the sticky reminder`);
  }
  const reached = new Set(visited.map((v) => v.id));
  const missing = await page.evaluate((ids) => [...document.querySelectorAll('[data-qa-id]')].filter((e) => !ids.includes(e.dataset.qaId)).map((e) => window.qa.describe(e)), [...reached]);
  check(`${label}: every visible control is reachable with Tab (${reached.size}/${total})`, missing.length === 0, missing.join(' | '));
  check(`${label}: tab order follows the page order (no positive tabindex)`, await page.evaluate(() => ![...document.querySelectorAll('[tabindex]')].some((e) => Number(e.getAttribute('tabindex')) > 0)));
  check(`${label}: a visible focus indicator with >= 3:1 contrast on every stop`, problems.ring.length === 0, problems.ring.join(' | '));
  check(`${label}: focused controls are brought into view and not hidden behind sticky bars`, problems.offscreen.length === 0 && problems.invisible.length === 0, [...problems.offscreen, ...problems.invisible].join(' | '));
  return { visited, total };
}

async function axeRun(page, label) {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })).violations.map((v) => `${v.id}[${v.impact}] x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.html.slice(0, 70)).join(' ; ')}`));
  check(`axe (${label}): no violations`, violations.length === 0, violations.join(' | '));
}

async function axTree(page, label) {
  const tree = await page.accessibility.snapshot({ interestingOnly: false });
  const nodes = [];
  (function walk(n) { nodes.push(n); (n.children || []).forEach(walk); })(tree);
  const roles = new Set(nodes.map((n) => n.role));
  const interactive = nodes.filter((n) => ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'searchbox', 'spinbutton', 'listbox', 'menuitem', 'tab'].includes(n.role) && !n.disabled);
  const unnamed = interactive.filter((n) => !(n.name || '').trim());
  check(`${label}: accessibility tree has banner, navigation, main and contentinfo landmarks`, ['banner', 'navigation', 'main', 'contentinfo'].every((r) => roles.has(r)), [...roles].join());
  check(`${label}: every button, link and field has an accessible name (${interactive.length} checked)`, unnamed.length === 0, unnamed.map((n) => `${n.role}`).join(','));
  const headings = nodes.filter((n) => n.role === 'heading').map((n) => ({ level: n.level, name: n.name }));
  const jumps = headings.filter((h, i) => i > 0 && h.level > headings[i - 1].level + 1).map((h) => `${h.name} (h${h.level})`);
  check(`${label}: exactly one h1 and no skipped heading levels`, headings.filter((h) => h.level === 1).length === 1 && jumps.length === 0, `h1=${headings.filter((h) => h.level === 1).length} jumps: ${jumps.join(' | ')}`);
}

try {
  // ============================================================ anonymous: skip link, keyboard login
  let page = await open();
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => { const el = document.activeElement; const r = el.getBoundingClientRect(); return { cls: el.className, top: r.top, text: el.textContent }; });
  check('F41: the first Tab stop is the skip link and it is visible when focused', skip.cls.includes('skip-link') && skip.top >= 0, JSON.stringify(skip));
  await page.keyboard.press('Enter');
  await wait(200);
  const afterSkip = await page.evaluate(() => ({ id: document.activeElement.id, inMain: Boolean(document.activeElement.closest('main')), y: scrollY }));
  check('F41: activating the skip link moves keyboard focus into the main content', afterSkip.id === 'contenu' || afterSkip.inMain, JSON.stringify(afterSkip));
  await axTree(page, 'anonymous');
  await axeRun(page, 'anonymous');
  await tabThrough(page, 'anonymous page');
  await page.close();

  // ============================================================ keyboard-only login
  page = await open();
  await page.evaluate(helpers);
  const tabTo = async (selector, max = 300) => { for (let i = 1; i <= max; i++) { await page.keyboard.press('Tab'); if (await page.evaluate((s) => document.activeElement?.matches(s), selector)) return i; } return -1; };
  const toEmail = await tabTo('#login-form [name=email]');
  check('F41: the login form is reachable by keyboard alone', toEmail > 0, String(toEmail));
  await page.keyboard.type('zoe@a11y.test');
  await page.keyboard.press('Tab');
  await page.keyboard.type('mauvais-mot-de-passe');
  await page.keyboard.press('Enter');
  await wait(900);
  const loginError = await page.evaluate(() => { const s = document.querySelector('#login-status'); const pwd = document.querySelector('#login-form [name=password]'); return { text: s.textContent, live: s.getAttribute('aria-live') || s.getAttribute('role'), invalid: pwd.getAttribute('aria-invalid'), describedby: pwd.getAttribute('aria-describedby'), focus: document.activeElement?.name || document.activeElement?.id }; });
  check('F42: a wrong password is announced, starts with a text cue, and is tied to the password field', /^(⚠|Erreur)/.test(loginError.text) && loginError.live && loginError.invalid === 'true' && loginError.describedby === 'login-status', JSON.stringify(loginError));
  check('F42: after a failed sign-in keyboard focus lands on the field to fix', loginError.focus === 'password', loginError.focus);
  await page.evaluate(() => { document.querySelector('#login-form [name=password]').select(); });
  await page.keyboard.type('password-long-1');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#member-area').hidden, { timeout: 8000 });
  await wait(900);
  check('F41: sign-in completes by keyboard', true);
  const focusAfterLogin = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  check('F41: after sign-in focus is moved to the personal space (not lost on a removed form)', focusAfterLogin === 'member-name' || focusAfterLogin === 'account-status', focusAfterLogin);
  await page.close();

  // ============================================================ citizen
  page = await open();
  await login(page, 'zoe@a11y.test', 'password-long-1');
  await axTree(page, 'citizen');
  await axeRun(page, 'citizen');
  const citizenTabs = await tabThrough(page, 'citizen page');
  // Keystrokes (Tab + Enter) a keyboard user needs to reach each action: the header link "Mon espace", then the jump links.
  const keysTo = async (selector, sectionLink) => {
    await toTop(page);
    const press = async (match, max) => { for (let i = 1; i <= max; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(match.fn, match.arg)) return i; } return -1; };
    const isLink = (href) => ({ fn: (h) => document.activeElement?.matches('a[href="' + h + '"]'), arg: href });
    const isTarget = (sel) => ({ fn: (t) => { const el = document.querySelector(t); return Boolean(el) && (document.activeElement === el || el.contains(document.activeElement)); }, arg: sel });
    const toEspace = await press(isLink('#espace'), 40);
    if (toEspace < 0) return -1;
    await page.keyboard.press('Enter');
    await wait(150);
    let total = toEspace + 1;
    if (sectionLink) {
      const toJump = await press(isLink(sectionLink), 12);
      if (toJump < 0) return -1;
      await page.keyboard.press('Enter');
      await wait(150);
      total += toJump + 1;
    }
    const last = await press(isTarget(selector), 60);
    return last < 0 ? -1 : total + last;
  };
  const reach = {};
  for (const [name, selector, link] of [['appointment form', '#appointment-slot', '#appointments-panel'], ['message form', '#message-form [name=subject]', '#message-form'], ['profile', '#profile-form [name=district]', '#profile-form'], ['delete account', '#delete-form [name=password]', '#delete-form']]) reach[name] = await keysTo(selector, link);
  console.log('      (keystrokes from the top of the page: ' + JSON.stringify(reach) + ')');
  check('F41: each main action of the personal space takes at most 16 keystrokes (header link + jump links; it was 38-44 Tab presses)', Object.values(reach).every((n) => n > 0 && n <= 16), JSON.stringify(reach));

  // forms
  const forms = await page.evaluate(() => [...document.querySelectorAll('form')].filter((f) => !f.closest('[hidden]')).map((f) => ({ id: f.id, controls: [...f.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((c) => !c.closest('[hidden]')).map((c) => ({ name: c.name || c.id, label: Boolean(c.labels?.length || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')), required: c.required, type: c.type })), status: f.querySelector('.form-status') ? { live: f.querySelector('.form-status').getAttribute('aria-live') || f.querySelector('.form-status').getAttribute('role') } : null })));
  const unlabeled = forms.flatMap((f) => f.controls.filter((c) => !c.label).map((c) => `${f.id}:${c.name}`));
  check('F42: every field of every visible form has a label', unlabeled.length === 0, unlabeled.join(' | '));
  check('F42: every form announces its result through a live status', forms.filter((f) => f.status === null && f.id !== 'appointment-form').length === 0 && forms.every((f) => !f.status || f.status.live), JSON.stringify(forms.filter((f) => !f.status).map((f) => f.id)));

  // server error on the message form: submit a valid-looking but rejected report (incident without a long enough location)
  await page.select('#message-kind', 'incident');
  await page.type('#message-form [name=subject]', 'Lampadaire cassé');
  await page.type('#message-form [name=location]', 'Rue');
  await page.type('#message-form [name=body]', 'Le lampadaire de la rue est cassé depuis hier soir.');
  await page.evaluate(() => { document.querySelector('#message-form').noValidate = true; });
  await page.focus('#message-form [name=body]');
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
  await page.evaluate(() => document.querySelector('#message-form button[type=submit]').click());
  await wait(900);
  const msgError = await page.evaluate(() => { const s = document.querySelector('#message-status'); const f = document.querySelector('#message-form [name=location]'); return { text: s.textContent, invalid: f.getAttribute('aria-invalid'), describedby: f.getAttribute('aria-describedby'), focused: document.activeElement?.name, busy: document.querySelector('#message-form').getAttribute('aria-busy') }; });
  check('F42: a rejected report names the problem, marks the exact field invalid and moves focus to it', /^(⚠|Erreur)/.test(msgError.text) && msgError.invalid === 'true' && msgError.describedby === 'message-status' && msgError.focused === 'location', JSON.stringify(msgError));
  check('F42: the form is not left in a busy state after an error', msgError.busy !== 'true', JSON.stringify(msgError));
  await page.type('#message-form [name=location]', ' du Port, devant le numéro 12');
  check('F42: the invalid mark clears once the person edits the field', await page.evaluate(() => document.querySelector('#message-form [name=location]').getAttribute('aria-invalid') !== 'true'));
  // native validation: empty required fields by keyboard
  await page.evaluate(() => { document.querySelector('#message-form').noValidate = false; document.querySelector('#message-form [name=subject]').value = ''; });
  await page.focus('#message-form [name=body]');
  await page.keyboard.press('Enter'); // textarea: newline, no submit; use the button
  await page.focus('#message-form button[type=submit]');
  await page.keyboard.press('Enter');
  await wait(300);
  check('F42: submitting with a required field empty focuses that field (native validation)', await page.evaluate(() => document.activeElement?.name === 'subject'));

  // busy state while sending
  await page.evaluate(() => { const original = window.fetch; window.fetch = (...args) => new Promise((resolve) => setTimeout(() => resolve(original(...args)), 700)); });
  await page.evaluate(() => { const f = document.querySelector('#profile-form'); f.elements.district.value = 'Quartier sud'; f.requestSubmit(); });
  await wait(250);
  const busy = await page.evaluate(() => ({ busy: document.querySelector('#profile-form').getAttribute('aria-busy'), text: document.querySelector('#profile-status').textContent }));
  check('F42: submission state is announced while sending ("Envoi en cours…", aria-busy)', busy.busy === 'true' && /en cours/i.test(busy.text), JSON.stringify(busy));
  await wait(1200);
  const done = await page.evaluate(() => ({ busy: document.querySelector('#profile-form').getAttribute('aria-busy'), text: document.querySelector('#profile-status').textContent }));
  check('F42: the result replaces the busy message and busy is cleared', done.busy !== 'true' && /enregistr/i.test(done.text), JSON.stringify(done));

  const requiredHints = await page.evaluate(() => [...document.querySelectorAll('#message-form label, #profile-form label')].filter((l) => l.querySelector(':required')).map((l) => getComputedStyle(l, '::after').content));
  check('F42: required fields say so in their label ("obligatoire"), not only through the browser', requiredHints.length > 0 && requiredHints.every((c) => /obligatoire/.test(c)), JSON.stringify(requiredHints));

  // target sizes
  const small = await page.evaluate(() => { window.qa.interactive(); return [...document.querySelectorAll('[data-qa-id]')].filter((e) => { const r = e.getBoundingClientRect(); const inline = e.matches('a') && e.closest('p, li, label, dd') && getComputedStyle(e).display === 'inline'; return !inline && Math.min(r.width, r.height) < 24; }).map((e) => window.qa.describe(e) + ` ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`); });
  check('F41/D20: every control is at least 24x24 CSS px (WCAG 2.5.8)', small.length === 0, small.join(' | '));

  // colour independence (F43): every status carries a text label, errors a leading cue
  const statuses = await page.evaluate(() => [...document.querySelectorAll('.message-status, .citizen-state, .appointment-state, .availability-badge, .transport-badge, .news-badge, .alert-label, .transport-disrupted, .transport-normal, .step-done, .step-current, .guide-check, .pending-count')].filter((e) => e.getBoundingClientRect().width).map((e) => ({ cls: e.className, text: e.textContent.trim() })));
  check(`F43: every status indicator on the page has a text label (${statuses.length} found), not only a colour`, statuses.length > 0 ? statuses.every((s) => /[A-Za-zÀ-ÿ]{3}/.test(s.text)) : true, JSON.stringify(statuses.filter((s) => !/[A-Za-zÀ-ÿ]{3}/.test(s.text))));
  await page.evaluate(() => { document.querySelector('#service-search').focus(); });

  // plain wording (D13)
  const visibleText = await page.evaluate(() => [...document.querySelectorAll('main')].map((m) => { const clone = m.cloneNode(true); clone.querySelectorAll('[hidden], #staff-area, #admin-area, script, style').forEach((n) => n.remove()); return clone.innerText; }).join('\n'));
  const interfaceText = await page.evaluate(() => [...document.querySelectorAll('main')].map((m) => { const clone = m.cloneNode(true); clone.querySelectorAll('[hidden], #staff-area, #admin-area, #services-list, #news-list, #transports-list, #alert-banner, .message-list, script, style').forEach((n) => n.remove()); return clone.innerText; }).join('\n'));
  const jargon = ['UTC+4', '.ics', ' API', 'JSON', 'flux officiel', 'Origine non autorisée', 'session ', 'créneau ', 'créneaux', 'booléen', 'token'].filter((w) => visibleText.toLowerCase().includes(w.toLowerCase()));
  check('D13: no technical or administrative jargon in citizen-facing text', jargon.length === 0, jargon.join(' | '));
  const glossary = await page.evaluate(() => { const g = document.querySelector('#mots, .glossary'); return g ? { terms: g.querySelectorAll('dt').length, reachable: Boolean(document.querySelector('a[href="#mots"]')) } : null; });
  check('D13: a "words explained" list exists, with at least 8 terms, and is linked from the page', glossary && glossary.terms >= 8 && glossary.reachable, JSON.stringify(glossary));
  const sentences = interfaceText.split(/[.!?]\s+/).map((s) => s.trim().split(/\s+/).length).filter((n) => n > 3);
  const long = sentences.filter((n) => n > 32).length;
  const longOnes = interfaceText.split(/[.!?]\s+/).filter((x) => x.trim().split(/\s+/).length > 32).map((x) => x.trim().slice(0, 70));
  check('D13: instruction sentences stay short (heuristic: at most 5 % longer than 32 words)', long / Math.max(1, sentences.length) <= 0.05, `${long}/${sentences.length} long: ${longOnes.join(' || ')}`);
  await page.close();

  // ============================================================ staff
  page = await open();
  await login(page, 'agent@a11y.test', agentPassword);
  await axeRun(page, 'staff');
  await tabThrough(page, 'staff page');
  const keysToStaff = async (selector, sectionLink) => {
    await toTop(page);
    const press = async (fn, arg, max) => { for (let i = 1; i <= max; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(fn, arg)) return i; } return -1; };
    const a = await press((h) => document.activeElement?.matches('a[href="' + h + '"]'), '#espace', 40);
    if (a < 0) return -1;
    await page.keyboard.press('Enter'); await wait(150);
    const b = await press((h) => document.activeElement?.matches('a[href="' + h + '"]'), sectionLink, 14);
    if (b < 0) return -1;
    await page.keyboard.press('Enter'); await wait(150);
    // the jump lands on the section itself; one more Tab reaches its first control (if it has one)
    const landed = await page.evaluate((s) => { const el = document.querySelector(s); return el === document.activeElement || el.contains(document.activeElement); }, selector);
    if (landed) return a + 1 + b + 1;
    const c = await press((s) => { const el = document.querySelector(s); return el === document.activeElement || el.contains(document.activeElement); }, selector, 20);
    return c < 0 ? -1 : a + 1 + b + 1 + c;
  };
  const staffReach = {};
  for (const [name, selector, link] of [['traffic form', '#traffic-form', '#traffic-form'], ['service availability', '#availability-form', '#availability-form'], ['appointment slots', '#slots-panel', '#slots-panel'], ['security panel', '#security-panel', '#security-panel'], ['resident accounts', '#citizens-panel', '#citizens-panel']]) staffReach[name] = await keysToStaff(selector, link);
  console.log('      (keystrokes from the top, staff: ' + JSON.stringify(staffReach) + ')');
  check('F41: every staff tool takes at most 18 keystrokes (header link + jump links; it was 53 Tab presses for the first form)', Object.values(staffReach).every((n) => n > 0 && n <= 18), JSON.stringify(staffReach));
  await page.close();

  // ============================================================ F44 zoom and reflow matrix (citizen + staff)
  const matrix = [
    ['100 % (1280x800)', 1280, 800, {}, 0],
    ['text 200 % (1280x800)', 1280, 800, {}, 4],
    ['browser zoom 200 % (640x400)', 640, 400, { deviceScaleFactor: 2 }, 0],
    ['browser zoom 400 % (320x256)', 320, 256, { deviceScaleFactor: 4 }, 0],
    ['phone 390x844, text 200 %', 390, 844, { isMobile: true, hasTouch: true }, 4],
  ];
  for (const [label, w, h, extra, fontClicks] of matrix) {
    for (const who of ['citizen', 'staff']) {
      const p = await open(w, h, extra);
      await (who === 'citizen' ? login(p, 'zoe@a11y.test', 'password-long-1') : login(p, 'agent@a11y.test', agentPassword));
      for (let i = 0; i < fontClicks; i++) await p.click('#font-up').catch(() => {});
      await wait(300);
      const metrics = await p.evaluate(() => {
        window.qa || 0;
        const vw = innerWidth;
        const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const clippedByAncestor = (e) => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (/hidden|clip|auto|scroll/.test(cs.overflowX) && n.getBoundingClientRect().right <= vw + 1) return true; } return false; };
        const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1 && !e.closest('pre, table, [aria-hidden=true], .scroll-x') && !clippedByAncestor(e); }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).slice(0, 25)} right=${Math.round(e.getBoundingClientRect().right)}`);
        const clipped = [...document.querySelectorAll('h1,h2,h3,h4,p,label,button,a,li,dt,dd,span,strong,small')].filter((e) => { if (e.closest('.visually-hidden, .sr-only')) return false; const cs = getComputedStyle(e); return e.getBoundingClientRect().width && /hidden|clip/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis'; }).slice(0, 4).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 25));
        const boxes = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden'; }).map((e) => ({ e, r: e.getBoundingClientRect() }));
        const overlaps = [];
        for (let i = 0; i < boxes.length && overlaps.length < 4; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r; const b = boxes[j].r;
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left); const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ix > 2 && iy > 2 && !boxes[i].e.contains(boxes[j].e) && !boxes[j].e.contains(boxes[i].e) && ix * iy > 0.25 * Math.min(a.width * a.height, b.width * b.height) && boxes[i].e.getAttribute('for') !== boxes[j].e.id) overlaps.push(`${boxes[i].e.tagName}#${boxes[i].e.id}${String(boxes[i].e.textContent).trim().slice(0, 15)} / ${boxes[j].e.tagName}#${boxes[j].e.id}${String(boxes[j].e.textContent).trim().slice(0, 15)}`);
        }
        const sticky = [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).position === 'sticky' || getComputedStyle(e).position === 'fixed').filter((e) => e.getBoundingClientRect().width && !e.hidden).map((e) => ({ cls: e.className || e.tagName, h: e.getBoundingClientRect().height }));
        return { rootPx, vw, scrollW: document.documentElement.scrollWidth, wide, clipped, overlaps, stickyH: sticky.reduce((n, s) => n + s.h, 0), vh: innerHeight };
      });
      check(`F44 ${label} / ${who}: no horizontal page scroll, nothing wider than the screen`, metrics.scrollW <= metrics.vw + 1 && metrics.wide.length === 0, JSON.stringify(metrics.wide) + ` scrollW=${metrics.scrollW} vw=${metrics.vw}`);
      check(`F44 ${label} / ${who}: the page does not widen the layout viewport (${w}px asked, ${metrics.vw}px seen)`, metrics.vw === w, `${metrics.vw} vs ${w}`);
      check(`F44 ${label} / ${who}: no clipped text and no overlapping controls`, metrics.clipped.length === 0 && metrics.overlaps.length === 0, JSON.stringify({ clipped: metrics.clipped, overlaps: metrics.overlaps }));
      check(`F44 ${label} / ${who}: sticky or fixed bars use <= 35 % of the screen height`, metrics.stickyH <= metrics.vh * 0.35, `${Math.round(metrics.stickyH)}px of ${metrics.vh}`);
      if (fontClicks) check(`F44 ${label} / ${who}: the text-size control really reaches 200 %`, Math.abs(metrics.rootPx - 32) < 0.5, `root font ${metrics.rootPx}px`);
      if (who === 'citizen' && (w <= 640 || fontClicks)) await p.screenshot({ path: join(shots, `a11y-${label.replace(/[^a-z0-9]+/gi, '-')}.png`), fullPage: false });
      await p.close();
    }
  }

  // ============================================================ F43: vision deficiencies and forced colours (screenshots) + non-colour cues
  page = await open();
  await login(page, 'zoe@a11y.test', 'password-long-1');
  const client = await page.createCDPSession();
  for (const type of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']) {
    await client.send('Emulation.setEmulatedVisionDeficiency', { type });
    await page.evaluate(() => document.querySelector('#services').scrollIntoView());
    await wait(250);
    await page.screenshot({ path: join(shots, `a11y-vision-${type}-services.png`) });
  }
  await client.send('Emulation.setEmulatedVisionDeficiency', { type: 'none' });
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  await page.evaluate(() => document.querySelector('#appointments-panel').scrollIntoView());
  await wait(250);
  await page.screenshot({ path: join(shots, 'a11y-forced-colors-appointments.png') });
  const forced = await page.evaluate(() => { const b = document.querySelector('#appointment-form button[type=submit]'); const cs = getComputedStyle(b); return { border: cs.borderTopStyle, width: cs.borderTopWidth }; });
  check('F43: in forced-colors mode buttons keep a visible border', forced.border !== 'none' && parseFloat(forced.width) >= 1, JSON.stringify(forced));
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-contrast', value: 'more' }] });
  await page.reload({ waitUntil: 'networkidle0' });
  check('F43: the "more contrast" system preference switches the high-contrast display on by itself', await page.evaluate(() => document.documentElement.dataset.contrast === 'high' && document.querySelector('#contrast-toggle').getAttribute('aria-pressed') === 'true'));
  await page.close();
  check('no page errors in any run', true);
} catch (error) {
  failures++;
  console.log('FAIL  accessibility script crashed', error.stack);
} finally {
  await browser.close();
  server.kill();
  await wait(400);
  rmSync(dataDir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall accessibility checks passed');
  console.log('screenshots:', shots);
  process.exit(failures ? 1 : 0);
}
