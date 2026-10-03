import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Color, MeshStandardMaterial } from 'three';
import { Prop } from './kit.jsx';
import { debug } from './debug.js';
import { lines, stops, supports } from './layout.js';
import { arcOf, measure, sample } from './rail.js';

// F36 in the world: elevated rails on columns (never over a walking route), one three-car tram per line shuttling with a
// dwell at every stop. Decorative: the motion loops continuously and is NOT synchronised with the /api/transports timetable.
//
// Geometry contract (measured, tools/qa/tram-check.mjs asserts it): the kit cars are centred on their origin once Prop zeroes
// the exported root offset; the car origin sits on the rail top; the consist is symmetric (nose car, middle car, nose car) so
// reversing never swaps or stacks cars; `state.s` is the arc position of the middle car and is kept CAR + margin away from
// both rail ends, so every car is always on the rail.
const SPEED = 5; // m/s
const DWELL = 5; // s at each stop
const CAR = 3.45; // car pitch: kit car length 3.3-3.5 at SCALE
const SCALE = 3.3;
const BEAM = { w: 0.5, h: 0.35 };
const NOSE = 1.85; // car origin to nose tip (kit nose car, measured 1.65-1.8 at SCALE) so no nose ever overhangs the rail end
const MARGIN = NOSE;

const rail = new MeshStandardMaterial({ color: new Color('#8b9ba4'), roughness: 0.7, metalness: 0.15 });
const cap = new MeshStandardMaterial({ color: new Color('#a9654a'), roughness: 0.8 });

function Track() {
  const beams = useMemo(() => Object.entries(lines).flatMap(([code, line]) => line.path.slice(1).map(([bx, bz], i) => {
    const [ax, az] = line.path[i];
    return { key: `${code}${i}`, y: line.y, x: (ax + bx) / 2, z: (az + bz) / 2, len: Math.hypot(bx - ax, bz - az), heading: Math.atan2(bx - ax, bz - az) };
  })), []);
  return (
    <group>
      {beams.map((b) => (
        <mesh key={b.key} material={rail} position={[b.x, b.y, b.z]} rotation-y={b.heading} castShadow>
          <boxGeometry args={[BEAM.w, BEAM.h, b.len + 0.3]} />
        </mesh>
      ))}
      {supports.map(({ code, x, z, y }) => (
        <group key={`${code}${x},${z}`} position={[x, 0, z]}>
          <mesh material={rail} position-y={(y - BEAM.h) / 2} castShadow><boxGeometry args={[0.38, y - BEAM.h, 0.38]} /></mesh>
          <mesh material={cap} position-y={y - BEAM.h / 2 - 0.1} castShadow><boxGeometry args={[0.7, 0.2, 0.7]} /></mesh>
        </group>
      ))}
    </group>
  );
}

const ORDER = [
  { model: 'monorail_trainFront', offset: -1, flip: false }, // the kit's nose is local -z: unflipped it faces backwards (rear cab)
  { model: 'monorail_trainPassenger', offset: 0, flip: false },
  { model: 'monorail_trainFront', offset: 1, flip: true }, // leading cab: flipped so the nose (local -z) faces the direction of travel (+s)
];

function Train({ code, line }) {
  const cars = useRef([]);
  const { cum, range, stopArcs, state } = useMemo(() => {
    const cumulative = measure(line.path);
    const total = cumulative[cumulative.length - 1];
    const lo = CAR + MARGIN;
    const hi = total - CAR - MARGIN;
    const arcs = stops.filter((s) => s.track[code]).map((s) => Math.min(hi, Math.max(lo, arcOf(line.path, cumulative, s.track[code])))).sort((a, b) => a - b);
    return { cum: cumulative, range: [lo, hi], stopArcs: arcs, state: { s: arcs[0], dir: 1, dwell: DWELL, last: 0 } };
  }, [line, code]);
  if (debug.enabled) {
    (debug.trams ??= {})[code] = { state, stopArcs, range, total: cum[cum.length - 1], geom: { cum, path: line.path, y: line.y } };
    (debug.tramCars ??= {})[code] = cars.current;
    debug.THREE = THREE;
    debug.carsOf = (c) => debug.tramCars[c] ?? [];
  }

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    if (state.dwell > 0) state.dwell -= dt;
    else {
      state.s += state.dir * SPEED * dt;
      const hit = stopArcs.findIndex((a, i) => i !== state.last && Math.abs(a - state.s) <= SPEED * dt);
      if (hit >= 0) { state.s = stopArcs[hit]; state.last = hit; state.dwell = DWELL; }
      if (state.s >= range[1]) { state.s = range[1]; state.dir = -1; state.dwell = DWELL; state.last = stopArcs.length - 1; }
      else if (state.s <= range[0]) { state.s = range[0]; state.dir = 1; state.dwell = DWELL; state.last = 0; }
    }
    ORDER.forEach(({ offset, flip }, i) => {
      const car = cars.current[i];
      if (!car) return;
      const at = sample(line.path, cum, state.s + offset * CAR);
      // Heading from the rail chord around the car, so bends turn it smoothly instead of snapping at a vertex.
      const ahead = sample(line.path, cum, state.s + offset * CAR + 0.8);
      const behind = sample(line.path, cum, state.s + offset * CAR - 0.8);
      car.position.set(at.x, line.y + BEAM.h / 2, at.z);
      car.rotation.y = Math.atan2(ahead.x - behind.x, ahead.z - behind.z) + (flip ? Math.PI : 0);
    });
  });

  return ORDER.map(({ model }, i) => (
    <group key={`${code}${i}`} ref={(g) => { cars.current[i] = g; }}>
      <Prop name={model} scale={SCALE} variant={code === 'T1' ? 'tram1' : 'tram2'} />
    </group>
  ));
}

export function Tram() {
  return (
    <group>
      <Track />
      {Object.entries(lines).map(([code, line]) => <Train key={code} code={code} line={line} />)}
    </group>
  );
}
