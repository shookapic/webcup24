// Collision footprints of the solid buildings (world metres, y up from the ground). Paths, windows, rings,
// rocks and the pond have no collider. Keep in sync with City.jsx until B1 replaces it with authored assets.
export const footprints = [
  // Mairie: tower + dome
  { shape: 'box', x: 0, z: -22, w: 6, d: 6, h: 22 },
  { shape: 'cyl', x: 0, z: -22, r: 7, h: 7 },
  // Santé: dome + annex
  { shape: 'cyl', x: 32, z: -6, r: 6, h: 6 },
  { shape: 'box', x: 39, z: -3, w: 6, d: 4, h: 3 },
  // Quartier sud: five small domes
  ...[[-8, 36], [-2, 41], [5, 37], [10, 42], [-12, 44]].map(([x, z]) => ({ shape: 'cyl', x, z, r: 2.4, h: 2.4 })),
  // Marché: four stalls
  ...[[-35, -5], [-29, -5], [-35, 1], [-29, 1]].map(([x, z]) => ({ shape: 'box', x, z, w: 4, d: 3, h: 2.6 })),
  // Habitat: three blocks
  { shape: 'box', x: -24, z: -40, w: 6, d: 6, h: 8 },
  { shape: 'box', x: -16, z: -38, w: 5, d: 5, h: 12 },
  { shape: 'box', x: -31, z: -37, w: 7, d: 5, h: 6 },
];

export const BOUNDS = 75; // half-size of the playable square; walls stand on it and leaving it respawns
export const SPAWN = [0, 3, 8];

// Meshes the camera must not pass through (filled by PlayableCity's Footprints).
export const cameraBlockers = [];
