# Terra Nova — 24H By Webcup 2026

Two people, two Claude Code sessions, one repo. Read this whole file before touching code.

## Active polish handoff — 2026-10-03

Read [the code review](docs/CODE_REVIEW.md) and [the roadmap/spec](docs/GAME_ROADMAP.md) before implementing. The user requested a playable, deliberately designed game and a physical handheld phone. The active tasks below supersede the old v1 execution order. Existing contest requirements, including Wave 4, remain mandatory. Component existence or build success is not proof of runtime quality.

**Priority:** stable movement → convincing plaza/animated character → physical phone integration → all districts → regression/performance. A advances civic features and UI concurrently with B. Do not wait for all art work before testing the phone bridge.

## The contest in 5 lines

- Requests arrive through `GET https://24h.webcup.fr/wp-json/webcup/v1/requests` (header `X-Webcup-Api-Key`), in waves roughly every hour. `request_code` is the stable id.
- Each request is worth XP (Facile 250 / Moyenne 500 / Difficile 750 / Expert 1000, plus a fixed time bonus). The jury tests each declared feature: 0 XP if broken, full XP if it works, bonus if excellent. Overall quality adds up to +30%.
- Only what runs in production at the end of the 24 h counts. Keep `main` deployable at all times.
- Declare only features that really work.
- The API city name is "Nova Terra"; our app says "Terra Nova". Keep "Terra Nova".

## Stack and deploy

- Node 24, zero runtime dependencies on the server: `server.mjs` (plain `node:http`), `store.mjs` (`node:sqlite`), `security.mjs` (sessions, scrypt).
- Portal frontend: plain JS in `public/` (no build). Served through the allowlist `files` in `server.mjs`.
- 3D world: Vite + React + React Three Fiber in `world/`, built to `dist/monde/`, served at `/monde/`.
- Hosting: Hodifly (cPanel, Passenger). Every push to `main` deploys. Config in `hodifly.json`: Node mode, `startup: server.mjs`, `persist: data/`, requires `TERRA_NOVA_API_KEY`. Hodifly runs `npm ci`/`npm install` then `npm run build`.
- **No WebSockets on Hodifly.** Anything live = polling.
- Local dev: copy `.env.example` to `.env`, set `TERRA_NOVA_API_KEY`, `npm start` → http://127.0.0.1:3000. For the world: `npm run dev:world` (Vite, proxies `/api` to :3000).

## Who owns what

Edit only files you own. Need a change in the other person's file? Ask them (or leave a clear note in your commit) instead of editing it.

| Session | Owns | Mission |
|---|---|---|
| **A — Experience & API** | `server.mjs`, `store.mjs`, `security.mjs`, `create-staff.mjs`, `public/**`, `hodifly.json`, `README.md`; `world/src/Phone.jsx`, `world/src/AvatarEditor.jsx`, `world/src/styles.css`, `world/src/ui/**`; `docs/FEATURE_MATRIX.md`, `docs/QA_A.md` | Civic features, accessible phone content/HUD, localization, API and regression |
| **B — Gameplay & art** | All remaining `world/**` (including `App.jsx`, `Player.jsx`, `City.jsx`, new `PhoneRig.jsx` and assets), `package.json`, `package-lock.json`, `vite.config.*`, `.gitignore`; `docs/ASSETS.md`, `docs/QA_B.md` | Movement, camera, city, animated characters/NPCs, tram, physical phone and integration |

Shared: this `CLAUDE.md` (edit the contract below only together).

The review/spec are the shared baseline. Propose changes in your own QA file and coordinate before modifying contracts. B alone wires components in `App.jsx`; A owns all world CSS. B supplies any CSS requirements in `docs/QA_B.md`. Watcher files remain with their current owner; do not create duplicate watchers.

## Active Session A tasks — in order

1. **A0 / protect scope:** create `docs/FEATURE_MATRIX.md` from the latest authorized feed or watcher snapshot. Include exact codes/requirements, implementation, owner, tests and pass/fail/unverified. Preserve all baseline and Wave 4 features. Existing portal features should be verified rather than rebuilt.
2. **A1 / unblock integration:** finish/preserve the Wave 4 transport API contract below first if outstanding. Implement the phone data hook, accessible screen/fallback and compact HUD under the interfaces below. Include real alerts, full news, services and transport departures, French/English, focus handling and stale/error states. Fix corrupt storage and unmount polling leaks. Keep old named exports until B integrates replacements.
3. **A2 / citizen experience:** polish avatar editor/save/cancel/error and onboarding; deliver remaining F33/F34/F35 portal work listed below without regression. Coordinate modal input boundaries with B. No unauthenticated or fake account-management actions.
4. **A3 / delivery:** correct missing asset 404/cache behavior, check model MIME/CSP via Node serving, run the full feature matrix and fix README's obsolete dependency description. Record evidence and outstanding blockers in `docs/QA_A.md`.

