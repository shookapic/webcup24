# Session A — QA and handoff

2026-10-03. Scope: A0 (scope ledger), A1 (transport API check, phone data hook/screen/fallback/HUD/alerts/i18n), A2 (editor polish, F34, F35), A3 (asset serving, README, evidence). Nothing is committed yet; all changes are in the working tree of `webcup24`.

## Milestone handoff

**Not committed.** Suggested commit split, each naming its codes per `CLAUDE.md`:
1. `Citizen administration API + portal (F34)` — `server.mjs`, `store.mjs`, `security.mjs`, `public/*`, `tools/qa-a/portal.mjs`
2. `First-use tips (F35)` — `public/*`
3. `World serving: real 404s, ETag, gzip` — `server.mjs`, `tools/smoke-a.mjs`, README
4. `Phone screen/fallback, HUD, editor, i18n (D18, F29–F31, F36, D14/F27)` — `world/src/Phone.jsx`, `world/src/ui/**`, `world/src/AvatarEditor.jsx`, `world/src/styles.css`
5. `Docs: feature matrix, QA_A` — `docs/*`

### Found already done (verified, not rebuilt)
`GET /api/transports` (contract-exact, incl. stop→district mapping and agent `PATCH`), the portal Transports section, and F33 were already on `main` (`fb11d85`, `4de1d7d`, `8b9c038`). F34 and F35 were not implemented anywhere.

### Changed
| Area | Change |
|---|---|
| F34 | `users.active` column (migration pattern), `GET /api/admin/citizens?q=`, `PATCH /api/admin/citizens/:id {active}`, `POST /api/admin/citizens/:id/password`, `DELETE /api/admin/citizens/:id`; agent/admin only; target must be `citizen` (staff → 403); deactivation deletes sessions and presence; `currentUser` ignores inactive users; login of a deactivated account returns 403 only after the password is right. `eraseUser()` is shared with F33. Portal panel "Comptes des habitants" with inline delete confirmation and a one-time password box. |
| F35 | Tips for service search, first message, first report; `tipDone:<userId\|guest>:<name>` in localStorage; dismissal returns focus to the field; sending a message clears its tips. |
| Serving | `/monde` → 301 `/monde/`; navigation (no extension) falls back to the app, anything with an extension that does not exist is a JSON 404; immutable cache only for hashed `assets/**/name-<hash>.ext`, everything else `no-cache` + ETag/304; gzip (level 9, cached per file version) for html/js/css/json/svg/wasm/gltf/glb/bin over 1 KB with `Vary`. Measured on the current build: world JS+CSS 5.67 MB raw → 1.96 MB gzip. |
| Phone | `Phone.jsx`: `useAnnouncements`, `PhoneScreen`, `PhoneFallback`, `AlertAnnouncer`, legacy `Phone` (same props as before, now also fetching services/transports itself). `ui/`: `i18n.js`, `storage.js`, `usePolled.js` (also `useServices`, `useTransports`), `useDialog.js` (`useDialogFocus`), `WorldHud.jsx`. |
| Editor | Locale, optional `preview`, saving state, `role=alert` error, keys stop at the dialog (Escape still cancels), cancel restores saved colours. |
| CSS | `world/src/styles.css` rewritten: new phone/HUD/editor blocks; legacy `.hud`, `.welcome`, `.controls-help` kept until `App.jsx` switches. |
| README | Dependency description fixed; new commands and features. |

### Interface changes for B (all additive; old named exports still work)
`App.jsx` was **not** touched. Wiring B should do:

```jsx
const { announcements, unseen, status, error, lastUpdated, acknowledge, retry } =
  useAnnouncements({ userId: user ? user.id : null, ready: user !== undefined });
```
- **`ready`** is an addition to the contract: `false` reports no unseen alerts. Use it while `/api/me` is loading, otherwise a returning user's already-acknowledged alerts flash as new under the guest key.
- `acknowledge(ids)` takes the shown IDs (what `PhoneScreen` passes to `onAcknowledge`); with no argument it acknowledges everything currently unseen (old behaviour).
- `PhoneScreen` extras: optional `onRetry` (announcements). `services` / `transports` accept a plain array **or** the object `useTransports()` / `useServices()` return (`{ data, status, error, lastUpdated, retry }`), so transport fetch status stays separate from announcement status. `nearestStop` is a stop name (`'Mairie'`) or `{ name }`; accent/case-insensitive match against the API stop names; when absent nothing is highlighted.
- Pending alerts (`pendingAlerts` non-empty) replace the page with the alert view, hide navigation and Close, and focus the heading; Escape acknowledges **exactly the rendered IDs**. When it empties, focus goes back to the page title. `AlertAnnouncer` is for the case where the phone is not showing them (editing); mount it with `active={!phoneShowsAlerts}` so text is not read twice.
- 3D host: render `<PhoneScreen>` inside your DOM bridge element and call `useDialogFocus(hostRef, phoneOpen)` from `ui/useDialog.js` for focus entry/trap/return; give the host `role="dialog" aria-label`. Only one screen may be mounted (the hook warns otherwise). `PhoneScreen` fills 100 % of its parent (`height:100%`), is rem-based, scrolls inside, and never uses fixed positioning.
- `WorldHud` renders only the controls whose handler you pass (`onEditAvatar` etc.), always shows the portal link, has `pointer-events:none` on its container. It sets no key listeners.
- Strings for B's own UI: `import { t } from './ui/i18n.js'` (`help.controls` holds the movement help line in both languages); `getLocale()` reads the portal's `lang` preference.
- Portal handoff links (`/#services`, `/#actualites`, `/#message-form`, `/`) open in a **new tab** so the world session survives.

