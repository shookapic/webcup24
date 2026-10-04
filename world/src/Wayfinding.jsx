import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { Vector3 } from 'three';
import { footprints, pathLinks, pathNodes, placeSite, playerPos } from './layout.js';
import { api } from './api.js';
import './wayfinding.css';

// F45 / F46: official places (GET /api/places) shown in the world, a ground route from the player to one of them, a one-key "nearest emergency" guide and a
// proximity prompt. Everything is data from the API plus layout.placeSites; nothing here changes movement or the service logic.

const STR = {
  fr: {
    emergencyButton: 'Urgences : où aller ? (G)', stop: 'Arrêter le guidage', stopHint: 'Échap pour arrêter', guiding: 'Guidage vers {name}', distance: 'à environ {m} m', arrived: 'Vous êtes arrivé : {name}.',
    started: 'Guidage vers {name}, à environ {m} mètres. Suivez la ligne au sol.', stopped: 'Guidage arrêté.', open24: 'Ouvert 24 h sur 24', call: 'Appeler le {phone}', details: 'Détails dans le téléphone (T)',
    nearby: 'À proximité : {name}', guideMe: 'Me guider', kind_hospital: 'Hôpital', kind_emergency: 'Urgences', kind_service: 'Service', none: 'Aucun lieu d’urgence n’est disponible pour le moment.', stopAt: 'Arrêt {stop}', hereNow: 'Vous êtes déjà sur place.',
  },
  en: {
    emergencyButton: 'Emergency: where to go? (G)', stop: 'Stop guidance', stopHint: 'Esc to stop', guiding: 'Guiding to {name}', distance: 'about {m} m away', arrived: 'You have arrived: {name}.',
    started: 'Guiding to {name}, about {m} metres. Follow the line on the ground.', stopped: 'Guidance stopped.', open24: 'Open 24 hours a day', call: 'Call {phone}', details: 'Details in the phone (T)',
    nearby: 'Nearby: {name}', guideMe: 'Guide me', kind_hospital: 'Hospital', kind_emergency: 'Emergency', kind_service: 'Service', none: 'No emergency place is available right now.', stopAt: '{stop} stop', hereNow: 'You are already there.',
  },
};
const say = (locale, key, vars = {}) => (STR[locale] ?? STR.fr)[key].replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
const nameOf = (place, locale) => (locale === 'en' && place.name_en) || place.name;
const isEmergency = (place) => place.kind === 'hospital' || place.kind === 'emergency';

// ---- routing on the NPC path graph (cosmetic route: roads, then the site's own waypoints)
function nearestNode(x, z, only) {
  let best = null, bestD = Infinity;
  for (const [name, [nx, nz]] of Object.entries(pathNodes)) {
    if (only && !only.includes(name)) continue;
    const d = Math.hypot(nx - x, nz - z);
    if (d < bestD) { best = name; bestD = d; }
  }
  return best;
}
function nodePath(from, to) {
  if (from === to) return [from];
  const previous = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const current = queue.shift();
    if (current === to) break;
    for (const next of pathLinks[current] ?? []) if (!(next in previous)) { previous[next] = current; queue.push(next); }
  }
  if (!(to in previous)) return [from, to];
  const out = [];
  for (let node = to; node; node = previous[node]) out.unshift(node);
  return out;
}
// Ground-level obstacles the player cannot walk through (low steps and overhead boxes do not count). A route segment that crosses one is bent around the
// nearest corner of its margin-inflated rectangle, so the drawn line is also a line a player can follow (benches, lamps, trees, supports, buildings).
const MARGIN = 0.9;
const obstacles = footprints.filter((f) => f.h >= 0.5 && !f.y).map((f) => (f.shape === 'box' ? { x0: f.x - f.w / 2 - MARGIN, x1: f.x + f.w / 2 + MARGIN, z0: f.z - f.d / 2 - MARGIN, z1: f.z + f.d / 2 + MARGIN } : { x0: f.x - f.r - MARGIN, x1: f.x + f.r + MARGIN, z0: f.z - f.r - MARGIN, z1: f.z + f.r + MARGIN }));
const within = (x, z, o) => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1;
const blocked = (a, b, o) => { for (let t = 0.02; t < 0.98; t += 0.02) if (within(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, o)) return true; return false; };
function bend(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let a = out[out.length - 1];
    const b = points[i];
    for (let guard = 0; guard < 10; guard++) {
      const hit = obstacles.find((o) => !within(a[0], a[1], o) && !within(b[0], b[1], o) && blocked(a, b, o));
      if (!hit) break;
      const e = 0.15; // step just outside the margin so leaving the corner never re-enters the rectangle
      const corners = [[hit.x0 - e, hit.z0 - e], [hit.x0 - e, hit.z1 + e], [hit.x1 + e, hit.z0 - e], [hit.x1 + e, hit.z1 + e]].filter(([x, z]) => !obstacles.some((o) => within(x, z, o)) && Math.hypot(x - a[0], z - a[1]) > 0.3 && !blocked(a, [x, z], hit));
      if (!corners.length) break;
      const corner = corners.reduce((best, c) => (Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]) < Math.hypot(best[0] - a[0], best[1] - a[1]) + Math.hypot(best[0] - b[0], best[1] - b[1]) ? c : best));
      out.push(corner);
      a = corner;
    }
    out.push(b);
  }
  return out;
}
export function routeFor(place, from = playerPos) {
  const site = placeSite(place);
  const start = nearestNode(from.x, from.z);
  const end = site.via ?? nearestNode(site.x, site.z);
  const points = bend([[from.x, from.z], ...nodePath(start, end).map((name) => pathNodes[name]), ...(site.route ?? []), [site.x, site.z]]);
  const length = points.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0), 0);
  return { points, length, site };
}

