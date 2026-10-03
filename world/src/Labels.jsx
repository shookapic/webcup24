import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';

// Own label overlay: drei <Html> drops its first instance under React 19.
export const districts = [
  { name: 'Mairie', position: [0, 28, -22] },
  { name: 'Santé', position: [32, 11, -6] },
  { name: 'Quartier sud', position: [0, 8, 38] },
  { name: 'Marché', position: [-32, 7, -2] },
  { name: 'Habitat', position: [-24, 15, -40] },
];

const elements = [];
const point = new Vector3();

// Inside <Canvas>: project each label like the curve shader would place it.
export function LabelProjector() {
  useFrame(({ camera, size }) => {
    districts.forEach(({ position: [x, y, z] }, i) => {
      const el = elements[i];
      if (!el) return;
      point.set(x, y, z).project(camera); // the playable area is flat, labels need no bending
      el.hidden = point.z > 1;
      el.style.transform = `translate(-50%, -50%) translate(${(point.x + 1) * size.width / 2}px, ${(1 - point.y) * size.height / 2}px)`;
    });
  });
  return null;
}

// Outside <Canvas>: the DOM labels themselves.
export function LabelLayer() {
  return (
    <div className="labels" aria-hidden="true">
      {districts.map(({ name }, i) => (
        <div key={name} ref={(el) => { elements[i] = el; }} className="district-label">{name}</div>
      ))}
    </div>
  );
}
