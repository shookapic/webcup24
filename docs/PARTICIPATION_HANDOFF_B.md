# Participation slice: handoff from B to A (F65, F66, F67, F68, F76)

Status labels: **committed** on branch `world` (B worktree), **NOT integrated** into A's server/portal, **NOT deployed**. Contract (unchanged by implementation): `coordination/reports/B-participation-contract.md`.

## Files (all new, B-owned; no A file was edited)
| File | Purpose |
|---|---|
| `participation.mjs` | backend: `initParticipation(db, { seedDemo })`, `handleParticipation(ctx)`, `eraseParticipationUser(db, userId)`; node:sqlite + node:crypto only |
| `public/participation.js`, `public/participation.css` | classic-script UI, `TerraParticipation.mount(root, { user, lang, api, services?, onChange? })` -> `{ update({ user, lang }), unmount() }`; safe DOM only, `.tp-*` CSS |
| `tools/qa-participation/` | `host.mjs` (mini host with A-shaped helpers), `participation-test.mjs` (API, 65 checks), `participation-ui.mjs` (browser, 24 checks), `integrated-e2e.mjs` (real-server end-to-end), `capture.mjs`, `stub.html` |
| `docs/qa-captures/participation/*.png` | guest FR, citizen FR, citizen EN at 320 px, staff FR |

## Integration steps for A (6 lines in A's files)
1. `server.mjs`: `import { initParticipation, handleParticipation, eraseParticipationUser } from './participation.mjs';`
2. After store init: `initParticipation(db, { seedDemo: true });` (demo rows are labelled "Exemple (démonstration)", have no votes/results; `false` = empty tables).
3. In `route()`, after A's own session/origin/throttle checks and before the final 404: `if (await handleParticipation({ request, response, path, method, user: currentUser(request), db, readJson, sendJson, fail, tx, audit })) return;`
   - `tx`/`audit` are optional. The module opens its own `BEGIN IMMEDIATE` transactions, so do not call it inside another transaction. `audit` is called as `audit(user, { category: 'participation', action, target, summary })`; if A's audit categories are an allowlist, add `participation`.
4. In `eraseUser(id)`: `eraseParticipationUser(db, id);`
5. Serve `/participation.js` and `/participation.css` from the public allowlist (CSP: same-origin script/style only, already allowed; the CSS uses no external font/image).
6. Portal: add `<section id="participation"><div id="participation-root"></div></section>` (e.g. after "Actualités", plus a nav link) and mount: `handle = TerraParticipation.mount(root, { user, lang, api, services })`; call `handle.update({ user, lang })` on login/logout/language switch (or unmount + mount). `api` must be the portal adapter; to localize server errors, let it keep `error.status` (the UI uses status 401/429/409, and for a 409 on vote it looks for "clos" in the message).

