import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { Sky } from './Sky.jsx';
import { City, Ground, Rocks } from './City.jsx';
import { LabelLayer, LabelProjector } from './Labels.jsx';
import { AvatarEditor } from './AvatarEditor.jsx';
import { Npcs } from './Npcs.jsx';
import { Phone, useAnnouncements } from './Phone.jsx';
import { defaultAvatar } from './Avatar.jsx';
import { api } from './api.js';
import { debug } from './debug.js';

const PlayableCity = lazy(() => import('./PlayableCity.jsx'));

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ?debug&fps=N: frames are driven by window.__tn.run(seconds, input) at exactly N Hz.
function SimDriver() {
  const advance = useThree((state) => state.advance);
  const clock = useThree((state) => state.clock);
  useEffect(() => {
    debug.run = async (seconds, input = null) => {
      debug.input = input;
      for (let i = 0, t = 0; t < seconds; i++) {
        const dt = debug.jitter ? (i % 20 === 19 ? 0.1 : (i % 2 ? 1.5 : 0.5) / debug.simFps) : 1 / debug.simFps;
        t += dt;
        // frameloop="never": advance() takes seconds and derives delta from clock.elapsedTime.
        advance(clock.elapsedTime + dt);
        if (i % 30 === 29) await new Promise((resolve) => setTimeout(resolve));
      }
      debug.input = null;
    };
  }, [advance, clock]);
  return null;
}

export function App() {
  const [user, setUser] = useState();
  const [view, setView] = useState('tps');
  const [avatar, setAvatar] = useState(defaultAvatar);
  const [editing, setEditing] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const { announcements, unseen, acknowledge } = useAnnouncements();
  const viewBeforeAlert = useRef('tps');
  const alerting = unseen.length > 0;

  // A new urgent broadcast switches to first person and holds the phone up in front of the player.
  useEffect(() => {
    if (!alerting) return;
    setView((current) => {
      viewBeforeAlert.current = current;
      return 'fps';
    });
  }, [alerting]);

  const acknowledgeAlerts = () => {
    acknowledge();
    setView(viewBeforeAlert.current);
  };

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
      if (event.target.closest('input, textarea, select')) return;
      if (event.code === 'KeyV') setView((v) => (v === 'tps' ? 'fps' : 'tps'));
      if (event.code === 'KeyT') setPhoneOpen((open) => !open);
    };
    addEventListener('keydown', toggle);
    return () => removeEventListener('keydown', toggle);
  }, []);

  return (
    <>
      <Canvas aria-hidden="true" dpr={[1, 1.5]} frameloop={debug.simFps ? 'never' : 'always'} camera={{ position: [40, 30, 60], fov: 55, far: 1000 }}>
        <fog attach="fog" args={['#5a2238', 70, 230]} />
        <hemisphereLight args={['#ffb38a', '#3a1424', 0.6]} />
        <directionalLight position={[60, 40, 50]} intensity={2.2} color="#ffd9b8" />
        {debug.simFps > 0 && <SimDriver />}
        <Sky reducedMotion={reducedMotion} />
        <Ground />
        {!debug.floorOnly && <Rocks />}
        {!debug.floorOnly && <Npcs reducedMotion={reducedMotion} />}
        {user ? (
          <Suspense fallback={<City />}>
            <PlayableCity avatar={avatar} view={view} reducedMotion={reducedMotion} inputEnabled={!editing && !phoneOpen && !alerting} />
          </Suspense>
        ) : <City />}
        <LabelProjector />
        {/* Glow materials use toneMapped={false} and intensity > 1, so only they cross the bloom threshold. */}
        {!debug.simFps && <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1} intensity={0.9} />
          <Vignette offset={0.3} darkness={0.55} />
        </EffectComposer>}
        {!user && <OrbitControls target={[0, 4, 0]} maxPolarAngle={1.45} minDistance={15} maxDistance={140} autoRotate={!reducedMotion} autoRotateSpeed={0.3} />}
      </Canvas>
      <LabelLayer />
      <nav className="hud" aria-label="Monde">
        <a href="/">Version accessible</a>
        <button type="button" onClick={() => setPhoneOpen((open) => !open)} aria-expanded={phoneOpen || alerting}>Téléphone (T)</button>
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
      <Phone open={phoneOpen || alerting} alerts={unseen} announcements={announcements} onAcknowledge={acknowledgeAlerts} onClose={() => setPhoneOpen(false)} />
      {user && <AvatarEditor open={editing} avatar={avatar} onChange={setAvatar} onClose={() => setEditing(false)} />}
      {user && <p className="controls-help">ZQSD / WASD ou flèches pour marcher · Maj pour courir · Espace pour sauter · glisser pour tourner la caméra</p>}
    </>
  );
}
