import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { Sky } from './Sky.jsx';
import { City, Ground, Rocks } from './City.jsx';
import { LabelLayer, LabelProjector } from './Labels.jsx';
import { AvatarEditor } from './AvatarEditor.jsx';
import { Npcs } from './Npcs.jsx';
import { AlertAnnouncer, PhoneFallback, useAnnouncements, useServices, useTransports } from './Phone.jsx';
import { WorldHud } from './ui/WorldHud.jsx';
import { getLocale, t } from './ui/i18n.js';
import { defaultAvatar } from './Avatar.jsx';
import { nearestStop, playerPos } from './layout.js';
import { api } from './api.js';
import { debug } from './debug.js';

const PlayableCity = lazy(() => import('./PlayableCity.jsx'));

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PHONE_MS = reducedMotion ? 0 : 300; // raise / lower time; the PhoneRig animates over this

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
  const locale = getLocale();
  const [user, setUser] = useState();
  const [view, setView] = useState('tps');
  const [avatar, setAvatar] = useState(defaultAvatar);
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState('home');
  const [help, setHelp] = useState(true);
  const [stop, setStop] = useState(null);
  // closed -> opening -> open -> closing -> closed. `source`: who raised it, the player or an urgent alert.
  const [phone, setPhone] = useState({ phase: 'closed', source: 'manual' });
  const viewBeforePhone = useRef('tps'); // snapshot once per phone session
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const timers = useRef([]);

  const { announcements, unseen: pending, status, error, lastUpdated, acknowledge, retry } = useAnnouncements({ userId: user?.id, ready: user !== undefined });
  const phoneUp = phone.phase !== 'closed';
  const services = useServices(phoneUp);
  const transports = useTransports(true);

  const later = (fn) => (PHONE_MS ? timers.current.push(setTimeout(fn, PHONE_MS)) : fn());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const openPhone = useCallback((source) => {
    const { phase } = phoneRef.current;
    if (phase === 'opening' || phase === 'open') return;
    if (phase === 'closed') setView((current) => { viewBeforePhone.current = current; return 'fps'; });
    setPhone({ phase: 'opening', source });
    later(() => setPhone((p) => (p.phase === 'opening' ? { ...p, phase: 'open' } : p)));
  }, []);

  const closePhone = useCallback(() => {
    if (!['opening', 'open'].includes(phoneRef.current.phase)) return;
    setPhone((p) => ({ ...p, phase: 'closing' }));
    later(() => {
      setPhone((p) => (p.phase === 'closing' ? { ...p, phase: 'closed' } : p));
      setView(viewBeforePhone.current);
      setPage('home');
    });
  }, []);

  // New urgent alert raises the phone, unless the avatar editor is open (AlertAnnouncer covers that meanwhile).
  // An alert withdrawn before acknowledgement puts the phone away if the alert raised it.
  useEffect(() => {
    if (pending.length && !editing && phone.phase === 'closed') openPhone('alert');
    if (!pending.length && phone.source === 'alert' && (phone.phase === 'open' || phone.phase === 'opening')) closePhone();
  }, [pending.length, editing, phone.phase, phone.source, openPhone, closePhone]);

  const acknowledgeAlerts = (ids) => {
    acknowledge(ids);
    if (phoneRef.current.source === 'alert') closePhone();
  };

  useEffect(() => {
    api('/api/me').then(({ user: me }) => {
      setUser(me);
      if (me?.avatar) setAvatar(me.avatar);
      else if (me) setEditing(true);
    }, () => setUser(null));
  }, []);

  const toggleView = () => {
    if (phoneRef.current.phase === 'closed') setView((v) => (v === 'tps' ? 'fps' : 'tps'));
  };
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const togglePhone = () => {
    const { phase } = phoneRef.current;
    if (phase === 'closed' || phase === 'closing') openPhone('manual');
    else if (!pendingRef.current.length) closePhone(); // an alert must be acknowledged first
  };
  const edit = () => {
    if (phoneRef.current.phase !== 'closed') return;
    setView('tps');
    setEditing(true);
  };

  useEffect(() => {
    const keys = (event) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], dialog')) return;
      if (event.code === 'KeyV') toggleView();
      if (event.code === 'KeyT') togglePhone();
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, []);

  // Nearest stop (physical, from the player position) and help hiding once the player has walked away from spawn.
  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(() => {
      const next = nearestStop(playerPos);
      setStop((current) => (current === next ? current : next));
      if (Math.hypot(playerPos.x, playerPos.z - 8) > 4) setHelp(false);
    }, 500);
    return () => clearInterval(timer);
  }, [user]);

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
            <PlayableCity avatar={avatar} view={view} reducedMotion={reducedMotion} inputEnabled={!editing && !phoneUp} />
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
      <WorldHud
        locale={locale}
        view={view}
        phoneOpen={phoneUp}
        unreadCount={pending.length}
        district={user ? stop?.district : undefined}
        onTogglePhone={togglePhone}
        onToggleView={user ? toggleView : undefined}
        onEditAvatar={user ? edit : undefined}
        onToggleHelp={user ? () => setHelp((h) => !h) : undefined}
      />
      {user === null && (
        <div className="welcome">
          <h1>Terra Nova</h1>
          <p>Connectez-vous pour entrer dans le monde et créer votre colon.</p>
          <a href="/">Se connecter</a>
        </div>
      )}
      <AlertAnnouncer alerts={pending} locale={locale} active={editing && !phoneUp} />
      <PhoneFallback
        open={phoneUp}
        page={page}
        onPageChange={setPage}
        announcements={announcements}
        pendingAlerts={phone.phase === 'closing' ? [] : pending}
        services={services}
        transports={transports}
        nearestStop={stop?.name}
        status={status}
        error={error}
        lastUpdated={lastUpdated}
        onRetry={retry}
        onAcknowledge={acknowledgeAlerts}
        onClose={closePhone}
        locale={locale}
      />
      {user && <AvatarEditor open={editing} avatar={avatar} onChange={setAvatar} onClose={() => setEditing(false)} locale={locale} />}
      {user && help && <p className="controls-help">{t(locale, 'help.controls')}</p>}
    </>
  );
}
