import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildIndex } from '../../orientation.mjs';
import { seededDb } from './fixtures.mjs';
let api; vm.runInNewContext(readFileSync(new URL('../../public/orientation.js', import.meta.url), 'utf8'), { globalThis: { __orientationExport: (a) => { api = a; } }, window: undefined });
const e = api.engine.createEngine(buildIndex(seededDb()), 'fr');
for (const q of process.argv.slice(2)) console.log(q, '=>', JSON.stringify(e.rank(q).results.map((r) => [r.key, r.score])));
