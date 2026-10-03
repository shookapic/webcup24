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
  // Santé (east): main clinic, two annexes, teal accent
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

// Authored landmarks (tools/assets/*.py -> models/colony-pack.glb): same placement conventions, collision listed explicitly below.
// townHall: hall + two wings + canopy on four pillars; its model is built to these footprints (tools/qa/building-check.mjs verifies).
export const landmarks = [{ id: 'townHall', x: 0, z: -27, ry: 0 }, { id: 'hospital', x: 40, z: -6, ry: -Math.PI / 2 }];
const townHallFootprints = [
  { shape: 'box', x: 0, z: -27, w: 19.6, d: 17, h: 8.4 },
  { shape: 'box', x: -16.5, z: -26, w: 8, d: 12, h: 4 },
  { shape: 'box', x: 16.5, z: -26, w: 8, d: 12, h: 4 },
].map((f) => ({ ...f, landmark: 'townHall' }));

// Boxes given in the model's local frame (x right, z front, metres; x0..x1, z0..z1, base y, height h) -> world footprints for a landmark placed at
// (x, z) with yaw ry (multiple of PI/2). `y` lifts a box off the ground (overhead parts); omitted = on the ground. `thin` = blocks the player, not the camera.
function landmarkFootprints(l, boxes) {
  const c = Math.round(Math.cos(l.ry)), s = Math.round(Math.sin(l.ry));
  return boxes.map(({ x0, x1, z0, z1, y = 0, h, thin }) => {
    const lx = (x0 + x1) / 2, lz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    const turned = s !== 0;
    return { shape: 'box', x: l.x + lx * c + lz * s, z: l.z - lx * s + lz * c, w: turned ? d : w, d: turned ? w : d, h, ...(y ? { y } : {}), ...(thin ? { thin } : {}), landmark: l.id };
  });
}
// Santé clinic (tools/assets-a/hospital, measured from hospital-a-v001.glb; docs/ASSET_HANDOFF_A.md). Explicit compound collision, not one solid box:
// the recessed entrance porch (x +-2.2, z 4.5675..6.2175) stays open at ground level so the doors are reachable from outside.
const hospitalFootprints = landmarkFootprints(landmarks[1], [
  { x0: 2.85, x1: 7.2075, z0: -6.2175, z1: 5.2, h: 6 },            // east wing
  { x0: -7.2075, x1: -2.85, z0: -6.2175, z1: 5.2, h: 6 },          // west wing
  { x0: -2.85, x1: 2.85, z0: -6.2175, z1: 4.5675, h: 6.25 },       // central block behind the porch (doors on its face)
  { x0: 2.2, x1: 2.85, z0: 4.5675, z1: 6.2175, h: 6.25 },          // porch pier
  { x0: -2.85, x1: -2.2, z0: 4.5675, z1: 6.2175, h: 6.25 },        // porch pier
  { x0: -2.2, x1: 2.2, z0: 4.5675, z1: 6.2175, y: 2.85, h: 3.4 },  // canopy soffit and upper block over the porch; underside 0.1 m below the visual soffit (2.95) so a jump never clips the model
  { x0: -2.1, x1: 2.1, z0: 4.5675, z1: 5.2, h: 0.35, thin: true },   // step B (door sill level)
  { x0: -2.1, x1: 2.1, z0: 5.2, z1: 5.8, h: 0.24, thin: true },     // step A
]);

// Street lamps (instanced, thin collider): plaza ring and both sides of the south avenue.
export const lamps = [[-12.5, -6.5], [12.5, -6.5], [-7.5, -14], [7.5, -14], [4.5, 12.5], ...[20, 28, 36, 44].flatMap((z) => [[4.5, z], [-4.5, z]])];

// Axis-aligned collision box of a building.
export function footprintOf(b) {
  const [w, h, d] = kitSize[b.model];
  const turned = Math.round(Math.abs(b.ry) / (Math.PI / 2)) % 2 === 1;
  return { shape: 'box', x: b.x, z: b.z, w: (turned ? d : w) * b.scale, d: (turned ? w : d) * b.scale, h: h * b.scale };
}

// Extra solid things that are not kit buildings: Mairie canopy pillars.
const pillars = [[-2.6, -14.2], [2.6, -14.2], [-2.6, -18.8], [2.6, -18.8]].map(([x, z]) => ({ shape: 'box', x, z, w: 0.9, d: 0.9, h: 4, thin: true }));

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

// Streetscape ---------------------------------------------------------------------------------------------------------
export const PLAZA = { x: 0, z: -3, r: 16 }; // paved round plaza; roads end at its rim
export const SIDEWALK = 1.8; // pedestrian strip on each side of a road

// Marked crossings: a strip across a road; stripes run along the road direction (`along`) and repeat across `span`.
export const crossings = [
  { x: 18.2, z: -3, along: 'x', span: 5 }, { x: -18.2, z: -3, along: 'x', span: 5 }, { x: 0, z: 15.2, along: 'z', span: 5 },
  { x: 24, z: -3, along: 'x', span: 5 }, { x: -30, z: -20, along: 'z', span: 4 }, { x: -21, z: -11.5, along: 'x', span: 4 },
];

