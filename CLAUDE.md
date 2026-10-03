# Terra Nova — 24H By Webcup 2026

Two people, two Claude Code sessions, one repo. Read this whole file before touching code.

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
| **A — Portal & API** | `server.mjs`, `store.mjs`, `security.mjs`, `public/**`, `hodifly.json`, `README.md` | Contest requests in the portal + the API the world needs |
| **B — World** | `world/**`, `package.json`, `package-lock.json`, `vite.config.*` | The 3D planet, avatars, NPCs, shaders, TPS/FPS "phone" |

Shared: this `CLAUDE.md` (edit the contract below only together).

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
| `GET /monde/*` | Files from `dist/monde/`, unknown paths → `dist/monde/index.html`. Path traversal blocked. |

CSP for `/monde/*` responses (the world needs it; keep the portal's strict CSP as is):
`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; base-uri 'none'; object-src 'none'`
(Rapier physics is WebAssembly; GLTFLoader uses blob:/data: URLs.)

Polling rates: announcements every 15 s, presence every 2 s, transports every 60 s. Nothing faster.

## Session A — Portal & API (in order)

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

## Session B — World (in order)

1. **Skeleton first, push early**: Vite + React + R3F in `world/` (`base: '/monde/'`, `outDir: '../dist/monde'`), `"build": "vite build"`, `"dev:world"` script, dev proxy `/api` → `http://127.0.0.1:3000`. Commit the lockfile. Merge as soon as `npm run build` passes so the Hodifly pipeline is proven before the scene gets big. Add `dist/` to `.gitignore`.
2. **Planet scene**: flat ground bent by a curved-horizon vertex shader (no spherical gravity), sky + a real 3D planet/atmosphere shader in the sky, buildings from CC0 kits (Kenney / Quaternius / KayKit, glTF in `world/public/`) grouped by district: Mairie, Santé, Quartier sud…
3. **Player**: `ecctrl` + `@react-three/rapier`, third-person by default. Not logged in → show a link to the portal login (`/`).
4. **Avatar**: one low-poly character, 3 color pickers (skin, outfit, accent), saved with `PUT /api/me/avatar`.
5. **NPCs**: bots walking between waypoints near buildings. Plain code; `yuka` only if crowds need avoidance.
6. **Phone**: HTML overlay (not 3D text). New urgent announcement → camera switches to first-person and the phone shows the alert in front of the user. Phone also lists announcements and links back to the portal.
7. **Other players**: presence polling, interpolate positions.
8. **Shaders polish**: `@react-three/postprocessing` (bloom, vignette, tone mapping). Cap `dpr` at 1.5.

Steps 1–8 are done and on `main`. Wave 4:

9. **F36 (580), transports in the world**: a tram line with stations at the district stops and a moving tram; the phone gets a "Transports" view with the next departures (from `GET /api/transports`), the player's nearest stop first.

World rules: no CDN or external fonts/assets (CSP blocks them; drei `<Text>` must get a local font). Canvas `aria-hidden="true"`; the phone is real HTML with `aria-live` for alerts; respect `prefers-reduced-motion`; a visible "Version accessible" link to `/`. The portal stays the accessible version and the fallback.

## Watching the API for new waves

`npm run watch-api` polls the contest API every 30 s and writes `api-requests.md` (git-ignored, newest requests on top, with the time each was first seen). It needs `TERRA_NOVA_API_KEY` in `.env`.

- In a terminal: `npm run watch-api` keeps running and prints new requests.
- In a Claude Code session: ask Claude to run `npm run watch-api -- --exit-on-new` as a background task. It exits when new requests appear, so Claude gets notified; Claude then reports them, triages them A/B, and restarts it.

One watcher per machine is enough. Both sessions add new waves to the lists above.

## Git workflow

- A works on branch `portal`, B on branch `world`. Only `main` deploys.
- Merge to `main` often (small steps). Before merging: `git pull --rebase origin main`, `npm run build` passes, `npm start` boots, click through what you changed.
- Never push a broken `main`: a failed build means no deploy, and a broken server means the jury sees nothing.
- Commit messages say which request codes they cover (e.g. `Alerts banner (D18, F29, F31)`), so the final jury declaration is easy to write.

## Rules for both sessions

- Ponytail mode: simplest thing that works, no new dependency for what a few lines do. Never cut validation, security, or accessibility.
- Validate every input on the server (see `readJson`, `fail()` helpers in `server.mjs`). Reuse existing helpers before writing new ones.
- No secrets in git. `.env` and `data/` stay ignored.
