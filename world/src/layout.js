// Shared world data: collision footprints, stops, pedestrian network, player position.
// Footprints are solid buildings only (world metres, y up from the ground). Paths, windows, rings, rocks and the pond have no collider.
// Keep in sync with Plaza.jsx / City.jsx until the other districts are rebuilt from kit pieces (B2).
export const footprints = [
  // Mairie (Plaza.jsx): central hall, two wings, canopy pillars
  { shape: 'box', x: 0, z: -27, w: 19.6, d: 17, h: 8.4 },
  { shape: 'box', x: -16.5, z: -26, w: 8, d: 12, h: 4 },
  { shape: 'box', x: 16.5, z: -26, w: 8, d: 12, h: 4 },
  ...[[-2.6, -14.2], [2.6, -14.2], [-2.6, -18.8], [2.6, -18.8]].map(([x, z]) => ({ shape: 'box', x, z, w: 0.9, d: 0.9, h: 4 })),
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
export const SPAWN = [0, 3, 4];

// Meshes the camera must not pass through (filled by PlayableCity's Footprints).
export const cameraBlockers = [];

// Tram/bus stops. Names and districts are the API contract (CLAUDE.md); positions sit on the path network.
export const stops = [
  { name: 'Mairie', district: 'Centre-ville', x: 5, z: -12 },
  { name: 'Santé', district: 'Quartier est', x: 26, z: -1 },
  { name: 'Marché', district: 'Quartier ouest', x: -24, z: 2 },
  { name: 'Habitat', district: 'Quartier nord', x: -14, z: -30 },
  { name: 'Quartier sud', district: 'Quartier sud', x: 4, z: 30 },
];

// Written by Player every frame, read by App (nearest stop, HUD district). Not React state on purpose.
export const playerPos = { x: SPAWN[0], z: SPAWN[2] };

export function nearestStop({ x, z }) {
  let best = stops[0];
  for (const stop of stops) if (Math.hypot(stop.x - x, stop.z - z) < Math.hypot(best.x - x, best.z - z)) best = stop;
  return best;
}

// Pedestrian network shared by NPC routes (Npcs.jsx). Nodes sit on the paths, clear of every footprint.
export const pathNodes = {
  center: [0, -3],
  mairie: [0, -12],
  sante: [24, -3],
  marche: [-24, -1],
  sud: [0, 30],
  sudEst: [8, 32],
  sudOuest: [-8, 32],
  plazaE: [10, -8],
  plazaW: [-10, -8],
  habitatPath: [-8, -14],
  habitat: [-19, -31],
};
export const pathLinks = {
  center: ['mairie', 'sante', 'marche', 'sud', 'plazaE', 'plazaW'],
  mairie: ['center', 'plazaE', 'plazaW'],
  plazaE: ['mairie', 'center'],
  plazaW: ['mairie', 'center', 'habitatPath'],
  sante: ['center'],
  marche: ['center'],
  sud: ['center', 'sudEst', 'sudOuest'],
  sudEst: ['sud'],
  sudOuest: ['sud'],
  habitatPath: ['plazaW', 'habitat'],
  habitat: ['habitatPath'],
};
