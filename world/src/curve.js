// Scoped planet curvature. The playable square (|x|,|z| < FLAT, see layout.js BOUNDS) stays perfectly flat so physics,
// shadows, labels and characters never see it; only materials passed through `curved()` (ground, distant rocks) bend
// down with world-space distance from the origin. Static, camera independent, no global shader patching.
export const FLAT = 80;
export const CURVE = 0.004;

export function curved(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 tnLocal = vec4(transformed, 1.0);
       #ifdef USE_INSTANCING
         tnLocal = instanceMatrix * tnLocal;
       #endif
       vec4 tnWorld = modelMatrix * tnLocal;
       float tnRing = max(length(tnWorld.xz) - ${FLAT.toFixed(1)}, 0.0);
       tnWorld.y -= tnRing * tnRing * ${CURVE};
       vec4 mvPosition = viewMatrix * tnWorld;
       gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  material.customProgramCacheKey = () => 'tn-curved';
  return material;
}
