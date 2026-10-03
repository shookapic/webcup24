// Small registry of authored environment assets. Semantic ids -> where the model lives and how to calibrate it. Placement, colliders, seat anchors,
// service codes and interaction data stay in layout.js (readable code), never inside the GLB.
// Models travel in packs (one request for many assets, see tools/pack-models.mjs); `node` is the node name inside the pack.
const base = import.meta.env.BASE_URL;

export const packs = {
  colony: `${base}models/colony-pack.glb`, // tools/assets/build.mjs: Blender scripts -> world/assets-src/colony/*.glb -> this pack
};

// Calibration: metres, Y up, origin at the centre of the base on the ground, front = +Z. `scale` multiplies the native size.
// `variants` recolour materials by name (shared per id + variant, never mutating the cached glTF).
export const assets = {
  townHall: {
    pack: 'colony', node: 'townHall', scale: 1, source: 'tools/assets/townhall.py',
    budget: { triangles: 2336, note: 'landmark: <= 30k' },
  },
  streetLamp: {
    pack: 'colony', node: 'streetLamp', scale: 1, source: 'tools/assets/lamp.py',
    budget: { triangles: 460, note: 'small prop: <= 3k' },
    glow: ['lampGlass'], // emissive materials stay un-tonemapped so the restrained amber glow is not washed out
  },
  bench: {
    pack: 'colony', node: 'bench', scale: 1, source: 'tools/assets/bench.py',
    budget: { triangles: 496, note: 'small prop: <= 3k; seat top 0.56 m, back at local -z, matches layout.js seats' },
  },
  colonyTree: {
    pack: 'colony', node: 'colonyTree', scale: 1, source: 'tools/assets/tree.py',
    budget: { triangles: 416, note: 'small prop: <= 3k' },
    variants: { warm: { foliage: '#c98a4a' }, green: { foliage: '#688c73' } },
  },
};
