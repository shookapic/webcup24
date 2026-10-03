import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { BackSide, AdditiveBlending } from 'three';

const skyShader = {
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vDir;
    void main() {
      float h = clamp(vDir.y, 0.0, 1.0);
      vec3 color = mix(vec3(1.0, 0.45, 0.27), vec3(0.45, 0.12, 0.32), smoothstep(0.0, 0.15, h));
      color = mix(color, vec3(0.04, 0.02, 0.08), smoothstep(0.1, 0.6, h));
      // Colours are picked in sRGB; convert to linear so composer/output conversion lands on them.
      gl_FragColor = vec4(pow(color, vec3(2.2)), 1.0);
      #include <colorspace_fragment>
    }`,
};

const giantShader = {
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vPos;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform float uTime;
    varying vec3 vNormal;
    varying vec3 vPos;
    void main() {
      float lat = normalize(vPos).y;
      float bands = sin(lat * 22.0 + sin(lat * 7.0 + uTime * 0.05) * 1.5);
      vec3 color = mix(vec3(0.85, 0.42, 0.25), vec3(0.98, 0.78, 0.55), bands * 0.5 + 0.5);
      float light = clamp(dot(vNormal, normalize(vec3(0.6, 0.2, 0.8))), 0.0, 1.0);
      gl_FragColor = vec4(pow(color * (0.15 + light), vec3(2.2)), 1.0);
      #include <colorspace_fragment>
    }`,
};

const glowShader = {
  vertexShader: `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vNormal;
    void main() {
      float rim = pow(1.0 - abs(vNormal.z), 3.0);
      gl_FragColor = vec4(pow(vec3(1.0, 0.55, 0.35), vec3(2.2)) * rim, rim);
      #include <colorspace_fragment>
    }`,
};

export function Sky({ reducedMotion }) {
  const giant = useRef();
  useFrame(({ clock }) => {
    if (!reducedMotion) giant.current.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <>
      <mesh>
        <sphereGeometry args={[450, 32, 16]} />
        <shaderMaterial args={[skyShader]} side={BackSide} depthWrite={false} />
      </mesh>
      <Stars radius={300} depth={60} count={3000} factor={6} fade speed={reducedMotion ? 0 : 0.5} />
      <group position={[-220, 90, -330]}>
        <mesh>
          <sphereGeometry args={[70, 64, 32]} />
          <shaderMaterial ref={giant} args={[giantShader]} />
        </mesh>
        <mesh scale={1.12}>
          <sphereGeometry args={[70, 64, 32]} />
          <shaderMaterial args={[glowShader]} side={BackSide} transparent blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
}
