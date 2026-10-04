import { Color, MeshStandardMaterial } from 'three';
import { Prop, kitMaterial } from './kit.jsx';
import { benches, lamps } from './layout.js';
import { WorldAssetInstances, preloadAssets } from './assets/WorldAsset.jsx';

preloadAssets(['townHall', 'streetLamp', 'bench', 'colonyTree']); // the slice's pack only

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

const benchItems = benches.map((b) => [b.x, b.z, 1, b.ry]);
const lampItems = lamps.map(([x, z]) => [x, z, 1, 0]);

export function Plaza() {
  return (
    <group>
      <Paving />
      <WorldAssetInstances id="bench" items={benchItems} />
      <WorldAssetInstances id="streetLamp" items={lampItems} />
      {/* Mairie: the townHall asset (Districts.jsx) carries hall, wings, canopy and antenna; beacon masts stay here */}
      <Prop name="chimney" position={[-12, 0, -16]} scale={[2, 3, 2]} />
      <mesh material={mats.amber} position={[-12, 6.1, -16]}><sphereGeometry args={[0.35, 12, 8]} /></mesh>
      <Prop name="chimney" position={[12, 0, -16]} scale={[2, 3, 2]} />
      <mesh material={mats.amber} position={[12, 6.1, -16]}><sphereGeometry args={[0.35, 12, 8]} /></mesh>
      {/* Plaza furniture: benches facing the fountain-less centre, planters, lamps */}
      <Prop name="rock_largeA" position={[-9, 0, 9]} scale={2.4} rotation-y={1} />
      <Prop name="rocks_smallA" position={[10, 0, 8]} scale={3} />
      <Prop name="machine_generatorLarge" position={[-23, 0, -17]} scale={2.4} rotation-y={0.6} />
      <Prop name="machine_barrelLarge" position={[24, 0, -17]} scale={2.4} />
      <Prop name="barrels" position={[22, 0, -16]} scale={2} />
    </group>
  );
}
