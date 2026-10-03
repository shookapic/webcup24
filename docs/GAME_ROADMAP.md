# Terra Nova — implementation roadmap and specification

Status: implementation handoff, 2026-10-03. This describes required future behavior, not completed features. Read `CODE_REVIEW.md` for evidence and `../CLAUDE.md` for exclusive ownership and integration contracts.

**Coordination update — 2026-10-03:** [PM_STATUS.md](PM_STATUS.md) records A's `2fd14e4`, B's `8e97b3e`, remaining integration gates and concrete next instructions. The original handoff is committed in `1afe494`. The authorized live feed now confirms 36 visible requests through Wave 5; preserve F37 login protection, F38 service availability, F39 appointments and F40 reminders in addition to the scope below. Session A owns these four requests; B consumes any required additive service metadata. See [the official request snapshot](CONTEST_REQUESTS_2026-10-03.md). Future-wave completeness and production completion remain unverified. B0's manual variable-step physics is a provisional deviation from §3's fixed-step target requiring hitch/irregular-frame evidence; do not discard the measured fix merely to restore the original plan.

## 1. Product and feature preservation

**Live checkpoint — 2026-10-03 15:30 Europe/Paris:** the authorized watcher now lists 42 requests through Wave 6. A's owned `FEATURE_MATRIX.md` has the official inventory. Preserve D13 plain wording, D20 inclusive use, F41 keyboard access, F42 accessible forms/errors, F43 colour distinction and F44 zoom/reflow; A is assigned to audit and close these gaps now, with B supporting any world input/DOM-host issue. Wave 5 is committed on `sessionA-work` and locally tested according to A's QA report, but is not on the inspected main tip `b0aaa09`. Baseline A/B phone/HUD and B0 input/camera integration are already on that main tip. B's authored plaza/rigged character work is in progress and uncommitted; physical phone/F36 world/release acceptance remain open. Session reports are evidence to review, not production acceptance.

Create a compact, welcoming extraterrestrial colony: natural walking, recognizable districts, animated inhabitants, municipal services and a believable handheld phone. First minute: clear loading, colonist customization, arrival in a composed plaza, walking to a service, reading an alert, putting away the phone and continuing.

Preserve the accessible portal throughout. No combat, crafting, procedural-city expansion, invented contest XP or networking rewrite. Environmental interactions connect to actual civic features.

| Existing scope to preserve | Required verification | Owner |
| --- | --- | --- |
| Registration/login/logout; citizen/agent/admin roles | Full account journey and unauthorized-action rejection | A |
| Messages and incidents with location, confirmation/history/status | Citizen submits, agent updates, citizen sees status | A |
| Official request feed | Staff-only access, server-held key, request codes, refresh and errors | A |
| Featured services F28; search F32 | Admin publish/toggle, ordering, accented search and no results | A |
| Alerts D18/F29/F30/F31 from original brief | Publish/withdraw, audience, portal banner, opt-in browser notification and world phone | A+B |
| First-login guide D12 and profile | Save district, guide steps, per-user dismissal | A |
| French/English D14/F27 | Interface/content translation and explicit content fallback | A |
| Accessibility | Keyboard, focus, contrast, 150% text, reduced motion, visible portal fallback | A+B |
| World/avatar | Five districts, TPS/FPS, three persisted avatar colors, login gate | B+A |
| NPCs/presence | Animated travel, two-browser presence/interpolation/expiry | B |
| Phone/urgent presentation | Physical device, actual data, acknowledgement, prior view restoration | A+B |
| Deployment | Build/boot, local assets, CSP, persistent data, production smoke | A+B |
| Wave 4 F33 account deletion | Password confirmation, own-account restriction, stated message retention/deletion policy, session revocation | A |
| Wave 4 F34 citizen administration | Staff-only list/search/deactivate/reactivate/reset/delete; protect staff accounts, revoke sessions on deactivation | A |
| Wave 4 F35 contextual tips | First-use message/report/search tips, dismissible and remembered per user | A |
| Wave 4 F36 transport | Two API lines, departures/disruptions, profile-nearest portal stop, physical-nearest world stop, stations and moving tram | A+B |

