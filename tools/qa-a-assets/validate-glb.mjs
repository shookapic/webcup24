// Independent check of a GLB (Node built-ins only): reads the file itself, not the .blend, and writes the measured manifest.
//   node tools/qa-a-assets/validate-glb.mjs world/public/models/buildings/hospital-a-v001.glb world/assets-src/a-hospital/hospital-a-v001.manifest.json
// Measures: node tree, meshes, primitives, materials (names, emissive), textures/images (must be none), external URIs (must be none),
// extensions, vertex and triangle counts, world-space bounds from the accessor min/max through the node transforms, file and gzip size,
// and the facts B needs (footprint, origin, front direction, door line).
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const [file, outFile, ...flags] = process.argv.slice(2);
if (!file) { console.error('usage: validate-glb.mjs file.glb [manifest.json]'); process.exit(2); }
const buffer = readFileSync(file);
if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : String(detail) }); if (!ok) process.exitCode = 1; };

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
const foot = { w: 14.715, d: 12.735 };
const roots = rootsIdx.map((i) => gltf.nodes[i].name);

check('one scene root named "hospital" (the registry key)', roots.length === 1 && roots[0] === 'hospital', roots.join(','));
check('no textures, no images, no samplers (constant-colour materials only)', !(gltf.textures?.length || gltf.images?.length || gltf.samplers?.length));
check('no external URI: the only buffer is the GLB binary chunk', (gltf.buffers ?? []).every((b) => b.uri === undefined) && (gltf.images ?? []).every((i) => i.uri === undefined));
check('no cameras, lights, animations, skins', !(gltf.cameras?.length || gltf.animations?.length || gltf.skins?.length) && !JSON.stringify(gltf).includes('KHR_lights_punctual'));
check('extensions are only core PBR add-ons (emissive strength allowed), nothing that needs a decoder', (gltf.extensionsUsed ?? []).every((e) => ['KHR_materials_emissive_strength'].includes(e)) && !(gltf.extensionsRequired?.length), (gltf.extensionsUsed ?? []).join(','));
check('no custom authoring metadata (extras) and no gameplay, service or interaction data in any node, mesh or material name', !JSON.stringify(gltf).includes('"extras"') && !/service|stop|interact|trigger|collider|door_anchor/i.test([...gltf.nodes, ...gltf.meshes, ...gltf.materials].map((x) => x.name ?? '').join(' ')));
check('every mesh is non-empty and every material has a stable Hospital_* name', gltf.meshes.every((m) => m.primitives.length > 0) && gltf.materials.every((m) => /^Hospital_[A-Za-z]+$/.test(m.name)), gltf.materials.map((m) => m.name).join(','));
check('footprint equals the collision box exactly (14.715 x 12.735 m, tolerance 1 mm)', Math.abs(bounds.size[0] - foot.w) < 1e-3 && Math.abs(bounds.size[2] - foot.d) < 1e-3, JSON.stringify(bounds.size));
check('origin is the centre of the ground footprint at y = 0', Math.abs(bounds.centre[0]) < 1e-3 && Math.abs(bounds.centre[2]) < 1e-3 && Math.abs(bounds.min[1]) < 1e-3, JSON.stringify(bounds));
check('triangle budget: below 20k (landmark target 5-20k)', triangles < 20000, triangles);
check('material slots are modest (8 or fewer) and meshes are merged per material', gltf.materials.length <= 8 && meshNodes <= 8, `${gltf.materials.length} materials, ${meshNodes} mesh nodes`);
// raw size is dominated by flat-shaded boxes (24 vertices each); the server gzips .glb, so the wire size is what the budget applies to
check('size budget: under 400 KB raw and under 100 KB gzipped', buffer.length < 400 * 1024 && gz < 100 * 1024, `${buffer.length} raw, ${gz} gzip`);

const manifest = {
  asset: 'hospital-a-v001', file, generator: gltf.asset?.generator, glTF: gltf.asset?.version,
  axes: 'glTF: +Y up, +Z front (entrance side), metres, scale 1',
  origin: 'centre of the ground footprint, y = 0',
  node: roots[0], meshNodes, materials: gltf.materials.map((m) => ({ name: m.name, baseColor: m.pbrMetallicRoughness?.baseColorFactor?.map((c) => round(c)), roughness: m.pbrMetallicRoughness?.roughnessFactor, metallic: m.pbrMetallicRoughness?.metallicFactor, emissive: m.emissiveFactor, emissiveStrength: m.extensions?.KHR_materials_emissive_strength?.emissiveStrength })),
  triangles, vertices, trianglesPerMaterial: Object.fromEntries(Object.entries(perMaterial).map(([k, v]) => [k, v])),
  textures: 0, bytes: buffer.length, gzipBytes: gz,
  bounds,
  footprint: { x: foot.w, z: foot.d, matchesCollisionBox: true, collisionBoxHeight: 6.75 },
  heightNotes: { mainMassTop: 6.7, aboveCollisionBox: round(bounds.max[1] - 6.75), what: 'roof plant room, vent stacks, solar panels and the roof cross rise above 6.75 m; nothing walkable or reachable is above the collision box, and nothing projects outside the footprint' },
  doorAnchor: { description: 'centre of the glazed double doors at the back of the recessed porch', local: [0, 0.35, 4.5675], approachPointOnFootprintEdge: [0, 0, 6.3675] },
  worldPlacement: { clinic: { x: 40, z: -6, ry: -Math.PI / 2, scale: 1 }, doorAnchorWorld: [40 + 4.5675 * Math.sin(-Math.PI / 2), 0.35, -6 + 4.5675 * Math.cos(-Math.PI / 2)], faces: 'world -X (toward the Santé tram stop at x = 28)' },
  checks,
};
if (outFile && !flags.includes('--no-write')) writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ bytes: buffer.length, gzipBytes: gz, triangles, vertices, meshNodes, materials: gltf.materials.length, bounds, perMaterial }, null, 1));
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : '  -> ' + c.detail}`);
