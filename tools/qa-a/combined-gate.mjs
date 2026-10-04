// One command for the combined release gate on the exact tree it is run in: build, then every focused suite one at a time (ports 3200-3209), logs saved, compact summary.
// Usage: node tools/qa-a/combined-gate.mjs [logDir]   (needs: npm ci; npm i --no-save puppeteer-core axe-core jsdom)
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const logs = process.argv[2] || join(root, 'gate-logs');
mkdirSync(logs, { recursive: true });
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const steps = [
  ['build (world + portal)', ['npm', ['run', 'build']], /./, 'exit'],
  ['smoke-a (roles, API, privacy claims, security)', ['node', ['tools/smoke-a.mjs']], /(\d+)\/(\d+) checks passed/, 'smoke'],
  ['migration-old-db (existing data + restart)', ['node', ['tools/qa-a/migration-old-db.mjs']], /all checks passed/, 'text'],
  ['portal + portal-audit', ['node', ['tools/qa-a/portal.mjs']], /all portal checks passed/, 'text'],
  ['portal-audit', ['node', ['tools/qa-a/portal-audit.mjs']], /all checks passed/, 'text'],
  ['form-protection (signed tokens, quotas, duplicates)', ['node', ['tools/qa-a/form-protection.mjs']], /all form-protection checks passed/, 'text'],
  ['forms-browser', ['node', ['tools/qa-a/forms-browser.mjs']], /all form UI checks passed/, 'text'],
  ['receipts-replies', ['node', ['tools/qa-a/receipts-replies.mjs']], /all receipt and reply checks passed/, 'text'],
  ['triage-api (themes, priority, similar)', ['node', ['tools/qa-a/triage-api.mjs']], /all triage API checks passed/, 'text'],
  ['scoping (agent perimeter)', ['node', ['tools/qa-a/scoping.mjs']], /all scoping checks passed/, 'text'],
  ['second-step (TOTP)', ['node', ['tools/qa-a/second-step.mjs']], /all second-step checks passed/, 'text'],
  ['passkeys (maintained verifier, hostile CBOR, legacy keys)', ['node', ['tools/qa-a/passkeys.mjs']], /all passkey checks passed/, 'text'],
  ['ops-api (emergency, export, backup, anomalies, official message, partner)', ['node', ['tools/qa-a/ops-api.mjs']], /all operations checks passed/, 'text'],
  ['participation-integration (lazy module, roles, deletion)', ['node', ['tools/qa-a/participation-integration.mjs']], /all participation integration checks passed/, 'text'],
  ['essentials-browser (lazy modules, essentials mode, offline copy, F72)', ['node', ['tools/qa-a/essentials-browser.mjs']], /all essentials checks passed/, 'text'],
  ['axe-modules-open (both modules, normal + high contrast)', ['node', ['tools/qa-a/axe-modules-open.mjs']], /./, 'axe'],
  ['a11y-browser (axe, keyboard budgets, 200 % zoom, 390 px, contrast)', ['node', ['tools/qa-a/a11y-browser.mjs']], /all accessibility checks passed/, 'text'],
  ['portal-browser', ['node', ['tools/qa-a/portal-browser.mjs']], /all browser checks passed/, 'text'],
  ['civic-browser (confirmation, receipts, replies, themes, priority, similar)', ['node', ['tools/qa-a/civic-browser.mjs']], /all civic UI checks passed/, 'text'],
  ['auth-browser (2FA, passkeys with a virtual authenticator, counter account, emergency, export, backup, official message)', ['node', ['tools/qa-a/auth-browser.mjs']], /all auth UI checks passed/, 'text'],
  ['world-ui (Phone, guidance button, HUD, avatar editor)', ['node', ['tools/qa-a/world-ui.mjs']], /all world UI checks passed/, 'text'],
  ['world-production (production-built world served by Node: assets, CSP, HUD)', ['node', ['tools/qa-a/world-production.mjs']], /all production world checks passed/, 'text'],
];
const rows = [];
for (const [name, [cmd, args], pass, kind] of steps) {
  const started = Date.now();
  const out = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' && cmd === 'npm', timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
  const text = `${out.stdout || ''}\n${out.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  const file = name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase() + '.log';
  writeFileSync(join(logs, file), text);
  let ok = out.status === 0;
  if (kind === 'text') ok = ok && pass.test(text) && !/^FAIL/m.test(text);
  if (kind === 'smoke') { const m = pass.exec(text); ok = ok && Boolean(m) && m[1] === m[2]; }
  if (kind === 'axe') ok = ok && /no violations/.test(text) && !/violations?\b.*\[(serious|critical|moderate|minor)\]/.test(text);
  const fails = (text.match(/^FAIL.*$/gm) || []).slice(0, 3).map((l) => l.slice(0, 160));
  rows.push({ name, ok, seconds: Math.round((Date.now() - started) / 1000), fails });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${Math.round((Date.now() - started) / 1000)} s)${ok ? '' : '  ' + fails.join(' | ')}`);
}
const failed = rows.filter((row) => !row.ok);
const summary = `# Combined gate on ${sha}\n${rows.map((row) => `- ${row.ok ? 'PASS' : 'FAIL'} ${row.name} (${row.seconds} s)${row.ok ? '' : ' :: ' + row.fails.join(' | ')}`).join('\n')}\n\n${failed.length ? `${failed.length} FAILED` : `all ${rows.length} steps passed`}\n`;
writeFileSync(join(logs, 'SUMMARY.md'), summary);
console.log(failed.length ? `\n${failed.length} of ${rows.length} FAILED (logs in ${logs})` : `\nall ${rows.length} steps passed (logs in ${logs})`);
process.exit(failed.length ? 1 : 0);
