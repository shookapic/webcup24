import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Euler, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';

// Kenney Nature Kit (CC0) plants, drawn with InstancedMesh: one draw call per model material however many are placed.
// Materials keep the kit's own colours (warm autumn leaves suit the palette). Placement items: [x, z, scale, yaw].
export const naturePack = `${import.meta.env.BASE_URL}assets/models/nature-pack.glb`; // tools/pack-models.mjs, sources in world/assets-src/nature
useGLTF.preload(naturePack);

const rotation = new Euler();
const quaternion = new Quaternion();
const position = new Vector3();
const scaleVector = new Vector3();
const placement = new Matrix4();

export function Scatter({ name, items, castShadow = true }) {
  const { scene } = useGLTF(naturePack);
  const meshes = useMemo(() => {
    const root = scene.getObjectByName(name).clone(true);
    root.position.set(0, root.position.y, 0); // same exported root offset as the space kit: draw the model where it is placed
    root.updateMatrixWorld(true);
    const list = [];
    root.traverse((child) => {
      if (!child.isMesh) return;
      // The kit marks its materials unlit (flat, washed out). Same colour as a lit matte material so trees take sun and shadow.
      const material = new MeshStandardMaterial({ color: child.material.color, roughness: 0.9, metalness: 0 });
      list.push({ geometry: child.geometry, material, local: child.matrixWorld.clone() });
    });
    return list;
  }, [scene, name]);
  const matrices = useMemo(() => items.map(([x, z, s = 1, ry = 0]) => {
    rotation.set(0, ry, 0);
    quaternion.setFromEuler(rotation);
    position.set(x, 0, z);
    scaleVector.set(s, s, s);
    return placement.compose(position, quaternion, scaleVector).clone();
  }), [items]);
  return meshes.map((mesh, i) => (
    <instancedMesh
      key={i}
      args={[mesh.geometry, mesh.material, matrices.length]}
      castShadow={castShadow}
      receiveShadow
      frustumCulled={false}
      ref={(instanced) => {
        if (!instanced) return;
        matrices.forEach((m, k) => instanced.setMatrixAt(k, new Matrix4().multiplyMatrices(m, mesh.local)));
        instanced.instanceMatrix.needsUpdate = true;
      }}
    />
  ));
}
