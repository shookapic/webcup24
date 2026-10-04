import { useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { Color, MeshStandardMaterial, Vector3 } from 'three';
import { PhoneScreen } from './Phone.jsx';
import { useDialogFocus } from './ui/useDialog.js';

// Physical handheld phone: a camera-child device + gloved hand drawn over the world (no depth test, fixed draw order, so
// it never clips into walls and never gets bloom), and an HTML host whose CSS matrix3d follows the projected screen quad.
// The Canvas never renders HTML; the host is ordinary DOM above it (see CLAUDE.md "B's PhoneRig").
export const SCREEN_PX = { w: 360, h: 766 }; // layout size of the DOM screen; the transform scales it onto the 3D quad

const PHONE = { w: 0.108, h: 0.222, d: 0.011 };
const SCREEN = { w: 0.094, h: 0.2 };
// Held square to the camera: the screen quad projects to an axis-aligned rectangle, so the DOM host needs only translate + scale
// (no perspective, no rotation: sliced/missing glyphs were reported with projective matrix3d text in Firefox).
const projective = new URLSearchParams(location.search).has('phoneproj'); // diagnostics only: the previous tilted pose + full matrix3d placement
const REST = projective ? { x: 0.025, y: -0.005, z: -0.29, rx: -0.14, ry: 0.1, rz: -0.05 } : { x: 0.025, y: -0.005, z: -0.29, rx: 0, ry: 0, rz: 0 };
const HIDDEN_Y = -0.42; // lowered out of view

// Projected screen corners in CSS px, order: top-left, top-right, bottom-right, bottom-left. Written by the rig, read by the host.
export const bridge = { corners: new Float32Array(8), ready: false, alpha: 0 };

const corner = new Vector3();
const local = [[-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]];

const mat = (color, extra = {}) => {
  const m = new MeshStandardMaterial({ color: new Color(color), roughness: 0.75, metalness: 0, depthTest: false, ...extra });
  return m;
};

function Part({ order, material, children, ...props }) {
  return <mesh renderOrder={order} material={material} {...props}>{children}</mesh>;
}

function Device({ outfit, screen }) {
  const m = useMemo(() => ({
    body: mat('#2d3b44', { roughness: 0.45, metalness: 0.35 }),
    trim: mat('#a9654a', { roughness: 0.55, metalness: 0.3 }),
    glass: mat('#0c1217', { roughness: 0.12, metalness: 0.6 }),
    button: mat('#e5e0d4', { roughness: 0.4, metalness: 0.5 }),
    lens: mat('#05080a', { roughness: 0.1, metalness: 0.9 }),
    glove: mat('#293d49', { roughness: 0.85 }),
    gloveLight: mat('#34505e', { roughness: 0.85 }),
    sleeve: mat(outfit, { roughness: 0.9 }),
    cuff: mat('#e5e0d4', { roughness: 0.9 }),
  }), [outfit]);
  const { w, h, d } = PHONE;
  return (
    <>
      {/* forearm: sleeve, cuff, glove, entering from the lower right behind the device */}
      <group position={[0.075, -0.2, -0.045]} rotation={[0.25, -0.1, 0.62]}>
        <Part order={0} material={m.sleeve} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.044, 0.05, 0.34, 20]} /></Part>
        <Part order={0} material={m.cuff} position-z={-0.17} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.047, 0.047, 0.03, 20]} /></Part>
        <Part order={0} material={m.glove} position-z={-0.26} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.038, 0.042, 0.17, 20]} /></Part>
      </group>
      {/* palm behind the device */}
      <Part order={1} material={m.glove} position={[0.012, -0.04, -0.026]} rotation={[0.1, 0, 0.05]}><boxGeometry args={[0.088, 0.09, 0.03]} /></Part>
      {/* body: rounded slab with a terracotta back plate edge */}
      <RoundedBox args={[w, h, d]} radius={0.014} smoothness={4} renderOrder={2} material={m.body} />
      <RoundedBox args={[w + 0.004, h + 0.004, d * 0.45]} radius={0.015} smoothness={3} renderOrder={1} position-z={-d * 0.2} material={m.trim} />
      {/* side controls */}
      <Part order={2} material={m.button} position={[w / 2 + 0.0015, 0.045, 0]}><boxGeometry args={[0.004, 0.034, 0.005]} /></Part>
      <Part order={2} material={m.button} position={[w / 2 + 0.0015, 0.0, 0]}><boxGeometry args={[0.004, 0.02, 0.005]} /></Part>
      <Part order={2} material={m.button} position={[-w / 2 - 0.0015, 0.06, 0]}><boxGeometry args={[0.004, 0.024, 0.005]} /></Part>
      {/* recessed glass + bezel */}
      <RoundedBox args={[SCREEN.w + 0.006, SCREEN.h + 0.006, 0.0012]} radius={0.007} smoothness={3} renderOrder={3} position-z={d / 2 + 0.0004} material={m.lens} />
      <mesh ref={screen} renderOrder={4} position-z={d / 2 + 0.0016} material={m.glass}><planeGeometry args={[SCREEN.w, SCREEN.h]} /></mesh>
      {/* speaker slit + camera dot sit in the bezel, above the screen */}
      <Part order={5} material={m.button} position={[0, h / 2 - 0.0035, d / 2 + 0.0018]}><boxGeometry args={[0.022, 0.0016, 0.0006]} /></Part>
      <Part order={5} material={m.lens} position={[0.02, h / 2 - 0.0035, d / 2 + 0.0018]}><cylinderGeometry args={[0.0017, 0.0017, 0.0006, 12]} /></Part>
      {/* fingers wrapping the left edge, thumb on the lower right of the bezel */}
      {[0.06, 0.025, -0.01, -0.045].map((y, i) => (
        <Part key={y} order={6} material={i % 2 ? m.gloveLight : m.glove} position={[-w / 2 - 0.003, y - 0.015, 0.002]} rotation={[0, 0, 0.12 - i * 0.03]}>
          <capsuleGeometry args={[0.0082, 0.03, 4, 10]} />
        </Part>
      ))}
      <Part order={6} material={m.glove} position={[w / 2 - 0.006, -h / 2 + 0.032, d / 2 + 0.003]} rotation={[0.2, 0.1, 0.9]}>
        <capsuleGeometry args={[0.0125, 0.048, 4, 10]} />
      </Part>
    </>
  );
}

