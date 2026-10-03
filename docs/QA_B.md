# QA — Session B (gameplay & art)

## B0 — movement oscillation: root cause, fix, evidence (2026-10-03, ~16:50)

### Method

`?debug` adds a per-frame probe (`world/src/debug.js`, recorded in `Player.jsx`): physical position/velocity, body yaw/pitch/roll, rendered avatar position, camera position/yaw, grounded flag. `?debug&fps=N` switches R3F to `frameloop="never"` and `window.__tn.run(seconds, input)` advances frames at exactly N Hz with injected input, so 30/60/144 Hz are reproducible on any machine (headless Chrome renders at ~7 fps). `?scene=floor` keeps only the floor collider and the player. Harness: `tools/qa/movement.mjs` (10 s of input, then 1.5 s release), `tools/qa/realwalk.mjs` (real rAF + real keyboard).

### Measured causes (installed ecctrl 2.0.2, @react-three/rapier 2.2.0)

1. **Ground never detected.** ecctrl treats a hit as ground only when `collider.parent()` is a rigid body. Our ground was a bare `<CuboidCollider>`: `grounded_pct` 0 %, body resting on the capsule at y = 0.748 instead of floating, no friction (never stopped after release), jump impossible. The city's automatic decoration colliders (paths, windows, rings) *were* rigid bodies, so grounding flickered on and off while walking across them and the float spring kicked the body up. Fix: ground collider inside `<RigidBody type="fixed">`.
2. **Impulses per render frame vs fixed physics step.** ecctrl applies move/turn/balance impulses in `useFrame`, scaled by `60 * world.timestep` (= 1 with the fixed 1/60 step). At 144 Hz it applied 2.4 impulse sets per physics step, and the camera followed the 60 Hz physical position while the avatar was drawn interpolated: **55 mm/frame² camera-vs-avatar jitter at 144 Hz** (0.3 at 60 Hz), stop time 0.21 s at 144 Hz vs 0.50 s at 60 Hz. Fix: `<Physics timeStep="vary" paused>` and `FrameStep` in `Player.jsx` steps once per rendered frame in an explicit order (ecctrl impulses → `step(min(dt, 1/30))` → camera follows the stepped body → CameraControls update).
3. **Body rocking.** Move impulse is applied 0.5 m above the centre; balance spring rocks it back: 5–9° tilt. Fix: `enabledRotations={[false, true, false]}`, `autoBalance={false}`.
4. **Turn ringing.** Yaw spring damping 0.006 overshot 4–6 times on diagonal starts. Fix: `autoBalanceDampingOnY={0.02}`.
5. **Slow stop.** Default `decDeltaTime` 0.2 → 0.47–0.50 s. Fix: 0.35 → 0.27–0.28 s.
6. **Toggle run.** ecctrl default `enableToggleRun` true while the HUD says hold Shift. Fix: `enableToggleRun={false}`, run 8 m/s.

### Results after fixes (floor scene, 10 s input)

| Rate | Input | Progress | Lateral max | Tilt | Turn reversals | Cam jitter | Stop |
|---|---|---|---|---|---|---|---|
| 30 Hz | fwd / left / back / diag | 39.33 m | ≤ 0.001 m | 0° | 0 | 0.00 mm | 0.27 s |
| 60 Hz | fwd / left / back / diag | 39.33 m | ≤ 0.001 m | 0° | 0 | 0.00 mm | 0.28 s |
| 144 Hz | fwd / left / back / diag | 39.33 m | ≤ 0.003 m | 0° | 0 | 0.00 mm | 0.28 s |
| 60 Hz city | fwd | 39.33 m | 0.000 m | 0° | 0 | 0.00 mm | — |

Speed 4.00 m/s steady, equal diagonal/cardinal, grounded 100 %, monotonic progress (0 backsteps). Real-time keyboard (`realwalk.mjs`, 7 fps headless): walks, grounded, tilt 0, no page errors.

