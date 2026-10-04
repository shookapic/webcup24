// Packs many small texture-less .glb files into ONE .glb (one scene root node per input, named after the file), so the world makes
// 2 model requests instead of ~31 (each costs a round trip on a slow link). Node built-ins only.
// node tools/pack-models.mjs <out.glb> <in1.glb> <in2.glb> ...
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [out, ...inputs] = process.argv.slice(2);
if (!out || !inputs.length) { console.error('usage: node tools/pack-models.mjs out.glb in.glb...'); process.exit(1); }

const align4 = (n) => (n + 3) & ~3;
const merged = { asset: { version: '2.0', generator: 'terra-nova pack-models' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
const extensions = new Set();
const chunks = [];
let total = 0;

for (const file of inputs) {
  const buf = readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
  const binLength = buf.readUInt32LE(20 + jsonLength);
  const bin = buf.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + binLength);
  if (json.textures?.length || json.images?.length || json.skins?.length || json.animations?.length) throw new Error(`${file}: textures, skins and animations are not packable`);
  (json.extensionsUsed ?? []).forEach((e) => extensions.add(e));

  const offset = align4(total);
  chunks.push(Buffer.alloc(offset - total), bin);
  total = offset + bin.length;
  const base = { node: merged.nodes.length, mesh: merged.meshes.length, material: merged.materials.length, accessor: merged.accessors.length, view: merged.bufferViews.length };

  for (const view of json.bufferViews ?? []) merged.bufferViews.push({ ...view, buffer: 0, byteOffset: (view.byteOffset ?? 0) + offset });
  for (const accessor of json.accessors ?? []) {
    if (accessor.sparse) throw new Error(`${file}: sparse accessors are not packable`);
    merged.accessors.push({ ...accessor, bufferView: accessor.bufferView === undefined ? undefined : accessor.bufferView + base.view });
  }
  for (const mesh of json.meshes ?? []) {
    merged.meshes.push({
      ...mesh,
      primitives: mesh.primitives.map((p) => ({
        ...p,
        attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, v + base.accessor])),
        indices: p.indices === undefined ? undefined : p.indices + base.accessor,
        material: p.material === undefined ? undefined : p.material + base.material,
      })),
    });
  }
  merged.materials.push(...(json.materials ?? []));
  for (const node of json.nodes ?? []) merged.nodes.push({ ...node, mesh: node.mesh === undefined ? undefined : node.mesh + base.mesh, children: node.children?.map((c) => c + base.node) });
  const roots = json.scenes[json.scene ?? 0].nodes;
  roots.forEach((root, i) => {
    const node = merged.nodes[root + base.node];
    node.name = roots.length === 1 ? basename(file, '.glb') : `${basename(file, '.glb')}_${i}`;
    merged.scenes[0].nodes.push(root + base.node);
  });
}

merged.buffers[0].byteLength = total;
if (extensions.size) merged.extensionsUsed = [...extensions];
const binary = Buffer.concat(chunks);
const jsonText = Buffer.from(JSON.stringify(merged), 'utf8');
const jsonPadded = Buffer.concat([jsonText, Buffer.alloc(align4(jsonText.length) - jsonText.length, 0x20)]);
const binPadded = Buffer.concat([binary, Buffer.alloc(align4(binary.length) - binary.length)]);
const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
const chunkHeader = (length, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(length, 0); h.write(type, 4, 'latin1'); return h; };
writeFileSync(out, Buffer.concat([header, chunkHeader(jsonPadded.length, 'JSON'), jsonPadded, chunkHeader(binPadded.length, 'BIN\0'), binPadded]));
console.log(`${out}: ${inputs.length} models, ${merged.nodes.length} nodes, ${merged.meshes.length} meshes, ${(12 + 16 + jsonPadded.length + binPadded.length) / 1024 | 0} KB${extensions.size ? `, extensions ${[...extensions].join(',')}` : ''}`);
