// Read-only smoke of a deployed host: GET requests only. It never logs in, posts, registers or modifies anything, so it is
// safe against production. Compares the host with a locally built dist (expected chunks, models, textures).
// Usage: node tools/qa-a/host-smoke.mjs https://host.example [path/to/dist/monde]
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const base = (process.argv[2] || '').replace(/\/$/, '');
const dist = process.argv[3] || 'dist/monde';
if (!base) { console.error('Usage: node tools/qa-a/host-smoke.mjs https://host [dist/monde]'); process.exit(2); }
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 400)}`); };
const note = (text) => console.log(`NOTE  ${text}`);
const get = async (path, headers = {}) => {
  const response = await fetch(base + path, { redirect: 'manual', headers: { 'Accept-Encoding': 'gzip', ...headers }, signal: AbortSignal.timeout(30_000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, bytes, text: () => bytes.toString('utf8'), location: response.headers.get('location') };
};
const walk = (dir, prefix = '') => existsSync(dir) ? readdirSync(dir).flatMap((name) => { const full = join(dir, name); return statSync(full).isDirectory() ? walk(full, `${prefix}${name}/`) : [`${prefix}${name}`]; }) : [];

console.log(`host: ${base}  (GET only)`);
try {
  const portal = await get('/');
  check('portal / answers 200 as HTML', portal.status === 200 && /text\/html/.test(portal.headers.get('content-type') || ''), `${portal.status} ${portal.headers.get('content-type')}`);
  const pcsp = portal.headers.get('content-security-policy') || '';
  check('portal CSP stays strict (self scripts/styles, no inline, no wasm)', pcsp.includes("script-src 'self'") && pcsp.includes("style-src 'self'") && !pcsp.includes('unsafe-inline') && !pcsp.includes('wasm'), pcsp);
  check('portal nosniff + frame protection', portal.headers.get('x-content-type-options') === 'nosniff' && portal.headers.get('x-frame-options') === 'DENY');
  check('portal HTML is the current one (skip link, jump links, glossary)', /skip-link/.test(portal.text()) && /id="mots"/.test(portal.text()) && /jump-nav/.test(portal.text()), 'older portal build deployed?');
  for (const file of ['/app.js', '/styles.css', '/i18n.js']) {
    const r = await get(file);
    check(`portal asset ${file} 200 with the right type`, r.status === 200 && (file.endsWith('.js') ? /javascript/ : /css/).test(r.headers.get('content-type') || ''), `${r.status} ${r.headers.get('content-type')}`);
  }

  // public read-only APIs
  const me = await get('/api/me');
  check('GET /api/me anonymous → { user: null }', me.status === 200 && JSON.parse(me.text()).user === null);
  const transports = JSON.parse((await get('/api/transports')).text());
  check('GET /api/transports: 2 lines, 3 stops each, 3 departures per stop', transports.lines?.length === 2 && transports.lines.every((l) => l.stops.length === 3 && l.stops.every((s) => s.next.length === 3)));
  const services = JSON.parse((await get('/api/services')).text()).services || [];
  check('GET /api/services lists services', services.length > 0);
  const announcements = JSON.parse((await get('/api/announcements')).text()).announcements || [];
  check('GET /api/announcements lists announcements', announcements.length > 0);
  // version probes (anonymous, no data touched): routes added in later waves answer 401, an older deploy answers 404
  const probes = { 'Wave 4 (F34 citizen admin)': '/api/admin/citizens', 'Wave 5 (F37 security overview)': '/api/admin/security', 'Wave 5 (F39 appointments)': '/api/appointments/slots' };
  for (const [label, path] of Object.entries(probes)) {
    const r = await get(path);
    check(`deployed version includes ${label}`, r.status === 401, `status ${r.status} (401 = present, 404 = older deploy)`);
  }
  check('services expose availability fields (F38 present)', services.every((s) => 'availability' in s), 'older deploy?');
  check('anonymous cannot read the official feed', (await get('/api/requests')).status === 401);

  // the world
  const bare = await get('/monde');
  check('/monde redirects to /monde/ (or serves the app)', (bare.status === 301 && /\/monde\/$/.test(bare.location || '')) || bare.status === 200, `${bare.status} ${bare.location}`);
  const world = await get('/monde/');
  const html = world.text();
  check('/monde/ answers 200 HTML', world.status === 200 && /text\/html/.test(world.headers.get('content-type') || ''));
  const wcsp = world.headers.get('content-security-policy') || '';
  check("/monde/ CSP is the contract one (script 'self' + wasm, worker blob:, img/connect blob: data:, base none, object none)", wcsp.includes("script-src 'self' 'wasm-unsafe-eval'") && wcsp.includes('worker-src') && wcsp.includes('blob:') && wcsp.includes("base-uri 'none'") && wcsp.includes("object-src 'none'"), wcsp);
  check('/monde/ not cached blindly (no-cache or ETag)', /no-cache/.test(world.headers.get('cache-control') || '') || Boolean(world.headers.get('etag')), world.headers.get('cache-control'));
  const referenced = [...html.matchAll(/(?:src|href)="(\/monde\/assets\/[^"]+)"/g)].map((m) => m[1]);
  check('/monde/ references hashed app assets', referenced.length >= 2, referenced.join(','));
  const localAssets = walk(join(dist, 'assets')).filter((f) => /^(index|PlayableCity|rapier)-/.test(f));
  const localReferenced = existsSync(join(dist, 'index.html')) ? [...(await import('node:fs')).readFileSync(join(dist, 'index.html'), 'utf8').matchAll(/(?:src|href)="(\/monde\/assets\/[^"]+)"/g)].map((m) => m[1]) : [];
  if (localReferenced.length) {
    const same = localReferenced.every((r) => referenced.includes(r));
    check('host serves the SAME hashed entry assets as the local build (this is the expected release)', same, `host: ${referenced.join(',')}  local: ${localReferenced.join(',')}`);
  }
  for (const asset of referenced) {
    const r = await get(asset);
    const type = r.headers.get('content-type') || '';
    check(`asset ${asset.replace('/monde/assets/', '')}: 200, ${extname(asset) === '.css' ? 'css' : 'javascript'} MIME, immutable cache, nosniff`, r.status === 200 && (extname(asset) === '.css' ? /css/ : /javascript/).test(type) && /immutable/.test(r.headers.get('cache-control') || '') && r.headers.get('x-content-type-options') === 'nosniff', `${r.status} ${type} ${r.headers.get('cache-control')}`);
    note(`${asset.replace('/monde/assets/', '')}: ${r.bytes.length} bytes on the wire, content-encoding ${r.headers.get('content-encoding') || 'none'}`);
  }
  // lazily loaded chunks and every local model/texture
  const lazy = localAssets.filter((f) => !referenced.includes(`/monde/assets/${f}`));
  for (const f of lazy) {
    const r = await get(`/monde/assets/${f}`);
    check(`expected chunk ${f} present on the host (200, immutable)`, r.status === 200 && /immutable/.test(r.headers.get('cache-control') || ''), `${r.status}`);
  }
  const mime = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.txt': 'text/plain', '.md': 'text/markdown' };
  const binary = walk(join(dist, 'assets')).filter((f) => /\.(glb|gltf|png|jpe?g|webp|ktx2|wasm)$/i.test(f));
  for (const f of binary) {
    const r = await get(`/monde/assets/${f}`);
    check(`model/texture ${f}: 200 with MIME ${mime[extname(f).toLowerCase()]}, not HTML`, r.status === 200 && (r.headers.get('content-type') || '').startsWith(mime[extname(f).toLowerCase()]) && !r.text().startsWith('<!doctype'), `${r.status} ${r.headers.get('content-type')}`);
  }
  if (!binary.length) note('no models/textures in the local dist to compare');
  const missing = await get('/monde/assets/models/__does-not-exist__.glb');
  check('a missing model returns a real 404, not the app HTML', missing.status === 404 && !missing.text().toLowerCase().includes('<!doctype'), `${missing.status} ${missing.text().slice(0, 60)}`);
  const route = await get('/monde/some/route');
  check('a navigation path (no file extension) falls back to the app', route.status === 200 && /text\/html/.test(route.headers.get('content-type') || ''));
  const traversal = await get('/monde/..%2fserver.mjs');
  check('path traversal does not leak server source', !traversal.text().includes('createServer') && traversal.status !== 200, `${traversal.status}`);
  const etag = world.headers.get('etag');
  if (etag) check('conditional GET returns 304', (await get('/monde/', { 'If-None-Match': etag })).status === 304);
} catch (error) {
  failures++;
  console.log('FAIL  host smoke crashed', error.stack);
}
console.log(failures ? `\n${failures} FAILED` : '\nhost smoke: all checks passed');
process.exit(failures ? 1 : 0);
