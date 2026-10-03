import { useEffect } from 'react';
import { Physics, RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier';
import { City } from './City.jsx';
import { Player } from './Player.jsx';
import { debug } from './debug.js';
import { footprints, BOUNDS, cameraBlockers } from './layout.js';

const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function Footprints() {
  useEffect(() => () => { cameraBlockers.length = 0; }, []);
  const register = (mesh) => mesh && !cameraBlockers.includes(mesh) && cameraBlockers.push(mesh);
  return (
    <RigidBody type="fixed" colliders={false}>
      {footprints.map((f, i) => f.shape === 'box' ? (
        <group key={i}>
          <CuboidCollider args={[f.w / 2, f.h / 2, f.d / 2]} position={[f.x, f.h / 2, f.z]} />
          <mesh ref={register} visible={false} position={[f.x, f.h / 2, f.z]}><boxGeometry args={[f.w, f.h, f.d]} /></mesh>
        </group>
      ) : (
        <group key={i}>
          <CylinderCollider args={[f.h / 2, f.r]} position={[f.x, f.h / 2, f.z]} />
          <mesh ref={register} visible={false} position={[f.x, f.h / 2, f.z]}><cylinderGeometry args={[f.r, f.r, f.h, 16]} /></mesh>
        </group>
      ))}
      {walls.map(([x, z]) => (
        <CuboidCollider key={`${x},${z}`} args={x ? [1, 20, BOUNDS] : [BOUNDS, 20, 1]} position={[x * (BOUNDS + 1), 20, z * (BOUNDS + 1)]} />
      ))}
    </RigidBody>
  );
}

// Lazy-loaded: Rapier (WebAssembly) and ecctrl are ~2 MB gzipped, only players need them.
export default function PlayableCity(props) {
  return (
    // Stepped manually once per frame by Player's FrameStep (see there for why).
    <Physics timeStep="vary" paused>
      {/* ecctrl only counts ground whose collider has a parent rigid body (collider.parent()). */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[220, 0.5, 220]} position={[0, -0.5, 0]} />
      </RigidBody>
      {!debug.floorOnly && (
        <>
          <City reducedMotion={props.reducedMotion} />
          <Footprints />
        </>
      )}
      <Player {...props} />
    </Physics>
  );
}