## Active Session B tasks — in order

1. **B0 / blocking movement:** reproduce oscillation on a floor-only scene, instrument physical position/rotation/camera, inspect installed ecctrl, isolate automatic colliders/balance/update order. Fix the measured cause, central input lock, camera and hold-to-run. Pass roadmap §3 before art expansion.
2. **B1 / visual slice:** select compatible licensed local assets and record provenance; build spawn plaza/Mairie, one rigged recolorable avatar, a walking NPC, lighting and shadows. Replace global shader mutation with scoped distant curvature. Pass the visual gate before repeating districts.
3. **B2 / complete colony:** all five districts, shared path/collider/label data, animated NPC routes, remote avatar interpolation/expiry, contextual service access. Preserve/complete F36 stations and moving tram; see transport acceptance below.
4. **B3 / physical phone:** camera-relative modeled device plus hand/forearm, aligned A-owned HTML screen, state machine, focus/input integration and camera restoration. Start the bridge during B1 rather than waiting until B2 ends. CSS-only phone is the fallback, not final desktop presentation.
5. **B4 / release:** loading/WebGL/asset fallbacks, tested quality settings and narrow-screen behavior, performance route, captures and production smoke. Record evidence in `docs/QA_B.md`. Preserve required features when reducing optional art/effect scope.

## Frontend integration contracts — target interfaces

These are agreed implementation targets, not existing exports. Changes require a handoff before editing the other side.

- A exports `useAnnouncements({ userId })` from `Phone.jsx`: `{ announcements, unseen, status, error, lastUpdated, acknowledge(ids), retry }`; status is `loading | ready | stale | error`. Per-user guarded storage, explicit acknowledged IDs, withdrawal reconciliation, cleanup guards; 15 s polling.
- A exports `PhoneScreen({ page, onPageChange, announcements, pendingAlerts, services, transports, nearestStop, status, error, lastUpdated, onAcknowledge, onClose, locale })`: semantic HTML with no Canvas/camera access or fixed viewport positioning. Pages `home | alerts | news | services | transports`; news-detail state may be internal. Acknowledgement passes only shown IDs. Keep transport fetch status distinct from announcement status.
- A exports `PhoneFallback` as an accessible dialog wrapper around the same content: focus entry/trap/return, Escape and scrolling. Provide reusable dialog semantics for the 3D screen's DOM host too; only one focusable screen instance exists at a time.
- A adds `ui/WorldHud.jsx`: `WorldHud({ locale, view, phoneOpen, unreadCount, district, onTogglePhone, onToggleView, onEditAvatar, onToggleHelp })`. DOM only, visible portal fallback, compact labeled controls; no independent gameplay shortcut listener.
- A retains `AvatarEditor({ open, avatar, onChange, onClose })`, optionally accepting a `preview` React node supplied by B. Cancel restores saved colors, save failures remain visible.
- A owns translated strings in `ui/i18n.js`. B owns `App.jsx` locale/data wiring and fetches services/transports using existing API contracts. Transport polling is 60 s; nearest stop derives from player world coordinates and stop mapping, never list order or invented service IDs.
- B's `PhoneRig` owns device/hand geometry, camera pose and screen alignment through a DOM bridge. Never render HTML directly as R3F objects. Reproduce any claimed drei compatibility problem before choosing a workaround; prove alignment/click handling early.
- B's `App.jsx` owns `view`, `phonePhase`, `editing`, `inputEnabled`, pending-alert presentation and pre-phone camera snapshot. One input/camera authority. A UI components invoke callbacks instead of manipulating camera/keys.

### F36 world acceptance

Preserve the moving tram and stations requirement. B maps all five named stops to the shared district/path data, provides visible stop signs and a non-obstructing tram route; doors/boarding are optional unless the official request requires them. A supplies real API departures/disruption text in portal and phone. Portal prioritizes profile district; world prioritizes physical nearest stop. Do not present decorative tram position as live authoritative timetable tracking unless actually synchronized. Verify both lines, nearest-stop changes, disruptions, empty/offline state and 60 s refresh. Keep tram routes clear of NPC/player paths or handle intersections deliberately.

## Contract between A and B

A implements, B consumes. Same origin, same session cookie: a user logged in on the portal is logged in on `/monde/`.

