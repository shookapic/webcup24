import { useMemo } from 'react';
import { Object3D } from 'three';

const glow = (color, intensity = 2) => ({ color, emissive: color, emissiveIntensity: intensity, toneMapped: false });

function Dome({ radius, position = [0, 0, 0], color = '#d8e4ef' }) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.25} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.15}>
        <torusGeometry args={[radius, 0.18, 8, 48]} />
        <meshStandardMaterial {...glow('#5ee7ff')} />
      </mesh>
    </group>
  );
}

function Tower({ height, radius }) {
  return (
    <group>
      <mesh position-y={height / 2}>
        <cylinderGeometry args={[radius * 0.7, radius, height, 16]} />
        <meshStandardMaterial color="#e9e2da" metalness={0.4} roughness={0.35} />
      </mesh>
      {[0.35, 0.6, 0.85].map((t) => (
        <mesh key={t} position-y={height * t}>
          <cylinderGeometry args={[radius * (1 - t * 0.3) + 0.05, radius * (1 - t * 0.3) + 0.05, 0.3, 16]} />
          <meshStandardMaterial {...glow('#ff4fa3')} />
        </mesh>
      ))}
      <mesh position-y={height + 1.5}>
        <coneGeometry args={[radius * 0.4, 3, 12]} />
        <meshStandardMaterial {...glow('#ffd36e', 3)} />
      </mesh>
    </group>
  );
}

function Block({ size, position, color = '#cfc6bd', window = '#5ee7ff' }) {
  const [w, h, d] = size;
  return (
    <group position={position}>
      <mesh position-y={h / 2}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, h * 0.6, d / 2 + 0.01]}>
        <planeGeometry args={[w * 0.8, h * 0.15]} />
        <meshStandardMaterial {...glow(window, 1.5)} />
      </mesh>
    </group>
  );
}

function Mairie() {
  return (
    <group position={[0, 0, -22]}>
      <Tower height={22} radius={3} />
      <Dome radius={7} color="#c9d6e3" />
    </group>
  );
}

function Sante() {
  return (
    <group position={[32, 0, -6]}>
      <Dome radius={6} color="#f4f7fa" />
      <mesh position-y={7.5}>
        <boxGeometry args={[3, 0.8, 0.8]} />
        <meshStandardMaterial {...glow('#4cff9a', 3)} />
      </mesh>
      <mesh position-y={7.5}>
        <boxGeometry args={[0.8, 3, 0.8]} />
        <meshStandardMaterial {...glow('#4cff9a', 3)} />
      </mesh>
      <Block size={[6, 3, 4]} position={[7, 0, 3]} color="#e8eef2" window="#4cff9a" />
    </group>
  );
}

function QuartierSud() {
  return (
    <group position={[0, 0, 38]}>
      {[[-8, 0, -2], [-2, 0, 3], [5, 0, -1], [10, 0, 4], [-12, 0, 6]].map((p, i) => (
        <Dome key={i} radius={2.4} position={p} color="#d9cbbd" />
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.15, 14]}>
        <ringGeometry args={[0, 12, 48, 12]} />
        <meshStandardMaterial color="#2a7fb8" emissive="#0d3b5c" roughness={0.2} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function Marche() {
  return (
    <group position={[-32, 0, -2]}>
      {['#ff4fa3', '#ffd36e', '#5ee7ff', '#4cff9a'].map((color, i) => (
        <group key={color} position={[(i % 2) * 6 - 3, 0, Math.floor(i / 2) * 6 - 3]}>
          <Block size={[4, 2.2, 3]} position={[0, 0, 0]} />
          <mesh position-y={2.6} rotation-x={0.15}>
            <boxGeometry args={[4.6, 0.15, 3.6]} />
            <meshStandardMaterial color={color} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Habitat() {
  return (
    <group position={[-24, 0, -40]}>
      <Block size={[6, 8, 6]} position={[0, 0, 0]} />
      <Block size={[5, 12, 5]} position={[8, 0, 2]} window="#ffd36e" />
      <Block size={[7, 6, 5]} position={[-7, 0, 3]} window="#ff4fa3" />
    </group>
  );
}

export function Rocks() {
  const matrices = useMemo(() => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const dummy = new Object3D();
    return Array.from({ length: 160 }, () => {
      const angle = random() * Math.PI * 2;
      const distance = 50 + random() * 140;
      dummy.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
      dummy.rotation.set(random() * 3, random() * 3, random() * 3);
      dummy.scale.setScalar(0.5 + random() * 2.5);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
  }, []);
  return (
    <instancedMesh args={[null, null, matrices.length]} ref={(mesh) => mesh && matrices.forEach((m, i) => mesh.setMatrixAt(i, m))}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#7a3420" roughness={1} flatShading />
    </instancedMesh>
  );
}

const paths = [[0, -11, 3, 22, 0], [16, -3, 30, 3, 0], [-16, -1, 30, 3, 0], [0, 19, 3, 36, 0], [-12, -30, 3, 22, 0.5]];

export function Ground() {
  return (
    <mesh rotation-x={-Math.PI / 2}>
      {/* subdivided so the curve shader has vertices to bend */}
      <planeGeometry args={[440, 440, 160, 160]} />
      <meshStandardMaterial color="#b5532c" roughness={1} />
    </mesh>
  );
}

// Everything here gets an automatic box collider.
export function City() {
  return (
    <>
      {paths.map(([x, z, w, d, turn]) => (
        <mesh key={`${x},${z}`} rotation={[-Math.PI / 2, 0, turn]} position={[x, 0.02, z]}>
          <planeGeometry args={[w, d, Math.ceil(w / 2), Math.ceil(d / 2)]} />
          <meshStandardMaterial color="#e0a27a" roughness={0.9} />
        </mesh>
      ))}
      <Mairie />
      <Sante />
      <QuartierSud />
      <Marche />
      <Habitat />
    </>
  );
}
