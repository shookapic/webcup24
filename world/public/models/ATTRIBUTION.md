# Model attribution and provenance (shipped with the world)

| File | Contents | Author / source | Licence |
|---|---|---|---|
| `colony-pack.glb` | `townHall`, `streetLamp`, `bench`, `colonyTree` (4 nodes, one request) | Authored for Terra Nova (WebCup 2026) with Blender 5.2.2 LTS from the committed scripts `tools/assets/{townhall,lamp,bench,tree}.py` (primitive modelling: boxes, cylinders, ico-spheres, bevels; deterministic seed). No third-party geometry or textures. | CC0 1.0 (public domain dedication) — licence evidence: this file and the scripts in the repository |
| `buildings/hospital-a-v001.glb` | `hospital` (Santé clinic, standalone, 6208 triangles, 8 materials) | Authored from scratch for Terra Nova (WebCup 2026) by project session A with Blender 5.2.2 LTS, `tools/assets-a/hospital/build_hospital.py` + `export_hospital.py`, source `world/assets-src/a-hospital/hospital-a-v001.blend`. No third-party model, texture or script; the Kenney hangar was only a size reference. | Original work of this project, usable and redistributable with the project; no third-party attribution required (not assigned a CC0 dedication). Evidence: `world/assets-src/a-hospital/SOURCE-AND-LICENCE.md` |
| `../assets/models/kit-pack.glb` | Kenney Space Kit pieces (buildings, tram cars, props) | Kenney (www.kenney.nl), Space Kit 2.0, downloaded 2026-10-03 | CC0 1.0, `../assets/licenses/kenney-space-kit-LICENSE.txt` |
| `../assets/models/nature-pack.glb` | Kenney Nature Kit pieces (trees, bushes, flowers) | Kenney, Nature Kit 2.1, downloaded 2026-10-03 | CC0 1.0, `../assets/licenses/kenney-nature-kit-LICENSE.txt` |
| `../assets/models/chars/*.glb` | Kenney Blocky Characters c, i, n | Kenney, Blocky Characters 2.0, downloaded 2026-10-03 | CC0 1.0, `../assets/licenses/kenney-blocky-characters-LICENSE.txt` |

Conventions of the authored assets: metres, Y up, origin at the centre of the base on the ground, front = +Z, plain PBR colours from the colony palette (no textures), semantic names. Rebuild: `node tools/assets/build.mjs` (needs Blender 5.2; set `BLENDER` for another path).