Rejected: `MAX_STEP = 1/20` (to avoid slow motion below 30 fps) made the yaw spring ring at 20 Hz (51 reversals). Kept 1/30: below 30 fps the game slows down rather than destabilising.

### B0 closed (2026-10-03 evening)

Implemented: `input.js` wired (`useMovementInput(inputEnabled)`, `inputEnabled = !editing && !phoneOpen && !alerting`), explicit footprints in `layout.js` (boxes/cylinders for Mairie, Santé, Marché stalls, Habitat, Quartier sud domes; paths/windows/rings/rocks/pond have none), square boundary walls at ±75 + respawn to spawn when y < -5 or outside ±78, camera `colliderMeshes` (invisible footprint meshes), TPS wheel clamp 2.5–14, FPS distance pinned at 0.01.

Harness `tools/qa/world-checks.mjs <base> <fps> [jitter]` (real keyboard events, deterministic frames, `&jitter` = alternating 0.5x/1.5x frame times + 100 ms hitch every 20 frames). 15 checks, **all pass at 30/60/144 Hz, with and without jitter**: W walks; blur stops and stays stopped with key still held; fresh press resumes; hidden tab stops; phone open (T) ignores keys, closed + fresh press walks; jump once per press with Space held (repeat); wall stops at z = -36.65 (face -37, radius 0.35) and slides; camera retracts to 0.6 m against the wall; fall/out-of-bounds respawn; boundary wall holds; FPS wheel stays 0.01; TPS wheel clamps.
`movement.mjs` floor/city at 30/60/144 unchanged after the change (39.33 m, lateral <= 0.001 m, tilt 0, stop 0.27–0.28 s). With jitter: no reversals, tilt 0, stop 0.29 s; progress is 32.9 m/10 s because hitches are clamped to 1/30 s (slow motion by design); the "cam jitter" metric reads 25 mm there only because it is a second difference of positions over unequal dt.

