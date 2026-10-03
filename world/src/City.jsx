import { Suspense, useMemo } from 'react';
import { BufferAttribute, Color, MeshStandardMaterial, Object3D } from 'three';
import { Plaza } from './Plaza.jsx';
import { curved } from './curve.js';

const glow = (color, intensity = 1.2) => ({ color, emissive: color, emissiveIntensity: intensity, toneMapped: false });

function Dome({ radius, position = [0, 0, 0], color = '#d8e4ef' }) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.25} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.15}>
        <torusGeometry args={[radius, 0.18, 8, 48]} />
        <meshStandardMaterial {...glow('#e9ba69')} />
      </mesh>
    </group>
  );
}

function Tower({ height, radius }) {
  return (
    <group>
      <mesh position-y={height / 2}>
        <cylinderGeometry args={[radius * 0.7, radius, height, 16]} />
        <meshStandardMaterial color="#e9e2da" metalness={0.4} roughness={0.35} />
      </mesh>
      {[0.35, 0.6, 0.85].map((t) => (
        <mesh key={t} position-y={height * t}>
          <cylinderGeometry args={[radius * (1 - t * 0.3) + 0.05, radius * (1 - t * 0.3) + 0.05, 0.3, 16]} />
          <meshStandardMaterial {...glow('#a9654a')} />
        </mesh>
      ))}
      <mesh position-y={height + 1.5}>
        <coneGeometry args={[radius * 0.4, 3, 12]} />
        <meshStandardMaterial {...glow('#e9ba69', 3)} />
      </mesh>
    </group>
  );
}

function Block({ size, position, color = '#cfc6bd', window = '#e9ba69' }) {
  const [w, h, d] = size;
  return (
    <group position={position}>
      <mesh position-y={h / 2}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, h * 0.6, d / 2 + 0.01]}>
        <planeGeometry args={[w * 0.8, h * 0.15]} />
        <meshStandardMaterial {...glow(window, 1.5)} />
      </mesh>
    </group>
  );
}

function Sante() {
  return (
    <group position={[32, 0, -6]}>
      <Dome radius={6} color="#f4f7fa" />
      <mesh position-y={7.5}>
        <boxGeometry args={[3, 0.8, 0.8]} />
        <meshStandardMaterial {...glow('#4a8c87', 3)} />
      </mesh>
      <mesh position-y={7.5}>
        <boxGeometry args={[0.8, 3, 0.8]} />
        <meshStandardMaterial {...glow('#4a8c87', 3)} />
      </mesh>
      <Block size={[6, 3, 4]} position={[7, 0, 3]} color="#e8eef2" window="#4a8c87" />
    </group>
  );
}

function QuartierSud() {
  return (
    <group position={[0, 0, 38]}>
      {[[-8, 0, -2], [-2, 0, 3], [5, 0, -1], [10, 0, 4], [-12, 0, 6]].map((p, i) => (
        <Dome key={i} radius={2.4} position={p} color="#d9cbbd" />
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.15, 14]}>
        <ringGeometry args={[0, 12, 48, 12]} />
        <meshStandardMaterial color="#2a7fb8" emissive="#0d3b5c" roughness={0.2} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function Marche() {
  return (
    <group position={[-32, 0, -2]}>
      {['#a9654a', '#e9ba69', '#e9ba69', '#4a8c87'].map((color, i) => (
        <group key={color} position={[(i % 2) * 6 - 3, 0, Math.floor(i / 2) * 6 - 3]}>
          <Block size={[4, 2.2, 3]} position={[0, 0, 0]} />
          <mesh position-y={2.6} rotation-x={0.15}>
            <boxGeometry args={[4.6, 0.15, 3.6]} />
            <meshStandardMaterial color={color} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Habitat() {
  return (
    <group position={[-24, 0, -40]}>
      <Block size={[6, 8, 6]} position={[0, 0, 0]} />
      <Block size={[5, 12, 5]} position={[8, 0, 2]} window="#e9ba69" />
      <Block size={[7, 6, 5]} position={[-7, 0, 3]} window="#a9654a" />
    </group>
  );
}

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

const paths = [[0, -9, 4, 16, 0], [16, -3, 30, 3, 0], [-16, -1, 30, 3, 0], [0, 19, 3, 36, 0], [-12, -30, 3, 22, 0.5]];

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

// Everything here gets an automatic box collider.
export function City() {
  return (
    <>
      {paths.map(([x, z, w, d, turn]) => (
        <mesh key={`${x},${z}`} rotation={[-Math.PI / 2, 0, turn]} position={[x, 0.02, z]}>
          <planeGeometry args={[w, d, Math.ceil(w / 2), Math.ceil(d / 2)]} />
          <meshStandardMaterial color="#cdb59b" roughness={0.95} />
        </mesh>
      ))}
      <Suspense fallback={null}><Plaza /></Suspense>
      <Sante />
      <QuartierSud />
      <Marche />
      <Habitat />
    </>
  );
}
