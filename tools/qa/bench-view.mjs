// Captures of a bench NPC cycle: approach, turn, sitting down, seated, standing up. node tools/qa/bench-view.mjs <base> <outDir>
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const [base, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
  await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  const { user } = await (await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)));
});
await page.goto(base + '/monde/?debug&fps=30', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn?.run, { timeout: 60000 });
await page.evaluate(async () => { const tn = window.__tn; for (let i = 0; i < 60 && !tn.ecctrl; i++) await tn.run(0.5); await tn.run(1); tn.freecam = true; });
const frame = async (name, mode, extraSeconds = 0) => {
  await page.evaluate(async ({ mode, extraSeconds }) => {
    const tn = window.__tn;
    const bot = tn.npcs[0];
    for (let i = 0; i < 4000 && bot.mode !== mode; i++) await tn.run(1 / 30);
    await tn.run(extraSeconds);
    // camera 3.2 m from the bot, from its side, at chest height
    const side = [Math.cos(bot.heading), -Math.sin(bot.heading)];
    tn.controls.setLookAt(bot.x + side[0] * 6 + Math.sin(bot.heading) * 1.2, 1.7, bot.z + side[1] * 6 + Math.cos(bot.heading) * 1.2, bot.x, 0.6, bot.z, false);
    await tn.run(0.1);
  }, { mode, extraSeconds });
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
};
await page.evaluate(async () => { const tn = window.__tn; let ok = false; for (let i = 0; i < 600 && !ok; i++) { ok = tn.forceSit(0, 0); if (!ok) await tn.run(0.1); } });
await frame('1-approach', 'approach', 1.0);
await frame('2-turn', 'turn');
await frame('3-sitting-down', 'sitDown', 0.35);
await frame('4-seated', 'sit', 1.0);
await frame('5-standing-up', 'standUp', 0.3);
await frame('6-resumed', 'walk', 1.5);
await browser.close();
