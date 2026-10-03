// Independent check of a GLB (Node built-ins only): reads the file itself, not the .blend, and writes a manifest with two separate parts.
//   node tools/qa-a-assets/validate-glb.mjs world/public/models/buildings/hospital-a-v001.glb world/assets-src/a-hospital/hospital-a-v001.manifest.json
// MEASURED from the GLB on every run: node tree, meshes, materials (names, emissive), textures/images/samplers (counts), external URIs,
// extensions, vertex and triangle counts, world-space bounds (accessor min/max through the node transforms), file and gzip size.
// DECLARED (not recoverable from the GLB; typed in below as inputs): the collision box, the front direction, the door anchor, the main mass
// top and the world placement. They come from the authoring script and from B's layout, and were only checked visually against the captures.
// "comparisons" are computed from both parts, and every boolean in them is taken from a check result, never hard-coded.
// File access: reads the GLB path it is given (read-only); writes only the manifest, and only to
// <checkout>/world/assets-src/a-hospital/hospital-a-<version>.manifest.json (resolved-path check, not an OS sandbox; --no-write skips it).
import { readFileSync, writeFileSync, realpathSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const [file, outFile, ...flags] = process.argv.slice(2);
if (!file) { console.error('usage: validate-glb.mjs file.glb [manifest.json] [--no-write]'); process.exit(2); }
const sameDir = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const manifestTarget = (target) => {
  const checkout = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
  const area = realpathSync(join(checkout, 'world', 'assets-src', 'a-hospital'));
  const asked = resolve(target);
  const parent = existsSync(dirname(asked)) ? realpathSync(dirname(asked)) : null;
  const name = basename(asked);
  if (!parent || !sameDir(parent, area) || !/^hospital-a-[A-Za-z0-9][A-Za-z0-9._-]*\.manifest\.json$/.test(name)) {
    throw new Error(`path guard: the manifest must be hospital-a-<version>.manifest.json directly inside ${area} (got ${asked})`);
  }
  if (existsSync(asked) && !statSync(asked).isFile()) throw new Error(`path guard: ${asked} is not a regular file`);
  return join(area, name);
};
let manifestPath = null;
if (outFile && !flags.includes('--no-write')) {
  try { manifestPath = manifestTarget(outFile); } catch (e) { console.error(e.message); process.exit(2); }   // before anything is read or written
}
const buffer = readFileSync(file);
if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : String(detail) }); if (!ok) process.exitCode = 1; return Boolean(ok); };

