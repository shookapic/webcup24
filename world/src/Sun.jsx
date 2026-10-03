import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { playerPos } from './layout.js';

// One warm key light with a single shadow map, framed around the player (1024 low / 2048 high via `size`).
const OFFSET = [28, 40, 22];
export function Sun({ size = 2048, shadows = true }) {
  const light = useRef();
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    // Snap to a 1 m grid so the shadow texels don't swim while walking.
    const x = Math.round(playerPos.x);
    const z = Math.round(playerPos.z);
    l.position.set(x + OFFSET[0], OFFSET[1], z + OFFSET[2]);
    l.target.position.set(x, 0, z);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight ref={light} color="#ffe0bd" intensity={2.6} castShadow={shadows} shadow-mapSize={[size, size]} shadow-bias={-0.0004} shadow-normalBias={0.04}
      shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-camera-near={1} shadow-camera-far={140} />
  );
}