Still open: human check on a real high-refresh monitor; UI drags not rotating the camera (A's UI not integrated yet); captures (taken with the plaza slice).

## Wave 5 triage (16:25) — all Session A

F37 login-attempt protection (900), F38 service unavailable status (600), F39 appointments (600), F40 appointment reminder (300). F38 could later feed world service markers.

## Integration with Session A (2026-10-03 ~15:10) — main b0aaa09

A's branch `sessionA-work` (2fd14e4) merged with B0 in a separate worktree (`integrate`), pushed as `main`. `App.jsx` now uses A's `useAnnouncements`, `useServices`, `useTransports`, `WorldHud`, `PhoneScreen`/`PhoneFallback`, `AlertAnnouncer`, `AvatarEditor` (locale from `ui/i18n.js`).

State machine in `App.jsx`: `closed -> opening -> open -> closing -> closed` (+ `source: manual | alert`), view snapshot once per phone session, 300 ms (0 with reduced motion). Rules tested by `tools/qa/alert-flow.mjs` (14 checks, PASS): alert raises the phone in first person; input locked; V ignored; T cannot dismiss an unacknowledged alert; acknowledge closes an alert-raised phone and restores the third-person view; acknowledged alert does not return after reload; manual T opens, Escape closes and restores; avatar editor defers the camera presentation (hidden live-region announces meanwhile) and the phone rises when the editor closes. Withdrawal-while-displayed is implemented (effect closes an alert-raised phone when no unseen alert remains) but **not yet covered by a test** (UNVERIFIED).

## B1 slice — plaza, rigged avatar/NPC, scoped curvature, physical phone (2026-10-03 ~16:00)

Assets: Kenney Space Kit + Blocky Characters (CC0), see `docs/ASSETS.md`.

- **Scene**: `Plaza.jsx` (Mairie: glazed round hall x6, two wings x4, canopy on four pillars, antenna dish, beacon masts; paving disc with inner/outer ring; benches, planters, lamps, rocks, generator/barrels), palette materials by kit material name (`kit.jsx`), warm key light with one shadow map framed on the player (`Sun.jsx`, 2048, snapped to 1 m), pale amber / teal sky (`Sky.jsx`), dusty ground with vertex-colour breakup. The other four districts are still the old primitives re-tinted to the palette (B2).
- **Scoped curvature** (`curve.js`): no `ShaderChunk` mutation any more. `curved(material)` bends only ground and distant rocks, static, by world distance from the origin beyond 80 m (the playable square is ±75). Labels need no bending. Imported/skinned/instanced props are untouched. Physics ground and shadows stay flat.
- **Avatar/NPC** (`Colonist.jsx`): one rigged character, skin/outfit/accent recolour on the atlas (accent = trousers), idle/walk/sprint crossfaded 0.2 s from measured speed; airborne holds the stride pose (no jump clip in the pack). NPCs (`Npcs.jsx`): 12 walkers on the shared `layout.js` path graph, steering toward lane-offset targets with turn-rate limit (no snapping, no teleports at nodes), 35 % chance of a 2–6 s pause (idle clip), no reversal except at dead ends, **travel continues under reduced motion**. Remote players use the same Colonist, speed from displacement, and are now dropped client-side 15 s after the last successful poll.
- **Physical phone** (`PhoneRig.jsx`): camera-child device (rounded body, terracotta back plate, glass bezel, speaker, camera dot, side buttons) with gloved hand and sleeve in the avatar's outfit colour, drawn after the world without depth test (no clipping into walls, no bloom). The four screen corners are projected to CSS px every frame and `quadToMatrix3d` (homography) places A's `PhoneScreen` (360 x 740 px host, `role=dialog`, `useDialogFocus`) on the glass. Raise/lower 280 ms, immediate under reduced motion. Flat `PhoneFallback` is used for narrow screens (<= 720 px), guests and `?flatphone`.
- **Gaps**: hand is blocky; no screen glare; the DOM screen is un-antialiased by CSS 3D; fingers cover a little of the left bezel; TPS-to-FPS camera move is a dolly (0.1 s smoothing), not a hand-held sway.

### Evidence (all in `docs/qa-captures/`, headless Edge/SwiftShader, deterministic frames)

| Item | Result |
|---|---|
| `plaza-1440x900.png`, `plaza-1920x1080.png` | spawn: avatar from behind, Mairie ahead, NPCs, benches, planters, lamps. **Visual gate: PARTIAL** — hierarchy and grounding are credible, but foreground is still wide, Mairie reads dark/small, other districts are blockout. Needs one more composition pass before B2. |
| `walk-cycle.png` | 6 frames @ 0.2 s: legs alternate, arms swing (PASS, foot sliding not measured). |
| `phone-open.png`, `phone-services.png`, `phone-alert-open.png` | handheld device, aligned screen, readable text at 1440 x 900. |
| `tools/qa/phone-capture.mjs` | PASS: host on screen, exactly one `.phone-screen`, focus inside, click on 4th and 5th tab through the matrix3d selects them, alert acknowledge button clickable (scrolled into view), Escape lowers the phone. |
| `tools/qa/world-checks.mjs` | PASS (15 checks) at 30/60/144 Hz, with and without uneven frame times. |
| `tools/qa/realwalk.mjs` (real rAF + real keyboard, 11.7 fps headless) | walks 4.4 m, grounded, tilt 0, no page error. |
| Human check on a real high-refresh monitor | **UNVERIFIED** |
| UI drag does not rotate camera (A's UI vs `CameraControls`) | **UNVERIFIED** (phone host sits above the canvas, pointer events do not reach it; not exercised) |

Fixed on the way: `Texture.clone()` shares its `Source` with the glTF texture, so replacing `.image` on a clone corrupted every later recolour (black/garbled limbs); the clone now gets its own `Source`.

## B2 + F36 + phone race fix (2026-10-03 ~17:30, final B commit of the test release)

**Layout** (`layout.js`, single source): 15 kit buildings (render, collision footprint, scale, rotation, district accent), roads, five stops, tram lines, NPC graph, labels. Footprints are derived from the kit sizes and the building scale, so render and collision cannot drift apart. Districts (`Districts.jsx`): Mairie hall + wings (plaza canopy, antenna, masts), Santé (3 buildings, teal accent, cross sign), Marché (6 booths with coloured awnings, crates, aisle), Habitat (2 rows of modules, lane, planters), Quartier sud (homes by the water, rail + flood hazard signs, pumps, restrained water shader frozen under reduced motion).

**F36 in the world** (`Tram.jsx`): elevated rail on columns (6 m, never crosses a walking route), T1 Habitat - Mairie - Quartier sud and T2 Marché - Mairie - Santé sharing the Mairie trunk, one three-car tram per line shuttling with a 5 s dwell at each stop and reversing at the ends. Every stop has a shelter, bench and a pole sign with one disc per serving line (line colours = API colours). `nearestStop()` uses the shelter positions and drives the HUD district and the phone's nearest stop. The tram is **decorative and not synchronised with `/api/transports`**; nothing in the UI presents it as live tracking. Boarding is not implemented (not required).

**Phone transition race (PM review of ffec17b): CONFIRMED and fixed.** Reproduced with `tools/qa/phone-race.mjs`: on ffec17b, reopening within the 300 ms lowering left the phone up while the old close timer restored the third-person view (2 FAIL: "reopened during lowering stays up in first person", "reopen 20 ms before the lowering timer"). Fix: one cancellable transition timer (`later()` clears the previous), snapshot only when coming from fully closed, source kept when reopening mid-lowering. After the fix 12/12 PASS: rapid close/reopen, reopen 20 ms before the timer, alert arriving during manual use shown inside the open phone, acknowledge keeps a manual phone open, T closes it afterwards with the third-person view restored, alert raises the phone, **withdrawal while displayed puts the phone away and restores the view**.

### Evidence (final build)

| Check | Result |
|---|---|
| `world-checks.mjs` (15) 30/60/144 Hz, with and without uneven frame times (wall test now on the Mairie west wing: stops at z = -19.65, slides, camera pulled in to 0.4 m) | PASS |
| `alert-flow.mjs` (14), `phone-capture.mjs` (physical phone, normal + alert), `phone-race.mjs` (12) | PASS |
| `tram-check.mjs` (8): both trams cover the whole line, dwell at all 3 stops, reverse, zero 4xx/5xx for models/textures | PASS |
| `movement.mjs` floor 30/60/144: 39.3 m, lateral <= 0.001 m, tilt 0, stop 0.27-0.28 s, camera jitter 0 | PASS. `turn_flips` now reads 1 because the avatar starts rotated by pi (the yaw sample wraps at +-pi); steady-state yaw range 0 deg, rate flips 0. |
| `smoke-a.mjs` on the merged server | 62/62 PASS (earlier merge); final combined run is PM's |
| Captures `docs/qa-captures/`: `plaza-*`, `spawn`, `mairie`, `sante`, `marche`, `habitat`, `sud`, `tram-side`, `tram`, `walk-cycle`, `phone-*` | taken from the final build (plaza + districts) |

### Honest gaps (PARTIAL / UNVERIFIED — remain on the roadmap)

- **Visual gate: PARTIAL.** Districts are recognisable and share one palette, but buildings are kit hangars with scale/colour variants, the character is blocky, the foreground is still wide; no reduced-clutter pass on label overlap.
- **Performance: UNVERIFIED.** No 60 s route, draw-call or triangle measurement; shadows 2048 always on; no quality setting; every kit prop is a separate mesh (no instancing).
- **Mobile / touch: UNVERIFIED.** Narrow screens fall back to A's flat phone dialog but there is no touch movement; do not claim mobile game support. The portal remains the accessible route.
- **Human high-refresh retest and UI-drag-vs-camera: UNVERIFIED.**
- Foot sliding not measured; no jump/fall clip; service-marker interaction (E near a building) not built; F45/F46 world wayfinding not started.
- NPCs have no mutual avoidance; remote players do not show jumping (API has no such state).

## Live defect round (user test of de791f3): kit origin offset, tram geometry, phone text (2026-10-03 ~18:10)

**Cause 1 (measured, all buildings + trams): the Space Kit exports every model under a root node translated by [2, 0, 1.5].** `Prop` cloned the scene without normalising it, so a model drawn at (x, z) appeared (2, 1.5) x scale away, rotated by its yaw. At scale 6 the Mairie sat 15 m from its collider, trams were 6.6 m / 4.95 m off their rail. `tools/qa/building-check.mjs` on the previous code: 22/22 FAIL (centre offsets 3-15 m); after zeroing the horizontal root offset on the clone (`kit.jsx`): 22/22 PASS, rendered width/depth/height equal the collision footprint within 0.3 m. Representative edge: walking into the Mairie west wing stops the avatar at z = -19.65, the wing's rendered face is z = -20 (0.35 m = capsule radius), so colliders, doors, labels and NPC nodes now agree with what is drawn. Before/after: `docs/qa-captures/before/*` vs `after/*`.

**Cause 2 (tram, measured):** (a) the offset above; (b) `sample()` clamped car arcs, so with three cars at `s - dir*i*CAR` the trailing cars stacked on the rail start/end and the consist was not symmetric when reversing; (c) corners were snapped vertices; (d) both lines shared a trunk, so two trams could overlap; (e) the kit nose car's nose is local **-z** (windscreens pointed inward in the first fix attempt, caught in PM's capture review). New design: `rail.js` (rounded corners, arc length, sampling), T1 and T2 on separate guideways (T2 rides at y = 9.2 over T1 at 6 where they cross), symmetric nose-passenger-nose consist driven by the middle car's arc, travel range limited by the measured nose extent (1.85 m) so nothing overhangs the rail end, cars oriented from the rail chord. `tools/qa/tram-check.mjs` (22 checks, PASS): full-rail coverage, dwell at every stop, reversal, cars on the rail polyline (0.000 m), underside on the rail top (0.000 m), no stacking (chord >= 3.3 m), mesh bounds centred on the car, no body beyond either rail end (-0.035 m), outer nose outward / inner inward at both ends of both lines, zero 4xx/5xx. Captures: `after/T1-straight`, `T1-station`, `T1-corner`, `T1-end` (end column and nose flush), `T2-*`.

**Phone text (Firefox) — NOT reproduced here, mitigated, UNVERIFIED on the user's machine.** Real headed Firefox (disposable profile, hardware GPU, DPR 1.25) and headed Edge on this PC render the previous projective placement and the new one with identical, stable glyph coverage 0.45 s and 3.5 s after opening (`tools/qa/phone-firefox.mjs`; A's headless Firefox, Chrome and Edge captures also readable). Suspected paths removed in `PhoneHost`: per-frame `transform` rewrite (now written only when the rounded value changes), projective `matrix3d` plus 3-D tilt (the device is now held square to the camera, so the host needs only `translate()` + `scale()` at whole-pixel positions), rounded `overflow: hidden` mask on the transformed host (removed), `will-change: transform` added. `?phoneproj` restores the old tilted pose with matrix3d placement for A/B diagnosis (A's `?phonefix=layer|nomask|smooth` switches are independent). The user must retest in Firefox after deploy; this is a plausible mitigation, not a proven fix.

Regression on this build: world-checks 15/15 (60 Hz, 30 Hz jitter, 144 Hz), alert-flow 14/14, phone-capture normal + alert, phone-race 12/12, tram-check 22/22, building-check 22/22.

## Streetscape + vegetation checkpoint (2026-10-03 ~19:00)

Roads now have sidewalks (1.8 m), raised curbs (instanced, clipped where roads meet or enter the plaza), dashed centre lines, six marked zebra crossings, a plaza that covers the avenues where they enter it, a fingerpost with district boards (canvas text, no font files), stop shelters with line discs. Vegetation (Kenney Nature Kit, CC0): 36 trees on the plaza ring, avenues and districts (trunks collide; the camera ignores thin colliders so it no longer snaps in behind trees), 23 planting beds with border, soil, bushes, flowers and grass. Data: `layout.js` (`crossings`, `trees`, `beds`, `roads`); components `Streetscape.jsx`, `Plantings.jsx`, `nature.jsx`.

Same-camera before/after: `docs/qa-captures/street-before/` (963b08b) vs `street-after/` (spawn, mairie, sante, marche, habitat, sud).

**Frame cost, named hardware** (`tools/qa/perf.mjs`, headed Edge 154, real rAF, 1440 x 900, DPR 1, NVIDIA GeForce RTX 5070 Ti via ANGLE/D3D11, 32 logical cores; `docs/qa-captures/perf-streetscape-rtx5070ti.json`):

| Stop | frame p50 / p95 / max (ms) | draw calls per frame* | triangles per frame* |
|---|---|---|---|
| spawn | 3.6 / 3.7 / 3.7 | 962 | 206k |
| mairie | 3.6 / 3.7 / 10.7 | 813 | 194k |
| sante | 3.6 / 3.7 / 7.1 | 571 | 185k |
| marche | 3.6 / 3.7 / 3.7 | 795 | 192k |
| habitat | 3.6 / 3.7 / 3.7 | 706 | 189k |
| sud | 3.6 / 3.7 / 3.7 | 818 | 203k |

*whole frame = shadow pass + scene + post-processing, measured with `info.autoReset` off. The roadmap budget (< 200 visible draw calls, < 500k triangles) is met for triangles but **not for draw calls** (every kit prop, NPC part and shadow-casting mesh is drawn twice). Frame time is excellent on this GPU (uncapped ~277 Hz); a weak device is **UNVERIFIED** and draw-call reduction (merging static props, instancing buildings) is a B4 task, not hidden by bloom.

Regression: world-checks 15/15 (60 Hz), building-check 22/22 on this build.

## Bench NPCs checkpoint (2026-10-03 ~19:40)

Nine benches (data in `layout.js`, rendered by `Plaza.jsx`, with thin colliders) with two seats each. NPCs (`Npcs.jsx`) now run a state machine: walk > (18 % at a node) reserve the nearest free seat within 14 m > `approach` (walk to the point 0.8 m in front of the seat) > `turn` (to face the bench direction) > `sitDown` (0.8 s, backs into the seat from wherever the turn ended, hips lowered, kit `sit` clip) > `sit` (8-22 s) > `standUp` (0.8 s) > release the seat > resume the route. Ownership is a module-level reservation array: a seat belongs to one walker from selection until it has stood up and left, so no two NPCs share or overlap a seat. The kit's blocky leg is one 1 m block, so seated legs stick out horizontally over the seat front (stylised, from the asset's own clip).

