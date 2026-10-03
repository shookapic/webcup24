# Asset handoff A: Santé clinic ("hospital-a-v001")

Session A, model delivery for B. Branch `asset-a-hospital`, based on B's committed `11a3262`. Nothing outside the unique paths below was touched; B integrates (registry, layout, collider, attribution) after the four-object slice gate.

## What it is
One authored landmark for the Santé district: a two-storey clinic with a central entrance block (full footprint depth, taller), two wings set back about 1 m, a recessed entrance porch with a teal canopy, two steps and glazed doors, a large health symbol (terracotta cross on a chalk disc in a teal ring) on the facade, a back ambulance bay, and roof furniture visible from the elevated T2 tram: amber helipad ring with an H, a row of dark solar panels, a plant room with louvres and two vent stacks, and a flat roof cross on a teal pad. Palette: matte chalk ceramic, slate trim, Santé teal, terracotta and amber accents, dark blue-green glass (B's kit colours). Distinct from the barrel hangar it replaces (see `docs/qa-captures/a-hospital/compare-hangar.png`).

## Files (all new, unique paths)
| Path | Content |
|---|---|
| `world/public/models/buildings/hospital-a-v001.glb` | runtime GLB (plain export, no compression, no textures) |
| `world/assets-src/a-hospital/hospital-a-v001.blend` | authored source (one managed script builds it) |
| `world/assets-src/a-hospital/hospital-a-v001.manifest.json` | MEASURED facts and the validator's checks (written by `validate-glb.mjs` from the GLB itself) |
| `world/assets-src/a-hospital/hospital-a-v001.build-report.json` | Blender-side validation of the build |
| `world/assets-src/a-hospital/SOURCE-AND-LICENCE.md` | source, licence, modifications |
| `tools/assets-a/hospital/build_hospital.py`, `export_hospital.py` | readable authoring and export scripts |
| `tools/qa-a-assets/validate-glb.mjs`, `capture.mjs`, `preview/` | GLB validator (Node built-ins), isolated R3F preview and capture script |
| `docs/qa-captures/a-hospital/*.png`, `gltfloader-readback.json` | front, three-quarter, back, human-scale entrance, tram-side view, roof, comparison with the hangar, footprint fit; GLTFLoader readback |

## Reproduce
```
# Blender 5.2.2 LTS at "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
blender --background --factory-startup --python tools/assets-a/hospital/build_hospital.py -- --out world/assets-src/a-hospital/hospital-a-v001.blend [--allow-overwrite]
blender --background world/assets-src/a-hospital/hospital-a-v001.blend --python tools/assets-a/hospital/export_hospital.py -- --out world/public/models/buildings/hospital-a-v001.glb [--allow-overwrite]
node tools/qa-a-assets/validate-glb.mjs world/public/models/buildings/hospital-a-v001.glb world/assets-src/a-hospital/hospital-a-v001.manifest.json
node tools/qa-a-assets/capture.mjs        # starts the isolated preview on 127.0.0.1:3206 and writes docs/qa-captures/a-hospital/
```
Both scripts refuse to overwrite an existing file without `--allow-overwrite`. They read and write only inside this checkout.

## Contract (measured, from the manifest; not inferred from comments)
- glTF axes: **+Y up, +Z front (entrance side)**, metres, scale 1. Origin: **centre of the ground footprint, y = 0**.
- Scene root and object name **`hospital`**; 8 mesh nodes (one per material); materials `Hospital_Ceramic`, `_Slate`, `_Teal`, `_Terracotta`, `_Amber`, `_Glass`, `_LobbyGlass`, `_Paving`.
- **Footprint 14.715 (X) x 12.735 (Z) m = exactly the collision box of `hangar_roundA` x 4.5** (`footprintOf`: 12.735 x 14.715 once turned by -PI/2). Every part of the model is inside it (porch, sign, sills, steps included): nothing projects beyond the collider.
- Bounds: x -7.3575..7.3575, **y 0..7.75**, z -6.3675..6.3675. Main mass top 6.7 m; the **plant room (to 7.75 m), vent stacks (7.25), solar panels and roof cross rise above the collision box height of 6.75 m**. Nothing reachable or walkable is above 6.75 m; no collision change is needed. If B prefers the old 6.75 m silhouette, the plant room could be lowered; not done to avoid guessing.
- Door: glazed double doors at the back of the recessed porch, local (0, 0.35, 4.5675); approach point on the footprint edge (0, 0, 6.3675). At world (40, -6) with ry -PI/2 the front faces **world -X**, toward the Santé tram stop (28, 0.5); the door lands at about world (35.43, 0.35, -6). The door anchor is in the manifest only; **no gameplay, service, stop or interaction metadata is in the GLB** (checked).
- Budget (measured): **6,208 triangles**, 12,096 vertices, 8 materials, 0 textures, no cameras/lights/animations/skins/extras/extensions, **334 KB raw, 54.8 KB gzip** (the server gzips .glb). Raw size is flat-shaded boxes (24 vertices each). Native meshopt was probed and would give 93 KB raw / 13 KB gzip but needs the meshopt decoder in B's loader; not shipped, B's call.
- Emission: only `Hospital_LobbyGlass`, strength 0.10 (below any bloom threshold). No glow elsewhere.

## How B registers it (proposal; B owns these files)
- Standalone: load `${import.meta.env.BASE_URL}models/buildings/hospital-a-v001.glb` (the file sits in `world/public`, so it ships as `/monde/models/buildings/hospital-a-v001.glb`, immutable-less: `no-cache` + ETag + gzip by the existing server, GLB MIME and 404 already tested).
- Packed: `node tools/pack-models.mjs <pack.glb> world/public/models/buildings/hospital-a-v001.glb ...` accepts the file (checked: 1 model, 9 nodes, 8 meshes); in a pack the root node takes the **file name**, i.e. `hospital-a-v001`, so use that as the registry key (or pack a copy named `hospital.glb`).
- Layout: replace `B('hangar_roundA', 40, -6, 4.5, -Math.PI / 2, 'sante', { cross: true })` by a `hospital` entry at (40, -6), scale **1**, ry **-PI/2**, with `kitSize.hospital = [14.715, 6.75, 12.735]` so `footprintOf` yields the same 12.735 x 14.715 x 6.75 collider. **Drop `cross: true`**: the model has its own symbol (HealthCross in Districts.jsx would draw a second one).
- Materials: not replaced by `kit.jsx` (names differ), so colours are final; shadows: set cast/receive like the other buildings.

## Validation done (PASS) and what it does not prove
Validator: 12/12 checks on the GLB (single root, no textures/URIs/extensions needing decoders, no metadata, Hospital_* names, footprint within 1 mm, origin, budgets). GLTFLoader readback in the isolated R3F preview: 8 meshes, 6,208 triangles, bounds identical, no missing normals, no parser warnings. Eight views captured on the real GPU (RTX 5070 Ti), 0 console errors, 0 failed requests, warm key light and one shadow map with B's Sun numbers.
**Not proven** (deferred to B, in the city): collision against the player and NPC paths, shadow-map coverage and quality tiers, frame cost and draw calls in the full scene (8 draw calls expected), bloom interaction, the view from the moving tram, annex alignment (`hangar_largeB` at (40, -20) and `hangar_smallA` at (40, 9) remain), and how it reads at the world's fog and curvature.

## Known limits
Flat-shaded, constant-colour low-poly style matching the kit, no textures or normal maps. Windows are dark glass, not emissive; no interior. The lobby reads as tinted glass with a faint warm light.
