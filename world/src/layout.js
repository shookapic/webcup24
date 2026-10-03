import { measure, sample, smoothPath } from './rail.js';

// Single source of truth for the colony: buildings (render + collision), roads, stops, tram route, NPC network, labels.
// World metres, y up, +z south (towards the spawn), Mairie to the north. Kit pieces are tiny, so every building lists its scale.

// Bounding sizes [w, h, d] of the kit pieces we use (unscaled), measured from the glb accessors.
export const kitSize = {
  hangar_roundGlass: [3.27, 1.4, 2.83], hangar_roundA: [3.27, 1.5, 2.83], hangar_roundB: [3.27, 1.8, 2.83],
  hangar_largeA: [2, 1, 3], hangar_largeB: [2.2, 1.1, 3], hangar_smallA: [2, 1, 2], hangar_smallB: [2, 1, 2],
};

// Rotation `ry` must be a multiple of PI/2 so the footprint box stays axis aligned. ry 0 = doors face +z (south).
// `scale` is uniform. `variant` recolours the terracotta accent (kit.jsx).
const B = (model, x, z, scale, ry = 0, variant, extra = {}) => ({ model, x, z, scale, ry, variant, ...extra });
export const buildings = [
  // Mairie: glazed round hall, two wings
  B('hangar_roundGlass', 0, -27, 6),
  B('hangar_largeA', -16.5, -26, 4),
  B('hangar_largeA', 16.5, -26, 4),
  // Santé (east): main clinic, two annexes, teal accent
  B('hangar_roundA', 40, -6, 4.5, -Math.PI / 2, 'sante', { cross: true }),
  B('hangar_largeB', 40, -20, 3.5, -Math.PI / 2, 'sante'),
  B('hangar_smallA', 40, 9, 4, -Math.PI / 2, 'sante'),
  // Marché (west): six booths on either side of a central aisle (awnings in Districts.jsx)
  ...[-47, -40, -33].map((x) => B('hangar_smallB', x, -9, 2.4, 0, 'marche', { booth: 1 })),
  ...[-47, -40, -33].map((x) => B('hangar_smallB', x, 4.5, 2.4, Math.PI, 'marche', { booth: -1 })),
  // Habitat (north-west): two rows of modules facing a lane, gardens in front
  ...[-51, -44, -37].map((x) => B('hangar_smallA', x, -38.5, 3.5, 0, 'habitat', { garden: 1 })),
  ...[-51, -44].map((x) => B('hangar_smallA', x, -25.5, 3.5, Math.PI, 'habitat', { garden: -1 })),
  // Quartier sud: homes by the water
  B('hangar_roundA', -14, 36, 2.6, 0, 'sud'),
  B('hangar_roundA', -23, 41, 2.6, 0, 'sud'),
  B('hangar_smallA', -16, 49, 3, 0, 'sud'),
  B('hangar_smallA', 24, 38, 3, 0, 'sud'),
  B('hangar_roundA', 31, 46, 2.6, 0, 'sud'),
];

// Axis-aligned collision box of a building.
export function footprintOf(b) {
  const [w, h, d] = kitSize[b.model];
  const turned = Math.round(Math.abs(b.ry) / (Math.PI / 2)) % 2 === 1;
  return { shape: 'box', x: b.x, z: b.z, w: (turned ? d : w) * b.scale, d: (turned ? w : d) * b.scale, h: h * b.scale };
}

// Extra solid things that are not kit buildings: Mairie canopy pillars.
const pillars = [[-2.6, -14.2], [2.6, -14.2], [-2.6, -18.8], [2.6, -18.8]].map(([x, z]) => ({ shape: 'box', x, z, w: 0.9, d: 0.9, h: 4 }));