`tools/qa/bench-check.mjs` (10 checks, PASS in normal and in reduced motion): forced cycle in the exact order, seated pose (y = -0.09, sit clip), seat released, largest single-frame move 0.047 m forced / 0.063 m over 6 simulated minutes (an earlier version snapped 0.22 m at the start of sitting down, fixed), 54-71 natural sit episodes in 6 min with zero double ownership / overlap / NaN, walkers keep travelling (4.2-4.5 km total) under reduced motion. Captures: `docs/qa-captures/bench/1-approach ... 6-resumed.png` (`tools/qa/bench-view.mjs`).

## Avatar looks + accessories (renderer side) checkpoint (2026-10-03 ~20:00)

Measured: the kit character is **2.7 m tall** (not 1.6): legs 1.0 + torso 0.9 + head 0.8; it is now drawn at `HEIGHT_SCALE` 0.64 (1.7 m) in `Colonist.jsx`, which also fixes the perception that benches, doors and props were tiny. Seat height for the sit pose recomputed: thigh underside (0.8 - 0.2) x 0.64 on the 0.56 m seat -> `SEAT_Y` 0.176 (bench-check updated and PASS).

Renderer contract (**FINAL, fixed by the PM; supersedes the earlier drafts in this file and in my handoff reports: first `ingenieur`/`medecin` as provisional ids, then `colon`/`ingenieur`/`medecin`**): `avatar = { skin, outfit, accent, look?, accessory? }`. `look` in `colon` (default, Kenney model c, short ginger hair) | `lunettes` (model i, glasses) | `bandeau` (model n, long dark hair with headband); `accessory` in `none` | `sac` | `visiere`. Legacy ids `ingenieur` -> `lunettes` and `medecin` -> `bandeau` are aliases. Catalogue and normalizer: `world/src/avatarCatalog.js` (`LOOK_IDS`, `ACCESSORY_IDS`, `DEFAULT_LOOK`, `DEFAULT_ACCESSORY`, `LOOK_MODEL`, `normalizeLook`, `normalizeAccessory`, `normalizeAvatar`); unknown / missing values never throw and fall back to `colon` / `none`. The three colours work for every look. `AvatarPreview.jsx` takes the full draft avatar object for A's `preview` prop; App passes it only while the editor is open (no extra WebGL context while closed). `tools/qa/avatar-catalog.mjs` checks the contract. All nine canonical combinations render: `docs/qa-captures/avatar/nine-combinations.png`. **Persistence, reload, presence and old-save behaviour in the integrated editor are A's server plus editor and are NOT proven on my side yet; nothing is offered or claimed deployed.** `?debug&look=lunettes&acc=sac` is a QA-only override. Remote players render whatever `look` / `accessory` the API returns.

