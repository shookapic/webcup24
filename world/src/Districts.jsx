import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Color, DoubleSide, MeshStandardMaterial, RepeatWrapping } from 'three';
import { Prop } from './kit.jsx';
import { buildings, footprintOf, lines, stops } from './layout.js';
import { debug } from './debug.js';

// Buildings (from layout.buildings, which also feeds collision), district dressing, stop shelters and the Quartier sud water.
const make = (color, extra = {}) => new MeshStandardMaterial({ color: new Color(color), roughness: 0.85, ...extra });
const mats = {
  slate: make('#4b5a63', { roughness: 0.6, metalness: 0.2 }),
  chalk: make('#e5e0d4'),
  wood: make('#8a6a4e'),
  crate: make('#a98657'),
  foliage: make('#688c73', { flatShading: true }),
  planter: make('#a9654a'),
  teal: make('#4a8c87', { emissive: new Color('#4a8c87'), emissiveIntensity: 0.9, toneMapped: false }),
};
const awningColors = ['#d09a3e', '#a9654a', '#4a8c87', '#688c73', '#c98a6e', '#e9ba69'].map((c) => make(c, { side: DoubleSide }));

let hazard;
function hazardMaterial() {
  if (!hazard) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#e9ba69';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#27363f';
    for (let i = -64; i < 128; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 16, 0);
      g.lineTo(i + 80, 64);
      g.lineTo(i + 64, 64);
      g.fill();
    }
    const texture = new CanvasTexture(c);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    hazard = make('#ffffff', { map: texture });
  }
  return hazard;
}

// Unit vector out of a building's doors (ry 0 = +z).
const front = (ry) => [Math.sin(ry), Math.cos(ry)];

function Booth({ b, index }) {
  const [fx, fz] = front(b.ry);
  return (
    <group position={[b.x + fx * 3.6, 0, b.z + fz * 3.6]} rotation-y={b.ry}>
      <mesh material={awningColors[index % awningColors.length]} position={[0, 2.9, 0]} rotation-x={0.28} castShadow><boxGeometry args={[5.2, 0.14, 3.2]} /></mesh>
      {[-2.4, 2.4].map((x) => <mesh key={x} material={mats.slate} position={[x, 1.45, 1.2]} castShadow><cylinderGeometry args={[0.07, 0.07, 2.9, 8]} /></mesh>)}
      <mesh material={mats.crate} position={[-1.4, 0.35, 0.3]} castShadow receiveShadow><boxGeometry args={[0.9, 0.7, 0.9]} /></mesh>
      <mesh material={mats.crate} position={[-0.3, 0.25, 0.5]} castShadow receiveShadow><boxGeometry args={[0.7, 0.5, 0.7]} /></mesh>
      <mesh material={mats.foliage} position={[1.5, 0.7, 0.3]} scale={[1, 0.7, 1]} castShadow><icosahedronGeometry args={[0.5, 1]} /></mesh>
    </group>
  );
}

function HealthCross({ b }) {
  return (
    <group position={[b.x, 1.5 * b.scale + 0.9, b.z]}>
      <mesh material={mats.teal}><boxGeometry args={[3.2, 0.9, 0.9]} /></mesh>
      <mesh material={mats.teal}><boxGeometry args={[0.9, 3.2, 0.9]} /></mesh>
    </group>
  );
}