// Elevated tram: two lines on separate guideways (T2 rides 3.2 m above T1 where they cross at (-28, -13)). Cosmetic: not
// synchronised with the timetable API (the phone and QA say so). `points` are the corner points, `path` the rounded rail.
export const lines = {
  T1: { color: '#b8336a', y: 6, stops: ['Habitat', 'Mairie', 'Quartier sud'], points: [[-30, -32], [-30, -13], [14, -13], [14, 32]] },
  T2: { color: '#1d6fa5', y: 9.2, stops: ['Marché', 'Mairie', 'Santé'], points: [[-28, 1.5], [-28, -16], [28, -16], [28, 1.5]] },
};
for (const line of Object.values(lines)) line.path = smoothPath(line.points);
// Stops (API names/districts): `x,z` = ground shelter, `track` = point on each serving line's rail, `facing` = shelter front.
export const stops = [
  { name: 'Mairie', district: 'Centre-ville', x: 7, z: -10, track: { T1: [7, -13], T2: [7, -16] }, facing: 0 },
  { name: 'Santé', district: 'Quartier est', x: 28, z: 0.5, track: { T2: [28, 1.5] }, facing: -Math.PI / 2 },
  { name: 'Marché', district: 'Quartier ouest', x: -28, z: 0.5, track: { T2: [-28, 1.5] }, facing: Math.PI / 2 },
  { name: 'Habitat', district: 'Quartier nord', x: -30, z: -30, track: { T1: [-30, -32] }, facing: Math.PI / 2 },
  { name: 'Quartier sud', district: 'Quartier sud', x: 14, z: 30, track: { T1: [14, 32] }, facing: -Math.PI / 2 },
];
// Support columns along each rail (about every 12 m, always at both ends). Each has its own height (the rail's).
export const supports = Object.entries(lines).flatMap(([code, line]) => {
  const cum = measure(line.path);
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / 12));
  return Array.from({ length: n + 1 }, (_, k) => {
    const at = sample(line.path, cum, (total * k) / n);
    return { code, x: Math.round(at.x * 2) / 2, z: Math.round(at.z * 2) / 2, y: line.y };
  });
});

export const footprints = [...buildings.map(footprintOf), ...pillars, ...supports.map(({ x, z, y }) => ({ shape: 'box', x, z, w: 0.7, d: 0.7, h: y }))];

// Roads [cx, cz, w, d] (w along x, d along z); drawn as paving and walked by the NPC graph below.
export const roads = [
  [0, -11, 4, 16], [15, -3, 30, 5], [-22, -3, 44, 5], [0, 22, 5, 44],
  [-21, -11.5, 18, 4], [-30, -22.5, 4, 19], [-39, -32, 26, 5], [-38, -2.5, 20, 5],
  [29, -3, 4, 12],
];

export const BOUNDS = 75; // half-size of the playable square; walls stand on it and leaving it respawns
export const SPAWN = [0, 3, 1];

// Meshes the camera must not pass through (filled by PlayableCity's Footprints).
export const cameraBlockers = [];

// Written by Player every frame, read by App (nearest stop, HUD district). Not React state on purpose.
export const playerPos = { x: SPAWN[0], z: SPAWN[2] };

export function nearestStop({ x, z }) {
  let best = stops[0];
  for (const stop of stops) if (Math.hypot(stop.x - x, stop.z - z) < Math.hypot(best.x - x, best.z - z)) best = stop;
  return best;
}

// Pedestrian network (NPC routes). Nodes sit on the roads, clear of every footprint.
export const pathNodes = {
  center: [0, -3],
  mairie: [0, -13],
  plazaE: [10, -8],
  plazaW: [-10, -8],
  east: [15, -3],
  sante: [28, -3],
  west: [-14, -3],
  marche: [-27, -3],
  marcheW: [-40, -3],
  link: [-22, -11],
  habitatJ: [-30, -13],
  habitatLane: [-30, -31],
  habitatW: [-45, -32],
  sud1: [0, 14],
  sud2: [0, 28],
  sudWater: [0, 42],
};
export const pathLinks = {
  center: ['mairie', 'plazaE', 'plazaW', 'east', 'west', 'sud1'],
  mairie: ['center', 'plazaE', 'plazaW'],
  plazaE: ['mairie', 'center'],
  plazaW: ['mairie', 'center', 'link'],
  east: ['center', 'sante'],
  sante: ['east'],
  west: ['center', 'marche'],
  marche: ['west', 'marcheW'],
  marcheW: ['marche'],
  link: ['plazaW', 'habitatJ'],
  habitatJ: ['link', 'habitatLane'],
  habitatLane: ['habitatJ', 'habitatW'],
  habitatW: ['habitatLane'],
  sud1: ['center', 'sud2'],
  sud2: ['sud1', 'sudWater'],
  sudWater: ['sud2'],
};

// DOM labels over the districts (Labels.jsx). The playable area is flat, so plain projection.
export const districts = [
  { name: 'Mairie', position: [0, 12, -27] },
  { name: 'Santé', position: [40, 9, -6] },
  { name: 'Quartier sud', position: [0, 7, 44] },
  { name: 'Marché', position: [-40, 6, -2] },
  { name: 'Habitat', position: [-44, 7, -32] },
];
