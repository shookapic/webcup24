# Terra Nova v1 code review

Reviewed 2026-10-03: all `world/src` components, server routes and asset delivery, store migrations, portal feature wiring, Vite configuration, and the installed ecctrl implementation. Evidence includes the user's screenshot and a successful `npm run build` on Node 24.19.0. This was a static review and build, not a browser reproduction or complete security audit.

## Follow-up review — 2026-10-03, A/B commits

The findings below describe the original v1 snapshot. Read [PM_STATUS.md](PM_STATUS.md) for the current review and assignments; do not reimplement resolved component work from this historical list.

- A's `2fd14e4` implements F34/F35, guarded per-user alert storage/polling, screen/fallback/HUD/editor/localization and asset 404/cache/gzip fixes. A reports local automated evidence; browser/production checks are still unverified. R3/R9/R10/R12 have progressed at the component/server layer.
- B's `8e97b3e` fixes ground ownership, frame/physics scheduling, body tilt, turn damping, stopping and hold-to-run. The installed ecctrl code confirms that grounding requires a parent rigid body. B reports 30/60/144 Hz measurements; R1 is now partially resolved, with input, collisions and camera tests still outstanding.
- App integration remains a blocking gap: both inspected versions omit userId/ready, discard explicit acknowledgement IDs and retain the old phone/HUD/input wiring. R2/R4 and end-to-end per-user alert behavior remain open. B's `input.js` is written but unused.
- B still uses automatic colliders for City meshes and a manual variable timestep capped at 1/30; below 30 FPS the documented game slows down. Require irregular-frame/tab-return and low-mode evidence before accepting this deviation from the roadmap.
- B's movement scripts output metrics without threshold assertions and only log page errors. Raw results and real-screen captures are required; their old storage fixture must follow A's per-user storage before integrated retesting.
- No authored assets, physical PhoneRig, skeletal avatar/NPC animation or F36 world tram/stations were found in the inspected commits. R5–R8 remain open.
- An authorized live feed GET succeeded at 2026-10-03T12:54:25.543Z: 36 requests through Wave 5. The prior unavailable-feed limitation is superseded for that inventory timestamp. F37 has an existing per-IP/email login limit to review; F38–F40 were not located. See the durable [request snapshot](CONTEST_REQUESTS_2026-10-03.md).

This follow-up reviewed source, git history, QA reports and harnesses. It did not rerun tests, playtest, merge or deploy. Remote freshness could not be checked because Git's SSH shell failed locally; `origin/main` here is a cached ref.

## Findings by priority

### R1 — High: reported locomotion oscillation remains undiagnosed

`world/src/Player.jsx`, `Character`, forwards input and calls camera `moveTo` every render frame. `PlayableCity.jsx` generates cuboid colliders for every mesh in `City`, including road planes, windows and decorative rings. The installed ecctrl implementation uses torque for character balance/turning, floating ground detection and camera-relative movement.

These are concrete investigation leads, **not a proven root cause**. The installed controller really does expose `setMovement`; do not remove that call based on a tutorial for a different version. It also defaults to `enableToggleRun=true`, whereas the HUD suggests holding Shift.

**B / blocking:** reproduce on a single floor with debug colliders, then compare city/floor, stationary/follow camera, and balance settings. Record physical position, rendered heading and camera yaw. Replace decorative automatic colliders with deliberate footprints. Fix the measured cause before art work; a visual rotation lerp alone is not evidence of a fix.

### R2 — High: phone/editor do not suspend gameplay input

`App.jsx` does not pass a UI input lock to the player; `Character` always forwards keys. The global shortcut handler ignores only inputs/textareas/selects, not dialogs or repeated keydown events. `Phone.jsx` renders a section without dialog focus management. Movement, Space activation, camera changes and UI actions can compete.

**A+B:** centralize input ownership; clear held movement on modal entry, blur and tab hiding; prevent UI pointer gestures from rotating the camera; trap/restore focus and require fresh movement input on resume.

### R3 — High: malformed saved alerts can crash the root render

`Phone.jsx` constructs `new Set(JSON.parse(stored(seenKey) || '[]'))` during render. Invalid JSON or a valid non-iterable value throws. `App` calls this hook without an error boundary. The storage key is also shared by all users of that browser.

**A:** safe parse plus array/ID validation, per-user keys, bounded retention, recover to an empty set. Verify corrupt storage and two users sharing a browser.

### R4 — Medium: urgent camera restoration is incomplete

`App.jsx` snapshots only the camera mode when the boolean `alerting` changes. It does not coordinate avatar editing or preserve camera pose/manual phone state. V can change view while an alert is active. If an urgent item is withdrawn by the next poll, the false `alerting` transition does not restore the prior mode; only explicit acknowledgement does.

**B:** explicit phone state machine, snapshot once per phone session, queue camera presentation behind the editor, acknowledge explicit displayed IDs, restore correctly on close/acknowledgement/withdrawal.

### R5 — High visual impact: city and inhabitants are still blockout geometry