// Water for Quartier sud: restrained ripples, frozen under reduced motion.
const waterShader = {
  uniforms: { uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform float uTime; varying vec2 vUv;
    void main() {
      vec2 p = (vUv - 0.5) * 2.0;
      float r = length(p);
      float ripple = sin(p.x * 14.0 + uTime * 0.8) * sin(p.y * 11.0 - uTime * 0.6) * 0.5 + 0.5;
      vec3 deep = vec3(0.10, 0.27, 0.34);
      vec3 shallow = vec3(0.29, 0.55, 0.53);
      vec3 color = mix(shallow, deep, smoothstep(0.2, 0.9, r)) + ripple * 0.05;
      gl_FragColor = vec4(pow(color, vec3(2.2)), 0.92);
      #include <colorspace_fragment>
    }`,
};
function Water({ reducedMotion }) {
  const material = useRef();
  useFrame(({ clock }) => {
    if (!reducedMotion && material.current) material.current.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 62]}>
      <circleGeometry args={[12.5, 48]} />
      <shaderMaterial ref={material} args={[waterShader]} transparent />
    </mesh>
  );
}

function WaterEdge() {
  const sign = useMemo(hazardMaterial, []);
  const posts = useMemo(() => Array.from({ length: 13 }, (_, i) => -12 + i * 2), []);
  return (
    <group position={[0, 0, 49.5]}>
      {posts.map((x) => <mesh key={x} material={mats.slate} position={[x, 0.55, 0]} castShadow><boxGeometry args={[0.12, 1.1, 0.12]} /></mesh>)}
      <mesh material={mats.slate} position={[0, 1.05, 0]} castShadow><boxGeometry args={[24, 0.08, 0.08]} /></mesh>
      <mesh material={mats.slate} position={[0, 0.6, 0]}><boxGeometry args={[24, 0.06, 0.06]} /></mesh>
      {[-7, 7].map((x) => (
        <group key={x} position={[x, 0, -0.3]}>
          <mesh material={mats.slate} position-y={1.1}><cylinderGeometry args={[0.05, 0.05, 2.2, 8]} /></mesh>
          <mesh material={sign} position-y={2.2} castShadow><boxGeometry args={[1.5, 0.9, 0.08]} /></mesh>
        </group>
      ))}
      <Prop name="machine_barrelLarge" position={[-15, 0, -1]} scale={2.2} variant="sud" />
      <Prop name="machine_barrelLarge" position={[15, 0, -1]} scale={2.2} variant="sud" rotation-y={1} />
    </group>
  );
}

const served = (name) => Object.entries(lines).filter(([, line]) => line.stops.includes(name)).map(([code]) => code);

// Stop shelter: roof, back panel, bench, and a pole sign with one disc per line that serves the stop.
function Stop({ stop }) {
  return (
    <group position={[stop.x, 0, stop.z]} rotation-y={stop.facing}>
      <mesh material={mats.chalk} position={[0, 2.6, 0]} castShadow><boxGeometry args={[3.4, 0.12, 1.6]} /></mesh>
      {[-1.5, 1.5].map((x) => <mesh key={x} material={mats.slate} position={[x, 1.3, -0.6]} castShadow><boxGeometry args={[0.1, 2.6, 0.1]} /></mesh>)}
      <mesh material={mats.slate} position={[0, 1.3, -0.72]}><boxGeometry args={[3.2, 2.4, 0.04]} /></mesh>
      <mesh material={mats.wood} position={[0, 0.5, -0.3]} castShadow><boxGeometry args={[2.2, 0.1, 0.5]} /></mesh>
      <group position={[2.2, 0, 0.6]}>
        <mesh material={mats.slate} position-y={1.6}><cylinderGeometry args={[0.05, 0.05, 3.2, 8]} /></mesh>
        {served(stop.name).map((code, i) => (
          <mesh key={code} position={[0, 3.2 - i * 0.55, 0.06]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.25, 0.25, 0.06, 20]} />
            <meshStandardMaterial color={lines[code].color} emissive={lines[code].color} emissiveIntensity={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function Districts({ reducedMotion }) {
  if (debug.enabled) debug.footprintOf = footprintOf;
  return (
    <group>
      {buildings.map((b, i) => (
        <group key={`${b.model}${b.x}${b.z}`}>
          <group ref={(g) => { if (debug.enabled && g) (debug.buildingObjects ??= new Map()).set(b, g); }}>
            <Prop name={b.model} variant={b.variant} position={[b.x, 0, b.z]} rotation-y={b.ry} scale={b.scale} />
          </group>
          {b.booth && <Booth b={b} index={i} />}
          {b.cross && <HealthCross b={b} />}
        </group>
      ))}
      {stops.map((stop) => <Stop key={stop.name} stop={stop} />)}
      <Water reducedMotion={reducedMotion} />
      <WaterEdge />
      <Prop name="rocks_smallA" position={[-30, 0, 52]} scale={3} variant="sud" />
      <Prop name="rock_largeA" position={[26, 0, 56]} scale={3.2} rotation-y={0.5} />
      <Prop name="barrels" position={[-44, 0, 8]} scale={2.2} />
      <Prop name="barrels" position={[-33, 0, -14.5]} scale={2} />
      <Prop name="machine_wireless" position={[-52, 0, -30]} scale={2.2} variant="habitat" rotation-y={1.57} />
    </group>
  );
}
