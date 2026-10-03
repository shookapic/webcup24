// Every street lamp must clear every NPC route segment (incl. the widest lane offset), bench approach points, other thin colliders and crossings.
// node tools/qa/lamp-clearance.mjs   (pure data check on world/src/layout.js, no browser)
import { lamps, pathNodes, pathLinks, seats, benches, trees, supports, crossings } from '../../world/src/layout.js';
const LANE = 0.8, HALF = 0.2, BODY = 0.4, MARGIN = 0.3; // widest NPC lane offset, lamp half-width, NPC radius, extra margin
const segDist = ([px, pz], [ax, az], [bx, bz]) => { const dx = bx - ax, dz = bz - az; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(px - (ax + t * dx), pz - (az + t * dz)); };
const need = LANE + HALF + BODY + MARGIN;
let ok = true;
const fail = (m) => { ok = false; console.log('FAIL', m); };
const segs = Object.entries(pathLinks).flatMap(([a, list]) => list.filter((b) => a < b).map((b) => [a, b]));
let minSeg = 1e9;
lamps.forEach((l, i) => {
  for (const [a, b] of segs) { const d = segDist(l, pathNodes[a], pathNodes[b]); minSeg = Math.min(minSeg, d); if (d < need) fail(`lamp ${i} [${l}] ${d.toFixed(2)} m from route ${a}-${b} (need ${need.toFixed(2)})`); }
  for (const [n, p] of Object.entries(pathNodes)) if (Math.hypot(l[0] - p[0], l[1] - p[1]) < need) fail(`lamp ${i} [${l}] near node ${n}`);
  seats.forEach((s, k) => { if (Math.hypot(l[0] - s.approach[0], l[1] - s.approach[1]) < 1.2) fail(`lamp ${i} blocks approach of seat ${k}`); });
  benches.forEach((b, k) => { if (Math.hypot(l[0] - b.x, l[1] - b.z) < 1.8) fail(`lamp ${i} overlaps bench ${k}`); });
  trees.forEach((t, k) => { if (Math.hypot(l[0] - t.x, l[1] - t.z) < 1.2) fail(`lamp ${i} overlaps tree ${k}`); });
  supports.forEach((s, k) => { if (Math.hypot(l[0] - s.x, l[1] - s.z) < 1.2) fail(`lamp ${i} overlaps tram support ${k}`); });
  crossings.forEach((c, k) => { const along = c.along === 'x'; const dx = Math.abs(l[0] - c.x), dz = Math.abs(l[1] - c.z); if ((along ? dx < 1.5 && dz < c.span / 2 : dz < 1.5 && dx < c.span / 2)) fail(`lamp ${i} on crossing ${k}`); });
});
console.log(ok ? `PASS ${lamps.length} lamps clear (min route distance ${minSeg.toFixed(2)} m, need ${need.toFixed(2)})` : 'FAILURES');
process.exit(ok ? 0 : 1);
