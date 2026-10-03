# Terra Nova coordination checkpoint

2026-10-03, 17:16 Europe/Paris. PM integration/review only; no application code edited by Codex.

## Latest: live user test found visual failures

The combined release **de791f3** was normally pushed to main and deployed at16:56. GitHub Hodifly status success;51 live GET-only checks passed with matching hashed entry assets. These prove deployment/serving, not visual or authenticated production acceptance.

User screenshots now establish **FAIL** for tram alignment and physical-phone text rendering. Browser: **Firefox, default zoom; text appears briefly while opening then disappears**. PM saved evidence under `coordination/evidence/user-world-2026-10-03/` and dispatched tasks to both sessions. A and B accepted at17:13.

- **B first:** fix measured exported model origin offsets and tram consist bounds; reproduce/fix Firefox phone rendering with A for any CSS changes. All19 kit models have root translation[2,0,1.5], retained by Prop; train scale3.3 produces6.6m lateral and4.95m longitudinal displacement. Building visuals likewise drift from layout colliders. Existing tram motion tests did not cover actual rendered alignment.
- **B next:** user-required vegetation, continuous pedestrian detail/sidewalks, crossing markings, visible bench sit/stand NPC cycles, then richer avatar variants with A's editor/persistence. First convincing spawn slice, then all districts; measured performance remains required.
- **A:** complete separate Wave7 milestone, reconcile full46-request matrix and close focused portal workflow evidence gaps. Last committed42-row matrix:26 local PASS,14 PARTIAL,2 UNVERIFIED. Do not claim all portal features work on production. A's server Wave7 b83ca3d is committed locally and source merged with release as30db1bf; UI/checks still in progress, not deployed.
- **Contract:** A's /api/places now has stable code/kind/district/stop/address/hours/contact fields, no world coordinates; B maps positions. A's phone places page is pending confirmation. Staff reason requirements are deliberate request changes and need regression evidence. Avatar currently persists three colors only; new variant/accessory schema must be agreed before either owner implements it.

Critical visual corrections may be released independently of unfinished Wave7. Require exact fix commit, rendered captures (Firefox explicitly), geometric asset/collider checks, phone interactions and focused regressions before another normal push. No application change by PM. Sections below retain the earlier release record and are superseded by this checkpoint where dated statements differ.

## Authorized test release

The user explicitly authorizes combining every completed A+B delivery and a normal push to `main` when B finishes, so they can test the hosted site. This is a user test release, not a declaration that every contest or quality gate has passed. PM owns the isolated `webcup24-int` / `integrate` worktree; both implementers have acknowledged that they will not push main independently during this handoff.

## Current combined candidate

- **Approved code candidate `ece7ba60f22de0d6a75ced1704d48c4265874e5a`**, combining all A commits through `4f3cd39`, all B commits through `5b00a4d`, and remote `main` through `6fed34a`. All merges were clean. Ancestry checks confirm all three branches are included.
- A and B application worktrees are clean. The four earlier PM documents in A's checkout were preserved in `coordination/archive/pm-docs-before-combined-release`; their refreshed canonical versions are committed here. A can merge the deployed main when it resumes without those stale dirty files blocking it.
- A's additive migrations were tested against a database made by the original store: old user login/message preserved, services available, appointment routes usable and second boot idempotent (A-reported PASS).
- B finished B2 districts, tram/stations and the phone timer fix, handed off `5b00a4d`, and reported no release blocker. Art/performance/mobile gaps remain explicit below.
- PM's own build/SSH execution is unavailable in this tool sandbox (`spawn EPERM`, Git shell mapping/network errors). B successfully validated the exact integrated candidate using its working environment: build, API104, physical-world20 and flat-world15, disposable databases only, no source/ref changes. Durable logs are under `release-evidence-2026-10-03/`.
- All20 GLB files have valid GLB2 headers, no remote image/buffer URI; the character PNG and both license files are tracked (PM static check PASS). No `.env` or database file is tracked.
- Public Hodifly URLs supplied by the user: https://losfablitos.lareunion.webcup.hodi.cloud/ and `/monde/`. Host deployment and runtime checks remain **UNVERIFIED** until the combined release is pushed and checked. GitHub reports Hodifly success for B's earlier `ffec17b` slice; that is not proof of the combined release.

