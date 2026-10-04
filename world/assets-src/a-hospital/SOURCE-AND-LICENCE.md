# hospital-a-v001: source and licence evidence

- **Source**: authored from scratch for this project, procedurally, in Blender 5.2.2 LTS (build 2026-09-15, hash d13f752e3b9c) by
  `tools/assets-a/hospital/build_hospital.py`. No third-party model, texture, font or script was inspected, downloaded, imported or
  copied. The Kenney Space Kit hangar (`hangar_roundA`) is used only as a size/orientation reference (footprint and entrance direction read
  from `world/src/layout.js`); none of its geometry is reused.
- **Colours**: the hex values of B's committed palette (`world/src/kit.jsx`: chalk, slate, terracotta, teal, window glass, paved) are reused
  as plain colour values. Colours are not copyrightable material.
- **Licence**: original work of this project (Terra Nova, 24H By Webcup 2026). It may be used, modified and redistributed with the project;
  no attribution to a third party is required, so nothing needs adding to `ATTRIBUTION.md`.
- **Modifications**: not applicable (no source asset). Version history: v001 only; the previous iterations were never committed.
- **Reproduce**: see `docs/ASSET_HANDOFF_A.md` (build, export, validate, capture commands). The `.blend` is kept so the GLB is not opaque.
- **Third-party tools used**: Blender (GPL, not redistributed), puppeteer-core and three.js/vite/react (already project dependencies) for the
  isolated preview and captures.
