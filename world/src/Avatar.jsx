export const defaultAvatar = { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' };

// Low-poly colonist: body, head, visor, backpack. Faces +z.
export function Avatar({ avatar = defaultAvatar, ...props }) {
  const { skin, outfit, accent } = { ...defaultAvatar, ...avatar };
  return (
    <group {...props}>
      <mesh position-y={-0.1}>
        <capsuleGeometry args={[0.35, 0.6, 4, 12]} />
        <meshStandardMaterial color={outfit} roughness={0.7} />
      </mesh>
      <mesh position-y={0.62}>
        <sphereGeometry args={[0.28, 16, 12]} />
        <meshStandardMaterial color={skin} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.66, 0.2]}>
        <boxGeometry args={[0.36, 0.1, 0.14]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, -0.38]}>
        <boxGeometry args={[0.4, 0.5, 0.18]} />
        <meshStandardMaterial color={accent} roughness={0.5} />
      </mesh>
    </group>
  );
}
