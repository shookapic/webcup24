# Session A — QA and handoff

Updated 2026-10-03 (H+7h30). Scope: A0 scope ledger, A1 phone/HUD/data hook, A2 portal citizen features (F33–F35), A3 delivery, Wave 5 (F37–F40) and Wave 6 accessibility (D13, D20, F41–F44, delivered as its own commit, see the end).

## Where the work is

| What | Where |
|---|---|
| A0–A3, F34, F35, phone/HUD/editor, asset serving | commit `2fd14e4`; already on `main` through B's merge `d04f830` |
| Wave 5 (F37–F40), D11 steps, F23 contrast fixes, QA harnesses | branch **`sessionA-work`** (not pushed, not on `main`): `3db1f0d` Wave 5, `6f88f02` merge of `origin/main` (`b0aaa09`), `ac006bc` docs + QA scripts |
| Docs `docs/PM_STATUS.md`, `docs/CONTEST_REQUESTS_2026-10-03.md`, edits to `CODE_REVIEW.md`/`GAME_ROADMAP.md` | belong to the PM; **left uncommitted** in the working tree on purpose |

The first draft of this file said "not committed" and "B must integrate"; both are now false.

## Reconciling with B's integration (read from `world/src/App.jsx` on `main`)

B's wiring matches the contract, so nothing is outstanding on the phone/HUD hand-off:
`useAnnouncements({ userId: user?.id, ready: user !== undefined })`, `PhoneFallback` driven by B's phase machine (`closed → opening → open → closing`), `pendingAlerts` emptied while closing, `AlertAnnouncer active={editing && !phoneUp}`, `WorldHud`, `useServices(phoneUp)`, `useTransports(true)`, `nearestStop={stop?.name}`. Verified against it, not assumed: `tools/qa-a/world-production.mjs` loads this `App.jsx` from the Node-served build (below). Observations for B, none blocking:
- B's key handler ignores events from a native `<dialog>` and inputs; the phone is a `div[role=dialog]`, so **T pressed inside the phone closes it** (intended: T toggles). Typing in the services search is ignored correctly.
- `PhoneFallback` covers the HUD buttons in the middle of the screen (it is a centred 24 rem sheet with a backdrop). The physical device replaces this, so no change requested.
- Headless software WebGL makes the client's 10 s request timeout fire occasionally: 3 `POST /api/presence` were aborted client-side during one production run. No server error. Treated as a test-environment effect, unproven on real hardware.

## Wave 5 contract (all additive; existing fields, routes and data are unchanged)

**Schema (migrations in `store.mjs`, `ALTER TABLE` pattern, existing rows keep working):** `users.active`; `services.availability` (`available|unavailable`), `unavailable_reason`, `unavailable_reason_en`, `available_again`, `alternative`, `alternative_en`; `messages.service_id`; new table `appointments(id, agent_id, starts_at, duration_min, location, instructions, citizen_id, reason, status open|booked|cancelled, booked_at, UNIQUE(agent_id, starts_at))`.

**Service availability — what B consumes (F38).** `GET /api/services` (public) returns for each service, in addition to the old fields:
- `availability`: `"available"` or `"unavailable"`. **Computed**: a stored outage with a return time in the past is reported `available` (it ends by itself).
- `unavailable_reason`, `unavailable_reason_en`, `alternative`, `alternative_en`: text or `null` (only meaningful when unavailable). English falls back to French when `_en` is null.
- `available_again`: `"YYYY-MM-DDTHH:MM"` in **Terra Nova time (UTC+4, no daylight saving)** or `null` (not announced). Show the digits as written; `formatCityTime()` in `world/src/ui/i18n.js` does this.
The phone's services page already renders it (badge text, reason, return time, "Meanwhile" alternative, FR/EN). A world service marker should use `availability === 'unavailable'` to dim and must not invent a return time. `PATCH /api/services/:id/availability` (agent/admin) sets it.

**Other endpoints**
- `POST /api/auth/login` failures: `401 {error, attemptsLeft}`; blocked: `429 {error, retryAfter}` + `Retry-After` header; success after others' failures: `200 {user, notice: {failedAttempts}}`. `GET /api/admin/security` (staff).
- Appointments: `POST /api/appointments` (staff, creates consecutive slots), `GET /api/appointments/staff`, `GET /api/appointments/slots` and `/mine` (citizen), `POST /api/appointments/:id/book`, `DELETE /api/appointments/:id` (citizen cancels own → slot reopens; staff on booked → `cancelled`, on open → removed), `GET /api/appointments/:id/ics`. Each appointment: `starts_at`, `ends_at`, `minutes_until`, `location`, `instructions`, `agent`, `status`, `reason`. Conflicts are `409` with a French message.
- `POST /api/messages` accepts optional `service_id`; messages list returns `service_id`, `service_title`, `service_title_en`.
- Deploy note: behind a proxy set `TRUST_PROXY=1` so sign-in limits apply per visitor (otherwise every client may look like loopback; the server warns once in production).

