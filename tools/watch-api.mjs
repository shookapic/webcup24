// Polls the contest API and keeps api-requests.md (git-ignored) up to date.
//   npm run watch-api                 keep running, print new requests as they appear
//   npm run watch-api -- --exit-on-new  stop when new requests appear (for a Claude Code background task)
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const url = 'https://24h.webcup.fr/wp-json/webcup/v1/requests';
const out = new URL('../api-requests.md', import.meta.url);
const state = new URL('../data/seen-requests.json', import.meta.url);
const exitOnNew = process.argv.includes('--exit-on-new');
const key = process.env.TERRA_NOVA_API_KEY;
if (!key) {
  console.error('TERRA_NOVA_API_KEY is missing: copy .env.example to .env and set it.');
  process.exit(1);
}

await mkdir(new URL('.', state), { recursive: true });
let seen = null;
try { seen = JSON.parse(await readFile(state, 'utf8')); } catch { /* first run: baseline */ }
const first = seen === null;
seen ??= {};

const cell = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');

async function render({ session: s, requests }) {
  const rows = [...requests].sort((a, b) => (seen[b.request_code] || '').localeCompare(seen[a.request_code] || '') || b.request_code.localeCompare(a.request_code));
  const minutes = s.elapsed_minutes || 0;
  await writeFile(out, [
    '# Terra Nova — demandes API',
    '',
    `Mis à jour : ${new Date().toLocaleString('fr-FR')} · vague ${s.current_wave} · ${s.visible_requests_count} demandes · H+${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')} · prochaine vague (${s.next_wave_number}) dans ${s.minutes_until_next_wave} min`,
    '',
    '| Code | Vu le | Vague | Difficulté | XP | Demandeur | Demande |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.request_code} | ${seen[r.request_code] || ''} | ${r.wave_number} | ${r.difficulty} | ${r.xp_total} | ${cell(r.requester_type)} | ${cell(r.message_public)} |`),
    '',
  ].join('\n'));
}

for (let baseline = first; ; baseline = false) {
  try {
    const response = await fetch(url, { headers: { 'X-Webcup-Api-Key': key }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const fresh = data.requests.filter((r) => !(r.request_code in seen));
    for (const r of fresh) seen[r.request_code] = baseline ? '' : now;
    await writeFile(state, JSON.stringify(seen));
    await render(data);
    if (fresh.length && !baseline) {
      console.log(`NEW REQUESTS (${now}):`);
      for (const r of fresh) console.log(`- ${r.request_code} (${r.difficulty}, ${r.xp_total} XP): ${r.message_public}`);
      if (exitOnNew) process.exit(0);
    }
  } catch (error) {
    console.error(`${new Date().toLocaleTimeString('fr-FR')} fetch failed: ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}