// Trees (trunk collision only): kit model, position, scale, yaw. Autumn leaves keep the warm palette.
const T = (model, x, z, s = 3.4, ry = 0) => ({ model, x, z, s: s * 0.74, ry });
const ringAngles = [35, 60, 120, 145, 215, 240, 300, 325];
export const trees = [
  // plaza ring, skipping the four road arms
  ...ringAngles.map((deg, i) => ({ model: 'colonyTree', variant: i % 2 ? 'green' : 'warm', x: PLAZA.x + 14.6 * Math.cos((deg * Math.PI) / 180), z: PLAZA.z + 14.6 * Math.sin((deg * Math.PI) / 180), s: 0.95 + (i % 3) * 0.12, ry: i })),
  // south avenue, both sidewalks
  ...[18, 26, 34, 42].flatMap((z, i) => [T(i % 2 ? 'tree_thin' : 'tree_oak_fall', 3.9, z, 4.5, i), T(i % 2 ? 'tree_oak_fall' : 'tree_thin', -3.9, z + 4, 4.5, i + 2)]),
  // east / west avenues
  T('tree_default_fall', 21, -6.9, 4.6), T('tree_oak_fall', 26, 0.9, 4.4, 1), T('tree_default_fall', -21, -6.9, 4.6, 2), T('tree_oak_fall', -25, 0.9, 4.4, 3),
  // Mairie forecourt, Santé shade, Marché ends, Habitat lane, Quartier sud
  T('tree_fat_fall', -17, -15.5, 4.5), T('tree_fat_fall', 17, -15.5, 4.5, 1),
  T('tree_oak_fall', 31, -12, 4.6), T('tree_default_fall', 31, 9, 4.6, 2),
  T('tree_oak_fall', -55, -2, 4.4), T('tree_default_fall', -24, -9, 4.4, 1),
  T('tree_thin', -34, -29, 4.2),
  T('tree_fat_fall', -8, 40, 4.6), T('tree_oak_fall', 8, 44, 4.4, 1), T('tree_default_fall', -20, 34, 4.4, 2), T('tree_fat_fall', 21, 42, 4.6, 3), T('tree_oak_fall', 28, 34, 4.4, 1),
];

// Benches: `ry` multiple of PI/2, sitters face (sin ry, cos ry). Two seats per bench; seats are the NPC sit targets (Npcs.jsx).
export const benches = [
  { x: -8.5, z: -2, ry: Math.PI / 2 }, { x: 8.5, z: -2, ry: -Math.PI / 2 }, { x: -5, z: 4.5, ry: Math.PI }, { x: 5, z: 4.5, ry: Math.PI },
  { x: -4, z: 47.2, ry: 0 }, { x: 4, z: 47.2, ry: 0 }, { x: 31.5, z: -6, ry: -Math.PI / 2 }, { x: -26, z: -6.5, ry: 0 }, { x: -36, z: -27.2, ry: Math.PI },
];
// Seat centre = hip position of a seated colonist (0.1 m in front of the backrest); `approach` = where the walker stands first.
export const seats = benches.flatMap((b, bi) => [-0.55, 0.55].map((o) => {
  const f = [Math.sin(b.ry), Math.cos(b.ry)];
  const right = [f[1], -f[0]];
  return { bench: bi, x: b.x + right[0] * o - f[0] * 0.1, z: b.z + right[1] * o - f[1] * 0.1, ry: b.ry, f, approach: [b.x + right[0] * o + f[0] * 0.8, b.z + right[1] * o + f[1] * 0.8] };
}));

// Planting beds (bushes, flowers, grass scattered deterministically inside each, plus a stone border).
export const beds = [
  [-11, -8, 1.5], [11, -8, 1.5], [-12, 3, 1.5], [12, 3, 1.5], [-4.5, -12.5, 1.3], [4.5, -12.5, 1.3],
  [-7, -16, 1.7], [7, -16, 1.7],
  [-27, 6, 1.4], [34, -14.5, 1.5], [34, 12, 1.5],
  [-52.5, -6, 1.4], [-52.5, 2.5, 1.4],
  [-14, 32, 1.4], [14, 36, 1.4], [-6, 46, 1.6], [6, 46, 1.6], [-20, 44, 1.5], [22, 33, 1.4],
  [-47, -20.5, 1.4], [-40, -20.5, 1.4], [-26, -38, 1.3],
];

export const footprints = [...buildings.map(footprintOf), ...townHallFootprints, ...hospitalFootprints, ...lamps.map(([x, z]) => ({ shape: 'box', x, z, w: 0.4, d: 0.4, h: 4, thin: true })), ...pillars, ...benches.map((b) => { const turned = Math.round(Math.abs(b.ry) / (Math.PI / 2)) % 2 === 1; return { shape: 'box', x: b.x, z: b.z, w: turned ? 0.6 : 2.2, d: turned ? 2.2 : 0.6, h: 0.9, thin: true }; }), ...trees.map(({ x, z }) => ({ shape: 'box', x, z, w: 0.5, d: 0.5, h: 3, thin: true })), ...supports.map(({ x, z, y }) => ({ shape: 'box', x, z, w: 0.7, d: 0.7, h: y, thin: true }))];

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
  plazaE: [8, -8],
  plazaW: [-8, -8],
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
  { name: 'Mairie', position: [0, 16, -27] },
  { name: 'Santé', position: [40, 9, -6] },
  { name: 'Quartier sud', position: [0, 7, 44] },
  { name: 'Marché', position: [-40, 6, -2] },
  { name: 'Habitat', position: [-44, 7, -32] },
];