Captures: `docs/qa-captures/avatar/` (colon, lunettes + sac front/back, bandeau + visiere). `Gallery.jsx ?lineup=c,i,n,...` shows models side by side. Bug found and fixed on the way: the recolour pass overwrote accessory materials with the character atlas (accessories now carry `userData.accessory`).

## World weight and loading (F57-F60 proxy evidence) — STOPPED PARTIAL (2026-10-03 ~20:30, user said stop implementing)

Status: **implemented and measured locally, not integrated, not pushed, not reviewed by the PM; the user ordered feature work to stop.** Everything below is committed on branch `world` as a preservation checkpoint.

What changed (world only; portal and server untouched):
1. **Duplicate WebAssembly removed (`vite.config.js`)**: ecctrl wants `@dimforge/rapier3d-compat ^0.19.2` but npm hoists 0.12.0 to the top level, so the physics chunk carried two Rapier wasm blobs (2043 KB + 1876 KB of base64). The config aliases every import to the copy `@react-three/rapier` uses. Physics chunk 4.38 MB -> 2.33 MB raw, 1.62 MB -> 0.86 MB gzip. Movement/input/collision checks identical (world-checks 15/15, floor movement 39.3 m, lateral <= 0.001 m, stop 0.28 s).
2. **Models packed (`tools/pack-models.mjs`)**: 31 kit/nature GLBs -> `kit-pack.glb` (269 KB) + `nature-pack.glb` (120 KB); sources moved to `world/assets-src/`. Requests per cold world load 41 -> 14-15.
3. **Quality tiers (`quality.js`, `Effects.jsx`)**: `low` is chosen automatically for data-saver, 2g/3g `effectiveType` or `prefers-reduced-data` (or `?quality=low`): no shadow pass, no post-processing (the 23 KB gzip effects chunk is never fetched), pixel ratio 1, 6 walkers instead of 12, no flowers/grass. All features, services and interactions remain.
4. **Returning players** start the physics chunk before `/api/me` answers (localStorage hint, cleared for guests). **Presence polling** pauses while the tab is hidden and refreshes at once on resume (`tools/qa/visibility.mjs` PASS: 0 requests hidden, first refresh 2 ms after resume).
5. Lit matte Nature Kit materials (the kit marks them unlit) so trees take sun and shadows.

