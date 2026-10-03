import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import { City } from './City.jsx';
import { Player } from './Player.jsx';

// Lazy-loaded: Rapier (WebAssembly) and ecctrl are ~2 MB gzipped, only players need them.
export default function PlayableCity(props) {
  return (
    <Physics>
      <CuboidCollider args={[220, 0.5, 220]} position={[0, -0.5, 0]} />
      <RigidBody type="fixed" colliders="cuboid">
        <City />
      </RigidBody>
      <Player {...props} />
    </Physics>
  );
}
