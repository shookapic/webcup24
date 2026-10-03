import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Color, MeshStandardMaterial } from 'three';

// Kenney Space Kit (CC0), re-coloured to the colony palette by material name. See docs/ASSETS.md.
// All kit models travel in ONE glb (tools/pack-models.mjs, sources in world/assets-src/kit): one request instead of ~19.
export const kitPack = `${import.meta.env.BASE_URL}assets/models/kit-pack.glb`;
useGLTF.preload(kitPack);

// Shared materials: one per kit material name, never mutated per instance.
const palette = {
  metal: { color: '#e5e0d4', roughness: 0.85, metalness: 0 },        // chalk
  metalDark: { color: '#6c7f89', roughness: 0.7, metalness: 0.1 },   // slate trim
  metalRed: { color: '#a9654a', roughness: 0.8, metalness: 0 },       // terracotta
  dark: { color: '#3b5a66', roughness: 0.3, metalness: 0.25 },        // inset windows
  rock: { color: '#8a5a45', roughness: 1, metalness: 0 },
  rockTrack: { color: '#cdb59b', roughness: 1, metalness: 0 },        // paved
  skin: { color: '#e9ba69', roughness: 0.8, metalness: 0 },
};
// Per-district accent: replaces the terracotta `metalRed` (district identity without new assets).
export const variants = { sante: '#4a8c87', marche: '#d09a3e', habitat: '#688c73', sud: '#3f6f8f', tram1: '#b8336a', tram2: '#1d6fa5' };
const shared = new Map();
export function kitMaterial(name, variant) {
  const key = `${variant ?? ''}:${name}`;
  if (!shared.has(key)) {
    const spec = { ...(palette[name] ?? { color: '#cccccc', roughness: 0.9, metalness: 0 }) };
    if (name === 'metalRed' && variants[variant]) spec.color = variants[variant];
    shared.set(key, new MeshStandardMaterial({ ...spec, color: new Color(spec.color) }));
  }
  return shared.get(key);
}

// A kit model with palette materials. Geometry is shared with the cached glTF; `scale` is uniform.
export function Prop({ name, scale = 1, shadows = true, variant, ...props }) {
  const { scene } = useGLTF(kitPack);
  const object = useMemo(() => {
    const source = scene.getObjectByName(name);
    if (!source) throw new Error(`Unknown kit model ${name}`);
    const clone = source.clone(true);
    // The kit exports every model under a root node translated by [2, 0, 1.5] (measured on all glb files), so a model drawn
    // at x,z sits 2 x 1.5 units away from it. Zero that horizontal offset on the clone; geometry stays centred on its footprint.
    clone.position.set(0, clone.position.y, 0);
    clone.traverse((child) => {
      if (!child.isMesh) return;
      child.material = kitMaterial(child.material?.name, variant);
      child.castShadow = shadows;
      child.receiveShadow = shadows;
    });
    return clone;
  }, [scene, name, shadows, variant]);
  return <primitive object={object} scale={scale} {...props} />;
}
