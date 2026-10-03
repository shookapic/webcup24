import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Matrix4, Quaternion, Vector3, Euler } from 'three';

// Kenney Nature Kit (CC0) plants, drawn with InstancedMesh: one draw call per model material however many are placed.
// Materials keep the kit's own colours (warm autumn leaves suit the palette). Placement items: [x, z, scale, yaw].
export const natureUrl = (name) => `${import.meta.env.BASE_URL}assets/models/nature/${name}.glb`;

const rotation = new Euler();
const quaternion = new Quaternion();
const position = new Vector3();
const scaleVector = new Vector3();
const placement = new Matrix4();

export function Scatter({ name, items, castShadow = true }) {
  const { scene } = useGLTF(natureUrl(name));
  const meshes = useMemo(() => {
    scene.updateMatrixWorld(true);
    const list = [];
    scene.traverse((child) => {
      if (!child.isMesh) return;
      // The kit exports metallic materials; with no environment map they render black. Keep the colours, make them matte.
      const material = child.material.clone();
      material.metalness = 0;
      material.roughness = 0.9;
      list.push({ geometry: child.geometry, material, local: child.matrixWorld.clone() });
    });
    return list;
  }, [scene]);
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
