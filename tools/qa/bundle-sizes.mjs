// Bytes per package inside a built chunk, from its source map (build with: npx vite build --sourcemap --outDir <tmp>).
// node tools/qa/bundle-sizes.mjs <tmp>/assets/index-xxxx.js
import { readFileSync } from 'node:fs';
const [file] = process.argv.slice(2);
const code = readFileSync(file, 'utf8');
const map = JSON.parse(readFileSync(`${file}.map`, 'utf8'));
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const decode = (segment) => {
  const out = [];
  let shift = 0;
  let value = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    value += (digit & 31) << shift;
    if (digit & 32) shift += 5;
    else { out.push(value & 1 ? -(value >> 1) : value >> 1); shift = 0; value = 0; }
  }
  return out;
};
const codeLines = code.split('\n');
const perSource = new Map();
let source = 0;
map.mappings.split(';').forEach((line, lineIndex) => {
  let column = 0;
  const segments = line.split(',').filter(Boolean).map((raw) => {
    const v = decode(raw);
    column += v[0];
    if (v.length > 1) source += v[1];
    return { column, source: v.length > 1 ? source : -1 };
  });
  segments.forEach((segment, i) => {
    const end = i + 1 < segments.length ? segments[i + 1].column : (codeLines[lineIndex] ?? '').length;
    const name = segment.source >= 0 ? map.sources[segment.source] : '(unmapped)';
    perSource.set(name, (perSource.get(name) || 0) + Math.max(0, end - segment.column));
  });
});
const perPackage = new Map();
for (const [name, size] of perSource) {
  const normal = name.split(String.fromCharCode(92)).join('/');
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(normal);
  const key = match ? match[1] : normal.includes('world/src') ? '(app code)' : normal;
  perPackage.set(key, (perPackage.get(key) || 0) + size);
}
for (const [key, size] of [...perPackage].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`${(size / 1024).toFixed(0).padStart(6)} KB  ${key}`);
