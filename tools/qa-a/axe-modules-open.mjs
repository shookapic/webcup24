import { spawn } from 'node:child_process';import { createRequire } from 'node:module';import { readFileSync, mkdtempSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';import { pathToFileURL } from 'node:url';
const root='C:/Users/shookapic/Documents/webcup/webcup24-A-finalqa/';const req=createRequire(root+'package.json');
const puppeteer=(await import(pathToFileURL(req.resolve('puppeteer-core')).href)).default;const axeSource=readFileSync(req.resolve('axe-core/axe.min.js'),'utf8');
const d=mkdtempSync(join(tmpdir(),'ax-'));const port=3206;
const env={...process.env,DATA_PATH:join(d,'s.sqlite'),PORT:String(port),HOST:'127.0.0.1',TERRA_NOVA_API_KEY:'',TRUST_PROXY:'1'};
const s=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'ignore'});await new Promise(r=>setTimeout(r,1500));
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox']});
for (const contrast of [false,true]) for (const hash of ['#orientation','#participation']) {
 const p=await b.newPage();await p.setViewport({width:1280,height:900});
 if(contrast) await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('highContrast','true')}catch{}});
 await p.goto(`http://127.0.0.1:${port}/${hash}`,{waitUntil:'networkidle0'});await new Promise(r=>setTimeout(r,1500));
 await p.evaluate(axeSource);
 const v=await p.evaluate(async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']})).violations.map(x=>`${x.id}[${x.impact}] x${x.nodes.length}: ${x.nodes[0].target.join(' ')}`));
 console.log(contrast?'HC':'normal',hash,v.length?v.join(' | '):'no violations');await p.close();}
await b.close();s.kill();
