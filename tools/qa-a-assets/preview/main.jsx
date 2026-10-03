// Isolated preview of the hospital asset: R3F + the same GLTFLoader B's world uses, the colony's light (warm key + one shadow map,
// B's Sun.jsx numbers) and ground tone. It proves the GLB loads and looks right; it is NOT proof of in-city collision or performance.
// Query: ?view=front|three|back|human|tram|roof|compare  &ref=1 (collision box outline)  &model=/models/buildings/hospital-a-v001.glb
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Box3, Vector3, Mesh, Color, BoxGeometry, EdgesGeometry, LineSegments, LineBasicMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'three';
const modelUrl = params.get('model') || '/models/buildings/hospital-a-v001.glb';
const FOOT = [14.715, 6.75, 12.735];

const views = {
  front: { p: [0, 3.4, 27], t: [0, 3.4, 0], fov: 38 },
  three: { p: [21, 9.5, 23], t: [0, 3.3, 0], fov: 38 },
  back: { p: [-15, 6.5, -25], t: [0, 3.0, 0], fov: 38 },
  human: { p: [3.4, 1.65, 12.4], t: [0.2, 2.1, 5.2], fov: 52 },
  tram: { p: [0, 9.2, 12.5], t: [0, 3.2, 1.5], fov: 62 },        // from the T2 tram stop side: the stop is 12 m in front of the clinic centre, the rail at 9.2 m
  roof: { p: [-4, 20, 14], t: [0, 6.5, -1], fov: 44 },
  compare: { p: [12, 11, 40], t: [11, 3, 0], fov: 40 },
};

function Rig() {
  const { camera } = useThree();
  useEffect(() => {
    const v = views[view] ?? views.three;
    camera.position.set(...v.p);
    camera.fov = v.fov;
    camera.lookAt(...v.t);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

function Person({ position }) {
  // a 1.7 m stand-in (not B's colonist): capsule body + head in the avatar palette, only to show human scale
  return (
    <group position={position}>
      <mesh position={[0, 0.8, 0]} castShadow><capsuleGeometry args={[0.24, 0.9, 6, 12]} /><meshStandardMaterial color="#3a6ea5" roughness={0.8} /></mesh>
      <mesh position={[0, 1.52, 0]} castShadow><sphereGeometry args={[0.18, 16, 12]} /><meshStandardMaterial color="#e0ac69" roughness={0.8} /></mesh>
      <mesh position={[0, 0.5, -0.24]} castShadow><boxGeometry args={[0.34, 0.5, 0.14]} /><meshStandardMaterial color="#ff4fa3" roughness={0.8} /></mesh>
    </group>
  );
}

function Scene() {
  const [model, setModel] = useState(null);
  const [kit, setKit] = useState(null);
  useEffect(() => {
    const loader = new GLTFLoader();
    loader.load(modelUrl, (gltf) => {
      const root = gltf.scene;
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const box = new Box3().setFromObject(root);
      const size = box.getSize(new Vector3());
      const centre = box.getCenter(new Vector3());
      const meshes = []; const materials = new Set(); let tris = 0; let noNormals = 0; let uv = 0; let nodes = 0;
      root.traverse((o) => {
        nodes++;
        if (!o.isMesh) return;
        meshes.push(o.name); materials.add(o.material.name);
        tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        if (!o.geometry.attributes.normal) noNormals++;
        if (o.geometry.attributes.uv) uv++;
      });
      window.__report = {
        loader: 'three GLTFLoader (the loader family B uses)', url: modelUrl, rootName: root.children[0]?.name, sceneChildren: root.children.map((c) => c.name),
        nodes, meshCount: meshes.length, meshes, materials: [...materials], triangles: tris, meshesWithoutNormals: noNormals, meshesWithUv: uv,
        bounds: { min: box.min.toArray().map((v) => +v.toFixed(4)), max: box.max.toArray().map((v) => +v.toFixed(4)), size: size.toArray().map((v) => +v.toFixed(4)), centre: centre.toArray().map((v) => +v.toFixed(4)) },
        parserWarnings: window.__warnings ?? [],
      };
      setModel(root);
    }, undefined, (error) => { window.__report = { error: String(error) }; });
    if (view === 'compare') {
      loader.load('/assets/models/kit-pack.glb', (gltf) => {
        const node = gltf.scene.getObjectByName('hangar_roundA');
        if (node) { const c = node.clone(true); c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); setKit(c); }
      });
    }
  }, []);
  useEffect(() => { if (model && (view !== 'compare' || kit)) setTimeout(() => { window.__ready = true; }, 600); }, [model, kit]);
  const ref = useMemo(() => {
    const edges = new LineSegments(new EdgesGeometry(new BoxGeometry(...FOOT)), new LineBasicMaterial({ color: '#ff4fa3' }));
    edges.position.set(0, FOOT[1] / 2, 0);
    return edges;
  }, []);
  return (
    <>
      <color attach="background" args={['#d9c3a9']} />
      <fog attach="fog" args={['#d9c3a9', 70, 190]} />
      <hemisphereLight args={['#b9d0e0', '#8a6c58', 1.5]} />
      <directionalLight color="#ffe0bd" intensity={2.6} position={[28, 40, 22]} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.04}
        shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-camera-near={1} shadow-camera-far={140} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[120, 64]} /><meshStandardMaterial color="#b59a80" roughness={1} /></mesh>
      {model && <primitive object={model} />}
      {kit && <primitive object={kit} position={[22, 0, 0]} scale={4.5} rotation-y={0} />}
      {params.get('ref') === '1' && <primitive object={ref} />}
      {(view === 'human' || params.get('person') === '1') && <Person position={[1.1, 0, 8.4]} />}
      <Rig />
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 40, near: 0.1, far: 400 }} gl={{ antialias: true, preserveDrawingBuffer: true }}><Scene /></Canvas>,
);
