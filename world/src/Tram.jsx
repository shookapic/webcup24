import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MeshStandardMaterial } from 'three';
import { Prop } from './kit.jsx';
import { debug } from './debug.js';
import { TRACK_Y, lines, stops, supports } from './layout.js';

// F36 in the world: elevated rail on columns (never crosses a walking route), two trams shuttling their line with a dwell
// at every stop. Decorative: the motion loops continuously and is NOT synchronised with the /api/transports timetable.
const SPEED = 5; // m/s
const DWELL = 5; // s at each stop
const CAR = 3.4; // car pitch (kit cars scaled x3.3)
const SCALE = 3.3;

const rail = new MeshStandardMaterial({ color: new Color('#8b9ba4'), roughness: 0.7, metalness: 0.15 });
const cap = new MeshStandardMaterial({ color: new Color('#a9654a'), roughness: 0.8 });

// Polyline helpers: cumulative arc length, point + heading at arc position s.
function measure(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return cum;
}
function sample(points, cum, s) {
  const total = cum[cum.length - 1];
  const t = Math.min(Math.max(s, 0), total);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const [ax, az] = points[i - 1];
  const [bx, bz] = points[i];
  const f = (t - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, heading: Math.atan2(bx - ax, bz - az) };
}
// Arc position of the point of the line nearest to a stop's track point.
function arcOf(points, cum, [px, pz]) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const len = cum[i] - cum[i - 1];
    const f = Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / (len * len)));
    const d = Math.hypot(ax + (bx - ax) * f - px, az + (bz - az) * f - pz);
    if (d < bestD) { bestD = d; best = cum[i - 1] + len * f; }
  }
  return best;
}

function Track() {
  const beams = useMemo(() => {
    const done = new Set();
    const list = [];
    for (const line of Object.values(lines)) {
      for (let i = 1; i < line.points.length; i++) {
        const [ax, az] = line.points[i - 1];
        const [bx, bz] = line.points[i];
        const key = `${ax},${az},${bx},${bz}`;
        if (done.has(key)) continue;
        done.add(key);
        list.push({ key, x: (ax + bx) / 2, z: (az + bz) / 2, len: Math.hypot(bx - ax, bz - az), heading: Math.atan2(bx - ax, bz - az) });
      }
    }
    return list;
  }, []);
  return (
    <group>
      {beams.map((b) => (
        <mesh key={b.key} material={rail} position={[b.x, TRACK_Y, b.z]} rotation-y={b.heading} castShadow>
          <boxGeometry args={[0.5, 0.35, b.len + 0.5]} />
        </mesh>
      ))}
      {supports.map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <mesh material={rail} position-y={TRACK_Y / 2} castShadow><boxGeometry args={[0.38, TRACK_Y, 0.38]} /></mesh>
          <mesh material={cap} position-y={TRACK_Y - 0.1} castShadow><boxGeometry args={[0.7, 0.2, 0.7]} /></mesh>
        </group>
      ))}
    </group>
  );
}

function Train({ code, line, reducedMotion }) {
  const cars = useRef([]);
  const { points, cum, stopArcs, state } = useMemo(() => {
    const cumulative = measure(line.points);
    const arcs = stops.filter((s) => line.stops.includes(s.name)).map((s) => arcOf(line.points, cumulative, s.track)).sort((a, b) => a - b);
    return { points: line.points, cum: cumulative, stopArcs: arcs, state: { s: arcs[0], dir: 1, dwell: DWELL, last: -1 } };
  }, [line]);
  const total = cum[cum.length - 1];
  if (debug.enabled) (debug.trams ??= {})[code] = { state, stopArcs, total };
  const models = ['monorail_trainFront', 'monorail_trainPassenger', 'monorail_trainEnd'];

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    if (state.dwell > 0) state.dwell -= dt;
    else {
      state.s += state.dir * SPEED * dt;
      const hit = stopArcs.findIndex((a) => Math.abs(a - state.s) < SPEED * dt && stopArcs.indexOf(a) !== state.last);
      if (hit >= 0) { state.s = stopArcs[hit]; state.dwell = DWELL; state.last = hit; }
      if (state.s >= total) { state.s = total; state.dir = -1; state.dwell = DWELL; state.last = stopArcs.length - 1; }
      if (state.s <= 0) { state.s = 0; state.dir = 1; state.dwell = DWELL; state.last = 0; }
    }
    models.forEach((_m, i) => {
      const car = cars.current[i];
      if (!car) return;
      const at = sample(points, cum, state.s - state.dir * i * CAR);
      car.position.set(at.x, TRACK_Y + 0.22, at.z);
      // The cars always run with the front car leading, so face along the direction of travel.
      car.rotation.y = at.heading + (state.dir > 0 ? 0 : Math.PI);
    });
  });
  void reducedMotion; // travel is essential motion; only secondary effects respect reduced motion (none here)

  return models.map((name, i) => (
    <group key={`${code}${name}`} ref={(g) => { cars.current[i] = g; }}>
      <Prop name={name} scale={SCALE} variant={code === 'T1' ? 'tram1' : 'tram2'} />
    </group>
  ));
}

export function Tram({ reducedMotion }) {
  return (
    <group>
      <Track />
      {Object.entries(lines).map(([code, line]) => <Train key={code} code={code} line={line} reducedMotion={reducedMotion} />)}
    </group>
  );
}