| Endpoint | Body / response |
|---|---|
| `GET /api/me` | `{ user: { id, email, name, role, avatar } \| null }`. `avatar` = `{ skin, outfit, accent }` (hex colors) or `null`. |
| `PUT /api/me/avatar` | body `{ skin, outfit, accent }`, each `#rrggbb`. Auth required. → `{ avatar }` |
| `GET /api/announcements` | `{ announcements: [{ id, title, body, published_at, urgent, audience }] }`. `urgent` 0/1, `audience` free text (`"Tous"`, `"Quartier sud"`, `"Personnes vulnérables"`…). Newest first. |
| `POST /api/presence` | body `{ x, z, ry }` (finite numbers). Auth required. In memory only. → `204` |
| `GET /api/presence` | `{ players: [{ id, name, avatar, x, z, ry }] }`, positions updated < 15 s ago, excluding the caller. |
| `GET /api/transports` | Public. `{ lines: [{ code, name, color, status, message, stops: [{ name, district, next }] }] }`. `code` e.g. `"T1"`; `color` `#rrggbb`; `status` `"normal"` \| `"perturbé"`; `message` text or `null`; `next` = the next 3 departures from that stop as `"HH:MM"` (Terra Nova local time, computed server-side from first/last/frequency). Stop names are world places: `Mairie`, `Santé`, `Quartier sud`, `Marché`, `Habitat`. `district` uses the portal profile list: Mairie → `Centre-ville`, Habitat → `Quartier nord`, Santé → `Quartier est`, Marché → `Quartier ouest`, Quartier sud → `Quartier sud`. |
| `GET /monde/*` | Files from `dist/monde/`; SPA fallback for navigation only; missing assets return 404. Path traversal blocked. |

