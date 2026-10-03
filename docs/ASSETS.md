# Assets — provenance and budgets (Session B)

All shipped assets are local under `world/public/assets/` (no CDN). Only files used by the scene are kept; re-copy from the source packs when a new piece is needed.

| Pack | Author / source | License | Local files | Use |
|---|---|---|---|---|
| Space Kit 2.0 | Kenney, https://kenney.nl/assets/space-kit | CC0 1.0 (`licenses/kenney-space-kit-LICENSE.txt`) | `models/kit/*.glb` (19 files, ~0.5 MB total) | Mairie, Santé, Marché, Habitat, Quartier sud buildings; tram cars; plaza props |
| Blocky Characters 2.0 | Kenney, https://kenney.nl/assets/blocky-characters | CC0 1.0 (`licenses/kenney-blocky-characters-LICENSE.txt`) | `models/chars/character-{c,i,n}.glb`, `models/chars/Textures/texture-{c,i,n}.png` | Player, NPCs, remote players; looks `colon` = c (default), `lunettes` = i, `bandeau` = n (same rig and clips, different hair/face/clothes painted in the atlas) |

| Nature Kit 2.1 | Kenney, https://kenney.nl/assets/nature-kit | CC0 1.0 (`licenses/kenney-nature-kit-LICENSE.txt`) | `models/nature/*.glb` (12 files, ~0.1 MB) | Trees (autumn oak/default/fat, thin), bushes, flowers, grass, column |

Downloaded 2026-10-03 from the Kenney asset pages (zip links on those pages). Not mandatory to credit; credited here.

## Modifications

- **Kit palette**: kit materials are replaced at load by name (`kit.jsx`): `metal` chalk `#e5e0d4`, `metalDark` slate `#4b5a63`, `metalRed` terracotta `#a9654a`, `dark` inset window `#27363f`, `rock`, `rockTrack`. One shared material per name, never mutated per instance. Geometry untouched.
- **District accents** (`kit.jsx` `variants`): the terracotta `metalRed` is replaced per building: Santé teal `#4a8c87`, Marché amber `#d09a3e`, Habitat foliage `#688c73`, Quartier sud blue `#3f6f8f`, tram cars the API line colours.
- **Root offset**: every Space Kit glb has its scene root translated by [2, 0, 1.5]; `Prop` zeroes the horizontal part on each clone (geometry is centred on its footprint). Verified by `tools/qa/building-check.mjs`. Nose of the monorail cars = local -z.
- **Nature Kit**: materials are cloned and made matte (the kit exports metallic materials that render black without an environment map); colours untouched. Drawn with `InstancedMesh` per model material (`nature.jsx`). Trees scaled x2.5-3.4 (about 3-6 m), bushes x2.6-3.8, flowers x2.6-3.8.
- **Avatar accessories**: `sac` (backpack in the accent colour) and `visiere` (glowing visor + brim) are primitive meshes parented to the rig's torso/head nodes (`Colonist.jsx`), so they follow every clip; they keep their own materials (the recolour pass skips them).
- **Kit scale**: kit units are small (hangar_largeA = 2 x 1 x 3). The scene scales by piece: Mairie hall x6, wings x4, canopy platform x(2.6, 3, 2.1), antenna dish x4, props x2–3. One unit = one metre after scaling; avatar 1.6 m; paths 3–4 m. Origin of every kit piece is the base centre; front (doors) faces +z.
- **Character recolour** (`Colonist.jsx`): the single 1024 px atlas is recoloured on a canvas per distinct (skin, outfit, accent): skin-coloured pixels (face, hands) -> skin, torso + sleeves -> outfit, trousers -> accent; shading kept by scaling each pixel with its luminance relative to the region mean. Result is a new `Texture` with its own `Source` (cloning the glTF texture shares its Source: replacing `.image` on the clone corrupts the original and every later recolour). Cached per colour set. The glTF's `KHR_materials_unlit` material is replaced by `MeshStandardMaterial` so characters take light and shadows. Accent therefore means trousers on this model (the editor label is A's).
- Skinned clones use `SkeletonUtils.clone`; clips used: `idle`, `walk`, `sprint` (the pack also has sit, die, emotes, etc., unused). There is **no jump/fall clip**: airborne freezes the walk pose.

