// Polling that stays polite under load (F77 / F78, world side). Each client desynchronises itself with random jitter, backs off exponentially while the
// server is failing or answering 429/503 (honouring Retry-After), and returns to the normal rate after one success. Pure functions: tools/qa/polling-check.mjs.
export const MAX_BACKOFF = 30_000;
export function nextDelay(base, failures, { retryAfter, random = Math.random } = {}) {
  const jitter = 0.8 + random() * 0.4; // +-20 %: clients never fall into lock step
  if (retryAfter > 0) return Math.min(120_000, Math.max(base, retryAfter * 1000)) * jitter;
  const backoff = failures > 0 ? Math.min(MAX_BACKOFF, base * 2 ** Math.min(failures, 8)) : base;
  return backoff * jitter;
}
export const firstDelay = (base, random = Math.random) => random() * base; // spread the first poll of many simultaneous page loads
