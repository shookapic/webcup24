// Focused proof (read-only review of A's committed factors.mjs): a 5-byte crafted CBOR item makes the reader loop ~4 billion times.
// node tools/qa-auth/cbor-dos.mjs <path to a COPY of A's factors.mjs>   (the reader runs in a child process with a 4 s kill timer)
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const factors = pathToFileURL(resolve(process.argv[2])).href;
const code = [
  `import { cbor } from ${JSON.stringify(factors)};`,
  'const crafted = Buffer.from([0x9a, 0xff, 0xff, 0xff, 0xff]); // CBOR array header with length 4294967295 and no content',
  'const t = performance.now();',
  "try { const r = cbor(crafted); console.log('returned', Array.isArray(r.value) ? `array of ${r.value.length}` : typeof r.value, 'after', Math.round(performance.now() - t), 'ms'); } catch (e) { console.log('threw', e.message, 'after', Math.round(performance.now() - t), 'ms'); }",
].join('\n');
const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 4000, encoding: 'utf8', maxBuffer: 1 << 20 });
const killed = run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGTERM';
console.log(killed ? 'FAIL: still running after 4 s (killed): a 5-byte item blocks the event loop' : `result: ${(run.stdout || run.stderr).trim().slice(0, 200)}`);
process.exit(killed ? 1 : 0);
