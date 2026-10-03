import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Color, MeshStandardMaterial } from 'three';
import { curved } from './curve.js';

// Kenney Space Kit (CC0), re-coloured to the colony palette by material name. See docs/ASSETS.md.
export const kitUrl = (name) => `${import.meta.env.BASE_URL}assets/models/kit/${name}.glb`;

// Shared materials: one per kit material name, never mutated per instance.
const palette = {
  metal: { color: '#e5e0d4', roughness: 0.85, metalness: 0 },        // chalk
  metalDark: { color: '#4b5a63', roughness: 0.7, metalness: 0.15 },   // slate trim
  metalRed: { color: '#a9654a', roughness: 0.8, metalness: 0 },       // terracotta
  dark: { color: '#27363f', roughness: 0.35, metalness: 0.2 },        // inset windows
  rock: { color: '#8a5a45', roughness: 1, metalness: 0 },
  rockTrack: { color: '#cdb59b', roughness: 1, metalness: 0 },        // paved
  skin: { color: '#e9ba69', roughness: 0.8, metalness: 0 },
};
const shared = new Map();
export function kitMaterial(name) {
  if (!shared.has(name)) {
    const spec = palette[name] ?? { color: '#cccccc', roughness: 0.9, metalness: 0 };
    shared.set(name, curved(new MeshStandardMaterial({ ...spec, color: new Color(spec.color) })));
  }
  return shared.get(name);
}

// A kit model with palette materials. Geometry is shared with the cached glTF; `scale` is uniform.
export function Prop({ name, scale = 1, shadows = true, ...props }) {
  const { scene } = useGLTF(kitUrl(name));
  const object = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (!child.isMesh) return;
      child.material = kitMaterial(child.material?.name);
      child.castShadow = shadows;
      child.receiveShadow = shadows;
    });
    return clone;
  }, [scene, shadows]);
  return <primitive object={object} scale={scale} {...props} />;
}
