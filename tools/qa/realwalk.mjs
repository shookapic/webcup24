// Real-time keyboard walk check through the ?debug probe. Same requirements as movement.mjs.
import puppeteer from 'puppeteer-core';
const [base] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Real', email: `r${Date.now()}@example.org`, password: 'motdepasse-solide-123' }) });
  await fetch('/api/me/avatar', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' }) });
  const { user } = await (await fetch('/api/me')).json(); localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
});
await page.goto(base + '/monde/?debug', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.samples.length > 30, { timeout: 120000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pos = () => page.evaluate(() => { const s = window.__tn.samples.at(-1); return { x: +s.x.toFixed(2), z: +s.z.toFixed(2), ground: s.ground, tilt: +(Math.max(Math.abs(s.pitch), Math.abs(s.roll)) * 57.3).toFixed(2) }; });
const a = await pos();
await page.keyboard.down('KeyW'); await wait(3000); await page.keyboard.up('KeyW'); await wait(1500);
const b = await pos();
const fps = await page.evaluate(() => { const s = window.__tn.samples; return (s.length - 1) / (s.at(-1).t - s[0].t); });
console.log(JSON.stringify({ before: a, after: b, moved_m: Math.hypot(b.x - a.x, b.z - a.z).toFixed(2), real_fps: fps.toFixed(1) }));
await browser.close();