CSP for `/monde/*` responses (the world needs it; keep the portal's strict CSP as is):
`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; base-uri 'none'; object-src 'none'`
(Rapier physics is WebAssembly; GLTFLoader uses blob:/data: URLs.)

Polling rates: announcements every 15 s, presence every 2 s, transports every 60 s. Nothing faster.

## Original Session A feature backlog — preserve and verify

The active tasks above set execution order. Items below retain original request details; do not repeat completed implementation blindly.

1. **Unblock B** (~30 min): `/monde/*` serving + its CSP, `avatar` column (JSON text) on `users` + `PUT /api/me/avatar`, `currentUser` returns `avatar`, in-memory presence endpoints. Use the `ALTER TABLE` migration pattern already in `store.mjs`.
2. **Alerts — D18, F29, F30, F31 (3 080 XP)**: `urgent` + `audience` columns on `announcements`; "Urgent" checkbox + audience field on the admin news form; newest urgent item shown in a `role="alert"` banner on every page; add `loadNews()` to the 30 s refresh and fire a browser `Notification` (opt-in button) for new urgent items.
3. **F32 (280)**: search field filtering the services list as you type.
4. **F28 (270)**: `featured` flag on services, featured ones first and highlighted; admin can toggle.
5. **D12 (540)**: first-login guide (complete profile → find a service → start a request), dismissible, remembered per user.
6. **D14 + F27 (1 080)**: language switch (fr/en at least) for the interface *and* service content.
7. New waves: triage with B. Portal-shaped requests default to A.

Wave 4 (H+5h, 1 740 XP) — in this order:

8. **F36 (580), transports — API first, B is waiting on it**: `GET /api/transports` exactly as in the contract (2 lines is plenty, e.g. T1 Habitat ↔ Mairie ↔ Quartier sud, T2 Marché ↔ Mairie ↔ Santé). Portal: a "Transports" section that shows the lines, perturbations, and puts the stop of the logged-in user's `district` first, so they see their next departures without browsing.
9. **F33 (290)**: a citizen deletes their own account: confirm by re-typing the password, delete the user and their sessions (messages stay, anonymised or cascaded — pick one and say it in the UI), log out, confirmation message.
10. **F34 (580)**: agents/admins administer citizen accounts: list + search, deactivate/reactivate, reset password (show a one-time password like `create-staff`), delete. Server-side role check on every route; staff accounts can't be modified from there; deactivated users can't log in and their sessions are revoked.
11. **F35 (290)**: short contextual tips at the moment of first use (first message form, first report, first service search), dismissible, remembered per user. Builds on the D12 guide.

Wave 5 (H+6h25, 2 400 XP) — triaged to A (portal-shaped), in this order:

12. **F37 (900), login attack protection, visible but not annoying**: per-account and per-IP failed-login counters (not just per IP+email), growing delay then temporary lock; the login form says how many tries remain / when to retry; on next successful login the citizen sees "N failed attempts since your last login"; staff space lists accounts under attack. No CAPTCHA.
13. **F39 + F40 (900), appointments + reminder**: agents publish slots (service, date-time, place); a citizen books one with a reason; the confirmation spells the slot out unambiguously (weekday, full date, time, Terra Nova time, place, what to bring) and can be cancelled. Reminder: "upcoming appointment" banner in the portal within 24 h, a browser `Notification` (reuse the opt-in), and an `.ics` download with a `VALARM` so the phone's calendar reminds them.
14. **F38 (600), service status**: `status` (`ouvert` / `maintenance` / `incident`), `status_message`, `back_at` on services; admin sets it; the service card and the request form show "unavailable until …, meanwhile do …" before the citizen starts. Expose the fields in `GET /api/services` for B.

Wave 6 (H+7h55, 3 720 XP) — accessibility and plain language, A (portal + A-owned world UI), in this order:

15. **F42 (930) + D20 (930), assistive-technology audit**: every form field has a visible label and `aria-describedby` hints; errors are tied to their field (`aria-invalid`, message by id), focus moves to the first error, success/error statuses are announced; every dialog/phone page traps and returns focus; record a checklist with evidence in `docs/QA_A.md`. No parcours that only works with a mouse or only in the 3D world: the portal stays the complete accessible version.
16. **F41 (620), keyboard only**: logical tab order, visible focus everywhere (portal, phone, HUD, avatar editor), skip links to each section and to "Mon espace", no keyboard traps, all actions reachable (feature/lift/deactivate buttons, language switch).
17. **F44 (620), zoom**: page usable at 200 % browser zoom and 400 % reflow (320 px wide) without horizontal scroll or overlapping text; extend the A+ control if needed.
18. **F43 (310), colour**: never colour alone — status pills, alert banner, transport lines, featured cards and form errors carry text/icons/patterns; check contrast in normal and high-contrast modes.
19. **D13 (310), plain language**: replace jargon in the interface ("démarche", "signalement", "statut"…) with everyday words, plus a short "Lexique" (glossary) with `<abbr>`/definitions for the remaining terms, in fr and en.

Wave 7 (H+8h, 2 880 XP) — A, in this order:

20. **F47 (960) + F48 (640), audit log**: one `audit_log` table (`at`, `actor_id`, actor name/role snapshot, `action`, `target_type`, `target_id`, short `details`), written by every staff/admin mutation (message status, services, announcements/alerts, transports status, citizen admin, slots…) and account deletions. Staff space: "Journal des actions" newest first, filter by action/person/date, plain-language lines ("Agent Dupont a désactivé le compte de M. Martin — 03/10 16:40"). Append-only: no edit/delete route.
21. **F45 (960) + F46 (320), find physical services**: each service gets an address, district, opening hours and nearest tram stop (`GET /api/services` fields, shared with B); service cards show "Où ? / Comment y aller ?" with the next tram from `GET /api/transports`; an always-visible "Urgences" block (112/15/18, centre de santé address and hours, nearest stop) on the home page and in the phone.

Wave 8 (H+9h, 2 970 XP) — A, in this order:

22. **F49 (330), status-change notice**: when a citizen's message changes status, the portal shows "Votre demande « … » est passée à En cours" (per-user last-seen status, cleared once read), and fires a `Notification` through the existing opt-in during the 30 s refresh.
23. **F50 (990), staff dashboard**: top of the staff space — messages to handle / in progress / resolved, reports per district, average resolution time, active alerts, disrupted lines, new citizens this week, a 7-day activity bar chart (plain CSS/SVG with text values, not colour alone). Numbers link to the filtered lists.
24. **F51 (990), "Vos données"**: plain-language page of what is stored, why and how long; JSON export of the citizen's own data; a "Question sur mes données" request kind with a reference number and tracked status, visible to staff; mention the account deletion (F33).
25. **F52 (660), support a request**: public, anonymised list of incident reports (subject, place, date, status); one "Je soutiens" per citizen (unique constraint), visible count and "Vous soutenez cette demande depuis le …"; staff see the count.

## Original Session B scope — retained for traceability

The active spec supersedes the implementation approach below, particularly the overlay-only phone and global curvature. All functional features remain required.

1. **Skeleton first, push early**: Vite + React + R3F in `world/` (`base: '/monde/'`, `outDir: '../dist/monde'`), `"build": "vite build"`, `"dev:world"` script, dev proxy `/api` → `http://127.0.0.1:3000`. Commit the lockfile. Merge as soon as `npm run build` passes so the Hodifly pipeline is proven before the scene gets big. Add `dist/` to `.gitignore`.
2. **Planet scene**: flat ground bent by a curved-horizon vertex shader (no spherical gravity), sky + a real 3D planet/atmosphere shader in the sky, buildings from CC0 kits (Kenney / Quaternius / KayKit, glTF in `world/public/`) grouped by district: Mairie, Santé, Quartier sud…
3. **Player**: `ecctrl` + `@react-three/rapier`, third-person by default. Not logged in → show a link to the portal login (`/`).
4. **Avatar**: one low-poly character, 3 color pickers (skin, outfit, accent), saved with `PUT /api/me/avatar`.
5. **NPCs**: bots walking between waypoints near buildings. Plain code; `yuka` only if crowds need avoidance.
6. **Phone**: HTML overlay (not 3D text). New urgent announcement → camera switches to first-person and the phone shows the alert in front of the user. Phone also lists announcements and links back to the portal.
7. **Other players**: presence polling, interpolate positions.
8. **Shaders polish**: `@react-three/postprocessing` (bloom, vignette, tone mapping). Cap `dpr` at 1.5.

Steps 1–8 were previously reported implemented on `main`; the review identifies failures and quality gaps, so they are not acceptance-certified. Wave 4:

9. **F36 (580), transports in the world**: a tram line with stations at the district stops and a moving tram; the phone gets a "Transports" view with the next departures (from `GET /api/transports`), the player's nearest stop first.

Wave 5: all four requests go to A. Optional world tie-ins once A has shipped them:

10. **F38 tie-in**: a "Fermé / En maintenance" sign on a district building when its service's `status` isn't `ouvert` (`GET /api/services`).
11. **F39/F40 tie-in**: the phone lists the player's upcoming appointment (endpoint to be added to the contract by A).

Wave 6 (accessibility) — A leads; B covers what lives in B files:

12. **F41/D20 in the world**: full keyboard play (move, run, phone, avatar, help) with no mouse requirement, a visible key legend, no keyboard trap between canvas and DOM; respect `prefers-reduced-motion` (no camera shake, slower tram/NPC easing).
13. **F43 in the world**: districts, tram lines and stop signs distinguished by label/shape, not colour alone.

Wave 7:

14. **F45/F46 in the world**: from the phone's service or "Urgences" entry, a wayfinding cue (path highlight or arrow) to that service's building; a clear Santé/hospital sign. Uses the service address/district fields A adds to `GET /api/services`.

Wave 8:

15. **F49 tie-in (optional)**: the phone shows the citizen's status-change notices once A exposes them.

World rules: no CDN or external fonts/assets (CSP blocks them; drei `<Text>` must get a local font). Canvas `aria-hidden="true"`; the phone is real HTML with `aria-live` for alerts; respect `prefers-reduced-motion`; a visible "Version accessible" link to `/`. The portal stays the accessible version and the fallback.

## Watching the API for new waves

`npm run watch-api` polls the contest API every 30 s and writes `api-requests.md` (git-ignored, newest requests on top, with the time each was first seen). It needs `TERRA_NOVA_API_KEY` in `.env`.

- In a terminal: `npm run watch-api` keeps running and prints new requests.
- In a Claude Code session: ask Claude to run `npm run watch-api -- --exit-on-new` as a background task. It exits when new requests appear, so Claude gets notified; Claude then reports them, triages them A/B, and restarts it.

One watcher per machine is enough. Both sessions add new waves to the lists above.

## Git workflow

- A works on branch `portal`, B on branch `world`. Only `main` deploys.
- On one machine use separate worktrees; never switch branches underneath another live session or overwrite its uncommitted changes.
- Milestone handoff in each owner's QA file: commit, interface/asset changes, tests/evidence, unresolved issues and next dependency. Gates: movement → plaza plus physical phone → full districts/features → production acceptance. See roadmap §8.
- Merge to `main` often (small steps). Before merging: `git pull --rebase origin main`, `npm run build` passes, `npm start` boots, click through what you changed.
- Never push a broken `main`: a failed build means no deploy, and a broken server means the jury sees nothing.
- Commit messages say which request codes they cover (e.g. `Alerts banner (D18, F29, F31)`), so the final jury declaration is easy to write.

## Rules for both sessions

- Ponytail mode: simplest thing that works, no new dependency for what a few lines do. Never cut validation, security, or accessibility.
- Validate every input on the server (see `readJson`, `fail()` helpers in `server.mjs`). Reuse existing helpers before writing new ones.
- No secrets in git. `.env` and `data/` stay ignored.