const labelEls = new Map(); // place code -> DOM element positioned by the projector inside the canvas

export function useWayfinding({ locale, enabled }) {
  const [places, setPlaces] = useState([]);
  const [guide, setGuide] = useState(null); // { place, route, distance, arrived }
  const [prompt, setPrompt] = useState(null);
  const [announce, setAnnounce] = useState('');
  const guideRef = useRef(null);
  guideRef.current = guide;
  const seen = useRef(new Set());

  useEffect(() => {
    let alive = true;
    const load = () => api('/api/places').then((data) => { if (alive) setPlaces(Array.isArray(data.places) ? data.places : []); }, () => {});
    load();
    const timer = setInterval(load, 300_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const startGuide = useCallback((place) => {
    const route = routeFor(place);
    setGuide({ place, route, distance: route.length, arrived: route.length < 3 });
    setPrompt(null);
    setAnnounce(route.length < 3 ? say(locale, 'hereNow') : say(locale, 'started', { name: nameOf(place, locale), m: Math.round(route.length / 5) * 5 }));
  }, [locale]);
  const stopGuide = useCallback(() => { if (guideRef.current) setAnnounce(say(locale, 'stopped')); setGuide(null); }, [locale]);

  const nearestEmergency = useCallback(() => {
    const candidates = places.filter(isEmergency);
    let best = null, bestLength = Infinity;
    for (const place of candidates) { const { length } = routeFor(place); if (length < bestLength) { best = place; bestLength = length; } }
    return best;
  }, [places]);
  const guideEmergency = useCallback(() => {
    if (guideRef.current) return stopGuide();
    const place = nearestEmergency();
    if (place) startGuide(place); else setAnnounce(say(locale, 'none'));
  }, [nearestEmergency, startGuide, stopGuide, locale]);

  // keep the route and distance fresh (2 Hz), detect arrival, raise the proximity prompt once per place
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      const current = guideRef.current;
      if (current && !current.arrived) {
        const route = routeFor(current.place);
        const arrived = Math.hypot(route.site.x - playerPos.x, route.site.z - playerPos.z) < 3;
        setGuide((g) => (g ? { ...g, route, distance: route.length, arrived } : g));
        if (arrived) setAnnounce(say(locale, 'arrived', { name: nameOf(current.place, locale) }));
      }
      if (!current) {
        const near = places.find((place) => { const site = placeSite(place); return !seen.current.has(place.code) && Math.hypot(site.x - playerPos.x, site.z - playerPos.z) < 12; });
        if (near) { seen.current.add(near.code); setPrompt(near); setTimeout(() => setPrompt((p) => (p === near ? null : p)), 9000); }
      }
    }, 500);
    return () => clearInterval(timer);
  }, [enabled, places, locale]);

  return { places, guide, prompt, announce, startGuide, stopGuide, guideEmergency, dismissPrompt: () => setPrompt(null) };
}

