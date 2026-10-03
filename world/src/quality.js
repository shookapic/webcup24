// Quality tier: "low" is chosen automatically for data-saver / slow connections / reduced-data preference, or with ?quality=low|high.
// Low keeps every feature, service and interaction; it drops the costly extras (post-processing code is never even downloaded,
// no shadow pass, native pixel ratio, fewer walkers, no flowers/grass) so the world loads and runs on weak links and devices.
const params = new URLSearchParams(location.search);
const connection = navigator.connection;
const slow = Boolean(connection?.saveData) || /(^|-)(2g|3g)$/.test(connection?.effectiveType ?? '') || matchMedia('(prefers-reduced-data: reduce)').matches;
const forced = params.get('quality');

export const quality = forced === 'low' || forced === 'high' ? forced : slow ? 'low' : 'high';
export const settings = quality === 'low'
  ? { shadows: false, shadowSize: 1024, effects: false, dpr: [1, 1], npcs: 6, detailPlants: false }
  : { shadows: true, shadowSize: 2048, effects: true, dpr: [1, 1.5], npcs: 12, detailPlants: true };
