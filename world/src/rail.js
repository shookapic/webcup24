// Pure rail geometry shared by the layout (supports), the rail meshes and the trams: rounded corners, arc length, sampling.

export const RAIL_RADIUS = 5; // corner radius in metres, so cars take bends smoothly instead of snapping

// Replace each interior vertex by a quadratic arc; straight runs keep only their end points.
export function smoothPath(points, radius = RAIL_RADIUS, steps = 10) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [px, pz] = points[i - 1];
    const [cx, cz] = points[i];
    const [nx, nz] = points[i + 1];
    const d1 = Math.hypot(px - cx, pz - cz);
    const d2 = Math.hypot(nx - cx, nz - cz);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const a = [cx + ((px - cx) / d1) * r, cz + ((pz - cz) / d1) * r];
    const b = [cx + ((nx - cx) / d2) * r, cz + ((nz - cz) / d2) * r];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      out.push([(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * cx + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * cz + t * t * b[1]]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function measure(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return cum;
}

// Point and heading (atan2(dx, dz), 0 = +z) at arc position s; s is clamped to the path.
export function sample(points, cum, s) {
  const t = Math.min(Math.max(s, 0), cum[cum.length - 1]);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const [ax, az] = points[i - 1];
  const [bx, bz] = points[i];
  const f = (t - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, heading: Math.atan2(bx - ax, bz - az) };
}

// Arc position of the path point nearest to (px, pz).
export function arcOf(points, cum, [px, pz]) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const len = cum[i] - cum[i - 1];
    if (!len) continue;
    const f = Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / (len * len)));
    const d = Math.hypot(ax + (bx - ax) * f - px, az + (bz - az) * f - pz);
    if (d < bestD) { bestD = d; best = cum[i - 1] + len * f; }
  }
  return best;
}
