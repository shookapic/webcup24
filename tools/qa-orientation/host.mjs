// Mini host: seeded disposable database in A's shape + fake session (cookie u=1) + the orientation module and page. No dependency on A's server.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { handleOrientation } from '../../orientation.mjs';
import { seededDb } from './fixtures.mjs';

export async function startHost({ db = seededDb(), failIndex = 0, delayMs = 0 } = {}) {
  let hits = 0;
  const requests = [];
  const sendJson = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    try {
      requests.push(`${request.method} ${request.url}`);
      if (url.pathname === '/orientation.js' || url.pathname === '/orientation.css') {
        const content = readFileSync(new URL(`../../public${url.pathname}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
        return response.end(content);
      }
      if (url.pathname === '/api/me') return sendJson(response, 200, { user: /(?:^|; )u=1/.test(request.headers.cookie || '') ? { id: 1, role: 'citizen', name: 'Camille' } : null });
      if (url.pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return response.end(readFileSync(new URL('./stub.html', import.meta.url))); }
      if (url.pathname === '/api/orientation/index') {
        hits++;
        if (hits <= failIndex) return sendJson(response, 503, { error: 'Service momentanément indisponible.' });
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (await handleOrientation({ request, response, path: url.pathname, method: request.method, db, sendJson, fail, cityNow: () => '2026-10-04T10:00' })) return;
      fail(404, 'Introuvable.');
    } catch (error) { sendJson(response, error.status || 500, { error: error.message }); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, db, base: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}