const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return r; };
const fromTRS = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0, (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0, (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
};
const local = (n) => n.matrix ?? fromTRS(n.translation, n.rotation, n.scale);
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
let triangles = 0, vertices = 0, meshNodes = 0;
const perMaterial = {};
const walk = (index, parent) => {
  const node = gltf.nodes[index];
  const world = mul(parent, local(node));
  if (node.mesh !== undefined) {
    meshNodes++;
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const pos = gltf.accessors[prim.attributes.POSITION];
      const count = gltf.accessors[prim.indices]?.count ?? pos.count;
      triangles += count / 3; vertices += pos.count;
      const name = gltf.materials[prim.material ?? 0]?.name ?? '(default)';
      perMaterial[name] = (perMaterial[name] ?? 0) + count / 3;
      for (const x of [pos.min[0], pos.max[0]]) for (const y of [pos.min[1], pos.max[1]]) for (const z of [pos.min[2], pos.max[2]]) {
        const p = apply(world, [x, y, z]);
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
      }
    }
  }
  for (const child of node.children ?? []) walk(child, world);
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rootsIdx = gltf.scenes[gltf.scene ?? 0].nodes;
for (const r of rootsIdx) walk(r, identity);

const round = (v) => Math.round(v * 10000) / 10000;
const bounds = { min: lo.map(round), max: hi.map(round), size: hi.map((v, i) => round(v - lo[i])), centre: hi.map((v, i) => round((v + lo[i]) / 2)) };
const gz = gzipSync(buffer, { level: 9 }).length;
// DECLARED contract inputs (see the header): not read from the GLB, not read from world/src/layout.js by this script.
const DECLARED = {
  footW: 14.715, footD: 12.735, collisionH: 6.75,          // hangar_roundA kit size [3.27, 1.5, 2.83] x 4.5, as footprintOf turns it
  mainMassTop: 6.7,                                         // authoring script: parapet top of the two-storey mass
  doorLocal: [0, 0.35, 4.5675], approachZ: 6.3675,          // authoring script: door centre at the back of the porch; footprint edge at z
  place: { x: 40, z: -6, ry: -Math.PI / 2, scale: 1 },     // B's layout entry for the Santé clinic
};
const foot = { w: DECLARED.footW, d: DECLARED.footD };
const roots = rootsIdx.map((i) => gltf.nodes[i].name);

check('one scene root named "hospital" (the registry key)', roots.length === 1 && roots[0] === 'hospital', roots.join(','));
check('no textures, no images, no samplers (constant-colour materials only)', !(gltf.textures?.length || gltf.images?.length || gltf.samplers?.length));
check('no external URI: the only buffer is the GLB binary chunk', (gltf.buffers ?? []).every((b) => b.uri === undefined) && (gltf.images ?? []).every((i) => i.uri === undefined));
check('no cameras, lights, animations, skins', !(gltf.cameras?.length || gltf.animations?.length || gltf.skins?.length) && !JSON.stringify(gltf).includes('KHR_lights_punctual'));
check('extensions are only core PBR add-ons (emissive strength allowed), nothing that needs a decoder', (gltf.extensionsUsed ?? []).every((e) => ['KHR_materials_emissive_strength'].includes(e)) && !(gltf.extensionsRequired?.length), (gltf.extensionsUsed ?? []).join(','));
check('no custom authoring metadata (extras) and no gameplay, service or interaction data in any node, mesh or material name', !JSON.stringify(gltf).includes('"extras"') && !/service|stop|interact|trigger|collider|door_anchor/i.test([...gltf.nodes, ...gltf.meshes, ...gltf.materials].map((x) => x.name ?? '').join(' ')));
check('every mesh is non-empty and every material has a stable Hospital_* name', gltf.meshes.every((m) => m.primitives.length > 0) && gltf.materials.every((m) => /^Hospital_[A-Za-z]+$/.test(m.name)), gltf.materials.map((m) => m.name).join(','));
const footprintMatches = check('measured footprint equals the declared collision box exactly (14.715 x 12.735 m, tolerance 1 mm)', Math.abs(bounds.size[0] - foot.w) < 1e-3 && Math.abs(bounds.size[2] - foot.d) < 1e-3, JSON.stringify(bounds.size));
const insideFootprint = check('every vertex lies inside the declared footprint (nothing projects beyond it)', lo[0] >= -foot.w / 2 - 1e-3 && hi[0] <= foot.w / 2 + 1e-3 && lo[2] >= -foot.d / 2 - 1e-3 && hi[2] <= foot.d / 2 + 1e-3, JSON.stringify(bounds));
check('origin is the centre of the ground footprint at y = 0', Math.abs(bounds.centre[0]) < 1e-3 && Math.abs(bounds.centre[2]) < 1e-3 && Math.abs(bounds.min[1]) < 1e-3, JSON.stringify(bounds));
check('triangle budget: below 20k (landmark target 5-20k)', triangles < 20000, triangles);
check('material slots are modest (8 or fewer) and meshes are merged per material', gltf.materials.length <= 8 && meshNodes <= 8, `${gltf.materials.length} materials, ${meshNodes} mesh nodes`);
// raw size is dominated by flat-shaded boxes (24 vertices each); the server gzips .glb, so the wire size is what the budget applies to
check('size budget: under 400 KB raw and under 100 KB gzipped', buffer.length < 400 * 1024 && gz < 100 * 1024, `${buffer.length} raw, ${gz} gzip`);

const door = DECLARED.doorLocal;
const manifest = {
  schema: 2,
  asset: 'hospital-a-v001', file,
  readMe: 'measuredFromGlb is computed from the GLB file by this script on every run. declaredContract is NOT recovered from the GLB: it is the authoring and integration contract, typed into the validator as inputs. comparisons are computed from both, and each boolean is taken from a check result.',
  measuredFromGlb: {
    generator: gltf.asset?.generator, glTF: gltf.asset?.version, sceneRoots: roots, meshNodes,
    materials: gltf.materials.map((m) => ({ name: m.name, baseColor: m.pbrMetallicRoughness?.baseColorFactor?.map((c) => round(c)), roughness: m.pbrMetallicRoughness?.roughnessFactor, metallic: m.pbrMetallicRoughness?.metallicFactor, emissive: m.emissiveFactor, emissiveStrength: m.extensions?.KHR_materials_emissive_strength?.emissiveStrength })),
    triangles, vertices, trianglesPerMaterial: Object.fromEntries(Object.entries(perMaterial)),
    textures: gltf.textures?.length ?? 0, images: gltf.images?.length ?? 0, samplers: gltf.samplers?.length ?? 0,
    extensionsUsed: gltf.extensionsUsed ?? [], bytes: buffer.length, gzipBytes: gz,
    bounds,
  },
  declaredContract: {
    status: "declared in tools/assets-a/hospital/build_hospital.py and B's layout, then checked by eye in docs/qa-captures/a-hospital (front.png, human-entrance.png, fit-footprint.png); not stored in the GLB and not recoverable from its anonymous geometry",
    axes: 'glTF: +Y up, +Z front (entrance side), metres, scale 1. The front direction is a declaration (set by the export axes in the scripts) confirmed visually; this script cannot derive it',
    origin: 'centre of the ground footprint, y = 0 (convention; the measured bounds are checked against it)',
    collisionBox: { width: DECLARED.footW, depth: DECLARED.footD, height: DECLARED.collisionH, basis: "hangar_roundA kit size [3.27, 1.5, 2.83] x 4.5 as footprintOf turns it; read by hand from B's committed world/src, not re-read by this script, B must confirm" },
    mainMassTop: DECLARED.mainMassTop,
    doorAnchor: { description: 'centre of the glazed double doors at the back of the recessed porch', local: door, storedInGlb: false },
    approachPointOnFootprintEdge: { local: [0, 0, DECLARED.approachZ], note: 'the nearest point of the declared footprint to the door, on the street side; with a solid footprint box this is as close as the player can get' },
    worldPlacement: { ...DECLARED.place, doorAnchorWorld: [DECLARED.place.x + door[2] * Math.sin(DECLARED.place.ry), door[1], DECLARED.place.z + door[2] * Math.cos(DECLARED.place.ry)], faces: 'world -X (toward the Santé tram stop at x = 28), by calculation from the declared ry' },
  },
  comparisons: {
    footprintMatchesDeclaredCollisionBox: footprintMatches,
    allGeometryInsideDeclaredFootprint: insideFootprint,
    measuredMaxHeight: bounds.max[1],
    metresAboveDeclaredCollisionBoxHeight: round(bounds.max[1] - DECLARED.collisionH),
    metresFromFootprintEdgeToDeclaredDoorAnchor: round(DECLARED.approachZ - door[2]),
  },
  unverified: [
    'whether the solid footprint box collider keeps the recessed door reachable from outside (it fills the porch: the door is declared 1.8 m inside the footprint edge); needs an in-city check by B',
    'whether anything above the collision box height (plant room, vent stacks, solar panels, roof cross) or the roof itself can be reached by the player, NPCs or the tram; needs an in-city check by B',
    'collision, shadows, frame cost, bloom and the view from the moving tram inside the real city',
  ],
  checks,
  allChecksPass: checks.every((c) => c.ok),
};
if (manifestPath) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ bytes: buffer.length, gzipBytes: gz, triangles, vertices, meshNodes, materials: gltf.materials.length, bounds, perMaterial }, null, 1));
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : '  -> ' + c.detail}`);
