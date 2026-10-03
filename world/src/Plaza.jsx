import { useMemo } from 'react';
import { Color, MeshStandardMaterial } from 'three';
import { Prop, kitMaterial } from './kit.jsx';
import { benches } from './layout.js';

// Spawn plaza + Mairie, built from Kenney Space Kit pieces re-coloured to the colony palette.
// Collision footprints for these pieces live in layout.js (keep in sync).
const make = (color, extra = {}) => new MeshStandardMaterial({ color: new Color(color), roughness: 0.9, ...extra });
const mats = {
  paving: make('#cdb59b'),
  pavingDark: make('#b69c82'),
  foliage: make('#688c73', { flatShading: true }),
  planter: make('#a9654a'),
  slate: make('#293d49', { roughness: 0.6, metalness: 0.2 }),
  amber: make('#e9ba69', { emissive: new Color('#e9ba69'), emissiveIntensity: 1.6, toneMapped: false }),
  wood: make('#8a6a4e'),
};

function Lamp({ position }) {
  return (
    <group position={position}>
      <mesh material={mats.slate} position-y={1.9} castShadow><cylinderGeometry args={[0.07, 0.1, 3.8, 8]} /></mesh>
      <mesh material={mats.amber} position-y={3.95}><sphereGeometry args={[0.24, 12, 8]} /></mesh>
    </group>
  );
}

function Bench({ position, rotation = 0 }) {
  return (
    <group position={position} rotation-y={rotation}>
      <mesh material={mats.wood} position-y={0.5} castShadow receiveShadow><boxGeometry args={[2.2, 0.12, 0.6]} /></mesh>
      <mesh material={mats.wood} position={[0, 0.85, -0.27]} castShadow><boxGeometry args={[2.2, 0.5, 0.08]} /></mesh>
      {[-0.9, 0.9].map((x) => <mesh key={x} material={mats.slate} position={[x, 0.25, 0]} castShadow><boxGeometry args={[0.1, 0.5, 0.55]} /></mesh>)}
    </group>
  );
}

// Round pavement with a darker inner ring, laid just above the ground plane.
function Paving() {
  return (
    <group position={[0, 0.07, -3]} rotation-x={-Math.PI / 2}>
      <mesh material={mats.paving} receiveShadow><circleGeometry args={[16, 64]} /></mesh>
      <mesh material={mats.pavingDark} position-z={0.01} receiveShadow><ringGeometry args={[5.2, 5.8, 64]} /></mesh>
      <mesh material={mats.pavingDark} position-z={0.01} receiveShadow><ringGeometry args={[13.6, 14.2, 64]} /></mesh>
    </group>
  );
}

export function Plaza() {
  const pillars = useMemo(() => [[-2.6, -14.2], [2.6, -14.2], [-2.6, -18.8], [2.6, -18.8]], []);
  return (
    <group>
      <Paving />
      {benches.map((b) => <Bench key={`${b.x},${b.z}`} position={[b.x, 0, b.z]} rotation={b.ry} />)}
      {/* Mairie (hall and wings come from layout.buildings): entrance canopy, antenna, beacon masts */}
      <Prop name="platform_large" position={[0, 3.9, -16.5]} scale={[2.6, 3, 2.1]} />
      {pillars.map(([x, z]) => <Prop key={`${x},${z}`} name="supports_high" position={[x, 0, z]} scale={[1.1, 3.9, 1.1]} />)}
      <Prop name="satelliteDish_large" position={[16.5, 4, -27]} scale={4} rotation-y={0.4} />
      <Prop name="chimney" position={[-12, 0, -16]} scale={[2, 3, 2]} />
      <mesh material={mats.amber} position={[-12, 6.1, -16]}><sphereGeometry args={[0.35, 12, 8]} /></mesh>
      <Prop name="chimney" position={[12, 0, -16]} scale={[2, 3, 2]} />
      <mesh material={mats.amber} position={[12, 6.1, -16]}><sphereGeometry args={[0.35, 12, 8]} /></mesh>
      {/* Plaza furniture: benches facing the fountain-less centre, planters, lamps */}
      {[[-13, -3], [13, -3], [-6, -11], [6, -11], [0, 14]].map(([x, z]) => <Lamp key={`${x},${z}`} position={[x, 0, z]} />)}
      <Prop name="rock_largeA" position={[-9, 0, 9]} scale={2.4} rotation-y={1} />
      <Prop name="rocks_smallA" position={[10, 0, 8]} scale={3} />
      <Prop name="machine_generatorLarge" position={[-23, 0, -17]} scale={2.4} rotation-y={0.6} />
      <Prop name="machine_barrelLarge" position={[24, 0, -17]} scale={2.4} />
      <Prop name="barrels" position={[22, 0, -16]} scale={2} />
    </group>
  );
}
