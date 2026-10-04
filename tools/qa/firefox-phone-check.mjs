import puppeteer from 'puppeteer-core';
const [base] = process.argv.slice(2);
const out = 'docs/qa-captures/final/firefox';
const browser = await puppeteer.launch({ browser: 'firefox', executablePath: 'C:/Program Files/Mozilla Firefox/firefox.exe', headless: 'new', protocolTimeout: 60000, args: ['--width=1280','--height=800'] });
console.log('firefox', await browser.version());
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const post=(u,m,b)=>fetch(u,{method:m,headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  await post('/api/auth/register','POST',{name:'FirefoxProbe4',email:`ff4${Date.now()}@example.org`,password:'motdepasse-solide-123'});
  await post('/api/me/avatar','PUT',{skin:'#e0ac69',outfit:'#3a6ea5',accent:'#ff4fa3'});
  const {user}=await(await fetch('/api/me')).json();
  localStorage.setItem(`world-seen-alerts:${user.id}`,JSON.stringify(Array.from({length:200},(_,i)=>i)));
});
// NO fps= param: real wall-clock rendering (frameloop 'always'), not the deterministic debug clock
await page.goto(`${base}/monde/?debug`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__tn, { timeout: 60000 });
await new Promise(r => setTimeout(r, 2500)); // let ecctrl/physics spin up for real
await page.evaluate(() => {
  window.__trace = [];
  const t0 = performance.now();
  const tick = () => {
    const host = document.querySelector('.phone-host');
    const text = host ? host.textContent.trim().length : -1;
    window.__trace.push({ t: Math.round(performance.now()-t0), op: host ? getComputedStyle(host).opacity : null, text });
    if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.keyboard.press('KeyT');
await new Promise(r => setTimeout(r, 4200));
const trace = await page.evaluate(() => window.__trace);
let last = null;
for (const p of trace) { const key = p.op + '|' + (p.text > 0); if (key !== last) { console.log(`t=${p.t}ms opacity=${p.op} hasText=${p.text > 0} (len ${p.text})`); last = key; } }
await page.screenshot({ path: `${out}/5-realtime-settled.png` });
await browser.close();
