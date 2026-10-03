# Terra Nova — feature matrix (Session A)

Created 2026-10-03 (A0), updated after A1–A3. Owner of this file: Session A.

## Source and its limits — read first

- **No authorized feed snapshot exists in this checkout.** There is no `.env` / `TERRA_NOVA_API_KEY`, no `api-requests.md`, no `data/seen-requests.json`, and the key was not fetched or guessed. Request wording below is therefore **paraphrased from `CLAUDE.md` and `docs/GAME_ROADMAP.md`, not the official request text**, and the codes are the ones those files cite.
- **Current-wave completeness is UNVERIFIED.** Waves after Wave 4 (and any baseline code not named in `CLAUDE.md`) cannot be listed. Next step for whoever holds the key: `npm run watch-api` → copy each `request_code`, official text and difficulty into the rows below, add rows for anything missing.
- `CLAUDE.md` groups codes without saying which sub-feature each one is (e.g. "D18, F29, F30, F31"). Rows keep that grouping instead of guessing a mapping.
- Evidence uses the Session A scripts, all local (Node 22.23, throwaway SQLite, no network): `node tools/smoke-a.mjs` (API, 62 checks), `node tools/qa-a/portal.mjs` and `node tools/qa-a/world-ui.mjs` (jsdom; need `npm i --no-save jsdom`). jsdom has no layout, no real focus ring, no CSS rendering, no `Notification`, no WebGL.

Status key: **PASS** = automated local check passes · **PARTIAL** = part verified, rest listed · **UNVERIFIED** = nothing run, or needs a real browser / production · **PENDING-B** = depends on Session B work not yet integrated.

## Baseline portal (Session A)

| Code | Requirement (paraphrase) | Implementation | Owner | Evidence | Status |
|---|---|---|---|---|---|
| — (code not in repo) | Citizen registration, login, logout; citizen / agent / admin roles | `server.mjs` `/api/auth/*`, `security.mjs`, `create-staff.mjs` | A | smoke: register, short password 400, wrong password 401, staff login, citizen 403 on staff routes | PASS |
| — | Messages and incident reports with location, confirmation, history, status; agent updates status | `/api/messages`, portal forms | A | smoke: incident needs location, 201 + confirmation, agent PATCH → citizen sees `in_progress`; portal: first report sent through the real form | PASS |
| — | Official request feed: staff only, key held server-side, request codes, refresh and errors | `/api/requests`, `loadFeed()` | A | smoke: anonymous 401, staff 503 without key. **Live feed with a real key not run** | PARTIAL |
| D18, F29, F30, F31 | Urgent announcements with audience; admin form; `role="alert"` banner on every page; opt-in browser notification; lift an alert; 30 s refresh | `announcements.urgent/audience`, `renderAlerts`, `renderNotifyButton` | A | smoke: publish urgent + audience, lift; portal: banner `role=alert` with 2 alerts + audience, English banner. **Notification permission/popup not testable in jsdom** | PARTIAL |
| F32 | Service search filtering as you type | `renderServices` | A | portal: "sante" finds "Centre de santé", no-result message | PASS |
| F28 | Featured services first and highlighted; admin toggle | `services.featured`, PATCH `/api/services/:id` | A | smoke: admin publishes featured service; portal: first card has `service-featured`. Admin toggle button click not exercised | PARTIAL |
| D12 | First-login guide (profile → service → request), dismissible, per user | `renderGuide` | A | portal: guide shown, steps tick after profile save and first message, dismissal stored under `guideDone:<id>` | PASS |
| D14, F27 | French/English interface and service/announcement content, explicit fallback | `public/i18n.js`, `title_en`… columns | A | portal: toggle → EN headings, EN service title, EN alert banner, `<html lang>`. Full-page string coverage not audited | PARTIAL |
| — | Portal accessibility: keyboard, focus, contrast, 150 % text, reduced motion | `public/styles.css`, `app.js` | A | Text-scale/contrast buttons exist; new F34/F35 UI has 44 px targets, labels, `role=status`. **No browser/axe/contrast run on the portal** | UNVERIFIED |
| F33 | Citizen deletes own account: password re-typed, own account only, stated policy, session revoked, logged out | `DELETE /api/me`, `eraseUser()` | A | smoke: wrong password 403, staff 403, success → logged out, cannot log in again, messages erased; policy text shown in the form ("account, messages and reports permanently deleted") | PASS |
| F34 | Staff list/search citizens; deactivate/reactivate; reset password (one-time); delete. Server role checks on every route; staff accounts protected; deactivated cannot log in, sessions revoked | `/api/admin/citizens*`, `users.active`, portal panel "Comptes des habitants" | A | smoke (14 checks): anonymous 401, citizen 403, search + wildcard escaping, staff target 403 on patch/reset/delete, 404, bad body 400, deactivate kills session + login 403, reactivate, reset ends sessions + old password dead + new works, delete. portal: list/search/deactivate/reactivate/reset (password really works)/delete with confirmation/cancel/EN | PASS |
| F35 | Short contextual tips at first use (message form, first report, service search), dismissible, remembered per user | `renderTips`, `tipDone:<user>:<name>` | A | portal: no tip before use; appears on first focus / when choosing "report"; dismiss hides, returns focus, persists; sending first message clears them | PASS |
| F36 (portal) | Transports section: both lines, disruptions, next departures, profile-district stop first | `GET /api/transports`, `PATCH /api/transports/:code`, `renderTransports` | A | smoke: 2 lines, 3 departures per stop, exact stop→district mapping, T1 disrupted, agent PATCH + validation. portal: district stop first with badge, both lines, disruption | PASS |
| — | `/monde/` serving: navigation fallback only, true asset 404, MIME, traversal blocked, CSP, caching | `serveWorld` | A | smoke + real build: `.glb` MIME, ETag/304, fingerprinted = immutable, others `no-cache`, missing `.glb` JSON 404, `/monde/dashboard` → index, `..%2f` blocked, CSP per contract, `/monde` → 301 | PASS |
| — | Deploy: build, boot, persistent data, production smoke | `hodifly.json`, `npm run build` | A+B | `npm run build` and local boot pass. **Not run on Hodifly** | UNVERIFIED |

