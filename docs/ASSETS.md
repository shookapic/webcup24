# Assets — provenance and budgets (Session B)

All shipped assets are local under `world/public/assets/` (no CDN). Only files used by the scene are kept; re-copy from the source packs when a new piece is needed.

| Pack | Author / source | License | Local files | Use |
|---|---|---|---|---|
| Space Kit 2.0 | Kenney, https://kenney.nl/assets/space-kit | CC0 1.0 (`licenses/kenney-space-kit-LICENSE.txt`) | `models/kit/*.glb` (11 files, ~0.3 MB total) | Mairie, wings, canopy, antenna, plaza props |
| Blocky Characters 2.0 | Kenney, https://kenney.nl/assets/blocky-characters | CC0 1.0 (`licenses/kenney-blocky-characters-LICENSE.txt`) | `models/chars/character-c.glb`, `models/chars/Textures/texture-c.png` | Player, NPCs, remote players (one rig, recoloured per instance) |

Downloaded 2026-10-03 from the Kenney asset pages (zip links on those pages). Not mandatory to credit; credited here.

## Modifications

- **Kit palette**: kit materials are replaced at load by name (`kit.jsx`): `metal` chalk `#e5e0d4`, `metalDark` slate `#4b5a63`, `metalRed` terracotta `#a9654a`, `dark` inset window `#27363f`, `rock`, `rockTrack`. One shared material per name, never mutated per instance. Geometry untouched.
- **Kit scale**: kit units are small (hangar_largeA = 2 x 1 x 3). The scene scales by piece: Mairie hall x6, wings x4, canopy platform x(2.6, 3, 2.1), antenna dish x4, props x2–3. One unit = one metre after scaling; avatar 1.6 m; paths 3–4 m. Origin of every kit piece is the base centre; front (doors) faces +z.
- **Character recolour** (`Colonist.jsx`): the single 1024 px atlas is recoloured on a canvas per distinct (skin, outfit, accent): skin-coloured pixels (face, hands) -> skin, torso + sleeves -> outfit, trousers -> accent; shading kept by scaling each pixel with its luminance relative to the region mean. Result is a new `Texture` with its own `Source` (cloning the glTF texture shares its Source: replacing `.image` on the clone corrupts the original and every later recolour). Cached per colour set. The glTF's `KHR_materials_unlit` material is replaced by `MeshStandardMaterial` so characters take light and shadows. Accent therefore means trousers on this model (the editor label is A's).
- Skinned clones use `SkeletonUtils.clone`; clips used: `idle`, `walk`, `sprint` (the pack also has sit, die, emotes, etc., unused). There is **no jump/fall clip**: airborne freezes the walk pose.

## Rig / units / axes

| | |
|---|---|
| Character | Y up, faces +z, origin at the feet, ~1.6 m tall (rig: root > leg-left, leg-right, torso > arm-left, arm-right, head). |
| Clips | idle 1.33 s, walk 0.67 s loop, sprint 0.5 s loop, in place. `timeScale` = speed / 3.2 (walk) or speed / 7 (sprint); to be re-measured against foot sliding (QA_B). |
| Physics link | ecctrl capsule centre rests 0.96 m above the floor; the avatar is offset by -0.96. |

## Budgets (current)

Initial playable transfer: the world chunk is ~4.4 MB (1.6 MB gzip) of JS + 0.4 MB models/texture. Draw calls and triangles: not yet measured (B4). Textures: one 1024 atlas per recolour (shared by all instances with the same colours).

## Not used / rejected

Kenney Space Kit monorail pieces are intended for the F36 tram (B2) and will be added with that work. Quaternius packs were not used: Kenney Blocky Characters already ships matching idle/walk/sprint clips on a single rig, which avoids retargeting.
