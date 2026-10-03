# Blender authoring workflow and MCP vetting (Session B)

## Chosen workflow: reviewed headless Blender scripts (no MCP)

- Blender: the official **Blender 5.2.2 LTS** already installed at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` (build 2026-09-15, hash d13f752e3b9c). Nothing was installed or downloaded. Blender is an authoring tool only; the deployed app never runs it.
- Scripts (committed, deterministic): `tools/assets/lib.py` (palette, helpers, GLB export) and `bench.py`, `lamp.py`, `tree.py`, `townhall.py`. Each starts from `--factory-startup` with an empty scene, writes ONE file given after `--`, and prints `TRIANGLES n`.
- Build: `node tools/assets/build.mjs` runs the four scripts into `world/assets-src/colony/*.glb` and packs them into `world/public/models/colony-pack.glb` with `tools/pack-models.mjs` (no textures, so packing is lossless).
- Export settings: glTF 2.0 binary, Y up, modifiers applied, selection only, no cameras/lights/texcoords/attributes, PBR materials (emissive via `KHR_materials_emissive_strength` for the lamp glass and beacon).
- Residual privileges: the scripts run with the invoking user's file permissions (bpy can read/write any path a script names). The scripts are small, reviewed, committed and never generated at runtime; no listener, socket, add-on, environment variable or Claude configuration is involved.

## Vetting record: Blender MCP (NOT installed)

- Canonical repository inspected: https://github.com/ahujasid/mcp-for-blender (formerly `blender-mcp`; the old URL redirects), licence MIT, ~29.9k stars, 41 open issues, last push 2026-09-30, `main` at commit `60d2a31b4632a7bc178f3dd636f7e68dfb5c8ae4`. Read-only inspection of `src/blender_mcp/server.py` (2577 lines); no code from it was executed or installed.
- Tools and paths found: `execute_blender_code` (arbitrary Python through a local socket; an optional AST-based safe mode, which is not an OS sandbox and cannot confine `bpy` file operations), viewport screenshot/capture/pick, Hunyuan3D job tools, trajectory feedback, telemetry (including a screenshot upload path when consent is on, with a `disable_telemetry` tool), plus Poly Haven / Sketchfab / Hyper3D integrations that reach external services.
- Decision: **not installed.** The attack surface (general code execution through a socket, telemetry/upload code, external service integrations, a Blender add-on listener) outweighs the benefit for this slice, and the scripted CLI workflow covers inspection, mesh creation, origins/scales, materials, optimisation and GLB export with a smaller privilege footprint. If MCP is ever wanted: pin the inspected commit, bind to loopback only, disable telemetry and cloud integrations, keep safe mode on, scope the project config to this repository, and re-vet the installer, add-on and dependency tree first.
- Removal: nothing to remove. `claude mcp list` shows no Blender entry; no Claude or cswap configuration was changed.

## Installed skill used as reference (blender-web-3d)

- Plugin `blender-web-3d` v2.0.0, git commit `858762f1add7f1d9f5dcb1fb1d0b55f71906bf0d`, loaded as the Claude skill `blender-web-3d:blender-web-3d` (a user-level plugin; nothing was added to this repository or to MCP/permission settings). Its own text says headless CLI is the default and the MCP path needs a live GUI session, which matches the choice above.
- Adopted ideas (re-written, not copied): versioned reviewed scripts that print one report line, headless run with `--factory-startup`, material/pivot names as the model-to-code contract, PNG previews to check geometry (`tools/assets/preview.py`, Workbench engine), `merge by material` plus `transform_apply` before export to cut draw calls.
- NOT adopted: its Vite viewer template, Meshopt/KTX2/WebP optimiser, custom shaders and Cycles beauty renders. The colony pack is texture-free flat colour and 221 KB, so extra compression and decoders would add dependencies and CSP surface for no measured gain. No package was added to `package.json`.
- Export/readback smoke: `node tools/assets/build.mjs` (works from any cwd; it moves to the project root itself) -> four GLBs -> `world/public/models/colony-pack.glb` -> `node tools/assets/validate.mjs` (per-asset triangles, material slots, bounds, base at y 0, no textures; exit 1 on any violation, report `docs/qa-captures/asset-validation.json`, currently `problems: []`) -> loaded in the world by `useGLTF` and checked in `tools/qa/building-check.mjs` and the slice captures.
- Reproducibility: structure is identical across rebuilds (glTF JSON chunk byte-equal, same length) but the binary buffer is not byte-identical between two Blender runs (vertex order); do not rely on file hashes as a build check, rely on `validate.mjs`.
- `__pycache__/` and `*.pyc` are git-ignored.
