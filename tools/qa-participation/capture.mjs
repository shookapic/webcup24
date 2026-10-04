// Screenshots of the participation UI on the mini host (disposable data, demo rows labelled). node tools/qa-participation/capture.mjs <outDir>
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { openDb, seedUsers, startHost } from './host.mjs';
const [outDir = 'docs/qa-captures/participation'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const db = openDb(); seedUsers(db);
const host = await startHost({ db, seedDemo: true });
const call = (user, method, path, body) => fetch(host.base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: `u=${user}` }, body: JSON.stringify(body) });
await call(3, 'POST', '/api/participation/admin/decisions', { title: 'Nom de la nouvelle place centrale', title_en: 'Name of the new central square', summary: 'Quel nom pour la place centrale ? (contenu de test)', choices: [{ label: 'Place des Colons', label_en: 'Settlers Square' }, { label: 'Place du Marché', label_en: 'Market Square' }], publish: true });
await call(3, 'POST', '/api/participation/ideas', {});
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
for (const [name, user, query, width] of [['guest-fr', null, '', 1000], ['citizen-fr', 1, '', 1000], ['citizen-en-320', 1, '?lang=en', 320], ['staff-fr', 3, '', 1000]]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  if (user) await page.setCookie({ name: 'u', value: String(user), url: host.base });
  await page.goto(`${host.base}/${query}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.tp-root h2');
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  console.log('shot', name);
  await page.close();
}
await browser.close(); await host.close();
