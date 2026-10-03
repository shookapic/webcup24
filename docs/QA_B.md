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

## Wave 6 triage (15:25, H+7h) — A, with B support

D13 plain wording (310), D20 inclusive platform (930), F41 keyboard-only (620), F42 assistive-tech forms/errors (930), F43 colour distinction (310), F44 zoom without breaking layout (620). All portal/UI shaped: **Session A**. B support only: world HUD/phone must stay keyboard-operable (movement keys are ignored inside dialogs, T/V/Escape documented), colour must not be the only signal (alert badge has text), world HUD must survive 200% zoom (A's CSS). The world is not a substitute for the portal route; "Version accessible" link stays visible.

## Not started

B1 (licensed assets, plaza, rigged avatar, lighting/shadows, scoped curvature), B2 (five districts, F36 tram/stations in the world), B3 (physical phone rig), B4 (release). No assets added yet, so no `docs/ASSETS.md`.
