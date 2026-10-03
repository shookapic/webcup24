import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import { Prop } from './kit.jsx';

// ?gallery=name1,name2,...  contact sheet of kit models with their names (debug, used to pick assets).
const names = new URLSearchParams(location.search).get('gallery')?.split(',') ?? [];
const COLS = 6;
const GAP = 7;
const els = [];
const p = new Vector3();
const place = (i) => [(i % COLS) * GAP, 0, Math.floor(i / COLS) * GAP];

function Labels() {
  useFrame(({ camera, size }) => {
    names.forEach((_, i) => {
      const [x, , z] = place(i);
      p.set(x, 0, z).project(camera);
      if (els[i]) els[i].style.transform = `translate(${(p.x + 1) * size.width / 2}px, ${(1 - p.y) * size.height / 2}px)`;
    });
  });
  return null;
}

export function Gallery() {
  const rows = Math.ceil(names.length / COLS);
  return (
    <>
      <Canvas camera={{ position: [(COLS * GAP) / 2 - 3, 14 + rows * 3, rows * GAP + 6], fov: 45 }}>
        <color attach="background" args={['#8fb0c8']} />
        <hemisphereLight args={['#ffffff', '#887766', 1.2]} />
        <directionalLight position={[10, 20, 10]} intensity={2} />
        <Suspense>{names.map((n, i) => <Prop key={n} name={n} position={place(i)} scale={3} />)}</Suspense>
        <Labels />
        <OrbitControls target={[(COLS * GAP) / 2 - 2, 0, (rows * GAP) / 2 - 2]} />
      </Canvas>
      {names.map((n, i) => <div key={n} ref={(e) => { els[i] = e; }} style={{ position: 'fixed', left: 0, top: 0, font: '12px monospace', color: '#000', background: '#fff8', pointerEvents: 'none' }}>{i}:{n}</div>)}
    </>
  );
}
