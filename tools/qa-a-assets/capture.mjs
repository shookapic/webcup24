// Starts the isolated preview and captures the review views with real Chrome (GPU path, shadows on). Also saves the GLTFLoader readback.
//   node tools/qa-a-assets/capture.mjs [out-dir]     (default docs/qa-captures/a-hospital)
// Needs the project's node_modules (vite, @vitejs/plugin-react, three, @react-three/fiber, react, puppeteer-core): no new dependency.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const out = process.argv[2] || join(root, 'docs', 'qa-captures', 'a-hospital');
mkdirSync(out, { recursive: true });

const server = await createServer({ configFile: join(root, 'tools/qa-a-assets/preview/vite.config.mjs'), logLevel: 'warn' });
await server.listen();
const base = 'http://127.0.0.1:3206/';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox', '--use-angle=default', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const views = [['front', ''], ['three-quarter', '&view=three'], ['back', '&view=back'], ['human-entrance', ''], ['tram-view', ''], ['roof', ''], ['compare-hangar', ''], ['fit-footprint', '&ref=1']];
const keys = { front: 'front', 'three-quarter': 'three', back: 'back', 'human-entrance': 'human', 'tram-view': 'tram', roof: 'roof', 'compare-hangar': 'compare', 'fit-footprint': 'three' };
let failed = 0;
let report = null;
for (const [name, extra] of views) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // three.js prints two deprecation warnings of its own (Clock, PCFSoftShadowMap); anything else, and every error, counts
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/THREE.Clock|PCFSoftShadowMap/.test(m.text()))) errors.push(m.text()); });
  const failedRequests = [];
  page.on('requestfailed', (r) => failedRequests.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}?view=${keys[name]}${extra}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30000 }).catch(() => { failed++; });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(out, `${name}.png`) });
  if (name === 'front') report = await page.evaluate(() => window.__report);
  const gl = await page.evaluate(() => { const c = document.querySelector('canvas'); const g = c.getContext('webgl2'); const ext = g?.getExtension('WEBGL_debug_renderer_info'); return { renderer: ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown' }; });
  console.log(`${name}: errors ${errors.length}, failed requests ${failedRequests.length} ${failedRequests.join(' ')} ${errors.slice(0, 2).join(' | ')} (${gl.renderer.slice(0, 50)})`);
  if (errors.length || failedRequests.length) failed++;
  await page.close();
}
writeFileSync(join(out, 'gltfloader-readback.json'), JSON.stringify(report, null, 2) + '\n');
console.log('readback', JSON.stringify(report).slice(0, 600));
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