## Rig / units / axes

| | |
|---|---|
| Character | Y up, faces +z, origin at the feet. Measured 2.7 m tall (legs 1.0 + torso 0.9 + head 0.8), drawn at `HEIGHT_SCALE` 0.64 = 1.7 m. Rig: root > leg-left, leg-right, torso > arm-left, arm-right, head (rigid nodes, not skinned; the head node is scaled 0.1). |
| Clips | idle 1.33 s, walk 0.67 s loop, sprint 0.5 s loop, in place. `timeScale` = speed / 3.2 (walk) or speed / 7 (sprint); to be re-measured against foot sliding (QA_B). |
| Physics link | ecctrl capsule centre rests 0.96 m above the floor; the avatar is offset by -0.96. |

## Budgets (current)

Initial playable transfer: the world chunk is ~4.4 MB (1.6 MB gzip) of JS + 0.4 MB models/texture. Draw calls and triangles: not yet measured (B4). Textures: one 1024 atlas per recolour (shared by all instances with the same colours).

## Not used / rejected

The Space Kit monorail cars (`monorail_trainFront/Passenger/End`, scaled x3.3) are used for the F36 tram; the track and columns are plain boxes because the kit's track pieces are too short and thin to read at colony scale. Quaternius packs were not used: Kenney Blocky Characters already ships matching idle/walk/sprint clips on a single rig, which avoids retargeting.


## Authored colony assets (GLTF pipeline slice)

Pipeline: `tools/assets/*.py` (Blender 5.2.2 LTS, headless, deterministic) -> `world/assets-src/colony/*.glb` (source exports, committed, not served) -> `tools/pack-models.mjs` -> `world/public/models/colony-pack.glb` (one request) -> `world/src/assets/registry.js` (semantic ids, calibration, budget) -> `WorldAsset` / `WorldAssetInstances` (drei `useGLTF`, shared geometry/materials, one `InstancedMesh` per material for repeats). Provenance and licences: `world/public/models/ATTRIBUTION.md`; Blender/MCP record: `docs/BLENDER_TOOLING.md`. Rebuild: `node tools/assets/build.mjs`.

| id | what | triangles | materials | placements | budget |
|---|---|---|---|---|---|
| `townHall` | Mairie landmark: hall with eight-sided glazed roof and lantern, two wings, entrance steps, canopy on four pillars, flag mast, antenna dish | 2336 | 7 (chalk, slate, slateDark, terracotta, teal, glass, beacon) | 1 (replaces 3 kit buildings, canopy and pillars) | landmark <= 30k |
| `streetLamp` | 4.3 m slate pole, hexagonal lantern, restrained amber glow (emissive 1.2, not tone-mapped) | 460 | 4 | 13 instanced | small prop <= 3k |
| `bench` | 2.2 m bench, seat top 0.56 m, back at local -z (same anchors as `layout.js` seats) | 496 | 3 | 9 instanced | small prop <= 3k |
| `colonyTree` | 5 m tree, faceted canopy, leaf colour variants `warm` / `green` | 416 | 2 | 8 instanced (plaza ring) | small prop <= 3k |

Conventions: metres, Y up, origin at the centre of the base on the ground, front = +Z, no textures (plain PBR colours from the palette), no exported root offset (the registry also zeroes any root translation on the clone). Units/orientation were checked against the collision footprints (`tools/qa/building-check.mjs`) and the seat geometry (`tools/qa/bench-check.mjs`). Collision, seat anchors, paths, service codes and interaction data stay in `layout.js`, not in the GLB.
