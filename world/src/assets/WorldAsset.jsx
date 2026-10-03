import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { assets, packs } from './registry.js';

// Reusable environment asset on top of drei useGLTF: ONE loader path for every GLB, shared geometry and materials, no per-component fetching.
//   <WorldAsset id="bench" position rotation scale variant />           one placement (a clone that shares geometry + materials)
//   <WorldAssetInstances id="streetLamp" items={[[x, z, scale, yaw, y]]} />   many placements, one InstancedMesh per material
// Pack URLs are preloaded on demand by `preloadAssets(ids)` for the slice only, not the whole future city.
export function preloadAssets(ids) {
  new Set(ids.map((id) => assets[id].pack)).forEach((pack) => useGLTF.preload(packs[pack]));
}

const prepared = new Map(); // `${id}:${variant}` -> [{ geometry, material, local }]
function meshesOf(scene, id, variant) {
  const key = `${id}:${variant ?? ''}`;
  if (prepared.has(key)) return prepared.get(key);
  const spec = assets[id];
  const root = scene.getObjectByName(spec.node);
  if (!root) throw new Error(`Asset ${id}: node "${spec.node}" not found in ${packs[spec.pack]}`);
  const copy = root.clone(true); // never touch the cached scene: other placements use it
  copy.position.set(0, 0, 0); // origin contract: base centre; ignore any exported root translation
  copy.rotation.set(0, 0, 0);
  copy.scale.setScalar(spec.scale);
  copy.updateMatrixWorld(true);
  const colours = spec.variants?.[variant] ?? {};
  const materials = new Map();
  const list = [];
  copy.traverse((child) => {
    if (!child.isMesh) return;
    const source = child.material;
    if (!materials.has(source)) {
      const material = source.clone();
      if (colours[source.name]) material.color = new Color(colours[source.name]);
      if (spec.glow?.includes(source.name)) material.toneMapped = false;
      materials.set(source, material);
    }
    list.push({ geometry: child.geometry, material: materials.get(source), local: child.matrixWorld.clone() });
  });
  prepared.set(key, list);
  return list;
}

export function WorldAsset({ id, variant, castShadow = true, receiveShadow = true, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }) {
  const spec = assets[id];
  const { scene } = useGLTF(packs[spec.pack]);
  const meshes = useMemo(() => meshesOf(scene, id, variant), [scene, id, variant]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {meshes.map((m, i) => (
        <mesh key={i} geometry={m.geometry} material={m.material} matrixAutoUpdate={false} matrix={m.local} castShadow={castShadow} receiveShadow={receiveShadow} />
      ))}
    </group>
  );
}

const euler = new Euler();
const quaternion = new Quaternion();
const position = new Vector3();
const scaleVector = new Vector3();
const placement = new Matrix4();

// items: [x, z, scale = 1, yaw = 0, y = 0]. Bounds are valid (no frustumCulled=false): geometry bounding sphere is recomputed over all instances.
export function WorldAssetInstances({ id, variant, items, castShadow = true, receiveShadow = true }) {
  const spec = assets[id];
  const { scene } = useGLTF(packs[spec.pack]);
  const meshes = useMemo(() => meshesOf(scene, id, variant), [scene, id, variant]);
  const matrices = useMemo(() => items.map(([x, z, s = 1, ry = 0, y = 0]) => {
    euler.set(0, ry, 0);
    quaternion.setFromEuler(euler);
    position.set(x, y, z);
    scaleVector.set(s, s, s);
    return new Matrix4().compose(position, quaternion, scaleVector);
  }), [items]);
  return meshes.map((mesh, i) => (
    <instancedMesh
      key={i}
      args={[mesh.geometry, mesh.material, matrices.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      ref={(instanced) => {
        if (!instanced) return;
        matrices.forEach((m, k) => instanced.setMatrixAt(k, new Matrix4().multiplyMatrices(m, mesh.local)));
        instanced.instanceMatrix.needsUpdate = true;
        instanced.computeBoundingSphere(); // honest culling bounds over every placement
      }}
    />
  ));
}
