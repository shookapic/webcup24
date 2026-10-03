import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Sky } from './Sky.jsx';
import { City, Ground, Rocks } from './City.jsx';
import { LabelLayer, LabelProjector } from './Labels.jsx';
import { AvatarEditor } from './AvatarEditor.jsx';
import { Npcs } from './Npcs.jsx';
import { AlertAnnouncer, PhoneFallback, useAnnouncements, useServices, useTransports } from './Phone.jsx';
import { WorldHud } from './ui/WorldHud.jsx';
import { getLocale, t } from './ui/i18n.js';
import { defaultAvatar } from './Avatar.jsx';
import { SPAWN, nearestStop, playerPos } from './layout.js';
import { Sun } from './Sun.jsx';
import { PhoneHost, PhoneRig } from './PhoneRig.jsx';
import { AvatarPreview } from './AvatarPreview.jsx';
import { api } from './api.js';
import { debug } from './debug.js';

import { settings } from './quality.js';

const Effects = lazy(() => import('./Effects.jsx'));
// Returning players: start the (large) physics chunk right away instead of after /api/me answers. The hint is set once a session
// has been seen and cleared for guests, so guests pay for it at most once.
const hint = (() => { try { return localStorage.getItem('tn.world') === '1'; } catch { return false; } })();
const playableChunk = hint ? import('./PlayableCity.jsx') : null;
const PlayableCity = lazy(() => playableChunk ?? import('./PlayableCity.jsx'));

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PHONE_MS = reducedMotion ? 0 : 300; // raise / lower time; the PhoneRig animates over this
const flatQuery = new URLSearchParams(location.search).has('flatphone');
const narrow = matchMedia('(max-width: 720px)');

// ?debug: exposes the renderer so QA can read draw calls / triangles (tools/qa/perf.mjs).
function GlProbe() {
  const gl = useThree((state) => state.gl);
  useEffect(() => { debug.gl = gl; }, [gl]);
  return null;
}

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

// QA only (?debug&look=lunettes&acc=sac): shows look / accessory before the editor and API can persist them.
const debugParams = new URLSearchParams(location.search);
const debugAvatar = debug.enabled ? Object.fromEntries([['look', debugParams.get('look')], ['accessory', debugParams.get('acc')]].filter(([, v]) => v)) : {};

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
  const timer = useRef(0); // the single pending phone transition; every new transition cancels the previous one

  const { announcements, unseen: pending, status, error, lastUpdated, acknowledge, retry } = useAnnouncements({ userId: user?.id, ready: user !== undefined });
  const phoneUp = phone.phase !== 'closed';
  // Physical phone on desktop with a playable avatar; flat accessible dialog on narrow screens, for guests or with ?flatphone.
  const [isNarrow, setNarrow] = useState(narrow.matches);
  useEffect(() => { const on = (e) => setNarrow(e.matches); narrow.addEventListener('change', on); return () => narrow.removeEventListener('change', on); }, []);
  const physical = Boolean(user) && !isNarrow && !flatQuery;
  const services = useServices(phoneUp);
  const transports = useTransports(true);

  const later = (fn) => {
    clearTimeout(timer.current);
    if (PHONE_MS) timer.current = setTimeout(fn, PHONE_MS);
    else fn();
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const openPhone = useCallback((source) => {
    const { phase } = phoneRef.current;
    if (phase === 'opening' || phase === 'open') return;
    // Snapshot only when coming from fully closed: reopening mid-lowering keeps the original view to restore.
    if (phase === 'closed') setView((current) => { viewBeforePhone.current = current; return 'fps'; });
    setPhone((p) => ({ phase: 'opening', source: phase === 'closing' ? p.source : source }));
    phoneRef.current = { ...phoneRef.current, phase: 'opening' };
    later(() => setPhone((p) => (p.phase === 'opening' ? { ...p, phase: 'open' } : p)));
  }, []);

  const closePhone = useCallback(() => {
    if (!['opening', 'open'].includes(phoneRef.current.phase)) return;
    setPhone((p) => ({ ...p, phase: 'closing' }));
    phoneRef.current = { ...phoneRef.current, phase: 'closing' };
    later(() => {
      setPhone((p) => ({ ...p, phase: 'closed' }));
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
      try { if (me) localStorage.setItem('tn.world', '1'); else localStorage.removeItem('tn.world'); } catch { /* storage unavailable */ }
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
      if (event.code === 'Escape' && phoneRef.current.phase === 'open' && !pendingRef.current.length) closePhone(); // focus may have fallen to the page after a click
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
      if (Math.hypot(playerPos.x - SPAWN[0], playerPos.z - SPAWN[2]) > 4) setHelp(false);
    }, 500);
    return () => clearInterval(timer);
  }, [user]);

  return (
    <>
      <Canvas aria-hidden="true" shadows={settings.shadows} dpr={settings.dpr} frameloop={debug.simFps ? 'never' : 'always'} camera={{ position: [40, 30, 60], fov: 55, far: 1000 }}>
        <fog attach="fog" args={['#d3b295', 90, 300]} />
        <hemisphereLight args={['#b9d0e0', '#8a6c58', 1.6]} />
        <Sun size={settings.shadowSize} shadows={settings.shadows} />
        {debug.simFps > 0 && <SimDriver />}
        {debug.enabled && <GlProbe />}
        <Sky reducedMotion={reducedMotion} />
        <Ground />
        {!debug.floorOnly && <Rocks />}
        {!debug.floorOnly && <Npcs reducedMotion={reducedMotion} />}
        {user ? (
          <Suspense fallback={<City reducedMotion={reducedMotion} />}>
            <PlayableCity avatar={{ ...avatar, ...debugAvatar }} view={view} reducedMotion={reducedMotion} inputEnabled={!editing && !phoneUp} />
          </Suspense>
        ) : <City reducedMotion={reducedMotion} />}
        <LabelProjector />
        {physical && phoneUp && <PhoneRig phase={phone.phase} reducedMotion={reducedMotion} outfit={avatar.outfit} />}
        {/* Glow materials use toneMapped={false} and intensity > 1, so only they cross the bloom threshold. */}
        {!debug.simFps && settings.effects && <Suspense fallback={null}><Effects /></Suspense>}
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
      {(() => {
        const screenProps = {
          page,
          onPageChange: setPage,
          announcements,
          pendingAlerts: phone.phase === 'closing' ? [] : pending,
          services,
          transports,
          nearestStop: stop?.name,
          status,
          error,
          lastUpdated,
          onRetry: retry,
          onAcknowledge: acknowledgeAlerts,
          onClose: closePhone,
          locale,
        };
        return physical
          ? phoneUp && <PhoneHost screenProps={{ ...screenProps, dialogLabel: t(locale, 'phone.label') }} />
          : <PhoneFallback open={phoneUp} {...screenProps} />;
      })()}
      {user && <AvatarEditor open={editing} avatar={avatar} onChange={setAvatar} onClose={() => setEditing(false)} locale={locale} preview={editing ? <AvatarPreview avatar={avatar} /> : null} />}
      {user && help && <p className="controls-help">{t(locale, 'help.controls')}</p>}
    </>
  );
}
