# Session A — QA and handoff

Updated 2026-10-03 (H+7h30). Scope: A0 scope ledger, A1 phone/HUD/data hook, A2 portal citizen features (F33–F35), A3 delivery, Wave 5 (F37–F40) and Wave 6 accessibility (D13, D20, F41–F44, delivered as its own commit, see the end).

## Where the work is

| What | Where |
|---|---|
| A0–A3, F34, F35, phone/HUD/editor, asset serving | commit `2fd14e4`; already on `main` through B's merge `d04f830` |
| Wave 6 accessibility (D13, D20, F41–F44) | `4749bdf` on **`sessionA-work`** (isolated commit on top of Wave 5) |
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
| B's world: physical phone, plaza and avatar are committed (see the combined-candidate section); stations and moving tram not found in source; performance on a reference laptop; real GPU | PARTIAL / UNVERIFIED |

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

## Combined candidate b1f2751 (A's `sessionA-work` 4749bdf + B's ffec17b), validated 2026-10-03 ~16:15

Source: `git archive b1f2751191101f8721637ae9332cff277841ed16` of the PM's `webcup24-int` (worktree untouched, still clean), extracted to a scratch folder, `npm ci`, `npm run build`. All local: Node-served build, Chrome headless, disposable databases. `origin/main` is now **f06be69** (README-only change over ffec17b); `sessionA-work` 4749bdf merges with it cleanly (`git merge-tree`). Nothing pushed.