`City.jsx` uses boxes, cylinders, hemispheres and flat road planes. `Avatar.jsx` is a capsule, head, visor and backpack with no limbs, skeleton or animation. `world/public` does not exist in this checkout. `App.jsx` has no enabled shadow setup. The screenshot shows sparse detail, a dominant bare ground plane, repetitive neon features and weak grounding.

**B:** authored models, consistent scale/materials, a detailed plaza, real entrances and props, rigged characters, purposeful lighting and contact shadows. Prove one good district before multiplying assets across the map.

### R6 — Medium: NPC travel exists, but reduced motion freezes it

`Npcs.jsx` contains waypoint movement; it skips `step` entirely when `reducedMotion` is true. Otherwise it translates and bobs a capsule, snaps rotation at turns, and has no walking animation or obstacle avoidance. Per-segment lane offsets can jump at route junctions.

The stationary-NPC report is explained if reduced motion is enabled; otherwise it still needs runtime reproduction.

**B:** retain functional travel under reduced motion, remove only secondary motion, add distance-driven gait, smooth turning, continuous junctions and lightweight separation. Share path data with scene layout.

### R7 — Medium: global curvature patch complicates shadows and imported assets

`curve.js` mutates global `ShaderChunk.project_vertex` using camera-relative deformation. Its own comment explains that shadow maps are avoided because the shadow camera would bend differently. Physics remains flat. Custom sky shaders use their own vertex code.

There **are** sky, planet and atmosphere shaders in `Sky.jsx`, plus bloom/vignette in `App.jsx`. The visual problem is coherence and integration, not an absence of shader code.

**B:** remove global mutation; scope curvature to distant scenery with a flat playable region, preserve correct skinning/instancing and align any affected labels. Establish lighting/material quality before adding effects.

### R8 — Medium: phone is a fixed HTML panel

`Phone.jsx` has no device mesh or hand pose; `.phone` in `styles.css` is fixed to the viewport bottom. The original brief explicitly requested an HTML overlay, so this was consistent with that brief. The user's physical-phone request now supersedes it. News currently exposes only five titles, not full article reading.

**A+B:** model a handheld device and align accessible interactive HTML to its screen. Keep a readable flat fallback. Add real full-text news detail and services navigation.

### R9 — Medium: polling cleanup and failure presentation are incomplete

`useAnnouncements` and `Multiplayer` clear their last timeout but an in-flight request can finish after unmount and schedule another. Errors are swallowed. A failed initial announcement request looks like an empty list; disconnected peers can remain indefinitely during client network failure.

**A+B:** disposal/abort guards before state updates/rescheduling, explicit loading/stale/error states, retry at existing poll rates and client-side stale peer expiry. Test unmount during a pending request and reconnection.

### R10 — Medium: missing assets return HTML and cache policy assumes fingerprinting

`server.mjs`, `serveWorld`, returns `index.html` for missing paths including models and textures. Every path below `/assets/` receives immutable caching, although future assets copied from `world/public/assets` may be unversioned. This can produce opaque model parsing errors or keep replaced assets cached for a year.

**A:** navigation-only SPA fallback, true asset 404s, correct MIME types and immutable caching only for versioned filenames/paths. Preserve traversal protection and CSP. Test using the built Node-served app, not only Vite.

### R11 — Medium: HUD, labels, language and loading need finishing

The screenshot shows a large toolbar overlapping the label area. `Labels.jsx` only clips labels using projected z, with no geometry occlusion, distance limit or HUD safe area. Most world UI strings remain French even when announcement content uses English. `/api/me` failures are treated as signed-out state; there is no explicit WebGL/error recovery. No touch movement controls exist.

**A+B:** compact contextual HUD, localized UI, fewer meaningful labels, distinct loading/auth/network states, fallback and tested narrow-screen behavior.

### R12 — Coordination: original checklist repeats work already present

Server/store/portal code already contains avatar persistence, presence, urgency/audience, featured services, search, guide/profile and English fields. These require verification, not blind reimplementation. README still says the project has no npm dependencies despite the world stack.

**A:** map exact current official requests to verification evidence. The new ownership split assigns A phone/UI work while B handles gameplay/art, avoiding a single-session bottleneck.

## Build evidence and limitations

Production build passed: main JS approximately 1.253 MB (344 KB gzip); playable-city chunk approximately 4.379 MB (1.631 MB gzip). These include dependencies. No claim is made that the deployed host serves gzip just because Vite prints compressed estimates.

No local `data/` snapshot was available and the authenticated live contest feed was not retrieved. Exact current-wave completeness is unverified. Movement root cause, browser focus behavior, performance and deployed-host behavior require the roadmap's runtime gates. Application code was not changed by this review.

Handoff update: a refreshed `CLAUDE.md` contained Wave 4 F33–F36 and transport API/watcher instructions added since the initial review read. These have been preserved in the assignments/spec. Their implementation has not been independently audited here; the initial review findings refer to the earlier inspected source snapshot. Both sessions must recheck changed files before applying a finding.
