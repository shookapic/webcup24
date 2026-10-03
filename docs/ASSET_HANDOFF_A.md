# Asset handoff A: Santé clinic ("hospital-a-v001")

Session A, model delivery for B. Branch `asset-a-hospital`, based on B's committed `11a3262`; model commit `dc289fd`, review-correction commit after it (this file is revision 2). Nothing outside the unique paths below was touched; B integrates (registry, layout, collider, attribution) after the four-object slice gate. The PM accepted the *visual* handoff provisionally; **no city integration, collision or runtime/performance acceptance is implied**, and several statements of revision 1 about the collider and the roof were withdrawn here (see "Collision and access" and "UNVERIFIED").

## What it is
One authored landmark for the Santé district: a two-storey clinic with a central entrance block (full footprint depth, taller), two wings set back about 1 m, a recessed entrance porch with a teal canopy, two steps and glazed doors, a large health symbol (terracotta cross on a chalk disc in a teal ring) on the facade, a back ambulance bay, and roof furniture visible from the elevated T2 tram: amber helipad ring with an H, a row of dark solar panels, a plant room with louvres and two vent stacks, and a flat roof cross on a teal pad. Palette: matte chalk ceramic, slate trim, Santé teal, terracotta and amber accents, dark blue-green glass (B's kit colours). Distinct from the barrel hangar it replaces (see `docs/qa-captures/a-hospital/compare-hangar.png`).

## Files (all new, unique paths)
| Path | Content |
|---|---|
| `world/public/models/buildings/hospital-a-v001.glb` | runtime GLB (plain export, no compression, no textures); unchanged by the review correction (sha256 `7396daef12e09cbc8da7db3941025cfcae86358516e389aa438683e8c0e27f4d`) |
| `world/assets-src/a-hospital/hospital-a-v001.blend` | authored source (one managed script builds it) |
| `world/assets-src/a-hospital/hospital-a-v001.manifest.json` | schema 2: `measuredFromGlb` (computed from the GLB), `declaredContract` (inputs, not recovered from the GLB), `comparisons` (computed from both), `unverified`, `checks` |
| `world/assets-src/a-hospital/hospital-a-v001.build-report.json` | Blender-side validation of the build |
| `world/assets-src/a-hospital/SOURCE-AND-LICENCE.md` | source, licence, modifications |
| `tools/assets-a/hospital/build_hospital.py`, `export_hospital.py`, `asset_paths.py` | authoring and export scripts, and their shared path guards |
| `tools/qa-a-assets/validate-glb.mjs`, `test-script-guards.mjs`, `capture.mjs`, `preview/` | GLB validator (Node built-ins), guard/labelling test, isolated R3F preview and capture script |
| `docs/qa-captures/a-hospital/*.png`, `gltfloader-readback.json`, `script-guard-test.json` | front, three-quarter, back, human-scale entrance, tram-side view, roof, comparison with the hangar, footprint fit; GLTFLoader readback; guard test result |

## Reproduce
```
# Blender 5.2.2 LTS at "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"; --python-exit-code makes a rejected run exit non-zero
blender --background --factory-startup --python-exit-code 1 --python tools/assets-a/hospital/build_hospital.py -- --out world/assets-src/a-hospital/hospital-a-v001.blend [--allow-overwrite]
blender --background world/assets-src/a-hospital/hospital-a-v001.blend --python-exit-code 1 --python tools/assets-a/hospital/export_hospital.py -- --out world/public/models/buildings/hospital-a-v001.glb [--allow-overwrite]
node tools/qa-a-assets/validate-glb.mjs world/public/models/buildings/hospital-a-v001.glb world/assets-src/a-hospital/hospital-a-v001.manifest.json
node tools/qa-a-assets/test-script-guards.mjs   # guards and manifest labelling; no GPU
node tools/qa-a-assets/capture.mjs              # isolated preview on 127.0.0.1:3206, writes docs/qa-captures/a-hospital/ (GPU; not rerun for the correction)
```
A fresh build + export from the committed script reproduced the committed GLB byte for byte (informational result of the guard test, `freshExportIdenticalToCommitted: true`).

## Script boundaries: exactly what is guarded
Plain resolved-path checks in Python/Node, run once at start-up before anything is created or changed. **They are not an OS sandbox.** The checkout root is taken from the script's own location (`__file__`, three levels above `tools/assets-a/hospital/`), never from the current directory or an argument. Paths are resolved first (relative parts, `..`, symlinks and junctions followed), then compared.

| Script | Reads | Writes | Rejected (non-zero exit, nothing written) |
|---|---|---|---|
| `build_hospital.py` | nothing from disk (starts from the factory scene; an opened .blend is refused) | `--out`: `hospital-a-<version>.blend` and its sibling `hospital-a-<version>.build-report.json`, directly in `world/assets-src/a-hospital/` | outside the checkout, other or nested directory, other suffix (case-sensitive) or name, junction/symlink resolving elsewhere, an existing output without `--allow-overwrite` (all outputs together, including the report) |
| `export_hospital.py` | the one opened .blend: `hospital-a-<version>.blend` directly in `world/assets-src/a-hospital/` | `--out`: `hospital-a-<version>.glb` directly in `world/public/models/buildings/` | same rules, plus an opened .blend outside the source directory, an empty scene, `--root` other than `hospital`; existing output without `--allow-overwrite` |
| `validate-glb.mjs` | the GLB path it is given (read-only, any location) | the manifest only: `hospital-a-<version>.manifest.json` directly in `world/assets-src/a-hospital/` (regenerated on every run, so overwriting is its job; `--no-write` writes nothing) | a manifest path anywhere else or with another name |

Also: Blender's `.blend1` backup is switched off in the build (no third file); importing the guard module does not create `__pycache__` (`sys.dont_write_bytecode`).
**Not guarded:** Blender itself writes a temporary `<name>.blend@` next to the .blend while saving and renames it; the glTF exporter is called for one GLB with no images and is expected to write only that file (Blender's behaviour, not enforced); a hard link inside an allowed directory is not detected; files can change between the check and the write; `capture.mjs` and `preview/` are not guarded (they write the captures to the directory given and a Vite cache under `node_modules/.vite-a-assets`, which in this worktree is a junction into the main checkout's `node_modules`; removed after each run), and they were not changed or rerun for this correction; `test-script-guards.mjs` itself creates and removes files named `hospital-a-v998-guardtest.*` in the two areas and writes its result JSON.
**Evidence:** `tools/qa-a-assets/test-script-guards.mjs` runs the real scripts in Blender: 36 checks, 36 pass (`docs/qa-captures/a-hospital/script-guard-test.json`), including the hostile cases above, a junction pointing outside, a pre-existing sibling report, valid runs (no `.blend1`, no stray files), and that the committed GLB, .blend and report are byte-identical afterwards. The same test run against the pre-correction script (`dc289fd`) showed it writing a .blend and a report outside the checkout.

## Contract
### Measured from the GLB (computed by `validate-glb.mjs`; manifest `measuredFromGlb`)
- Scene root and object name **`hospital`** (single root); 8 mesh nodes (one per material); materials `Hospital_Ceramic`, `_Slate`, `_Teal`, `_Terracotta`, `_Amber`, `_Glass`, `_LobbyGlass`, `_Paving`.
- Budget: **6,208 triangles**, 12,096 vertices, 8 materials, **0 textures, 0 images, 0 samplers**, no cameras/lights/animations/skins/extras, only `KHR_materials_emissive_strength`, **334,356 bytes raw, 54,757 gzip** (the server gzips .glb). Raw size is flat-shaded boxes (24 vertices each). Native meshopt was probed (93 KB raw / 13 KB gzip) but needs the meshopt decoder in B's loader; not shipped, B's call.
- Bounds: x -7.3575..7.3575, **y 0..7.75**, z -6.3675..6.3675, so the footprint is 14.715 x 12.735 m (check 8), every vertex lies inside it (check 9), and it is centred on the origin with the lowest point at y = 0 (check 10).
- Emission: only `Hospital_LobbyGlass`, strength 0.10. No glow elsewhere.
- No gameplay, service, stop or interaction metadata in the GLB (check on names and extras). The door anchor is **not** in the GLB.

### Declared contract (inputs to the validator, manifest `declaredContract`; not recoverable from the GLB)
- **Axes / front: +Y up, +Z = the entrance side, metres, scale 1.** The front direction is set by the export axes in the scripts and was confirmed *visually* (`front.png`, `human-entrance.png`); the anonymous geometry cannot prove it.
- **Collision box 14.715 x 12.735 x 6.75 m** = `hangar_roundA` kit size [3.27, 1.5, 2.83] x 4.5 as `footprintOf` turns it (12.735 x 14.715 after the -PI/2 turn). Read by hand from B's committed `world/src`, not re-read by a script: **B must confirm**. The measured footprint equals it within 1 mm (`comparisons.footprintMatchesDeclaredCollisionBox`, derived from the footprint check).
- **Main mass top 6.7 m** (declared by the authoring script). Measured max height is 7.75 m: the plant room (to 7.75), vent stacks (7.25), solar panels and roof cross are higher than the 6.75 m box (`metresAboveDeclaredCollisionBoxHeight` = 1).
- **Door anchor** (glazed double doors at the back of the recessed porch): local (0, 0.35, 4.5675). **Approach point on the footprint edge:** local (0, 0, 6.3675). Distance from that edge to the door: 1.8 m (calculated from the two declared numbers).
- **Placement** (B's layout entry): world (40, -6), ry -PI/2, scale 1. By calculation from the declared ry the front faces **world -X**, toward the Santé tram stop (28, 0.5); the approach point lands at about world (33.63, 0, -6) and the door anchor at about (35.43, 0.35, -6).

## Collision and access: for B to decide and test (UNVERIFIED, A implements nothing)
- **The proposed unchanged collider is a solid box over the whole footprint. It therefore fills the recessed porch**: the door anchor is 1.8 m *inside* the collider (declared numbers), so the player and NPCs can reach the footprint edge (the approach point) but not the doors themselves. Revision 1's statement "no collision change is needed" is withdrawn.
- Anything that must work at the door (a service interaction, "enter", an NPC destination) has to stay reachable **from outside the collider**: for example an interaction zone or radius measured from the approach point that covers the door anchor with margin (at least 1.8 m), or **B must deliberately adapt the collision geometry** (for example several boxes that leave the porch open). The model carries no such data; the door anchor and the approach point exist only in the manifest.
- **Roof and elements above 6.75 m: reachability is UNVERIFIED.** Revision 1 said nothing there is reachable or walkable; that is not established without an in-city check (player jump and step height, the elevated T2 tram near x = 28, NPC paths). Treat the roof as possibly reachable until B has measured it.

## How B registers it (proposal; B owns these files)
- Standalone: load `${import.meta.env.BASE_URL}models/buildings/hospital-a-v001.glb` (the file sits in `world/public`, so it ships as `/monde/models/buildings/hospital-a-v001.glb` with the existing server contract: GLB MIME, `no-cache` + ETag + gzip, real 404).
- Packed: `node tools/pack-models.mjs <pack.glb> world/public/models/buildings/hospital-a-v001.glb ...` accepts the file (checked: 1 model, 9 nodes, 8 meshes); in a pack the root node takes the **file name**, i.e. `hospital-a-v001`, so use that as the registry key (or pack a copy named `hospital.glb`).
- Layout: replace `B('hangar_roundA', 40, -6, 4.5, -Math.PI / 2, 'sante', { cross: true })` by a `hospital` entry at (40, -6), scale **1**, ry **-PI/2**; its `kitSize` would be [14.715, 6.75, 12.735] to give the same turned collider, **but that solid box fills the porch (see above), so the collider is B's decision**. **Drop `cross: true`**: the model has its own symbol (HealthCross in Districts.jsx would draw a second one).
- Materials: not replaced by `kit.jsx` (names differ), so colours are final; shadows: set cast/receive like the other buildings.

## Validation: PASS / UNVERIFIED
- **PASS** (measured, no GPU needed for the correction): validator 13/13 on the GLB (single root, no textures/URIs/decoder extensions, no metadata, Hospital_* names, footprint within 1 mm, all geometry inside the footprint, origin, budgets); guard test 36/36; committed GLB/.blend/report byte-identical.
- **PASS** (earlier, unchanged model): GLTFLoader readback in the isolated R3F preview (8 meshes, 6,208 triangles, same bounds, no missing normals), eight views on the real GPU (RTX 5070 Ti), 0 console errors, 0 failed requests, with B's Sun numbers. Not rerun for the review correction.
- **UNVERIFIED** (B, in the city): collision against the player and NPC paths including the porch; reachability of the roof and of elements above 6.75 m; shadow-map coverage and quality tiers; frame cost and draw calls in the full scene (8 expected); bloom interaction; the view from the moving tram; annex alignment (`hangar_largeB` at (40, -20), `hangar_smallA` at (40, 9) remain); how it reads at the world's fog and curvature. The declared collision box dimensions are unconfirmed by B.

## Known limits
Flat-shaded, constant-colour low-poly style matching the kit, no textures or normal maps. Windows are dark glass, not emissive; no interior. The lobby reads as tinted glass with a faint warm light.
