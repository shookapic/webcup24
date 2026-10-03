import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { KeyboardControls, useKeyboardControls } from '@react-three/drei';
import { Ecctrl } from 'ecctrl';
import { EcctrlCameraControls } from 'ecctrl/camera';
import { Avatar } from './Avatar.jsx';

const keyboardMap = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW', 'KeyZ'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'leftward', keys: ['ArrowLeft', 'KeyA', 'KeyQ'] },
  { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['Shift'] },
];

const HEAD = 0.7;
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
  const [, getKeys] = useKeyboardControls();

  useEffect(() => {
    controls.current?.dollyTo(distance[view], !reducedMotion);
  }, [view, reducedMotion]);

  useFrame(() => {
    if (!ecctrl.current || !controls.current) return;
    // ecctrl v2 does not read the keyboard itself.
    ecctrl.current.setMovement(getKeys());
    const { x, y, z } = ecctrl.current.currPos;
    controls.current.moveTo(x, y + HEAD, z, !reducedMotion);
  });

  return (
    <>
      <Ecctrl ref={ecctrl} position={[0, 3, 8]} capsuleHalfHeight={0.4} capsuleRadius={0.35} maxWalkVel={4} maxRunVel={9} jumpVel={6}>
        <Avatar avatar={avatar} visible={view !== 'fps'} />
      </Ecctrl>
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