## Evidence and scope

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Movement | PASS reported for deterministic local checks; human hardware UNVERIFIED | B0: ground rigid body, explicit colliders, controlled physics order, yaw/upright/run/input fixes; 30/60/144 Hz and irregular frames. Below 30 FPS the timestep clamp slows simulation. |
| Plaza, avatar, NPCs | PARTIAL visual acceptance; local functionality PASS reported | Five districts and rigged animated characters delivered; local models/captures reviewed. Real hardware performance, quality settings, foot sliding and further art polish remain open. |
| Physical phone | PASS local combined checks |20 exact-candidate checks; modeled device/hand, projected HTML, one dialog, real clicks/focus/alerts;15 flat fallback checks. Reduced displayed text size remains a readability consideration. |
| Wave 5/6 API and accessibility | PASS/PARTIAL as matrix states | A's full earlier portal/browser proof reused where unchanged; exact final API104 and both world UI modes passed. Real assistive technology remains UNVERIFIED. |
| F36 world | PASS local B checks; host pending | Five stops, both moving trams, nearest-stop API phone integration;8 tram checks passed. Tram animation is decorative, not synchronized live tracking. |
| Production | READY FOR AUTHORIZED PUSH; host pending | Exact merged source build/boot/API/world gates pass. B will perform normal push, then GET-only live version/assets/CSP checks. Real host persistence/proxy identity still needs observation. |

Official inventory: Wave 7, **46 requests**, from the existing B watcher snapshot at 16:27. The contest snapshot contains all exact wording. A's `FEATURE_MATRIX.md` currently covers 42 through Wave 6; its remaining four rows are queued to A after quota recovery. Reminders are in-app/opt-in browser/calendar; no email or SMS implementation exists.

### Wave 7 coverage ledger (16:25 arrival)

| Code | Request | Owner | Status |
| --- | --- | --- | --- |
| F45 | Locate physical municipal services easily | A location information; B world markers/context prompt | NOT STARTED for the new requirement; existing districts are not sufficient proof |
| F46 | Locate hospitals and emergency services | A information; B supporting health signage | NOT STARTED; existing health district is only a starting point |
| F47 | Justify platform actions and preserve traceability over time | A server audit/history and staff access | NOT STARTED |
| F48 | Staff can readily find who changed what in administration | A staff audit view | NOT STARTED |

Queue task `A-wave7-1` preserves these requests for A after its Claude quota resets at 16:50. This test release contains completed work through Wave 6 and B's districts/tram/phone milestone; Wave 7 remains explicit backlog, not silently excluded or claimed complete.

### Validation update, 16:20

A committed `4f3cd39` before hitting its quota; PM merged it and remote `f06be69` (README only) cleanly. A's exact archive of combined source `b1f2751` passed build, API104, portal60, world-UI75, portal-browser15, accessibility91, world-browser113, physical-world20, flat-world15, B movement at60/30+jitter, phone clicks and alert flow. Its old-host GET baseline passed existing HTML/assets/CSP/404 behavior; nine expected version failures remain until the new release deploys. B confirmed the rapid close/reopen defect (2 failures before fix), fixed it with one cancellable timer, and reports12 phone-race checks passing,8 tram checks and movement at60/30+jitter/144 passing on its current source. The final B commit and combined checks are now complete; actual new host deployment remains pending.

## Release sequence

1. A validates the combined candidate; any source defect goes to its owner. Update stale matrix entries for B's delivered plaza/rig.
2. B commits its final intended code/assets/licenses/docs, reports checks and known gaps. Keep required contest features; do not expand optional polish indefinitely before a test release.
3. PM merges both final branch tips, commits current PM records, reviews tracked assets and migrations, then obtains final build/boot/critical regression evidence on that exact source.
4. Fetch remote, confirm ancestry and push the approved candidate normally to `main` (no force). If PM Git transport remains blocked, the connected Claude session may execute the exact validated push.
5. Verify the live portal and `/monde/` once the host finishes; label actual host checks separately from local Node production-build checks. Report deployed commit and remaining test limitations.

Host follow-up: measure proxy client identity before setting `TRUST_PROXY=1`; never blindly trust forwarded headers. Preserve `data/` and server-only official feed credentials. Real assistive technology, touch/other browsers and hardware performance remain unverified and must not be advertised as passed.
