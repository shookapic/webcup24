import { parseRetryAfter } from './polling.js';
// Same contract as the portal's api() helper in public/app.js.
export async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10_000),
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Une erreur est survenue.'), { status: response.status, retryAfter: parseRetryAfter(response.headers.get('Retry-After')) || Number(data.retryAfter) || 0 });
  return data;
}
