import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import { City } from './City.jsx';
import { Player } from './Player.jsx';
import { debug } from './debug.js';

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
        <RigidBody type="fixed" colliders="cuboid">
          <City />
        </RigidBody>
      )}
      <Player {...props} />
    </Physics>
  );
}
