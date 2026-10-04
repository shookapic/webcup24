import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, Color, DoubleSide, MeshStandardMaterial, Object3D } from 'three';
import { PLAZA, SIDEWALK, crossings, roads } from './layout.js';

// Roads with sidewalks, raised curbs, dashed centre lines and zebra crossings. Everything repeated is one InstancedMesh.
// Heights (m): sidewalk 0.02, road 0.045, plaza paving 0.07 (Plaza.jsx), so the plaza covers the avenues where they enter it.
const std = (color, extra = {}) => new MeshStandardMaterial({ color: new Color(color), roughness: 0.95, ...extra });
const mats = {
  sidewalk: std('#d8cab3'),
  road: std('#8c8279'),
  curb: std('#ece6da', { roughness: 0.8 }),
  paint: std('#f1ede4', { roughness: 0.7 }),
  slate: std('#4b5a63', { roughness: 0.6 }),
  wood: std('#8a6a4e'),
};

const insideRoad = (x, z, ignore, margin) => roads.some((r, i) => i !== ignore && Math.abs(x - r[0]) < r[2] / 2 + margin && Math.abs(z - r[1]) < r[3] / 2 + margin);
const insidePlaza = (x, z, margin = 0.4) => Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + margin;

// Unit-length pieces along the road edges, skipped where another road or the plaza covers them.
function curbPieces() {
  const out = [];
  roads.forEach(([cx, cz, w, d], i) => {
    for (let t = -w / 2 + 0.5; t < w / 2; t += 1) for (const s of [-1, 1]) {
      const x = cx + t;
      const z = cz + (s * d) / 2;
      if (!insideRoad(x, z, i, 0.3) && !insidePlaza(x, z)) out.push({ x, z, ry: 0 });
    }
    for (let t = -d / 2 + 0.5; t < d / 2; t += 1) for (const s of [-1, 1]) {
      const x = cx + (s * w) / 2;
      const z = cz + t;
      if (!insideRoad(x, z, i, 0.3) && !insidePlaza(x, z)) out.push({ x, z, ry: Math.PI / 2 });
    }
  });
  return out;
}

// Dashed centre line on roads longer than 20 m, away from the plaza and the crossings.
function dashPieces() {
  const out = [];
  roads.forEach(([cx, cz, w, d], i) => {
    const alongX = w >= d;
    const length = alongX ? w : d;
    if (length < 20) return;
    for (let t = -length / 2 + 1.5; t < length / 2 - 1; t += 3.2) {
      const x = alongX ? cx + t : cx;
      const z = alongX ? cz : cz + t;
      const nearCrossing = crossings.some((c) => Math.hypot(x - c.x, z - c.z) < 3.2);
      if (!insidePlaza(x, z, 0.8) && !insideRoad(x, z, i, 0.2) && !nearCrossing) out.push({ x, z, ry: alongX ? 0 : Math.PI / 2 });
    }
  });
  return out;
}

function stripePieces() {
  const out = [];
  for (const c of crossings) {
    for (let t = -c.span / 2 + 0.45; t < c.span / 2; t += 0.9) {
      out.push(c.along === 'x' ? { x: c.x, z: c.z + t, ry: 0 } : { x: c.x + t, z: c.z, ry: Math.PI / 2 });
    }
  }
  return out;
}

const dummy = new Object3D();
function Instances({ pieces, size, y, material, shadows = false }) {
  const ref = useRef();
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    pieces.forEach((p, i) => {
      dummy.position.set(p.x, y, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [pieces, y]);
  return (
    <instancedMesh ref={ref} args={[null, null, pieces.length]} material={material} receiveShadow castShadow={shadows} frustumCulled={false}>
      <boxGeometry args={size} />
    </instancedMesh>
  );
}

// A signpost board with text on both faces (canvas texture: no font files needed).
function board(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const g = canvas.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ffffff';
  g.font = '700 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  const texture = new CanvasTexture(canvas);
  return new MeshStandardMaterial({ map: texture, roughness: 0.8, side: DoubleSide });
}

const signs = [
  { text: 'Santé →', to: [40, -6], color: '#4a8c87', h: 3.1 },
  { text: '← Marché', to: [-40, -2], color: '#a9654a', h: 2.5 },
  { text: 'Mairie ↑', to: [0, -27], color: '#293d49', h: 3.7 },
  { text: 'Quartier sud ↓', to: [0, 44], color: '#3f6f8f', h: 1.9 },
  { text: '← Habitat', to: [-44, -32], color: '#688c73', h: 1.3 },
];

function Fingerpost({ position }) {
  const boards = useMemo(() => signs.map((s) => ({ ...s, material: board(s.text, s.color), angle: Math.atan2(s.to[0] - position[0], s.to[1] - position[1]) })), [position]);
  return (
    <group position={position}>
      <mesh material={mats.slate} position-y={2.3} castShadow><cylinderGeometry args={[0.08, 0.1, 4.6, 8]} /></mesh>
      {boards.map((b) => (
        <group key={b.text} position-y={b.h} rotation-y={b.angle - Math.PI / 2}>
          <mesh material={b.material} position-x={1.15} castShadow><boxGeometry args={[2.3, 0.5, 0.06]} /></mesh>
        </group>
      ))}
    </group>
  );
}

export function Streetscape() {
  const curbs = useMemo(curbPieces, []);
  const dashes = useMemo(dashPieces, []);
  const stripes = useMemo(stripePieces, []);
  return (
    <group>
      {roads.map(([x, z, w, d]) => (
        <group key={`${x},${z}`} rotation-x={-Math.PI / 2} position={[x, 0, z]}>
          <mesh material={mats.sidewalk} position-z={0.02} receiveShadow><planeGeometry args={[w + SIDEWALK * 2, d + SIDEWALK * 2]} /></mesh>
          <mesh material={mats.road} position-z={0.045} receiveShadow><planeGeometry args={[w, d]} /></mesh>
        </group>
      ))}
      <Instances pieces={curbs} size={[1.0, 0.14, 0.2]} y={0.07} material={mats.curb} />
      <Instances pieces={dashes} size={[1.4, 0.02, 0.14]} y={0.06} material={mats.paint} />
      <Instances pieces={stripes} size={[2.4, 0.02, 0.5]} y={0.065} material={mats.paint} />
      <Fingerpost position={[5, 0, 7]} />
    </group>
  );
}
