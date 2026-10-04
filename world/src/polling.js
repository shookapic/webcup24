// Polling that stays polite under load (F77 / F78, world side). Each client desynchronises itself with random jitter, backs off exponentially while the
// server is failing or answering 429/503, and returns to the normal rate after one success. Pure functions: tools/qa/polling-check.mjs.
// Retry-After is a MINIMUM: the next request is never earlier than the server's instruction (no negative jitter, no cap that could shorten it).
export const MAX_BACKOFF = 30_000;
export function nextDelay(base, failures, { retryAfter, random = Math.random } = {}) {
  if (retryAfter > 0) return Math.max(base, retryAfter * 1000) * (1 + random() * 0.2); // positive-only jitter spreads the herd after the deadline
  const jitter = 0.8 + random() * 0.4; // +-20 %: clients never fall into lock step
  const backoff = failures > 0 ? Math.min(MAX_BACKOFF, base * 2 ** Math.min(failures, 8)) : base;
  return backoff * jitter;
}
export const firstDelay = (base, random = Math.random) => random() * base; // spread the first poll of many simultaneous page loads
// Retry-After as seconds: delta-seconds ("120") or an HTTP-date; anything else, or a past date, means "no instruction".
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return 0;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const at = Date.parse(text);
  return Number.isNaN(at) ? 0 : Math.max(0, Math.ceil((at - now) / 1000));
}
