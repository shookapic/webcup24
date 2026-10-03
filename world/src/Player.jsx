import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { KeyboardControls, useKeyboardControls } from '@react-three/drei';
import { Ecctrl } from 'ecctrl';
import { EcctrlCameraControls } from 'ecctrl/camera';
import { Avatar } from './Avatar.jsx';
import { Multiplayer } from './Multiplayer.jsx';
import { debug, record } from './debug.js';
import { Euler, Vector3 } from 'three';

const probeEuler = new Euler();
const probeRendered = new Vector3();
const probeDir = new Vector3();

const keyboardMap = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW', 'KeyZ'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'leftward', keys: ['ArrowLeft', 'KeyA', 'KeyQ'] },
  { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['Shift'] },
];

const HEAD = 0.7;
const MAX_STEP = 1 / 30; // clamp after tab switches / hitches. Measured: 1/20 makes the yaw spring ring at 20 fps; below 30 fps the game slows down instead

// One physics step per rendered frame, in a fixed order (Physics is paused, we drive it):
// ecctrl applies its impulses in its own useFrame → step here → camera follows the new pose.
// ecctrl scales impulses by 60 * world.timestep, which assumes exactly this one-step-per-frame loop.
function FrameStep({ after }) {
  const { step } = useRapier();
  useFrame((state, delta) => {
    step(Math.min(delta, MAX_STEP));
    after(state);
  });
  return null;
}
const distance = { tps: 7, fps: 0.01 };

export function Player(props) {
  return (
    <KeyboardControls map={keyboardMap}>
      <Character {...props} />
    </KeyboardControls>
  );
}

function Character({ avatar, view, reducedMotion }) {
  const ecctrl = useRef();
  const controls = useRef();
  const avatarGroup = useRef();
  const [, getKeys] = useKeyboardControls();

  useEffect(() => {
    controls.current?.dollyTo(distance[view], !reducedMotion);
  }, [view, reducedMotion]);

  const follow = ({ camera, clock }) => {
    if (!ecctrl.current?.body || !controls.current) return;
    // ecctrl v2 does not read the keyboard itself; it picks this up next frame.
    ecctrl.current.setMovement(debug.input ?? getKeys());
    const { x, y, z } = ecctrl.current.body.translation();
    controls.current.moveTo(x, y + HEAD, z, !reducedMotion);
    if (debug.enabled) {
      const e = ecctrl.current;
      probeEuler.setFromQuaternion(e.currQuat, 'YXZ');
      avatarGroup.current.getWorldPosition(probeRendered);
      camera.getWorldDirection(probeDir);
      record({
        t: clock.elapsedTime,
        x, y, z,
        vx: e.currLinVel.x, vz: e.currLinVel.z,
        yaw: probeEuler.y, pitch: probeEuler.x, roll: probeEuler.z,
        rx: probeRendered.x, rz: probeRendered.z,
        cx: camera.position.x, cz: camera.position.z,
        camYaw: Math.atan2(probeDir.x, probeDir.z),
        ground: e.isOnGround,
      });
    }
  };

  return (
    <>
      <Ecctrl
        ref={ecctrl}
        position={[0, 3, 8]}
        capsuleHalfHeight={0.4}
        capsuleRadius={0.35}
        maxWalkVel={4}
        maxRunVel={8}
        jumpVel={6}
        enableToggleRun={false}
        // Measured: default 0.2 stops in ~0.5 s; 0.35 stops in < 0.3 s.
        decDeltaTime={0.35}
        // Default yaw damping 0.006 rings 4–6 times when turning; this settles without overshoot.
        autoBalanceDampingOnY={0.02}
        // Upright capsule: only yaw may rotate, so the off-centre move impulse can't rock the body.
        enabledRotations={[false, true, false]}
        autoBalance={false}
      >
        <group ref={avatarGroup}>
          <Avatar avatar={avatar} visible={view !== 'fps'} />
        </group>
      </Ecctrl>
      <FrameStep after={follow} />
      <Multiplayer ecctrl={ecctrl} />
      <EcctrlCameraControls
        ref={controls}
        makeDefault
        smoothTime={reducedMotion ? 0 : 0.1}
        minDistance={0.01}
        maxDistance={20}
        maxPolarAngle={1.55}
        distance={distance[view]}
        polarAngle={1.2}
      />
    </>
  );
}
