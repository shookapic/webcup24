// Screenshot helper. Usage: node tools/qa/shot.mjs <url> <out.png> [width=1440] [height=900] [waitMs=4000] [login=0]
// login=1 registers a throw-away user with an avatar first (same origin as the url), so /monde/ shows the playable scene.
import puppeteer from 'puppeteer-core';
const [url, out, width = '1440', height = '900', wait = '4000', login = '0'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: Number(width), height: Number(height) });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log(m.type(), m.text().slice(0, 200)));
if (login === '1') {
  const origin = new URL(url).origin;
  await page.goto(origin + '/', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
    await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
    const { user } = await (await fetch('/api/me')).json();
    localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
  });
}
await page.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, Number(wait)));
await page.screenshot({ path: out });
await browser.close();
