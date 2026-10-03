// A missing / failing model must fail visibly with the accessible-portal recovery, never a blank page or HTML parsed as a GLB.
// node tools/qa/asset-fallback.mjs <base>   (intercepts requests in the browser; the server is untouched)
import puppeteer from 'puppeteer-core';
const [base] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 300000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const check = (name, ok, info = {}) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
async function scenario(label, handler, login) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 700 });
  if (login) {
    await page.goto(base + '/', { waitUntil: 'networkidle0' });
    await page.evaluate(async () => {
      const post = (u, m, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
      await post('/api/auth/register', 'POST', { name: 'Probe', email: `p${Date.now()}${Math.random()}@example.org`, password: 'motdepasse-solide-123' });
      await post('/api/me/avatar', 'PUT', { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
    });
  }
  await page.setRequestInterception(true);
  page.on('request', (r) => (/colony-pack\.glb/.test(r.url()) ? handler(r) : r.continue()));
  await page.goto(base + '/monde/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.world-error', { timeout: 30000 }).catch(() => null);
  const info = await page.evaluate(() => {
    const box = document.querySelector('.world-error');
    return box ? { role: box.getAttribute('role'), heading: box.querySelector('h1')?.textContent, portal: box.querySelector('a')?.getAttribute('href'), retry: Boolean(box.querySelector('button')) } : null;
  });
  check(`${label}: visible error with alert role, accessible-portal link and retry`, Boolean(info && info.role === 'alert' && info.portal === '/' && info.retry), info ?? {});
  await page.screenshot({ path: `docs/qa-captures/slice-gates/asset-fallback-${label.replace(/\W+/g, '-')}.png` });
  await page.close();
}
await scenario('network abort (guest)', (r) => r.abort('failed'), false);
await scenario('404 json (guest)', (r) => r.respond({ status: 404, contentType: 'application/json', body: '{"error":"Introuvable"}' }), false);
await scenario('SPA html served as glb (guest)', (r) => r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' }), false);
await scenario('network abort (logged in)', (r) => r.abort('failed'), true);
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILURES');
process.exit(results.every(Boolean) ? 0 : 1);
