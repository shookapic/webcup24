// Pure checks of world/src/polling.js. node tools/qa/polling-check.mjs
import { MAX_BACKOFF, firstDelay, nextDelay, parseRetryAfter } from '../../world/src/polling.js';
let bad = 0;
const check = (name, ok, info = '') => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const mid = () => 0.5; // jitter factor exactly 1 without Retry-After
check('healthy: the normal 2 s rate', nextDelay(2000, 0, { random: mid }) === 2000);
check('failures double the delay: 4 s, 8 s, 16 s', [1, 2, 3].map((n) => nextDelay(2000, n, { random: mid })).join() === '4000,8000,16000');
check(`backoff is capped at ${MAX_BACKOFF / 1000} s`, nextDelay(2000, 20, { random: mid }) === MAX_BACKOFF);
check('jitter without Retry-After stays within +-20 %', [0, 0.999].every((r) => { const d = nextDelay(2000, 0, { random: () => r }); return d >= 1600 && d <= 2400; }));
// Retry-After is a minimum
for (const seconds of [1, 45, 120, 121, 600, 9999]) {
  const lowest = nextDelay(2000, 1, { retryAfter: seconds, random: () => 0 });
  const highest = nextDelay(2000, 1, { retryAfter: seconds, random: () => 0.999999 });
  check(`Retry-After ${seconds} s: lowest possible delay is not earlier than the instruction`, lowest >= Math.max(2000, seconds * 1000), `${lowest} ms >= ${Math.max(2000, seconds * 1000)}`);
  check(`Retry-After ${seconds} s: jitter only adds time (at most +20 %)`, highest <= Math.max(2000, seconds * 1000) * 1.2 + 1 && highest >= lowest);
}
check('a long instruction (9999 s) is not capped to an earlier retry', nextDelay(2000, 1, { retryAfter: 9999, random: () => 0 }) === 9_999_000);
check('a Retry-After of 0 or missing falls back to normal back-off', nextDelay(2000, 1, { retryAfter: 0, random: mid }) === 4000);
// header parsing
check('parse: delta-seconds', parseRetryAfter('120') === 120 && parseRetryAfter(' 7 ') === 7);
const now = Date.parse('2026-10-04T10:00:00Z');
check('parse: HTTP-date in the future is converted to seconds (rounded up)', parseRetryAfter('Sun, 04 Oct 2026 10:01:30 GMT', now) === 90 && parseRetryAfter('Sun, 04 Oct 2026 10:00:00.5 GMT', now) === 1);
check('parse: past date, garbage, empty, null -> 0 (no instruction)', [parseRetryAfter('Sun, 04 Oct 2026 09:00:00 GMT', now), parseRetryAfter('soon', now), parseRetryAfter('', now), parseRetryAfter(null, now), parseRetryAfter('-5', now)].every((v) => v === 0));
const spread = Array.from({ length: 1000 }, () => firstDelay(2000));
check('first poll of 1000 simultaneous loads is spread over the whole 2 s window', Math.min(...spread) < 100 && Math.max(...spread) > 1900 && new Set(spread.map((d) => Math.floor(d / 200))).size >= 9);
console.log(bad ? `FAILURES (${bad})` : 'ALL PASS');
process.exit(bad ? 1 : 0);
