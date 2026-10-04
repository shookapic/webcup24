// Frame-time + draw-call route on REAL hardware (headed browser, real rAF, no throttling). Teleports through the districts and
// records, per stop, frame-time percentiles and renderer.info (calls, triangles). node tools/qa/perf.mjs <base> <out.json> [seconds-per-stop=6]
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const [base, out, secs = '6'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: false, args: ['--window-size=1500,1000'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  const { user } = await (await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
});
await page.goto(base + '/monde/?debug' + (process.env.QUALITY ? '&quality=' + process.env.QUALITY : ''), { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.ecctrl && window.__tn?.gl, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
const cdp = await page.createCDPSession();
if (process.env.THROTTLE) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) }); // CPU proxy for a weaker device, applied after load
const hardware = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return { gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown', ua: navigator.userAgent, dpr: devicePixelRatio, cores: navigator.hardwareConcurrency }; });
const stops = [['spawn', 0, 1, 0], ['mairie', 0, -8, 0], ['sante', 24, -3, -Math.PI / 2], ['marche', -26, -3, Math.PI / 2], ['habitat', -30, -26, Math.PI / 2], ['sud', 4, 40, 0]];
const results = [];
for (const [name, x, z, az] of stops) {
  const r = await page.evaluate(async ({ x, z, az, ms }) => {
    const tn = window.__tn;
    const b = tn.ecctrl.body;
    b.setTranslation({ x, y: 1.2, z }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    tn.controls.rotateAzimuthTo(az, false);
    await new Promise((res) => setTimeout(res, 1200));
    const deltas = [];
    let last = performance.now();
    const end = last + ms;
    await new Promise((res) => {
      const tick = (t) => { deltas.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    deltas.shift();
    deltas.sort((p, q) => p - q);
    const pct = (p) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))];
    // draw calls / triangles of ONE whole frame (shadow pass + scene + post-processing): stop auto reset, reset, wait one frame
    const info = tn.gl.info;
    info.autoReset = false;
    info.reset();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const one = { calls: info.render.calls / 2, triangles: info.render.triangles / 2 }; // two frames elapsed
    info.autoReset = true;
    return { frames: deltas.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: deltas[deltas.length - 1], calls: one.calls, triangles: one.triangles, geometries: info.memory.geometries, textures: info.memory.textures };
  }, { x, z, az, ms: Number(secs) * 1000 });
  results.push({ stop: name, ...r });
  console.log(name, JSON.stringify(r));
}
writeFileSync(out, JSON.stringify({ hardware, results }, null, 2));
console.log(JSON.stringify(hardware));
await browser.close();
