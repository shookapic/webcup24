import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { Ecctrl } from 'ecctrl';
import { EcctrlCameraControls } from 'ecctrl/camera';
import { Colonist, FEET_BELOW_BODY } from './Colonist.jsx';
import { Multiplayer } from './Multiplayer.jsx';
import { debug, record } from './debug.js';
import { useMovementInput } from './input.js';
import { Euler, Vector3 } from 'three';
import { BOUNDS, SPAWN, cameraBlockers, playerPos } from './layout.js';

const probeEuler = new Euler();
const probeRendered = new Vector3();
const probeDir = new Vector3();

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
const distance = { tps: 9, fps: 0.01 };
// Wheel zoom stays inside these; FPS is pinned so it can never end up half zoomed out.
const zoomRange = { tps: [3, 16], fps: [0.01, 0.01] };

export function Player({ avatar, view, reducedMotion, inputEnabled }) {
  const ecctrl = useRef();
  const controls = useRef();
  const avatarGroup = useRef();
  const getKeys = useMovementInput(inputEnabled);
  useEffect(() => { if (debug.enabled) { debug.ecctrl = ecctrl.current; debug.controls = controls.current; } });

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    [c.minDistance, c.maxDistance] = zoomRange[view];
    c.dollyTo(distance[view], !reducedMotion);
    c.colliderMeshes = cameraBlockers; // camera pulls in instead of passing through walls
  }, [view, reducedMotion]);

  const gait = () => {
    const e = ecctrl.current;
    return e ? { speed: Math.hypot(e.currLinVel.x, e.currLinVel.z), air: !e.isOnGround } : null;
  };

  const follow = ({ camera, clock }) => {
    if (!ecctrl.current?.body || !controls.current) return;
    // ecctrl v2 does not read the keyboard itself; it picks this up next frame.
    ecctrl.current.setMovement(debug.input ?? getKeys());
    const body = ecctrl.current.body;
    let { x, y, z } = body.translation();
    if (y < -5 || Math.abs(x) > BOUNDS + 3 || Math.abs(z) > BOUNDS + 3) { // fell through or escaped: back to spawn
      body.setTranslation({ x: SPAWN[0], y: SPAWN[1], z: SPAWN[2] }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      [x, y, z] = SPAWN;
    }
    if (!debug.freecam) controls.current.moveTo(x, y + HEAD, z, !reducedMotion); // freecam: QA drives the camera itself
    playerPos.x = x;
    playerPos.z = z;
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
        position={SPAWN}
        rotation={[0, Math.PI, 0]}
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
          <Colonist avatar={avatar} visible={view !== 'fps'} reducedMotion={reducedMotion} getState={gait} position-y={-FEET_BELOW_BODY} />
        </group>
      </Ecctrl>
      <FrameStep after={follow} />
      <Multiplayer ecctrl={ecctrl} />
      <EcctrlCameraControls
        ref={controls}
        makeDefault
        smoothTime={reducedMotion ? 0 : 0.1}
        maxPolarAngle={1.55}
        distance={distance[view]}
        polarAngle={1.2}
      />
    </>
  );
}
