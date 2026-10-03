// Real-browser phone text capture on the hardware GPU (headed, disposable profile): the user's defect was sliced/vanishing glyphs in
// Firefox. node tools/qa/phone-firefox.mjs <base> <outPrefix> [firefox|chrome] [query]   e.g. query "&phoneproj" for the old placement
// Opens the phone with T, screenshots at ~150 ms and 3.5 s, then measures text presence (light glyph pixels) in the screen area.
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
const [base, prefix, which = 'firefox', query = ''] = process.argv.slice(2);
const firefox = which === 'firefox';
const browser = await puppeteer.launch(firefox
  ? { browser: 'firefox', executablePath: 'C:/Program Files/Mozilla Firefox/firefox.exe', headless: false, protocolTimeout: 120000, args: ['-width', '1440', '-height', '900'] }
  : { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: false, args: ['--window-size=1440,960'] });
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
await page.goto(`${base}/monde/?x=1${query}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 8000)); // physics chunk + models
console.log('dpr', await page.evaluate(() => devicePixelRatio));
await page.keyboard.press('KeyT');
const shots = [['early', 450], ['late', 3500]];
const stats = [];
for (const [name, wait] of shots) {
  await new Promise((r) => setTimeout(r, wait));
  const file = `${prefix}-${which}-${name}.png`;
  await page.screenshot({ path: file });
  const rect = await page.evaluate(() => { const r = document.querySelector('.phone-host')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; });
  if (!rect) { console.log(name, 'no phone host'); continue; }
  const png = PNG.sync.read(readFileSync(file));
  const scale = png.width / 1440;
  let light = 0;
  let total = 0;
  for (let y = Math.round(rect.y * scale); y < Math.round((rect.y + rect.h) * scale); y++) {
    for (let x = Math.round(rect.x * scale); x < Math.round((rect.x + rect.w) * scale); x++) {
      const i = (y * png.width + x) * 4;
      total++;
      if (png.data[i] > 200 && png.data[i + 1] > 200 && png.data[i + 2] > 190) light++; // heading / body text is near white
    }
  }
  stats.push({ name, rect, lightPixels: light, share: +(light / total).toFixed(4) });
}
console.log(JSON.stringify(stats));
await browser.close();
