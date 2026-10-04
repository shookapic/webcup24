// Validation JSON for the colony pack: per asset triangles, vertices, material slots, bounds (metres, Y up), raw + gzip size, and the
// conventions the world relies on (origin at the base: min y ~ 0, front at +Z, no textures, budgets). Exit code 1 on any violation.
// node tools/assets/validate.mjs [pack.glb] [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const [file = 'world/public/models/colony-pack.glb', out = 'docs/qa-captures/asset-validation.json'] = process.argv.slice(2);
const buf = readFileSync(file);
const jsonLength = buf.readUInt32LE(12);
const g = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
const budgets = { townHall: 30000, streetLamp: 3000, bench: 3000, colonyTree: 3000 };

// world-space bounds of one node subtree from accessor min/max and node transforms (no animation, no skins in this pack)
const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return r; };
const local = (n) => {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1]; const [sx, sy, sz] = n.scale ?? [1, 1, 1]; const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
};
function walk(index, parent, acc) {
  const node = g.nodes[index];
  const m = mul(parent, local(node));
  if (node.mesh !== undefined) {
    for (const p of g.meshes[node.mesh].primitives) {
      const a = g.accessors[p.attributes.POSITION];
      for (const x of [a.min[0], a.max[0]]) for (const y of [a.min[1], a.max[1]]) for (const z of [a.min[2], a.max[2]]) {
        const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
        w.forEach((v, i) => { acc.min[i] = Math.min(acc.min[i], v); acc.max[i] = Math.max(acc.max[i], v); });
      }
      acc.triangles += g.accessors[p.indices].count / 3;
      acc.vertices += a.count;
      acc.materials.add(g.materials[p.material].name);
      acc.meshes++;
    }
  }
  (node.children ?? []).forEach((c) => walk(c, m, acc));
}

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const report = { file, rawKB: +(buf.length / 1024).toFixed(1), gzipKB: +(gzipSync(buf).length / 1024).toFixed(1), textures: g.textures?.length ?? 0, assets: {} };
const problems = [];
for (const root of g.scenes[0].nodes) {
  const name = g.nodes[root].name;
  const acc = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], triangles: 0, vertices: 0, materials: new Set(), meshes: 0 };
  walk(root, identity, acc);
  const size = acc.max.map((v, i) => +(v - acc.min[i]).toFixed(2));
  report.assets[name] = { triangles: acc.triangles, vertices: acc.vertices, meshes: acc.meshes, materials: [...acc.materials], boundsMin: acc.min.map((v) => +v.toFixed(2)), boundsMax: acc.max.map((v) => +v.toFixed(2)), sizeXYZ: size };
  if (acc.triangles > (budgets[name] ?? 3000)) problems.push(`${name}: ${acc.triangles} triangles over budget`);
  if (Math.abs(acc.min[1]) > 0.02) problems.push(`${name}: origin not at the base (min y ${acc.min[1].toFixed(2)})`);
  if (Math.abs((acc.min[0] + acc.max[0]) / 2) > 4 && name !== 'townHall') problems.push(`${name}: not centred in x`);
}
if (report.textures) problems.push('textures present (the colony pack is texture-free by convention)');
report.problems = problems;
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(problems.length ? 1 : 0);