Codes above come from the original brief, not a fresh official-feed audit. A creates `docs/FEATURE_MATRIX.md` from the latest authorized feed: exact request, code, implementation, owner, test, pass/fail/unverified. Include later waves and any missing baseline codes. If unavailable, mark current-wave completeness unverified. Do not silently drop requirements for visual polish.

Wave 4 was present in the refreshed `CLAUDE.md` during this handoff and is preserved here. Verify its current implementation state before assigning remaining work. A prioritizes the transport API contract to unblock B, then carries F33–F35 alongside UI work. Account mutations require the specified user confirmation and server role checks; redesign must preserve those protections.

## 2. Art direction: a lived-in observatory colony

Stylized low-poly hard-surface buildings, matte ceramic and painted metal, functional rounded details, warm restrained terrain, cool sky and shaded planting. District entrances and civic signage provide identity. Aim for intentional scene composition at normal play distance.

- Palette starting points: chalk `#E5E0D4`, terracotta `#A9654A`, slate `#293D49`, teal `#4A8C87`, amber `#E9BA69`, foliage `#688C73`. Tune under final lighting. Reserve strong warning colors for alerts; avoid universal neon windows/visors.
- Warm directional key, cooler sky fill, readable shadows, atmospheric distance. Reduce the current orange wash and heavy vignette. Brightness should lead toward entrances and landmarks.
- Spawn composition: avatar lower center, a path toward the Mairie in the middle distance, nearby sign/planter/bench, visible NPC crossing and planet above the skyline. Reach inhabited space within ten seconds of walking.
- Compact ~80–100 m core with short connected streets. Retain Mairie north, Santé east, Marché west, Habitat northwest, Quartier sud south. One unit = one meter; avatar ~1.7 m; doors >=2.2 m; paths ~3–5 m. Validate against actual asset scale.
- Mairie: strongest silhouette, entrance canopy, civic sign, antenna/flag and seating. Santé: pale structure, teal wayfinding, shaded waiting area. Marché: awnings, stalls/crates and restrained color variation. Habitat: repeated modules with individualized entrances and gardens. Quartier sud: water-side route, railings/pumps and hazard signage linked to flood announcements.
- Per district: architectural focal point, distinct prop cluster and readable service marker. Keep pedestrian routes clear. Avoid uniform random scattering or unrelated asset styles.

### Assets

B creates `world/public/assets/models/`, `textures/`, optional local `fonts/`, and `docs/ASSETS.md`. Record source, author, license copy, local paths, modifications, units/forward axis, polygon/texture budgets, tintable materials, rig and clip names. Ship only used assets and local decoder files.

