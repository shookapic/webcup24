import { ShaderChunk } from 'three';

// Bend every built-in material down with distance from the camera, so the flat ground reads as a small planet.
// ponytail: no shadow maps — the shadow pass would bend around the light instead of the camera.
export const CURVE = 0.0015;

const from = 'mvPosition = modelViewMatrix * mvPosition;';
if (!ShaderChunk.project_vertex.includes(from)) console.warn('curve.js: three changed project_vertex, world is flat');
ShaderChunk.project_vertex = ShaderChunk.project_vertex.replace(from, `
  vec4 tnWorld = modelMatrix * mvPosition;
  vec2 tnOffset = tnWorld.xz - cameraPosition.xz;
  tnWorld.y -= dot(tnOffset, tnOffset) * ${CURVE};
  mvPosition = viewMatrix * tnWorld;`);