// ---- inside <Canvas>: place beacons, the ground route and the label projector
const point = new Vector3();
export function WayfindingScene({ places, guide, reducedMotion }) {
  const sites = useMemo(() => places.map((place) => ({ place, site: placeSite(place) })), [places]);
  const pulse = useRef();
  useFrame(({ camera, size, clock }) => {
    for (const { place, site } of sites) {
      const el = labelEls.get(place.code);
      if (!el) continue;
      point.set(site.x, site.label ?? 4, site.z).project(camera);
      const distance = Math.hypot(site.x - camera.position.x, site.z - camera.position.z);
      const wanted = isEmergency(place) || guide?.place.code === place.code || distance < 45;
      el.hidden = !wanted || point.z > 1 || distance > 140;
      el.style.transform = `translate(-50%, -100%) translate(${(point.x + 1) * size.width / 2}px, ${(1 - point.y) * size.height / 2}px)`;
    }
    if (pulse.current && !reducedMotion) pulse.current.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 3));
  });
  const routePoints = guide && !guide.arrived ? guide.route.points.map(([x, z]) => new Vector3(x, 0.18, z)) : null;
  return (
    <group>
      {sites.map(({ place, site }) => {
        const strong = isEmergency(place);
        const colour = strong ? '#e8553f' : '#e9ba69';
        return (
          <group key={place.code} position={[site.x, 0, site.z]}>
            <mesh position-y={2.2}><cylinderGeometry args={[0.07, 0.07, 4.4, 8]} /><meshStandardMaterial color="#27363f" roughness={0.7} /></mesh>
            {strong ? (
              <group position-y={4.7}>
                <mesh><boxGeometry args={[0.9, 0.3, 0.12]} /><meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.9} toneMapped={false} /></mesh>
                <mesh><boxGeometry args={[0.3, 0.9, 0.12]} /><meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.9} toneMapped={false} /></mesh>
              </group>
            ) : (
              <mesh position-y={4.7}><sphereGeometry args={[0.35, 12, 8]} /><meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.8} toneMapped={false} /></mesh>
            )}
            {guide?.place.code === place.code && (
              <mesh ref={pulse} position-y={0.1} rotation-x={-Math.PI / 2}><ringGeometry args={[1.1, 1.5, 32]} /><meshBasicMaterial color="#ffd26a" toneMapped={false} /></mesh>
            )}
          </group>
        );
      })}
      {routePoints && routePoints.length > 1 && <Line points={routePoints} color="#ffd26a" lineWidth={4} dashed dashSize={0.9} gapSize={0.5} toneMapped={false} />}
    </group>
  );
}

// ---- outside <Canvas>: labels, the emergency button, the guide panel and the proximity prompt
export function WayfindingUi({ locale, places, guide, prompt, announce, hidden, onEmergency, onStop, onGuide, onOpenPhone, onDismissPrompt }) {
  const meters = guide ? Math.max(0, Math.round(guide.distance / 5) * 5) : 0;
  const place = guide?.place;
  return (
    <>
      <div className="place-labels" aria-hidden="true">
        {places.map((p) => (
          <div key={p.code} ref={(el) => { if (el) labelEls.set(p.code, el); else labelEls.delete(p.code); }} className={`place-label${isEmergency(p) ? ' place-label-strong' : ''}`} hidden>
            <span className="place-label-kind">{say(locale, `kind_${p.kind}`)}</span> {nameOf(p, locale)}{p.open_24h ? ` · 24 h` : ''}
          </div>
        ))}
      </div>
      <p className="sr-only way-live" role="status" aria-live="polite">{announce}</p>
      {!hidden && (
        <div className="way-ui">
          {!guide && places.some(isEmergency) && <button type="button" className="way-button" onClick={onEmergency}>{say(locale, 'emergencyButton')}</button>}
          {guide && (
            <section className="way-panel" aria-label={say(locale, 'guiding', { name: nameOf(place, locale) })}>
              <h2 className="way-title">{say(locale, 'guiding', { name: nameOf(place, locale) })}</h2>
              <p className="way-meta"><span aria-hidden="true">{guide.arrived ? say(locale, 'arrived', { name: nameOf(place, locale) }) : say(locale, 'distance', { m: meters })}</span> · {say(locale, `kind_${place.kind}`)} · {say(locale, 'stopAt', { stop: place.stop })}{place.open_24h ? ` · ${say(locale, 'open24')}` : ''}</p>
              <div className="way-actions">
                {place.phone && isEmergency(place) && <a className="way-button" href={`tel:${String(place.phone).replace(/[^0-9+]/g, '')}`}>{say(locale, 'call', { phone: place.phone })}</a>}
                <button type="button" className="way-button way-secondary" onClick={onOpenPhone}>{say(locale, 'details')}</button>
                <button type="button" className="way-button way-secondary" onClick={onStop}>{say(locale, 'stop')}</button>
              </div>
              <p className="way-hint">{say(locale, 'stopHint')}</p>
            </section>
          )}
          {!guide && prompt && (
            <section className="way-prompt" aria-label={say(locale, 'nearby', { name: nameOf(prompt, locale) })}>
              <p className="way-title">{say(locale, 'nearby', { name: nameOf(prompt, locale) })}</p>
              <p className="way-meta">{prompt.open_24h ? say(locale, 'open24') : (locale === 'en' && prompt.hours_en) || prompt.hours || ''}</p>
              <div className="way-actions">
                <button type="button" className="way-button way-secondary" onClick={onOpenPhone}>{say(locale, 'details')}</button>
                <button type="button" className="way-button way-secondary" onClick={onDismissPrompt}>×<span className="sr-only"> {say(locale, 'stop')}</span></button>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
