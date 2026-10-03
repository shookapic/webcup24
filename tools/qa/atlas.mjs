// Dumps the recoloured colonist atlas (debug aid): node tools/qa/atlas.mjs http://127.0.0.1:3100 out.png
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const [base, out] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
});
await page.goto(base + '/monde/?debug', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.atlases?.length, { timeout: 60000 });
const info = await page.evaluate(() => { const a = window.__tn.atlases.find((x) => x.key === '#e0ac69#3a6ea5#ff4fa3') ?? window.__tn.atlases[0]; return { type: a.key, url: a.out.toDataURL('image/png') }; });
console.log(info.type);
writeFileSync(out, Buffer.from(info.url.split(',')[1], 'base64'));
await browser.close();
