// Pure checks of world/src/polling.js. node tools/qa/polling-check.mjs
import { MAX_BACKOFF, firstDelay, nextDelay } from '../../world/src/polling.js';
let bad = 0;
const check = (name, ok, info = '') => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const mid = () => 0.5; // jitter factor exactly 1
check('healthy: the normal 2 s rate', nextDelay(2000, 0, { random: mid }) === 2000);
check('failures double the delay: 4 s, 8 s, 16 s', [1, 2, 3].map((n) => nextDelay(2000, n, { random: mid })).join() === '4000,8000,16000');
check(`backoff is capped at ${MAX_BACKOFF / 1000} s`, nextDelay(2000, 20, { random: mid }) === MAX_BACKOFF);
check('Retry-After is honoured (never faster than the normal rate, capped at 120 s)', nextDelay(2000, 1, { retryAfter: 45, random: mid }) === 45_000 && nextDelay(2000, 1, { retryAfter: 1, random: mid }) === 2000 && nextDelay(2000, 1, { retryAfter: 9999, random: mid }) === 120_000);
check('jitter stays within +-20 %', [0, 0.999].every((r) => { const d = nextDelay(2000, 0, { random: () => r }); return d >= 1600 && d <= 2400; }));
const spread = Array.from({ length: 1000 }, () => firstDelay(2000));
check('first poll of 1000 simultaneous loads is spread over the whole 2 s window', Math.min(...spread) < 100 && Math.max(...spread) > 1900 && new Set(spread.map((d) => Math.floor(d / 200))).size >= 9);
console.log(bad ? `FAILURES (${bad})` : 'ALL PASS');
process.exit(bad ? 1 : 0);