// Inside <Canvas>. phase: opening | open | closing. Pose follows phase; reduced motion jumps straight to the end pose.
export function PhoneRig({ phase, reducedMotion, outfit = '#3a6ea5' }) {
  const { camera, scene, size } = useThree();
  const group = useRef();
  const screen = useRef();
  const amount = useRef(reducedMotion ? 1 : 0); // 0 lowered .. 1 raised

  useEffect(() => {
    scene.add(camera); // camera children are only drawn when the camera is part of the scene
    return () => { scene.remove(camera); bridge.ready = false; };
  }, [camera, scene]);

  useFrame((_, delta) => {
    const g = group.current;
    const s = screen.current;
    if (!g || !s) return;
    const target = phase === 'closing' ? 0 : 1;
    amount.current = reducedMotion ? target : amount.current + Math.sign(target - amount.current) * Math.min(Math.abs(target - amount.current), delta / 0.28);
    const t = amount.current;
    const ease = t * t * (3 - 2 * t);
    g.position.set(REST.x, HIDDEN_Y + (REST.y - HIDDEN_Y) * ease, REST.z - (1 - ease) * 0.05);
    g.rotation.set(REST.rx - (1 - ease) * 0.5, REST.ry, REST.rz);
    // Project the four screen corners to CSS px for the DOM host.
    camera.updateMatrixWorld();
    g.updateMatrixWorld(true);
    local.forEach(([x, y], i) => {
      corner.set(x * SCREEN.w, y * SCREEN.h, 0);
      s.localToWorld(corner).project(camera);
      bridge.corners[i * 2] = ((corner.x + 1) / 2) * size.width;
      bridge.corners[i * 2 + 1] = ((1 - corner.y) / 2) * size.height;
    });
    bridge.alpha = t;
    bridge.ready = true;
  });

  return createPortal(
    <group ref={group}>
      <Device outfit={outfit} screen={screen} />
    </group>,
    camera,
  );
}

// Homography taking the (0,0) (w,0) (w,h) (0,h) rectangle onto four points, as a CSS matrix3d string.
export function quadToMatrix3d(w, h, [x0, y0, x1, y1, x2, y2, x3, y3]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const hh = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
  // unit square -> quad is [a b c; d e f; g hh 1]; pre-scale by 1/w, 1/h so the element's own px space maps in.
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.join(',')})`;
}

// DOM host for A's PhoneScreen: fixed-size box, transformed onto the projected 3D screen each frame. One focusable instance.
export function PhoneHost({ screenProps }) {
  const host = useRef();
  useDialogFocus(host, true);
  useEffect(() => {
    let frame;
    let applied = '';
    const place = () => {
      const el = host.current;
      if (el && bridge.ready) {
        const c = bridge.corners;
        let transform;
        if (projective) transform = quadToMatrix3d(SCREEN_PX.w, SCREEN_PX.h, c);
        else {
          const left = Math.min(c[0], c[2], c[4], c[6]);
          const top = Math.min(c[1], c[3], c[5], c[7]);
          const sx = (Math.max(c[0], c[2], c[4], c[6]) - left) / SCREEN_PX.w;
          const sy = (Math.max(c[1], c[3], c[5], c[7]) - top) / SCREEN_PX.h;
          // Whole-pixel position and a quantised scale: a steady phone writes nothing, a moving one never re-rasterises at fractions.
          transform = `translate(${Math.round(left)}px, ${Math.round(top)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
        }
        const opacity = bridge.alpha > 0.55 ? '1' : '0'; // screen lights up once the device is mostly raised
        const key = transform + opacity;
        if (key !== applied) {
          applied = key;
          el.style.transform = transform;
          el.style.opacity = opacity;
        }
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      ref={host}
      className="phone-host"
      role="dialog"
      aria-modal="true"
      aria-label={screenProps.dialogLabel}
      style={{ position: 'fixed', left: 0, top: 0, width: SCREEN_PX.w, height: SCREEN_PX.h, transformOrigin: '0 0', zIndex: 20, opacity: 0, willChange: 'transform' }}
    >
      <PhoneScreen {...screenProps} />
    </div>
  );
}