Measured with `tools/qa/load.mjs` (headless Edge, CDP throttling, cold = empty cache, warm = reload; `docs/qa-captures/load/*.json`):

| Profile / state | before (ac6c95d) | after |
|---|---|---|
| slow 4G (1.6 Mbit/s, 150 ms RTT), logged-in, cold: scene visible / playable | 4.0 s / 11.6 s | 3.4 s / 7.4 s |
| same, bytes transferred / requests | 2096 KB / 41 | 1324 KB / 15 |
| same, warm: playable | 2.7 s | 1.2-2.2 s |
| slow 3G (400 kbit/s, 400 ms RTT), cold: scene visible / playable | 13.1 s / 44.6 s | 11.4 s / 28.1 s |
| same, bytes / requests | 2101 KB / 43 | 1307 KB / 15 |
| guest (no physics), slow 4G cold: scene visible, bytes | n/a | 3.2 s, 489 KB / 12 requests |
| guest, slow 3G cold | n/a | 10.9 s, 466 KB / 11 requests |

Render cost with `tools/qa/perf.mjs` (headed Edge, real rAF, 1440 x 900, DPR 1, NVIDIA GeForce RTX 5070 Ti, `docs/qa-captures/perf-*.json`): high = 694-1007 draw calls and 190-208k triangles per whole frame (shadow + scene + post), low = 116-481 calls and 110-132k triangles. Frame time on this GPU is flat at 3.6 ms (uncapped, GPU not the limit). With the CPU throttled 6x as a weak-device proxy: high p50 10.8-17.9 ms (p95 up to 28.6 ms), low p50 3.7-10.7 ms (p95 up to 17.9 ms); one 37 s stall in the first low sample (asset parse under throttling) is not representative and is not reproduced elsewhere. Bundle composition: `tools/qa/bundle-sizes.mjs` (index chunk: three 571 KB, react-dom 203, fiber 163, three-stdlib 85, app 76, postprocessing 58 raw; physics chunk: Rapier 2.2 MB raw, mostly inlined wasm).