## Phone/UI compatibility notes for B's PhoneRig (A keeps screen, CSS and focus semantics)

- `PhoneScreen` fills **100 % of its parent** (`width/height:100%`), is rem-based, scrolls inside (`.phone-body`), and has no fixed positioning. Verified embedded in a **360 × 740 CSS px** host: nothing escapes, no horizontal overflow. Treat 360 × 740 as the design size; smaller than ~340 px wide is untested.
- Keep the host at that CSS size and scale the *rendered* host with a CSS transform to match the 3D screen; do not shrink the CSS box, or the ≥ 44 px targets (verified at scale 1) shrink with it. Hit-testing through CSS 3D transforms is B's to prove.
- Focus/semantics for the 3D host: `role="dialog" aria-label`, `useDialogFocus(hostRef, open)` from `ui/useDialog.js`, a single mounted screen. Escape is handled inside the screen, so focus must be inside it: on a pointer press on the canvas, refocus `host.querySelector('[data-autofocus]')`. `PhoneFallback` already does this for its backdrop (real-Chrome finding this wave: a press on the backdrop used to drop focus and Escape stopped working).
- Narrow screens / accessible mode: keep using `PhoneFallback` (full-screen at ≤ 30 rem).
- Nothing in A's components reads or writes the camera, keys or pointer lock.

## Evidence (all local, 2026-10-03)

