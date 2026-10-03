# Terra Nova coordination checkpoint

2026-10-03, 16:07 Europe/Paris. PM integration/review only; no application code edited by Codex.

## Authorized test release

The user explicitly authorizes combining every completed A+B delivery and a normal push to `main` when B finishes, so they can test the hosted site. This is a user test release, not a declaration that every contest or quality gate has passed. PM owns the isolated `webcup24-int` / `integrate` worktree; both implementers have acknowledged that they will not push main independently during this handoff.

## Current combined candidate

- `b1f2751`: clean merge of A `4749bdf` (Wave 5/6) and B `ffec17b` (plaza, rigged characters, physical phone). No source conflicts.
- A is release-ready; only the four PM documents remain dirty in A's checkout. Its additive migrations were tested against a database made by the original store: old user login/message preserved, services available, appointment routes usable and second boot idempotent (A-reported PASS).
- B has not finished. B2 districts, tram/stations and composition are in progress on `world`; PM will merge B's exact final committed HEAD after its handoff.
- Latest remote state is session-reported `ffec17b`. PM's Git SSH read failed with Windows `sh.exe` CreateFileMapping error 5. A is asked to fetch and report the actual tip before release.
- PM build attempt on the combined candidate is **UNAVAILABLE**: Vite fails spawning a child process (`EPERM`) in this tool sandbox. This does not prove a build defect. A is asked to run build/API/portal/Node-served world gates through its working execution environment, covering the physical phone rather than assuming the old flat-dialog selectors.
- Public Hodifly URLs supplied by the user: https://losfablitos.lareunion.webcup.hodi.cloud/ and `/monde/`. Host deployment and runtime checks remain **UNVERIFIED** until the combined release is pushed and checked. GitHub reports Hodifly success for B's earlier `ffec17b` slice; that is not proof of the combined release.

## Evidence and scope

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Movement | PASS reported for deterministic local checks; human hardware UNVERIFIED | B0: ground rigid body, explicit colliders, controlled physics order, yaw/upright/run/input fixes; 30/60/144 Hz and irregular frames. Below 30 FPS the timestep clamp slows simulation. |
| Plaza, avatar, NPCs | PARTIAL | Kenney CC0 local assets; idle/walk/sprint, 12 moving NPCs, scoped distant curvature, sun shadows; captures reviewed. Other districts/composition still in progress. |
| Physical phone | PASS reported locally; combined regression pending | Modeled device, buttons, gloved hand/sleeve; projected DOM screen, one dialog, narrow/guest/`?flatphone` fallback; phone/services/alert captures. |
| Wave 5/6 API and accessibility | PASS/PARTIAL as matrix states | A reports 473 checks on `4749bdf`; exact combined physical-phone source was not covered by that earlier proof. |
| F36 world | IN PROGRESS | API/portal/phone already present; B finishing stations and moving tram. |
| Production | UNVERIFIED | Push authorized after B final handoff and release checks. Actual host URL, build result, assets/CSP and persistence still need checking. |

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

A committed `4f3cd39` before hitting its quota; PM merged it and remote `f06be69` (README only) cleanly. A's exact archive of combined source `b1f2751` passed build, API104, portal60, world-UI75, portal-browser15, accessibility91, world-browser113, physical-world20, flat-world15, B movement at60/30+jitter, phone clicks and alert flow. Its old-host GET baseline passed existing HTML/assets/CSP/404 behavior; nine expected version failures remain until the new release deploys. B confirmed the rapid close/reopen defect (2 failures before fix), fixed it with one cancellable timer, and reports12 phone-race checks passing,8 tram checks and movement at60/30+jitter/144 passing on its current source. Final B commit and combined final build/runtime/host checks remain pending.

## Release sequence

1. A validates the combined candidate; any source defect goes to its owner. Update stale matrix entries for B's delivered plaza/rig.
2. B commits its final intended code/assets/licenses/docs, reports checks and known gaps. Keep required contest features; do not expand optional polish indefinitely before a test release.
3. PM merges both final branch tips, commits current PM records, reviews tracked assets and migrations, then obtains final build/boot/critical regression evidence on that exact source.
4. Fetch remote, confirm ancestry and push the approved candidate normally to `main` (no force). If PM Git transport remains blocked, the connected Claude session may execute the exact validated push.
5. Verify the live portal and `/monde/` once the host finishes; label actual host checks separately from local Node production-build checks. Report deployed commit and remaining test limitations.

Host follow-up: measure proxy client identity before setting `TRUST_PROXY=1`; never blindly trust forwarded headers. Preserve `data/` and server-only official feed credentials. Real assistive technology, touch/other browsers and hardware performance remain unverified and must not be advertised as passed.
