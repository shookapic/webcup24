import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Colonist } from './Colonist.jsx';

// Live 3D preview for A's AvatarEditor (`preview` prop): the same Colonist renderer, so colours, look and accessory
// shown here are exactly what the world draws. Slow turntable unless reduced motion is requested. Decorative: aria-hidden.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function AvatarPreview({ avatar, size = 220 }) {
  return (
    <div aria-hidden="true" style={{ width: size, height: size * 1.25 }}>
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 1.0, 3.6], fov: 32 }} gl={{ antialias: true }}>
        <hemisphereLight args={['#b9d0e0', '#8a6c58', 1.7]} />
        <directionalLight position={[3, 5, 4]} intensity={2.4} color="#ffe0bd" />
        <Suspense fallback={null}>
          <Colonist avatar={avatar} reducedMotion={reduced} rotation-y={reduced ? 0.5 : undefined} position-y={-0.1} getState={() => ({ speed: 0, air: false })} />
        </Suspense>
      </Canvas>
    </div>
  );
}
