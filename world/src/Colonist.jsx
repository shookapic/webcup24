import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { AnimationMixer, LoopRepeat, MeshStandardMaterial, Source } from 'three';
import { debug } from './debug.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Rigged colonist: Kenney Blocky Characters "character-c" (CC0, see docs/ASSETS.md), clips idle / walk / sprint.
// Origin = feet, faces +z, ~1.6 m tall. Skin / outfit / accent recolour the shared atlas per colour set (cached).
const URL = `${import.meta.env.BASE_URL}assets/models/chars/character-c.glb`;
export const FEET_BELOW_BODY = 0.96; // ecctrl body centre above the floor at rest (measured, docs/QA_B.md)

useGLTF.preload(URL);

const hex = /^#[0-9a-f]{6}$/i;
export const defaultColors = { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' };
const clean = (avatar) => Object.fromEntries(Object.keys(defaultColors).map((k) => [k, hex.test(avatar?.[k]) ? avatar[k] : defaultColors[k]]));

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const rect = (x, y, w, h) => ({ x, y, w, h });
// Atlas regions in 1024 px space (same layout for every Kenney blocky texture).
const regions = {
  torso: rect(0, 688, 448, 336),
  arms: [rect(480, 534, 256, 234), rect(768, 534, 256, 234)],
  legs: rect(480, 800, 544, 224),
  head: rect(0, 0, 512, 384),
};
const textures = new Map(); // colour key -> Promise<Texture>

// Recolour the atlas: skin-coloured pixels (head, hands) -> skin; torso + sleeves -> outfit; legs -> accent.
// Shading is kept by scaling the new colour with each pixel's luminance relative to the region's mean.
function recolored(original, { skin, outfit, accent }) {
  const key = `${skin}${outfit}${accent}`;
  if (textures.has(key)) return textures.get(key);
  const pending = build(original, key, { skin, outfit, accent });
  textures.set(key, pending);
  return pending;
}

async function build(original, key, { skin, outfit, accent }) {
  const source = original.image;
  const size = source.width;
  const k = size / 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, size, size);
  const d = image.data;
  const px = (x, y) => (Math.floor(y * k) * size + Math.floor(x * k)) * 4;
  const base = (() => { const i = px(190, 350); return [d[i], d[i + 1], d[i + 2]]; })(); // chin strip = flat skin colour
  const target = (h) => [1, 3, 5].map((j) => parseInt(h.slice(j, j + 2), 16));
  const [sk, ou, ac] = [skin, outfit, accent].map(target);
  const baseLum = lum(...base);
  const isSkin = (i) => Math.hypot(d[i] - base[0], d[i + 1] - base[1], d[i + 2] - base[2]) < 55 + (255 - baseLum) * 0.1;
  const paint = (i, color, ref) => {
    const f = Math.min(1.5, Math.max(0.45, lum(d[i], d[i + 1], d[i + 2]) / ref));
    d[i] = Math.min(255, color[0] * f);
    d[i + 1] = Math.min(255, color[1] * f);
    d[i + 2] = Math.min(255, color[2] * f);
  };
  const each = (r, fn) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = px(x, y); if (d[i + 3] && Math.max(d[i], d[i + 1], d[i + 2]) > 70) fn(i, x, y); }
  };
  const mean = (r, filter = () => true) => { let s = 0, n = 0; each(r, (i, x, y) => { if (filter(i, x, y)) { s += lum(d[i], d[i + 1], d[i + 2]); n++; } }); return n ? s / n : 128; };
  const jobs = [];
  jobs.push([regions.head, isSkin, sk, baseLum]);
  jobs.push([regions.torso, (i) => !isSkin(i), ou, mean(regions.torso, (i) => !isSkin(i))]);
  for (const arm of regions.arms) {
    jobs.push([arm, (i, x, y) => !isSkin(i) && y < arm.y + 190, ou, mean(arm, (i, x, y) => !isSkin(i) && y < arm.y + 190)]);
    jobs.push([arm, isSkin, sk, baseLum]);
  }
  jobs.push([regions.legs, (i, x, y) => !isSkin(i), ac, mean(regions.legs, (i, x, y) => !isSkin(i))]);
  const hits = jobs.map(([r, filter, color, ref]) => { const list = []; each(r, (i, x, y) => filter(i, x, y) && list.push(i)); return [list, color, ref]; });
  for (const [list, color, ref] of hits) for (const i of list) paint(i, color, ref); // classify first, paint after, so one region's edit never changes another's test
  ctx.putImageData(image, 0, 0);
  if (debug.enabled) (debug.atlases ??= []).push({ out: canvas, source, key });
  // Same texture object settings as the glTF's own (flipY, colour space, UV transform), only the pixels differ.
  const texture = original.clone();
  // clone() shares the Source with the glTF texture: give it its own, or the next recolour starts from this one's pixels.
  texture.source = new Source(await createImageBitmap(canvas, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
  texture.needsUpdate = true;
  return texture;
}

const idleState = { speed: 0, air: false };

// `getState()` is read every frame: { speed (m/s horizontal), air }. Physics owns displacement; clips play in place.
export function Colonist({ avatar, getState, visible = true, reducedMotion, ...props }) {
  const { scene, animations } = useGLTF(URL);
  const colors = clean(avatar);
  const colorKey = `${colors.skin}${colors.outfit}${colors.accent}`;
  const object = useMemo(() => {
    const root = clone(scene);
    root.traverse((child) => {
      if (child.isMesh) {
        child.frustumCulled = false;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return root;
  }, [scene]);

  const material = useMemo(() => new MeshStandardMaterial({ roughness: 0.85, metalness: 0 }), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    let original;
    scene.traverse((child) => { if (child.isMesh && !original) original = child.material.map; });
    if (!original) return undefined;
    let live = true;
    recolored(original, colors).then((map) => {
      if (!live) return;
      material.map = map;
      material.needsUpdate = true;
      object.traverse((child) => { if (child.isMesh) child.material = material; });
    });
    return () => { live = false; };
  }, [object, material, scene, colorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const mixer = useMemo(() => new AnimationMixer(object), [object]);
  const actions = useMemo(() => Object.fromEntries(['idle', 'walk', 'sprint', 'sit'].map((name) => {
    const action = mixer.clipAction(animations.find((clip) => clip.name === name), object);
    action.setLoop(LoopRepeat, Infinity);
    return [name, action];
  })), [mixer, animations, object]);
  const current = useRef(null);
  const self = useRef({});
  self.current = { object, clip: () => current.current?.getClip().name, avatar: colors };
  useEffect(() => { if (debug.enabled) { (debug.colonists ??= new Set()).add(self); return () => debug.colonists.delete(self); } }, []);
  useEffect(() => () => mixer.stopAllAction(), [mixer]);

  useFrame((_, delta) => {
    const { speed, air, sit } = getState?.() ?? idleState;
    // Airborne: hold a mid-stride pose; otherwise pick the clip from horizontal speed.
    const name = sit ? 'sit' : speed < 0.4 && !air ? 'idle' : speed > 5.5 ? 'sprint' : 'walk';
    const action = actions[name];
    if (current.current !== action) {
      action.reset().fadeIn(0.2).play();
      current.current?.fadeOut(0.2);
      current.current = action;
    }
    // Clip speeds measured against ground motion: walk clip = 3.2 m/s, sprint clip = 7 m/s (docs/QA_B.md).
    action.timeScale = air ? 0 : name === 'walk' ? Math.max(0.5, speed / 3.2) : name === 'sprint' ? speed / 7 : 1;
    mixer.update(reducedMotion && name === 'idle' ? 0 : delta);
  });

  return (
    <group {...props} visible={visible}>
      <primitive object={object} />
    </group>
  );
}