Candidate primary sources checked during review: [Kenney Space Kit](https://kenney.nl/assets/space-kit) is CC0 and is a suitable starting point for a coherent architectural kit. [Quaternius Universal Animation Library 2](https://quaternius.com/packs/universalanimationlibrary2.html) provides CC0 animation material; verify the chosen download and rig compatibility. Prefer a character with matching included clips over lengthy retargeting. License/format compatibility must be checked on the exact selected files.

Prove one local GLB, animation, recoloring and scale before populating the city. Skeleton-clone animated instances and clone tintable materials per avatar; share immutable geometry/textures. The final hero character needs limbs and animated gait. Primitive geometry remains appropriate for hidden colliders and deliberate small secondary objects.

**Visual gate:** spawn/plaza/entrance screenshots at 1440×900 and 1920×1080 show grounded inhabitants, clear focal hierarchy, detailed architecture and connected routes, without large empty foregrounds. Improve the plaza until it passes before expanding all districts.

## 3. Movement and camera — B0, blocking

1. Reproduce ten seconds of forward input on a single flat collider. Repeat in the city, TPS/FPS, stationary/follow camera. Visualize colliders and record body position/velocity/heading, rendered rotation, camera yaw and grounded state. Distinguish actual sideways travel from body wobble or camera shake.
2. Use one physics/input/camera authority and an explicit update order. Inspect the installed ecctrl implementation rather than copying another version's API. Fixed physics timestep; rendering interpolation must not apply a second movement transform.
3. Replace automatic decoration colliders with explicit ground/building footprints. Road decals/windows/rings/foliage do not produce collision surfaces. Test steps, corners and wall sliding. Camera retracts near walls and recovers smoothly.
4. Isolate balance/turn torque and timestep effects. Fix the measured cause. If ecctrl cannot pass after a focused ~60–90 minute investigation, B may replace only the controller with a Rapier kinematic capsule supporting gravity, ground checks, wall sliding and jump. Keep the UI/presence contracts stable.
5. TPS direction follows camera yaw; visual facing smooths without physics roll/pitch wobble. FPS follows view direction; character rotation must not drive the camera back. Initialize camera via supported methods; prevent wheel input from leaving FPS in an undefined partial zoom.
6. Walk ~4 m/s; hold Shift for ~7–9 m/s; jump once per press while grounded; equal diagonal/cardinal speed. ZQSD/WASD/arrows work. Explicitly disable ecctrl toggle-run if retaining it.
7. Phone/editor/menu, window blur and hidden tabs stop and clear movement. Resume only on fresh input. UI drags do not rotate camera. Clamp recovery delta after tab return. World NPC/network activity need not freeze with the phone.
8. Bound the playable area and respawn safely after falling outside/below it. Keep near-field rendered ground aligned with physics.

**Acceptance:** ten-second straight walk has monotonic progress and <0.15 m lateral drift on the isolated floor, no alternating heading/roll shake or camera hunting. Release stops within ~0.3 s. Verify four directions, diagonal, run release, jump/landing, corners, road transitions, V switching, mouse drag and blur at 30/60/120 render FPS. Record measurements and a short capture. The user's oscillation report must be explicitly retested.

## 4. Characters, NPCs and presence — B1/B2

- Rigged player with distinct skin/outfit/accent material regions. Idle/walk/run/jump/fall derive from velocity/ground state, crossfade ~0.15–0.25 s. In-place clips; physics owns displacement. Match feet and gait speed to ground motion.
- Shared district/path data drives roads, labels, NPC routes and collider placement. Avoid diverging coordinate lists.
- Target 8–14 NPCs on high, 4–6 on low. Pick destinations, follow sidewalks, ease corners, pause 2–6 s at a stall/bench/entrance and continue. Stagger speed/phase; avoid immediate reversals except dead ends. Lightweight local separation is enough initially.
- Maintain continuous progress/lane offsets at junctions. Walking animation stops during pauses. Reduced motion removes bob/sway and secondary effects, not essential travel; an optional crowd-pause setting is separate.
- Remote avatars use the same model/tint pipeline, shortest-angle interpolation and displacement-derived idle/walk. Poll no faster than 2 s. Guard unmounts and expire stale peers even during network failure. The existing API has no height/animation state: do not claim synchronized remote jumping.

**Acceptance:** observe two minutes at plaza and another district: no junction teleports, wall crossings, persistent stacking or obvious foot sliding. Test reduced motion. Use two users/browsers for movement, independent recoloring and disconnection; verify expiry within the 15 s server window plus next successful poll.

## 5. Physical phone — A1/B3

Desktop device: camera-relative 3D body with bevels, thickness, recessed glass, speaker/notch, side controls and a gloved hand/forearm. Materials match the colony. It is foreground equipment, unaffected by horizon bending and protected from camera/world clipping and excessive bloom.

Screen remains interactive HTML, aligned with the 3D display through a proven projected/transformed DOM bridge. B owns alignment/presentation; A owns content/focus semantics. Never render HTML tags directly as R3F objects. Maintain one focusable screen instance and accurate click coordinates. A CSS rectangle alone does not meet the physical-device requirement. Prove this integration early.

T or HUD opens from either view, snapshots view/camera and raises the phone into FPS in ~250–350 ms. Closing restores the previous pose/view. Reduced motion makes this immediate, with no sway. Player movement and camera look are gated; release pointer lock if used. Narrow-screen/accessible mode uses the same content in a readable flat dialog.

### State and data

B owns `closed → opening → open → closing → closed` plus pending urgent IDs. Snapshot once per phone session. New urgent items take priority without resetting the snapshot. During avatar editing, immediately announce the alert in HTML and defer camera presentation until the editor closes. Acknowledge only displayed IDs. If already manually open, remain open after acknowledgement; if alert-opened, restore prior state. Withdrawal removes pending items and triggers appropriate restoration. Polling must not replay transitions/announcements. Disable V during transitions/urgent presentation and ignore T key repeat.

A supplies home, alerts, news/detail and services screens. Status bar, concise title, scrollable content and persistent actions/navigation. Alerts include full body, audience, urgency/date and acknowledgement. News exposes full content. Services use actual API data/search and honest portal handoffs to `/#services`, `/#actualites`, `/#espace` or `/#message-form`; do not invent backend service IDs or fake submissions.

Also include the mandatory F36 transports page using `GET /api/transports` every 60 s: lines, next three departures, disruption status and nearest stop first. The world computes proximity from the player's coordinates; the portal uses profile district. Preserve the exact stop/district mapping in `CLAUDE.md`. B creates stations and a moving tram on a deliberate route; boarding is optional unless required by the official request. A decorative tram must not be presented as authoritative live timetable tracking. Test both lines, changing nearest stop, disruptions, fetch failures and refresh.

Per-user seen-ID persistence with safe parsing. Distinct loading/empty/stale/error states and retry. Never show “no alerts” when initial loading failed. Translate controls; fallback-language content is marked appropriately. Poll announcements every 15 s.

### Accessibility and acceptance

Dialog focus entry/trap/return, keyboard scrolling and visible focus. Escape follows the documented close/acknowledge behavior; urgent text is announced once per item. Long content stays above reachable actions at 150% text.

Test manual open/close in TPS/FPS; alert during walking, phone reading and editing; successive arrivals; acknowledge/reload; withdrawal; two users on one browser; malformed storage; offline/reconnect; keyboard-only; French/English long text; 390×844 and desktop. Verify DOM click alignment and capture the handheld reading view.

## 6. Rendering, HUD and resilience — A1/B1/B4

- Remove global shader chunk mutation. Preserve curved-horizon intent through isolated distant scenery with a flat near-field region; use matching mapping for affected labels. Imported skinned/instanced assets and nearby physical surfaces remain correct. Curved shadow-casting objects need matching depth deformation; avoid that complexity in the core.
- One framed directional shadow map, starting 1024 low / 2048 high. Selective casting/receiving; supplementary simple grounding where useful. No collection of expensive shadow lights.
- Terrain color/roughness breakup without shimmering noise, matte walls, rough metal trims and darker inset windows. Restrained local water shader in Quartier sud; planet/atmosphere stays behind readable architecture. Correct single color-output/tone-mapping pipeline.
- Selective mild bloom; reduce vignette. Optional water/cloud/wind motion follows reduced motion. No CDN/font/decoder dependency at runtime.
- Compact district block top left; phone/view/help controls top right; contextual interaction near bottom center. Hide full movement instructions after first use, keep Help reachable. >=44 CSS px touch targets, no text-only icon mystery controls.
- Nearby meaningful labels only; distance/edge/HUD rules and geometry occlusion where feasible. Service marker within ~3 m offers E/click to open the phone services page. Unknown service mapping opens the list rather than a fabricated detail.
- Explicit loading, authentication/network errors, asset failures and WebGL fallback to portal. Error boundary around world. Reduced-motion settings update at runtime.
- Touch controls require a tested joystick/look/jump/phone input flow. If not feasible within event time, provide a clear fully functional accessible portal route before presenting an uncontrollable world; do not claim mobile game support.

## 7. Performance and production gates

Targets, not measured guarantees: ~60 FPS at 1080p on the team's named reference laptop; >=30 FPS low mode on a named weaker device. Measure a 60 s route after warm-up; record browser, hardware, resolution, settings and slow frames.

- DPR <=1.5 high / 1 low; initial working budgets <200 visible draw calls, <500k visible triangles, mostly <=1024 textures, <=15 MB initial playable transfer. Adjust only with measured justification.
- Reuse/instance props, share immutable resources, skeleton-clone characters, avoid per-frame allocation/state churn. Lazy-load secondary assets. The large playable chunk includes physics dependencies, not just application code.
- Reduce particles/postprocessing, shadow resolution/range, textures and crowd count first. Preserve movement, alerts and feature access.
- On a stated 10 Mbps profile target playable within ~15 s; show progress/fallback earlier. Measure deployed compression and bytes rather than assuming Vite gzip estimates describe the host.
- Node-served production checks: `/monde/` refresh, model/texture MIME, missing `.glb` returns 404, valid navigation fallback, CSP and console, versioned cache behavior. Repeat on deployed host and verify persistence.

## 8. Two-session sequence

Effort bands are estimates, not a promise about remaining contest time. Work concurrently within ownership. Reduce secondary decoration/effect scope first if needed; preserve features and movement/phone correctness.

| Milestone | A | B | Exit gate |
| --- | --- | --- | --- |
| M0 ~30–45 min | Feature inventory and existing-flow checks | Isolated movement reproduction | Scope ledger and measured debugging evidence |
| M1 ~1–2 h | Screen/HUD/alert data, stable exports | Movement fix, camera/input/colliders | Straight-walk tests and usable UI components |
| M2 ~2–3 h | Polished phone/editor, DOM bridge handoff | Plaza/model/gait/light, early physical-phone integration | Convincing spawn, walking NPC and usable handheld screen |
| M3 ~2–3 h | Localization/onboarding, asset serving/regressions | Five districts, crowds/presence, final phone state | Complete baseline world and preserved civic flows |
| M4 ~1–2 h | Full feature matrix and production checks | Performance/fallbacks/captures/integration | Recorded acceptance evidence, build/boot, no critical blockers |

Reserve final event hour for production smoke, fixes and accurate declarations. No late major dependency changes. Each owner records commit, interface changes, validation and unresolved issues in their QA file. Do not defer physical-phone integration until the end.

### Final smoke route

1. Register/login, select language, enter world, customize three colors, refresh to check persistence.
2. Walk/run/jump Mairie → Santé → Quartier sud → Marché → Habitat; inspect corners, ground contact, labels and TPS/FPS.
3. Open a district service in the phone, read actual data, follow portal action and return.
4. Admin publishes urgent news while citizen walks; phone raises, inputs stop, acknowledgement restores view. Test withdrawal while displayed and alert during editing.
5. Observe NPCs two minutes and a second user's presence/disconnection. Test reduced motion, tab blur, offline recovery, keyboard and narrow viewport.
6. Submit message/incident, update as agent, verify history and every remaining official feature-matrix row.
7. Build/boot production, test assets/CSP, measure route, capture spawn/all districts/editor/phone plus locomotion/NPC/alert video.

Wave 4 smoke: verify tram movement/stations and both transport lists; first-use tips/dismissal; delete a dedicated test citizen with password confirmation; staff deactivate/reactivate/reset/delete a different test citizen and verify session revocation and staff-account protection. Never use a real participant account for destructive test fixtures.

Deliver `FEATURE_MATRIX.md`, `ASSETS.md`, `QA_A.md`, `QA_B.md` with evidence paths and explicit pass/fail/unverified results. Movement, civic flows, alert delivery, authentication and production asset-loading failures block a ready declaration.
