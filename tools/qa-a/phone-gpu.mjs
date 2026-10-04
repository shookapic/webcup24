// Reproduce the physical phone with the machine's REAL GPU (the user saw sliced/missing glyphs that software WebGL never shows).
// Serves the built dist with a disposable database, opens /monde/ with a hardware-accelerated Chrome, opens the phone and captures it.
// Usage: node tools/qa-a/phone-gpu.mjs [label] [--soft] [--dsf=1.5] [--size=1920x1080] [--browser=path]   (--soft = SwiftShader, for comparison). Needs puppeteer-core. Env: CHROME_PATH, SHOTS_DIR.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const req = createRequire(root + 'package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;
const label = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'gpu';
const soft = process.argv.includes('--soft');
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const dsf = Number(arg('dsf', '1'));
const [vw, vh] = arg('size', '1280x800').split('x').map(Number);
const firefox = process.argv.includes('--firefox');
const fix = arg('fix', '');
const browserPath = arg('browser', firefox ? 'C:/Program Files/Mozilla Firefox/firefox.exe' :  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const shots = process.env.SHOTS_DIR || join(tmpdir(), 'terra-gpu-shots');
mkdirSync(shots, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'terra-gpu-'));
const port = 3200 + Math.floor(Math.random() * 10); // A test ports 3200-3209
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_PATH: join(dataDir, 'g.sqlite'), PORT: String(port), HOST: '127.0.0.1', TERRA_NOVA_API_KEY: '', TN_FORM_TOKENS: 'optional', TN_FORM_LIMIT_SCALE: '1000', TN_FORM_MIN_AGE_MS: '0' };
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: 'ignore' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await wait(1500);
const args = soft ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'];
const browser = await puppeteer.launch(firefox ? { browser: 'firefox', executablePath: browserPath, headless: true, protocolTimeout: 600000 } : { executablePath: browserPath, headless: 'new', protocolTimeout: 600000, args });
try {
  const page = firefox ? await browser.newPage() : await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: dsf });
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    const post = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await post('/api/auth/register', 'POST', { name: 'Gpu Probe', email: 'gpu@probe.test', password: 'motdepasse-solide-123' });
    await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  });
  await page.goto(`${base}/monde/${fix ? `?phonefix=${fix}` : ''}`, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForSelector('.world-hud', { timeout: 60000 });
  const renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  console.log(`renderer: ${renderer}`);
  await page.waitForSelector('.phone-host, .phone-sheet', { timeout: 60000 });
  // a split second after opening, and again a few seconds later: the report is that text shows briefly and then disappears
  await wait(150);
  await page.screenshot({ path: join(shots, `phone-${label}-early.png`) });
  await wait(3500);
  await page.screenshot({ path: join(shots, `phone-${label}.png`) });
  const probe = await page.evaluate(() => {
    const host = document.querySelector('.phone-host');
    if (!host) return null;
    const cs = getComputedStyle(host);
    const screen = document.querySelector('.phone-screen');
    return { transform: cs.transform.slice(0, 120), willChange: cs.willChange, overflow: cs.overflow, radius: cs.borderRadius, opacity: cs.opacity, font: getComputedStyle(screen).fontFamily, w: host.getBoundingClientRect().width };
  });
  console.log('host', JSON.stringify(probe));
  console.log(`screenshot: ${join(shots, `phone-${label}.png`)}`);
} finally {
  await browser.close();
  server.kill();
  await wait(400);
  rmSync(dataDir, { recursive: true, force: true });
}
