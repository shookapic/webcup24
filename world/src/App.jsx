import { lazy, Suspense, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Sky } from './Sky.jsx';
import { City, Ground, Rocks } from './City.jsx';
import { LabelLayer, LabelProjector } from './Labels.jsx';
import { AvatarEditor } from './AvatarEditor.jsx';
import { Npcs } from './Npcs.jsx';
import { defaultAvatar } from './Avatar.jsx';
import { api } from './api.js';

const PlayableCity = lazy(() => import('./PlayableCity.jsx'));

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function App() {
  const [user, setUser] = useState();
  const [view, setView] = useState('tps');
  const [avatar, setAvatar] = useState(defaultAvatar);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api('/api/me').then(({ user: me }) => {
      setUser(me);
      if (me?.avatar) setAvatar(me.avatar);
      else if (me) setEditing(true);
    }, () => setUser(null));
  }, []);

  const edit = () => {
    setView('tps');
    setEditing(true);
  };

  useEffect(() => {
    const toggle = (event) => {
      if (event.code === 'KeyV' && !event.target.closest('input, textarea, select')) setView((v) => (v === 'tps' ? 'fps' : 'tps'));
    };
    addEventListener('keydown', toggle);
    return () => removeEventListener('keydown', toggle);
  }, []);

  return (
    <>
      <Canvas aria-hidden="true" dpr={[1, 1.5]} camera={{ position: [40, 30, 60], fov: 55, far: 1000 }}>
        <fog attach="fog" args={['#5a2238', 70, 230]} />
        <hemisphereLight args={['#ffb38a', '#3a1424', 0.6]} />
        <directionalLight position={[60, 40, 50]} intensity={2.2} color="#ffd9b8" />
        <Sky reducedMotion={reducedMotion} />
        <Ground />
        <Rocks />
        <Npcs reducedMotion={reducedMotion} />
        {user ? (
          <Suspense fallback={<City />}>
            <PlayableCity avatar={avatar} view={view} reducedMotion={reducedMotion} />
          </Suspense>
        ) : <City />}
        <LabelProjector />
        {!user && <OrbitControls target={[0, 4, 0]} maxPolarAngle={1.45} minDistance={15} maxDistance={140} autoRotate={!reducedMotion} autoRotateSpeed={0.3} />}
      </Canvas>
      <LabelLayer />
      <nav className="hud" aria-label="Monde">
        <a href="/">Version accessible</a>
        {user && (
          <>
            <button type="button" onClick={() => setView((v) => (v === 'tps' ? 'fps' : 'tps'))}>
              {view === 'tps' ? 'Vue première personne' : 'Vue troisième personne'} (V)
            </button>
            <button type="button" onClick={edit}>Personnaliser mon colon</button>
          </>
        )}
      </nav>
      {user === null && (
        <div className="welcome">
          <h1>Terra Nova</h1>
          <p>Connectez-vous pour entrer dans le monde et créer votre colon.</p>
          <a href="/">Se connecter</a>
        </div>
      )}
      {user && <AvatarEditor open={editing} avatar={avatar} onChange={setAvatar} onClose={() => setEditing(false)} />}
      {user && <p className="controls-help">ZQSD / WASD ou flèches pour marcher · Maj pour courir · Espace pour sauter · glisser pour tourner la caméra</p>}
    </>
  );
}