### CSS requirements answered
B asked for none yet in `docs/QA_B.md`. A owns all world CSS; send requirements (e.g. host element size for the phone bridge) and I will add them.

## Evidence (all local, 2026-10-03)

| Command | Result |
|---|---|
| `node tools/smoke-a.mjs` | 62/62 — API contracts, roles, F33, F34, `/monde/` serving incl. gzip |
| `node tools/qa-a/portal.mjs` | all pass — real `index.html` + `app.js` in jsdom: F34 UI, F35 tips, D12, F28, F32, D14/F27, D18/F29 banner, F36 ordering |
| `node tools/qa-a/world-ui.mjs` | all pass (≈70 checks) — screen pages/states, FR/EN, dialog focus, hook polling/storage/unmount, HUD, editor |
| `npm run build` | passes; main 1.27 MB (347 KB gzip), PlayableCity 4.38 MB (1.61 MB gzip) |
| Real build over Node | `/monde/` 200 `no-cache`; hashed JS immutable; `nope.glb` and `models/x.glb` JSON 404; `/monde/dashboard` serves the app |
| Contrast (computed) | lowest phone/HUD/editor text pair 6.4:1 (teal on surface); body text 10–13:1 |

The two jsdom scripts were also run against deliberately broken input during development (leaked polling roots produced 29 vs 22 requests, which the unmount check detected), so they can fail.

## Not verified — do not claim these

- **Anything in a real browser**: visual layout of phone/HUD/editor/portal panels, focus ring visibility, 150 % text, 390×844, reduced motion, touch targets, HUD over the 3D scene (its background is 88 % opaque; contrast over bright sky not measured).
- **Browser `Notification` opt-in** (F30-era feature, unchanged code) — jsdom has none.
- **Live contest feed** with a real key; **current-wave completeness** (see `FEATURE_MATRIX.md`).
- **Hodifly**: boot, persistence of `data/`, whether the host also compresses (we send our own `Content-Encoding: gzip`), production CSP/console.
- **Two users on one real browser** for world alerts (storage logic is unit-tested, the UI path is not).
- Admin UI buttons for lifting an alert and toggling "featured" (the API is tested).
- Anything depending on B: physical phone alignment/click handling, nearest stop from position, the 60 s poll in the app, alert-during-editing flow, tram/stations.

## Known limitations / decisions
- F33/F34 deletion policy: messages and reports are **deleted with the account** (stated in the UI).
- F34 reset returns the temporary password in the response body (shown once, never stored in plain text, never logged; the server logs only staff and citizen ids). There is no password-change screen for citizens yet, so the UI does not promise one.
- No rate limit on `/api/admin/*` beyond the role check.
- Deactivated users get "account deactivated" only after a correct password, so the message does not reveal which emails exist.
- Services polled every 60 s in the phone legacy wrapper (no contract rate was specified; services rarely change).
- jsdom is not a project dependency (`package.json` is B's): the scripts need `npm i --no-save jsdom`.
- Old `.hud` / `.controls-help` CSS stays until B removes the old HUD from `App.jsx`.

## Next dependency / production pass
1. B: swap `App.jsx` to `useAnnouncements({ userId, ready })`, `PhoneScreen` in the bridge, `WorldHud`, `AlertAnnouncer` during editing; feed `transports` (60 s) and `nearestStop`.
2. A, once B has a build: browser pass — keyboard-only through every phone page, FR/EN long text at 150 %, 390×844 + desktop, alert while walking/reading/editing, acknowledge → reload, withdrawal, two users, malformed storage (set `world-seen-alerts:<id>` to garbage), offline/reconnect, capture handheld view.
3. Both: Hodifly smoke including Wave 4 (F33–F36) with dedicated test accounts only.