| Command (cwd = the candidate) | Result |
|---|---|
| `npm run build` | PASS (index 1.37 MB / gzip 381 KB, PlayableCity 4.38 MB / gzip 1.63 MB; models and Kenney licences under assets/) |
| `node tools/smoke-a.mjs` | PASS 104/104 |
| `node tools/qa-a/portal.mjs` (jsdom) | PASS 60 |
| `node tools/qa-a/world-ui.mjs` (jsdom) | PASS 75 |
| `node tools/qa-a/portal-browser.mjs` (Chrome) | PASS 15 |
| `node tools/qa-a/a11y-browser.mjs` (Chrome) | PASS 91 |
| `node tools/qa-a/world-browser.mjs` (Chrome, harness) | PASS 113 |
| `node tools/qa-a/world-production.mjs physical` (Node-served `/monde/`, B's physical rig) | PASS 20 |
| `node tools/qa-a/world-production.mjs flat` (`?flatphone`, accessible dialog) | PASS 15 |
| B's `tools/qa/world-checks.mjs` at 60 Hz and at 30 Hz with jitter | ALL PASS (18 checks each) |
| B's `tools/qa/phone-capture.mjs`, `tools/qa/alert-flow.mjs` | ALL PASS |

**Physical phone, what was actually proven** (real-time build, 1280×800, Chrome, software WebGL): the host is `.phone-host` (`role=dialog`, `aria-modal`, labelled) under a CSS `matrix3d`, lit (opacity 1), exactly one dialog and no flat sheet beside it, on the viewport, focus inside. A **real mouse click at each projected tab centre hit that tab** and changed the page (Services, back to Home), and the alert takeover, acknowledge and Escape paths work. The screen is drawn at about **0.76 scale**: 16 px text reads as about 12 px at this size, readable in the capture but smaller than the flat dialog. Not proven: real GPU timing, Firefox/Safari, touch, other resolutions. `tools/qa-a/world-production.mjs` takes the mode as an argument and covers both hosts (`.phone-sheet`, `.phone-host`).

**Host baseline (production URL, read-only).** The user-supplied host is https://losfablitos.lareunion.webcup.hodi.cloud/ (world at `/monde/`). `node tools/qa-a/host-smoke.mjs <url> dist/monde` sends GET requests only (no login, no posting, no accounts, no content). Result against the **currently deployed earlier build**: portal and `/monde/` answer 200; portal CSP strict; world CSP is the contract one; hashed assets are 200 with correct MIME, immutable cache, gzip; all 13 local models/textures are served with `model/gltf-binary` / `image/png`; a missing `.glb` is a real 404; navigation falls back to the app; traversal does not leak; conditional GET is 304; public APIs shape OK; Wave 4 route present (401). **Expected FAILs until the release is pushed (9 checks):** the portal HTML and the Wave 5 routes (`/api/admin/security`, `/api/appointments/slots` answer 404) and `availability` fields are not deployed yet, and the host's entry chunks are `index-DUJ3j-ei.js` / `index-Hrqw9TDY.css` instead of the candidate's `index-B_qHMEZc.js` / `index-DPnYpTfY.css` / `PlayableCity-DxlwfB7x.js` / `rapier-CRmr7vNN.js`. Re-run the same command after the push: every one of these should flip to PASS. This is host evidence for the old build only; it is not a result for the combined release.

**Migration / data safety.** Schema changes are additive. Tested: a database created by the original store (commit 1afe494) with a real user and message keeps working after the new server boots (login, message kept, services available, new appointment routes), and a second boot is harmless. Rollback leaves extra columns that older code ignores.

**Deploy knobs.** `TRUST_PROXY=1` if Hodifly shows every client as loopback (otherwise the per-address sign-in limit is shared by all visitors). `TERRA_NOVA_API_KEY` stays server-side. Sign-in counters are in memory and reset on restart.

**Feed.** Contest API queried directly at 16:16: wave 6, 42 requests, next wave 7 due in 9 minutes; no new codes. The single watcher (started 15:25:37) is running; `api-requests.md` is rewritten only when the feed changes.

## Wave 8 (F49, F50, F51, F52) and the current state, 2026-10-03 ~18:40 (branch `sessionA-wave8`; NOT in the deployed release)

Earlier sections above are historical runs and are kept as they were. Current facts:

- **Deployed**: `f6487cf` on `main` (A and B combined, Wave 7 included, B's square-on affine phone host). GET-only evidence: `coordination/reports/host-smoke-f6487cf.log` (51/51 PASS) and `host-wave7-f6487cf.json` (10/10 PASS). No authenticated production flow has been run.
- **Wave 8 commits** (on top of the frozen Wave 7 base `52468bd`): `f7eaae0` F49+F50, `00afe62` F51, `9be2176` F52 server, `28eabd9` F52 portal, `0d5564e` dashboard outage fix (review finding: the query lacked the columns `serviceView` reads; reproduced first, test fails on the old code), `abc2047` avatar contract (server side), `edb516d` F50 completion. Wave 9 (D02, F53–F56) arrived at 18:25 and is recorded in the matrix as not started / partial.
- **Tests on this branch, all PASS**: `tools/smoke-a.mjs` 216 (was 138 at Wave 7), `tools/qa-a/portal-audit.mjs` 86 (new), `tools/qa-a/portal.mjs` 96, `tools/qa-a/migration-old-db.mjs` 15, `tools/qa-a/portal-browser.mjs` 15, `tools/qa-a/a11y-browser.mjs` 91 (real Chrome + axe). World suites (`world-ui`, `world-browser`, `world-production`) were not re-run after Wave 8: no world file changed.
- **What the tests prove that a schema would not**: notices only on a real change and only for the owner; own-ids-only for "seen"; ten simultaneous support clicks give one support; the public payload has exact keys and contains none of the private subject/body/location/name/e-mail; withdrawing a publication or deleting either account removes the record, supports and quoting notices; every claim of the "Vos données" page is checked against the running server and database (cookie lifetime, table inventory, scrambled passwords and sessions, 15 s position, append-only journal); each dashboard figure equals the database after scripted actions, including a known-timestamp average and activity moved across days.
- **Changed contracts** (all additive except one): new tables `notices`, `concerns`, `public_requests`, `supports`; new routes `/api/me/notices`, `/api/me/notices/seen`, `/api/me/export`, `/api/concerns`, `/api/admin/concerns`, `/api/admin/dashboard`, `/api/public-requests`, `/api/me/supports`, `/api/messages/:id/public`, `/api/public-requests/:id/support`; `PATCH /api/messages/:id` accepts an optional `note`; message lists gain `public_id`, `public_title`, `support_count` (and `citizen_district` for staff); avatar gains optional `look` and `accessory`. Behaviour change: a staff message PATCH that really changes the state now also writes a notice for the owner.
- **Old data**: tested with a database created by the original store (`1afe494`): boots, keeps the old user and message, creates the new tables, the old resident has no invented notice, nothing is public, a concern can be filed, the export contains the old message.
- **Not verified / limits**: the real OS notification popup; automated authenticated production behaviour of anything above (by A/PM; F47 alone has a user-reported live test, see the Wave 14 section); a resident's or agent's understanding of the new pages; the unread-notice banner state under axe in Chrome (the Chrome run covers the empty and populated staff dashboard, not every notice state); the avatar editor and renderer variants (B has not delivered the catalogue). The F52 public list deliberately shows a public title/summary/district written for that purpose, not the private subject and exact place named in the triage wording.

## Wave 13 review and preserved-candidate validation, 2026-10-03 ~22:55 (read-only; no application change; supersedes the "dirty work unverified" wording of the Wave 8/9 sections for the items below)

Sources, kept apart:
- **Deployed:** f6487cf on `main` (GET-only host evidence only; F47 authenticated live test: PASS, user-reported).
- **Committed, not deployed:** `sessionA-wave9` HEAD 6876d79 (Wave 8, F54, F55, F56, avatar contract). Validated in a disposable copy merged with B 11a3262: smoke 248, migration 16, portal 96, portal-audit 93 (+3 live-feed checks UNVERIFIED without a key), portal-browser 15, a11y-browser 100, world-ui 102, world-browser 121, production flat 17/17, physical 21/22 (stale matrix3d gate, 22/22 with the existing c79083a gate). Logs: coordination/reports/val-6876d79/.
- **Dirty candidate (uncommitted, frozen, hashes in coordination/reports/val-candidate/source-hashes.txt):** 9 files, Wave 10 portal performance work. Validated separately in a disposable copy: smoke 254, migration 16, portal 96, audit 93, browser 15, a11y 100, world production physical 22/22 and flat 17/17, plus 42 new real-browser checks (lazy English dictionary, offline/slow/timeout/retry, duplicate submits, hidden-tab polling, HTTP negotiation and headers).

**Release blockers for the dirty candidate (reproduced; none fixed):**
- D1 dictionary load failure leaves lang="en" and a "Français" toggle over French text (public/app.js).
- D2 Accept-Encoding q=0 ignored (server.mjs serveFile; low).
- D3 a failed refresh replaces the request history / message list by the error text, losing the last good data (public/app.js loadMessages; same on the dashboard to-do).
- D4 a failed staff status change leaves the unsaved value in the selector and uses a modal alert() (public/app.js).
Smallest fixes and layers: coordination/reports (candidate evidence report). The harness already contains the failing checks (coordination/reports/val-candidate/portal-candidate.mjs).

**Performance, same tool/route/profiles as the baseline (reports/perf-portal-baseline.json vs val-candidate/perf-portal-after.json):** transferred bytes -78 to -95 % (visitor cold 271.8 -> 56.8 KB, warm -> 14.1 KB), cold load on slow 3G about 5.7 s -> 1.7 s, requests unchanged (10 / 19 / 18), hidden-tab calls 17 -> 0 per 66 s in the emulated state. CPU proxy (Chrome main-thread time under 4x throttle) did **not** improve: cold +5 to +25 %, single runs. No carbon or energy figure. Compression is not a simplified interface (F62 stays partial).

**Access and data protection (F69, F70), tools/qa-a/security-access.mjs, coordination/reports/val-security/:** 51 checks PASS on committed 6876d79 and 51 PASS on the dirty candidate: 56 routes x 4 roles (222 probes, no unexpected 401/403, no 5xx), own-data isolation (messages, export, recap, concerns, notices, devices, appointments, supports, presence), public requests carry only the consented fields, staff see only support counts, agents keep F34 and cannot touch staff accounts, administrator-only tools refused to agents, deactivation and password reset end sessions at once, feed credential (canary) absent from 12 public/built files and 333 API responses, cross-origin writes refused, 413 on oversized bodies, nosniff/no-store, SQL metacharacters inert, stored markup inert in Chrome for five viewers and in the generated pages. Static review: no HTML assignment in the portal script, no SQL built from request data. The matrix deliberately does not probe the official-feed route as staff (it would contact the real contest API). Not a security audit; Secure cookie flag and HTTPS behaviour are only on the host (UNVERIFIED).
Gaps, stated: agents can read every resident's messages and e-mail (no per-agent scoping); no second factor (F53) and no passkeys (D02).

**Newcomers (F71, F72):** registration needs an e-mail address (missing, empty, malformed, phone number: 400), so people without e-mail can read the public information but cannot use authenticated services; only French and English exist; a first visit from an English browser shows French (the language is a stored choice only). The first-use guide, hero starting points, emergency block and tips work for a newcomer without registering twice (progress, persistence, per-resident dismissal, English guide checked). Missing: a situation-based "what is useful for me" selection.

**Current feed (B's saved snapshot, wave 13, 71 requests):** F61-F72 mapped in docs/FEATURE_MATRIX.md with where each exists (live / committed only / dirty only / not started). F63 and F64 pass (F38 availability, live); F65-F68 are not started with reuse notes; F57-F61 exist only in the dirty candidate or as measurements; D02 and F53 are unstarted designs.

## Wave 14 coverage ledger, 2026-10-03 ~23:45 (read-only: no application change, no production mutation, no new test run)

**Feed.** Session B's saved `api-requests.md` (A runs no watcher and used no credential): first read "Mis à jour : 03/10/2026 23:37:27" (H+15h12), re-read 23:42:04 (H+15h17): wave 14, 75 requests; F73-F76 first seen 23:25. Rows are in docs/FEATURE_MATRIX.md with the official text copied by script.

**Where each level was inspected, separately.** Deployed f6487cf and committed 6876d79: `git grep` on server.mjs, store.mjs, security.mjs, public/app.js, index.html, i18n.js. Dirty candidate: `grep` in the working tree (app files not touched; sha256 prefixes unchanged: public/app.js 484525335b7e, server.mjs 1a395c0cb513, public/index.html 257fc3df836d). Live, GET only on 03/10 23:38: `/`, `/app.js`, `/styles.css`, `/i18n.js`, `/api/announcements`, `/api/services`, `/api/places`. The live HTML at `/` and the three static files are byte-identical to f6487cf (sha256 prefixes 903723df8574d12c, 4f52690544a7fdc8, 96ac61866e9b83e0, 0b22c2b82d3e1c77); `/i18n-en.js` is 404 live because it exists only in the dirty candidate.

| Request | Status | What exists (source) | What does not |
|---|---|---|---|
| F73 official public message, immediate | **PARTIAL** (reuse) | The alert pipeline of D18/F29-F31, live: public GET /api/announcements, admin publishes, urgent banner (role="alert") on every page, 30 s portal polling, 15 s phone. server.mjs announcements routes (6876d79 ~708-740), public/app.js loadNews | "Immediately" not observed (no production publish) and bounded by polling; no author or "official" label on a published message; no timing test; not decided whether this is a separate declaration from F29-F31 |
| F74 partner hours and place | **PARTIAL** (reuse) | The places page of F45/F46, live: public GET /api/places (address, hours, nearest stop, phone), staff form to add a place (public/index.html 327-338) | No partner entity, kind or label in any revision (0 hits). The 7 live places are city and emergency seeds; the 6 live services carry no address or hours, so public services prove nothing about a partner |
| F75 grouping similar requests for staff | **NOT STARTED** | Not credited: state/type/district filters (index.html 243-245), GROUP BY dashboard counts (server.mjs 527-533), F34 account search | Any similarity, duplicate, grouping or "open the group" function |
| F76 recorded feedback on a service | **NOT STARTED** | Not credited: D04 messages to the administration, incident reports, F52 "Mes soutiens" (support of a public incident report) | Any feedback, rating or comment on a service and the "trace" shown back to the resident |

**Recount and the 44-vs-41 mismatch (resolved).** 75 rows, no duplicates: PASS 44 (24220 XP), PARTIAL 22 (14640), UNVERIFIED 1 (1080), NOT STARTED 8 (6950), 46890 XP in total. The earlier summary "44 PASS" next to "34 live + 7 committed = 41" lost three rows: F41, F43 and F44 still said "not started" and "Not deployed yet" (as did D13, D20 and F42), written before Wave 6 shipped. Wave 6's commit 4749bdf is in the history of f6487cf and the live static files equal f6487cf, so those six rows are live. Corrected count of the 44 PASS: 36 live, 1 (F69) live core with later pieces committed only, 7 committed only on 6876d79, 0 dirty-only. The Wave 6 evidence is still local (real-browser checks on the committed source, a descendant of the deployed code), not a production run.

**Limits, stated.** The server code is not publicly readable: that f6487cf's server is what runs rests on the confirmed push and on consistent live responses (the places and announcements routes exist), not on a byte comparison. No automated browser run on production by A/PM (F47 alone has a user-reported authenticated live test, see the correction below). The earlier sections of this file that say Wave 6 is "not deployed" predate the f6487cf release and are superseded here.

**Actionable coverage gaps (for the PM; implementation stays stopped).** (1) F75 and F76 have no implementation at all and are the two largest unclaimed XP in wave 14 (1170 and 780). (2) F73 and F74 are reuse claims: decide with the PM whether to declare them, and for F74 a real partner entry would have to exist and be checked first. (3) No automated authenticated production flow exists from A or the PM, and F47 has a user-reported authenticated live test (see the correction below). Declaration wording follows the evidence-strength guidance in the matrix (implemented, deployed, how checked); there is no blanket requirement of a separate production browser run, and F74, F75 and F76 are not to be credited on missing or merely generic reuse.

**Correction, 2026-10-03 ~23:55 (docs only): F47 recorded as USER-REPORTED authenticated LIVE.** The user created the live admin account through the Hodifly terminal and tested F47 on the live host successfully (the user's words, relayed by the PM: "okay its fine now and I have been able to in fact test f47 nice"). It is recorded in the F47 row as evidence separate from the automated GET-only and local audit checks: A and the PM did not reproduce it, what exactly was checked was not reported to A, and no admin credential or action is recorded. F48 was not reported separately. The wording "no authenticated production flow" is corrected throughout both documents to "no automated authenticated production flow by A/PM", and the earlier blanket rule "declare only rows that pass a browser run on production" is replaced by an evidence-strength rule: implementation, deployment and evidence strength are kept apart, and existing deployed source plus direct relevant local validation can support a carefully worded declaration with the production interaction limits explicit. Counts are unchanged because F47 was already PASS (PASS 44, PARTIAL 22, UNVERIFIED 1, NOT STARTED 8).

## Wave 15 coverage ledger, 2026-10-04 ~00:40 (read-only: no application change, no production mutation, no load or stress test, no new benchmark)

**Feed.** Session B's saved `api-requests.md` (A runs no watcher), read 04/10/2026 00:34:06: wave 15, 79 requests, H+16h09; F77-F80 first seen 00:25 (the file stamp the PM cited was 00:25:53). Rows with the official text are in docs/FEATURE_MATRIX.md.

**Inspected separately:** deployed f6487cf and committed 6876d79 (`git grep`), the dirty candidate (working tree, untouched), and the live host (9 single GETs on 04/10 ~00:33, headers only, no load).

| Request | Status | What exists | What does not |
|---|---|---|---|
| F77 server overload, essentials kept | **PARTIAL** (general reuse) | Live: /monde/ gzip, ETag, 304, immutable hashed assets, WAL, 413 body limit, sign-in 429 with Retry-After, polling 30/60 s. Dirty only: portal files compressed once per version, ETag/304, hidden-tab pause, online/offline handlers | No overload behaviour. The live portal files are served uncompressed, no-store, no ETag (33325 and 78466 bytes). A failed refresh replaces the history or list with the error text (D3, live too). Candidate is blocked by D1-D4 |
| F78 many simultaneous residents | **UNVERIFIED** | Single process, WAL, throttling, expiring presence; none tested concurrently | Any concurrency measurement or capacity figure. The F77 reuse is single-user evidence, not stability proof |
| F79 citizen sort/filter by subject | **NOT STARTED** | Not credited: service and place searches, staff state/type/district filters (committed and dirty only), account search | Any sort or filter on the resident's requests and reports; no defined subject to filter on |
| F80 staff priority cases | **NOT STARTED** | Not credited: status-order sort (variable named priority), filters, counts, the announcement urgent flag | Any priority field or classification |

**Recount (79 rows, by script):** PASS 44 (24220 XP), PARTIAL 23 (15840), UNVERIFIED 2 (2680), NOT STARTED 10 (8150), 50890 XP in total. PASS provenance is unchanged (36 live, 1 F69 live core, 7 committed only). F47 keeps its separate USER-REPORTED authenticated live evidence; all earlier status limits stand.

**Limits.** The 9 GETs document headers only; they say nothing about behaviour under load. The existing candidate performance figures (val-candidate/perf-portal-after.json) are single-client throttled profiles. The live code is f6487cf, so the candidate's compression and polling changes are not deployed. D1-D4 persist.

## Wave 16 coverage ledger, 2026-10-04 ~01:40 (read-only: no application change, no bot, no mutation, no duplicate submission, no load or browser run)

**Feed.** Session B's saved `api-requests.md` (A runs no watcher), read 04/10/2026 01:30:52: wave 16, 83 requests, H+17h05; F81-F84 first seen 01:25. Rows with the official text are in docs/FEATURE_MATRIX.md.

**Inspected separately:** deployed f6487cf and committed 6876d79 (`git show`, `git grep`), the dirty candidate (working tree, untouched; sha256 prefixes unchanged: public/app.js 484525335b7e, server.mjs 1a395c0cb513, public/index.html 257fc3df836d). Nothing was run on the live host.

| Request | Status | What exists (live = f6487cf) | What does not |
|---|---|---|---|
| F81 robots submitting forms | **PARTIAL** (reuse) | Live: the sign-in limiter of F37 only. Committed: a 5-a-day cap on concerns. Dirty: nothing new | No limit on registration or on the message and incident form; no CAPTCHA, honeypot or timing marker anywhere; the same-origin check only applies when an Origin header is sent. Sign-in throttling is not bot protection on civic forms |
| F82 same form sent several times | **PARTIAL** (reuse) | Live: unique e-mail at registration, atomic appointment booking (one winner of two simultaneous clicks), unique slot per agent and time. Committed: one support and one publication per report, concern cap. Dirty: a client-side second-submit guard (25 s) | No server duplicate detection or idempotency key on requests and incident reports; the live message button is never disabled; the dirty guard is untested and undeployed |
| F83 receipt with a reference | **PARTIAL** (reuse of D16) | Live: "Votre message a bien été transmis. Référence n°{id}" on screen after sending. Committed: the F56 recap (number, received time, state, note) and concern reference C-{id} | The reference is a transient status line, not repeated on the history card; no per-request receipt, no "received on" statement, no e-mail receipt |
| F84 agents answer requests | **PARTIAL** (committed only) | Committed: a state change with an optional 5-300 character note delivered as a notice; a full answer on concerns (F51). Live: state change only | No reply without a state change, no thread, no resident reply; the note is not on the history card; nothing is live |

**Existing local evidence reused (not rerun):** tools/smoke-a.mjs at 6876d79 (F39 simultaneous booking, F49 note and notice, F51 reference, answer and 5-a-day cap, F52 ten simultaneous support clicks, F37 throttling) and tools/qa-a/portal-audit.mjs (D04/D16 confirmation with a reference number). No test exists for a duplicate message submission, for registration or message volume, or for the dirty client guard.

**Recount (83 rows, by script):** PASS 44 (24220 XP), PARTIAL 27 (19120), UNVERIFIED 2 (2680), NOT STARTED 10 (8150), 54170 XP in total. PASS provenance unchanged (36 live, 1 F69 live core, 7 committed only). F47 keeps its separate USER-REPORTED authenticated live evidence; all earlier status limits stand.

**Limits.** Everything above is source reading plus the existing tests; unsent behaviour such as the double submission of a message is inferred from the code, not observed. The dirty candidate is blocked by D1-D4 and not releasable.
