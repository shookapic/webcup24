import { useMemo } from 'react';
import { Color, MeshStandardMaterial } from 'three';
import { Scatter } from './nature.jsx';
import { beds, trees } from './layout.js';

// Trees and planting beds from the Kenney Nature Kit (CC0). Beds: stone border + soil + deterministic scatter of bushes,
// flowers and grass; trees are the layout's collision trees. All instanced per model.
const soil = new MeshStandardMaterial({ color: new Color('#5b4636'), roughness: 1 });
const border = new MeshStandardMaterial({ color: new Color('#cdbfa6'), roughness: 0.9 });

function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function Plantings() {
  const lists = useMemo(() => {
    const out = { plant_bushLarge: [], plant_bushDetailed: [], plant_bush: [], flower_yellowA: [], flower_redA: [], flower_purpleA: [], grass_large: [] };
    beds.forEach(([bx, bz, r], i) => {
      const random = rng(97 + i * 31);
      const at = (inner) => {
        const a = random() * Math.PI * 2;
        const d = Math.sqrt(random()) * r * inner;
        return [bx + Math.cos(a) * d, bz + Math.sin(a) * d];
      };
      const bush = ['plant_bushLarge', 'plant_bushDetailed', 'plant_bush'];
      for (let k = 0; k < 3; k++) out[bush[k]].push([...at(0.55), 2.6 + random() * 1.2, random() * 6]);
      const flowers = ['flower_yellowA', 'flower_redA', 'flower_purpleA'];
      for (let k = 0; k < 7; k++) out[flowers[k % 3]].push([...at(0.9), 2.6 + random() * 1.2, random() * 6]);
      for (let k = 0; k < 3; k++) out.grass_large.push([...at(0.85), 3 + random() * 1.5, random() * 6]);
    });
    return out;
  }, []);
  const treeLists = useMemo(() => {
    const out = {};
    for (const t of trees) (out[t.model] ??= []).push([t.x, t.z, t.s, t.ry]);
    return out;
  }, []);
  return (
    <group>
      {beds.map(([x, z, r]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <mesh material={border} position-y={0.1} receiveShadow castShadow><cylinderGeometry args={[r + 0.25, r + 0.3, 0.2, 20]} /></mesh>
          <mesh material={soil} position-y={0.12} receiveShadow><cylinderGeometry args={[r, r, 0.16, 20]} /></mesh>
        </group>
      ))}
      {Object.entries(lists).map(([name, items]) => <Scatter key={name} name={name} items={items} />)}
      {Object.entries(treeLists).map(([name, items]) => <Scatter key={name} name={name} items={items} />)}
    </group>
  );
}