French error messages A may want in its English dictionary: `Vous avez déjà voté pour cette décision.`, `Ce vote est clos.`, `Cette consultation est close.`, `Donnez une note ou un commentaire.`, `Choix invalide.`, `Service inconnu.`, `Trop d’envois récents, réessayez plus tard.`, `Clé de soumission invalide.`, `Un vote clos ne peut pas être rouvert.`, `Une publication ne repasse pas en brouillon.`, `Une décision a entre 2 et 6 choix.`, `Accès réservé.`, `Connectez-vous pour continuer.`, `Introuvable.` (the module's own UI strings are bilingual inside `participation.js`).

## Routes (JSON, session cookie; roles: citizen / agent / admin)
| Route | Who | Notes |
|---|---|---|
| `GET /api/participation/overview` | anyone | open+closed decisions (no counts while open; counts + outcome when closed; `myVote {receipt,votedAt}` for a citizen, never the choice), consultations (`myOpinion`), projects |
| `POST /api/participation/decisions/:id/vote {choiceId}` | citizen | 201 `{receipt,votedAt}`; 409 `already_voted` (with the first receipt) or `closed`; 400 `invalid_choice`; staff 403 |
| `GET/PUT /api/participation/consultations/:id/opinion` | citizen | `{rating?,comment?}`; 201 first time, 200 on edit (same receipt); 409 `closed` |
| `GET /api/participation/projects` | anyone | read-only list |
| `POST /api/participation/ideas {title,body,key}` / `GET .../ideas/mine` | citizen | `key` (8-64 chars) makes retries idempotent (200 `duplicate:true`, same receipt); 5 per hour per user -> 429 |
| `POST /api/participation/feedback {serviceId,rating,comment?,key}` / `GET .../feedback/summary` | citizen / anyone | service must exist in A's `services`; summary has averages only |
| `GET /api/participation/mine` | citizen | history: votes (no choice), opinions, ideas with status, feedback |
| `GET /api/participation/admin/overview` | agent, admin | drafts, live counts, anonymous opinion summaries and comments, ideas (with author name), anonymous feedback |
| `POST/PATCH /api/participation/admin/{decisions,consultations,projects}[/:id]`, `PATCH .../admin/ideas/:id {status,note}` | agent, admin | decisions need 2-6 choices; closing is final; `closesAt` auto-closes by date |
| `DELETE /api/participation/admin/{decisions,consultations,projects}/:id` | admin | cascades choices/voters/opinions |

## Data, privacy, deletion
- Tables `part_*` only (8), `CREATE ... IF NOT EXISTS`, no foreign key to A's tables (`service_id` is a plain integer validated against `services` when it exists).
- Vote privacy (what is actually protected): no relation between a voter and a choice is stored. `part_choices` keeps an aggregate counter and `part_voters` stores who voted (one row per user per decision, UNIQUE), a receipt and a timestamp, never the choice; there are no per-ballot rows. LIMITS, not covered by this design: the staff overview shows running per-choice totals and each voter row has a timestamp, so in a very small electorate or with close observation of totals over time a vote could be inferred; this is not absolute anonymity and no stronger claim should be made to residents or the jury.
- Account deletion: `eraseParticipationUser` removes the user's voter rows, opinions, ideas and feedback; anonymous counts stay.
- Opinion comments and feedback carry no author field for staff (free text can still identify its writer); ideas show the author's name to staff (they must reply).

## Ready-made integration patch, proven on a scratch copy of A's server
`coordination/reports/B-participation-integration.patch` (unified diff against A's `8fe6b85`: `server.mjs`, `public/index.html`, `public/app.js`; 9 small hunks) applies the six steps above. It was applied to a DISPOSABLE scratch copy (A's `8fe6b85` + B's world build, port 3101, temp SQLite; A's working tree untouched) and `tools/qa-participation/integrated-e2e.mjs` ran against it: **ALL PASS** (`docs/qa-captures/participation/integrated-e2e.log`): portal serves the module under the portal CSP, guest view with demo badges, real registration/session, vote through the real portal UI with receipt, second vote 409, 6 concurrent submissions with one key = one record, service feedback with a real `services` id, 403 for citizen on staff routes, language switch remounts in English, staff publish/close, entries in the real hash-chained audit journal (`/api/admin/audit?category=participation`) and `audit/verify` ok, agent cannot delete, staff cannot vote, real `DELETE /api/me` removes the citizen's voter/idea/feedback rows and keeps the anonymous counter, A's tables untouched. A should apply the patch (or the equivalent) in its own tree and re-run that script against its dev server.

## Corrections after the PM review of b8c62d2 (this revision)
- Expired decisions/consultations (stored as open, effectively closed by date) cannot be reopened or have their deadline moved/cleared (409); closing them explicitly stays possible and records `closed_at` = the deadline. A consultation opinion, a vote and every staff PATCH now read the row again INSIDE the write transaction after the request body has arrived, so a delayed request cannot be accepted after a close or reopen a closed row. Regression cases: `tools/qa-participation/participation-races.mjs` (deterministic: headers sent, body withheld until another request has changed the row): ALL PASS (13); the same file against the pre-fix module (`b8c62d2`) FAILS 10 checks. Retry-After handling: see QA_B (world polling).
- The vote-privacy statement above is narrowed to what the schema actually guarantees.

## Evidence (disposable databases, local mini host; NOT A's server)
- `node --no-warnings tools/qa-participation/participation-test.mjs`: ALL PASS (65): migration x4 + restart + existing rows untouched + demo seed once; 401/403/404/400/413 negative cases; one vote per citizen; 40 concurrent votes by one citizen -> exactly 1 accepted; 30 citizens x 2 concurrent -> 30 accepted, counter = voter rows; idempotent idea/feedback keys incl. 10 concurrent retries; hourly cap; close/auto-close/no reopen; opinion edit keeps one row; admin-only delete with cascade; deletion keeps counts; audit hook received.
- `node --no-warnings tools/qa-participation/participation-ui.mjs`: ALL PASS (24) in headless Edge: no HTML string insertion in the script, hostile title stays text, demo badges, vote needs an explicit confirmation step, receipt in a focused `role=status`, keyboard vote, idea double click -> one record, opinion edit, feedback, FR/EN, 320 px no horizontal scroll, heading order, every control labelled, staff panel create/publish/close, agent has no delete, admin has, unmount cleans.
- UNVERIFIED: integration inside A's own working tree (the patch was proven only on the scratch copy above), A's throttling of the new routes, A's English dictionary for the French server messages and the portal nav link, production data, screen reader/real-device use, Firefox, jury-visible contrast audit (colour is never the only signal: badges carry text and a symbol; contrast not measured), performance under load.
- Feature labels (B view, until A integrates): F65 PARTIAL (module + UI committed, not integrated), F66 PARTIAL, F67 PARTIAL, F68 PARTIAL, F76 PARTIAL.
