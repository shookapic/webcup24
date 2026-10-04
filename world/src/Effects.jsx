import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

// Loaded lazily (high quality only): glow materials use toneMapped={false} and intensity > 1, so only they cross the bloom threshold.
export default function Effects() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur luminanceThreshold={1} intensity={0.9} />
      <Vignette offset={0.3} darkness={0.55} />
    </EffectComposer>
  );
}