Not done (proposals, not claims): Brotli (the Node server only gzips; precompressed `.br` would take the physics chunk from ~860 KB to ~590 KB, needs a server change by A), a manual quality toggle in the HUD (A), merging static props into fewer draw calls, shipping the wasm as a real file, A's portal-side items of F57-F60. No carbon figure is claimed; bytes, requests and CPU frame times above are the proxies.

## Wave 6 triage (15:25, H+7h) — A, with B support

D13 plain wording (310), D20 inclusive platform (930), F41 keyboard-only (620), F42 assistive-tech forms/errors (930), F43 colour distinction (310), F44 zoom without breaking layout (620). All portal/UI shaped: **Session A**. B support only: world HUD/phone must stay keyboard-operable (movement keys are ignored inside dialogs, T/V/Escape documented), colour must not be the only signal (alert badge has text), world HUD must survive 200% zoom (A's CSS). The world is not a substitute for the portal route; "Version accessible" link stays visible.

## Wave 7 triage (16:25, H+8h)

F45 locate physical services in the city (960), F46 where are hospitals/emergency services (320), F47 justify actions / traceability (960), F48 who changed what in admin (640). F47/F48: **A** (audit trail, agent workspace). F45/F46: **A** owns the information (service locations/addresses on the portal and in the phone services page); **B support** once A exposes a location field: world signs/markers at the Santé clinic and other service buildings and the contextual "open services" prompt within ~3 m (roadmap section 6). Not started; the world already has the Santé district with a cross sign and a stop at each district.
