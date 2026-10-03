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

Implemented: `input.js` wired (`useMovementInput(inputEnabled)`, `inputEnabled = !editing && !phoneOpen && !alerting`), explicit footprints in `layout.js` (boxes/cylinders for Mairie, Sant�, March� stalls, Habitat, Quartier sud domes; paths/windows/rings/rocks/pond have none), square boundary walls at �75 + respawn to spawn when y < -5 or outside �78, camera `colliderMeshes` (invisible footprint meshes), TPS wheel clamp 2.5�14, FPS distance pinned at 0.01.

Harness `tools/qa/world-checks.mjs <base> <fps> [jitter]` (real keyboard events, deterministic frames, `&jitter` = alternating 0.5x/1.5x frame times + 100 ms hitch every 20 frames). 15 checks, **all pass at 30/60/144 Hz, with and without jitter**: W walks; blur stops and stays stopped with key still held; fresh press resumes; hidden tab stops; phone open (T) ignores keys, closed + fresh press walks; jump once per press with Space held (repeat); wall stops at z = -36.65 (face -37, radius 0.35) and slides; camera retracts to 0.6 m against the wall; fall/out-of-bounds respawn; boundary wall holds; FPS wheel stays 0.01; TPS wheel clamps.
`movement.mjs` floor/city at 30/60/144 unchanged after the change (39.33 m, lateral <= 0.001 m, tilt 0, stop 0.27�0.28 s). With jitter: no reversals, tilt 0, stop 0.29 s; progress is 32.9 m/10 s because hitches are clamped to 1/30 s (slow motion by design); the "cam jitter" metric reads 25 mm there only because it is a second difference of positions over unequal dt.

Still open: human check on a real high-refresh monitor; UI drags not rotating the camera (A's UI not integrated yet); captures (taken with the plaza slice).

## Wave 5 triage (16:25) — all Session A

F37 login-attempt protection (900), F38 service unavailable status (600), F39 appointments (600), F40 appointment reminder (300). F38 could later feed world service markers.

## Not started

B1 (licensed assets, plaza, rigged avatar, lighting/shadows, scoped curvature), B2 (five districts, F36 tram/stations in the world), B3 (physical phone rig), B4 (release). No assets added yet, so no `docs/ASSETS.md`.
