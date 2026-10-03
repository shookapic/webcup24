import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function Planet() {
  const mesh = useRef();
  useFrame((_, delta) => { if (!reducedMotion) mesh.current.rotation.y += delta * 0.1; });
  return (
    <mesh ref={mesh}>
      <sphereGeometry args={[1.5, 64, 64]} />
      <meshStandardMaterial color="#c4582f" roughness={0.9} />
    </mesh>
  );
}

export function App() {
  return (
    <>
      <Canvas aria-hidden="true" dpr={[1, 1.5]} camera={{ position: [0, 0, 5] }}>
        <color attach="background" args={['#0b0614']} />
        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 3, 5]} intensity={2} />
        <Planet />
      </Canvas>
      <a className="accessible-link" href="/">Version accessible</a>
    </>
  );
}