## World features owned by A

| Code | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| D18/F29–F31 (world) | Phone shows real alerts, full text, audience, acknowledgement once, withdrawal reconciled, per-user seen IDs, corrupt storage safe, polling 15 s without unmount leaks | `useAnnouncements`, `PhoneScreen`, `AlertAnnouncer` | world-ui: corrupt/non-array/foreign storage, per-user + reload + second user, withdrawal on next poll, new arrival, stale/retry, initial error never shown as "no alerts", unmount mid-request does not reschedule | PASS (component level) |
| F36 (phone) | Transports page: both lines, next three departures, disruption text, nearest stop first, 60 s refresh, empty/offline/stale | `PhoneScreen` transports/home, `useTransports` | world-ui: nearest first within and across lines, no invented highlight when unknown, stale/error independent of announcement status. **Nearest stop from player coordinates and the 60 s poll in the running app are B's wiring** | PENDING-B |
| D14/F27 (world) | FR/EN phone, HUD, editor; FR fallback marked | `ui/i18n.js` | world-ui: EN chrome/content, `lang="fr"` + FR tag on untranslated items | PASS (component level) |
| Phone | Accessible screen/fallback: dialog semantics, focus in/trap/return, Escape (detail → back, pending → acknowledge, else close) | `PhoneFallback`, `useDialogFocus` | world-ui: focus enters, Tab/Shift+Tab wrap, escaped focus pulled back, Escape returns focus to opener | PASS (jsdom) |
| HUD | Compact labeled controls, ≥ 44 px, unread badge, portal link always visible, no key listeners | `ui/WorldHud.jsx` | world-ui: labels, badge text, aria-expanded, callbacks, EN, optional controls. **Layout over the 3D scene not seen** | PARTIAL |
| Avatar | Editor with save/cancel/error, preview slot, saved colours restored on cancel | `AvatarEditor.jsx` | world-ui: live change, failure stays open with `role=alert`, cancel restores, success PUTs. **First-run onboarding flow is B's `App.jsx` (opens editor when no avatar)** | PARTIAL |

## World features owned by B (listed so nothing is dropped; A has not verified them)

| Requirement | Owner | Status |
|---|---|---|
| Five districts, TPS/FPS, movement (roadmap §3), camera, input lock | B | UNVERIFIED by A |
| Animated avatar/NPCs, presence interpolation and expiry | B | UNVERIFIED by A |
| Physical phone device + DOM bridge, phone state machine, urgent camera presentation/restoration | B | PENDING-B |
| F36 world: stations at the five stops, moving tram, nearest stop from position | B | PENDING-B |
| Loading/WebGL fallbacks, performance, touch decision | B | UNVERIFIED by A |

## Declaration guidance

Declare as working only rows marked PASS after a browser pass on production (`docs/QA_A.md` lists what that pass must cover). Do not declare F36's world half until B's stations/tram exist and the phone page is fed by the live poll.