| Command | Result |
|---|---|
| `node tools/smoke-a.mjs` | 104/104 — API contracts, roles, F33/F34, F37 (16), F38 (8), F39/F40 (16), `/monde/` serving |
| `node tools/qa-a/portal.mjs` | all pass (jsdom, real `index.html` + `app.js`) |
| `node tools/qa-a/world-ui.mjs` | all pass (jsdom) |
| `node tools/qa-a/portal-browser.mjs` | all pass in **Chrome**: keyboard booking, reminder, lockout, 390 px at 150 % text, touch targets, axe 0 violations on citizen / staff / high-contrast views |
| `node tools/qa-a/world-browser.mjs` | all pass in **Chrome** (A's components on a fake API): real focus trap/return, Escape order, alerts, polling, editor, 150 %, reduced motion, axe |
| `node tools/qa-a/world-production.mjs` | all pass: `npm run build`, **Node-served `/monde/`** with B's `App.jsx`: HUD, alert takeover/acknowledge, F38 outage and F36 nearest stop in the phone, gzip + immutable chunks, no 4xx/5xx, no CSP violation, axe on the HUD |
| Live feed | staff `GET /api/requests` 200 (42 requests, wave 6); anonymous 401; key not in the response |

Screenshots: `SHOTS_DIR` (default the OS temp folder) — `p0*` production, `w*` world harness, numbered portal shots. The scripts can fail: during development they caught real defects (below).

### Real defects the browser passes found and fixed this wave
1. Portal contrast (F23): four pre-existing AA failures in the light news block (4.43, 3.70, 4.27, 4.04 : 1).
2. Citizens logging in saw no "make a request" button until the next refresh (services were not re-rendered on login).
3. Pressing the backdrop dropped focus out of the phone dialog, so Escape/Tab stopped working.
4. Phone CSS at 150 % text on 390 px: status bar wrapped, tab labels broke mid-word, "nearest stop" tag stretched full width.
5. The owner's own typos triggered the "attempts while you were away" notice (now only failures from other addresses).

## Not verified — do not claim these

| Area | Status |
|---|---|
| **Hodifly production**: boot, `data/` persistence, whether the host also compresses (we send our own gzip), `TRUST_PROXY` need, production CSP/console | UNVERIFIED |
| Browser `Notification` popup for alerts (F30) and reminders (F40) | UNVERIFIED (headless) |
| Real screen reader (NVDA/VoiceOver/TalkBack), real touch device, Safari/Firefox | UNVERIFIED (only Chrome headless + axe) |
| F40 as e-mail/SMS | NOT PROVIDED: none exists; the reminder needs the page open (banner/notification) or a calendar app (.ics alarms) |
| Rate-limit state survives a restart | NO: in memory, per process (documented in `throttle.mjs`) |
| `sign-in limits per visitor on Hodifly` | depends on `TRUST_PROXY`; unknown until measured there |
| Physical phone, stations/tram, plaza art (B) | not A's; B's `docs/QA_B.md` says not started |

## Decisions and limits
- F33/F34 deletion removes messages and reports with the account (stated in the UI); deleting a citizen frees their booked slots.
- F34 reset returns the temporary password once in the response; nothing stores or logs it; there is no citizen password-change screen, so the UI does not promise one.
- F37 limits: pair 5, account 20, address 40 failures per 15 min. Distributed attackers can still lock a victim's account for up to 15 min (the trade-off for stopping a spread attack); staff see it in "Sécurité des connexions".
- Appointments: max 2 upcoming per citizen, no overlap, slots end the same day, ≤ 90 days ahead, 10–60 min each.
- jsdom, puppeteer-core and axe-core are **not** project dependencies (`package.json` is B's): `npm i --no-save jsdom puppeteer-core axe-core`.

## Wave 6 — accessibility (D13, D20, F41, F42, F43, F44)

Audit first, then fix. `tools/qa-a/a11y-browser.mjs` (real Chrome + axe, new) was run against the existing portal before any change: **37 failures**. Roughly a third were harness mistakes (smooth scrolling, Tab starting point, date inputs with several Tab stops, a forced-colors API puppeteer lacks); the rest were real and are fixed. It now passes (91 checks), so it can fail and does.

### What the audit found and what changed
| Finding (measured) | Fix |
|---|---|
| Skip link moved the page but not keyboard focus (`main` could not take focus) | `main tabindex="-1"` |
| Focus ring teal on the light news block: 1.18 : 1 | ring colour per section; yellow in high contrast |
| 38–53 Tab presses to reach the appointment, message, profile and staff forms | "Dans mon espace" / "Dans l'espace agent" jump links with focusable targets: 13–16 keystrokes (header link + jump links) |
| Wrong password: no field marked, no cue, focus not on the field | errors start with "⚠ Erreur :", mark the field (`aria-invalid`, `aria-describedby`), move focus to it; mark clears on edit |
| Server-side rejection of a report: generic message, focus lost | server message mapped to the exact field (name, e-mail, subject, body, location, reason, dates…) |
| No sending state | "Envoi en cours…" + `aria-busy` until the result replaces it |
| Focus fell to `<body>` after sign-in and sign-out | focus moved to the personal space / the "signed out" message |
| Text links 15–17 px high (WCAG 2.5.8 needs 24) | 44 px for nav, breadcrumb, footer and hero links; search input is a full-size target |
| Text-size control stopped at 150 %; disabling the button threw focus away | up to 200 %, `aria-disabled`, size announced |
| 320 px and 200 % text on a phone: header/hero/fieldset overflowed, fixed header height | wrapping header, `min-width:0`, fieldset fix, 16 px gutters, sticky bars capped |
| Jargon: "créneau", "UTC+4", ".ics" | "horaire", "heure de Terra Nova", "fichier calendrier"; 11-term "Les mots expliqués simplement" list (FR/EN) linked from header, footer and breadcrumb |
| Required fields only known to the browser | "(obligatoire)" / "(required)" added to the label by CSS |
| Colour-only cues | every status already had words; errors/successes now carry "⚠ Erreur :" / "✓"; forced-colors rules; the system "more contrast" setting switches high contrast on by itself |
| `matchMedia` missing in some environments aborted the whole script | guarded |
Also found by running the other suites: my word swap produced "le horaire"; agreement and elision fixed everywhere (`l'horaire`, `cet horaire`).

### Evidence (2026-10-03, local, Chrome headless unless noted)
| Command | Checks |
|---|---|
| `node tools/qa-a/a11y-browser.mjs` | 91 PASS: keyboard reach and order, focus-ring contrast, skip link, sign-in by keyboard, accessibility tree (landmarks, one h1, names), form errors/busy/required, 24 px targets, status cues, jargon and glossary, zoom/reflow matrix (100 %, text 200 %, browser zoom 200 % and 400 %, phone 390 px at text 200 %, citizen and staff), forced-colors, "more contrast" |
| `node tools/qa-a/world-browser.mjs` | 113 PASS, now including the phone dialog, long alert takeover, tab bar and Put-away at the same zoom matrix; every dialog control takes focus and scrolls into view; words on every status |
| `node tools/smoke-a.mjs`, `portal.mjs`, `world-ui.mjs`, `portal-browser.mjs`, `world-production.mjs` | 104, 60, 75, 15, 15 PASS (no regression; the production run builds and Node-serves `/monde/` with B's `App.jsx`) |
Screenshots in `SHOTS_DIR`: `a11y-*` (zoom matrix, four colour-vision simulations, forced colours), `w-reflow-*`.

### Not verified, not claimed
- **No real assistive technology** (NVDA, JAWS, VoiceOver, TalkBack, switch, voice control) was used. The tests check the DOM, the accessibility tree Chrome exposes, focus movement and axe; what a screen reader actually says is UNVERIFIED. D20, F42 and D13 are therefore PARTIAL.
- **Plain language (D13) is a judgement.** Vocabulary was replaced and a glossary added; nobody has read it who finds the platform hard to understand.
- The official requests name no zoom percentage; 200 % text and 400 % browser zoom are my operational targets.
- Other browsers (Firefox, Safari), real touch devices and real high-contrast Windows mode: UNVERIFIED (forced-colors was emulated).
- Alert, service and news *content* written by staff or seeded earlier (long sentences with several instructions) was not rewritten; the sentence-length heuristic is applied to interface text only.
- B's world (canvas, game controls, mobile input) is not covered: the 3D scene is `aria-hidden` with the portal as the accessible route. At 400 % zoom the HUD wraps over a large part of the screen; nobody plays a 3D game there. No B-owned file needed changing for this wave.

### Next
Watcher still running (one per machine). `sessionA-work` has not been pushed or merged; that is a separate checkpoint.
