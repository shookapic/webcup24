import { Suspense, useMemo } from 'react';
import { BufferAttribute, Color, MeshStandardMaterial, Object3D } from 'three';
import { Plaza } from './Plaza.jsx';
import { Districts } from './Districts.jsx';
import { Tram } from './Tram.jsx';
import { curved } from './curve.js';
import { roads } from './layout.js';

const rockMaterial = curved(new MeshStandardMaterial({ color: new Color('#8a5a45'), roughness: 1, flatShading: true }));
export function Rocks() {
  const matrices = useMemo(() => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const dummy = new Object3D();
    return Array.from({ length: 160 }, () => {
      const angle = random() * Math.PI * 2;
      const distance = 85 + random() * 130; // outside the playable walls
      dummy.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
      dummy.rotation.set(random() * 3, random() * 3, random() * 3);
      dummy.scale.setScalar(0.5 + random() * 2.5);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
  }, []);
  return (
    <instancedMesh args={[null, null, matrices.length]} ref={(mesh) => mesh && matrices.forEach((m, i) => mesh.setMatrixAt(i, m))}>
      <dodecahedronGeometry args={[1, 0]} />
      <primitive object={rockMaterial} attach="material" />
    </instancedMesh>
  );
}


// Dusty warm ground with slow colour breakup (vertex colours, no per-pixel noise to shimmer), bending down beyond the playable square.
const groundMaterial = curved(new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
function groundGeometry(mesh) {
  if (!mesh) return;
  const position = mesh.geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const a = new Color('#a58468');
  const b = new Color('#8f7059');
  const c = new Color('#b59a7c');
  const mix = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const n = Math.sin(x * 0.045) * Math.sin(y * 0.05) + 0.5 * Math.sin(x * 0.13 + y * 0.09);
    mix.copy(n > 0 ? c : b).lerp(a, 1 - Math.min(1, Math.abs(n)));
    colors.set([mix.r, mix.g, mix.b], i * 3);
  }
  mesh.geometry.setAttribute('color', new BufferAttribute(colors, 3));
}

export function Ground() {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow ref={groundGeometry} material={groundMaterial}>
      {/* subdivided so the curve has vertices to bend */}
      <planeGeometry args={[520, 520, 208, 208]} />
    </mesh>
  );
}


const roadMaterial = new MeshStandardMaterial({ color: new Color('#cdb59b'), roughness: 0.95 });

// Visual city: roads, plaza, districts, tram. Collision comes from layout.footprints (PlayableCity), not from these meshes.
export function City({ reducedMotion }) {
  return (
    <>
      {roads.map(([x, z, w, d]) => (
        <mesh key={`${x},${z}`} rotation-x={-Math.PI / 2} position={[x, 0.02, z]} material={roadMaterial} receiveShadow>
          <planeGeometry args={[w, d]} />
        </mesh>
      ))}
      <Suspense fallback={null}>
        <Plaza />
        <Districts reducedMotion={reducedMotion} />
        <Tram reducedMotion={reducedMotion} />
      </Suspense>
    </>
  );
}
