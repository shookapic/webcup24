import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Sky } from './Sky.jsx';
import { City } from './City.jsx';
import { LabelLayer, LabelProjector } from './Labels.jsx';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function App() {
  return (
    <>
      <Canvas aria-hidden="true" dpr={[1, 1.5]} camera={{ position: [40, 30, 60], fov: 55, far: 1000 }}>
        <fog attach="fog" args={['#5a2238', 70, 230]} />
        <hemisphereLight args={['#ffb38a', '#3a1424', 0.6]} />
        <directionalLight position={[60, 40, 50]} intensity={2.2} color="#ffd9b8" />
        <Sky reducedMotion={reducedMotion} />
        <City />
        <LabelProjector />
        {/* ponytail: orbit camera until the player controller (task 3) lands */}
        <OrbitControls target={[0, 4, 0]} maxPolarAngle={1.45} minDistance={15} maxDistance={140} autoRotate={!reducedMotion} autoRotateSpeed={0.3} />
      </Canvas>
      <LabelLayer />
      <a className="accessible-link" href="/">Version accessible</a>
    </>
  );
}
