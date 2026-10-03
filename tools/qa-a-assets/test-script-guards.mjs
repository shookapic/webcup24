// Focused test of the path guards and the manifest labelling. No GPU, no rendering, no network.
//   node tools/qa-a-assets/test-script-guards.mjs        (Blender: env BLENDER or the default install path)
// Runs the real build/export scripts in Blender and the validator with hostile and valid arguments, and checks: rejected runs exit non-zero,
// say why, and create or change nothing; valid runs write only the expected files (no .blend1, no __pycache__); the committed model,
// source and report are byte-identical afterwards; every temporary file is gone. Writes docs/qa-captures/a-hospital/script-guard-test.json.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const SRC = join(ROOT, 'world/assets-src/a-hospital');
const RUN = join(ROOT, 'world/public/models/buildings');
const BUILD = join(ROOT, 'tools/assets-a/hospital/build_hospital.py');
const EXPORT = join(ROOT, 'tools/assets-a/hospital/export_hospital.py');
const VALIDATE = join(ROOT, 'tools/qa-a-assets/validate-glb.mjs');
const COMMITTED = { blend: join(SRC, 'hospital-a-v001.blend'), report: join(SRC, 'hospital-a-v001.build-report.json'), glb: join(RUN, 'hospital-a-v001.glb') };
const TEST = 'hospital-a-v998-guardtest';
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const outside = mkdtempSync(join(tmpdir(), 'hosp-guard-'));          // a directory that is not inside the checkout

const listing = (dir) => {
  const out = {};
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out[relative(ROOT, p).replace(/\\/g, '/')] = sha(p); } };
  walk(dir);
  return out;
};
const watched = [SRC, RUN, join(ROOT, 'tools/assets-a'), join(ROOT, 'tools/qa-a-assets/preview')];
const snapshot = () => Object.assign({}, ...watched.map(listing));
const before = snapshot();
const protectedBefore = Object.fromEntries(Object.entries(COMMITTED).map(([k, v]) => [k, sha(v)]));

const blender = (args, opened) => {
  const a = ['--background', ...(opened ? [opened] : ['--factory-startup']), '--python-exit-code', '7', '--python', args.script, '--', ...args.args];
  const r = spawnSync(BLENDER, a, { encoding: 'utf8', timeout: 240000 });
  return { status: r.status, text: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const build = (...args) => blender({ script: BUILD, args });
const exportGlb = (opened, ...args) => blender({ script: EXPORT, args }, opened);
const validator = (...args) => { const r = spawnSync(process.execPath, [VALIDATE, ...args], { encoding: 'utf8' }); return { status: r.status, text: `${r.stdout}${r.stderr}` }; };

const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
// a rejected run: non-zero exit, a reason in the output, and none of the listed paths came into existence
const rejects = (name, run, mustNotExist = [], reason = /path guard|refusing to overwrite/) => {
  const gone = mustNotExist.filter((p) => existsSync(p));
  record(name, run.status !== 0 && reason.test(run.text) && gone.length === 0, `exit ${run.status}; created: ${gone.join(',') || 'none'}; ${run.text.split('\n').filter((l) => /guard|refus|Error/.test(l)).slice(0, 2).join(' | ')}`);
};

const clean = () => {
  for (const f of [`${TEST}.blend`, `${TEST}.blend1`, `${TEST}.blend@`, `${TEST}.build-report.json`, `${TEST}.manifest.json`, 'hospital-a-escape.blend', 'hospital-a-escape.build-report.json']) rmSync(join(SRC, f), { force: true });
  for (const f of [`${TEST}.glb`, 'hospital-a-escape.glb']) rmSync(join(RUN, f), { force: true });
  for (const f of ['hospital-a-copy.blend']) rmSync(join(ROOT, 'tools/qa-a-assets', f), { force: true });
  try { rmdirSync(join(SRC, 'hospital-a-sub')); } catch { /* not created */ }              // a junction: rmdir removes the link, never its target
};

try {
  clean();
  // ---- build_hospital.py: rejected before any write
  const sibling = (p) => p.replace(/\.blend$/, '.build-report.json');
  const badBuild = (name, out) => rejects(`build rejects ${name}`, build('--out', out), [out, sibling(out)]);
  badBuild('--out outside the checkout (absolute)', join(outside, 'hospital-a-escape.blend'));
  badBuild('--out reaching outside by .. (relative)', join(SRC, '..', '..', '..', '..', 'hospital-a-escape.blend'));
  badBuild('--out in the wrong checkout directory (docs/)', join(ROOT, 'docs/hospital-a-escape.blend'));
  badBuild('--out with another suffix (.glb)', join(SRC, 'hospital-a-escape.glb'));
  badBuild('--out with an upper-case suffix (.BLEND)', join(SRC, 'hospital-a-escape.BLEND'));
  badBuild('--out with another name', join(SRC, 'other.blend'));
  badBuild('--out in a nested directory', join(SRC, 'sub', 'hospital-a-escape.blend'));
  mkdirSync(join(outside, 'target'));
  symlinkSync(join(outside, 'target'), join(SRC, 'hospital-a-sub'), 'junction');
  rejects('build rejects --out through a junction that points outside', build('--out', join(SRC, 'hospital-a-sub', 'hospital-a-escape.blend')), [join(outside, 'target', 'hospital-a-escape.blend'), join(outside, 'target', 'hospital-a-escape.build-report.json')]);
  rmdirSync(join(SRC, 'hospital-a-sub'));
  rejects('build refuses the committed .blend without --allow-overwrite', build('--out', COMMITTED.blend));
  writeFileSync(join(SRC, `${TEST}.build-report.json`), '{"pre-existing":true}\n');
  rejects('build refuses when only the sibling report exists (all outputs respect --allow-overwrite)', build('--out', join(SRC, `${TEST}.blend`)), [join(SRC, `${TEST}.blend`)]);
  record('the pre-existing sibling report was left untouched', readFileSync(join(SRC, `${TEST}.build-report.json`), 'utf8') === '{"pre-existing":true}\n');
  rmSync(join(SRC, `${TEST}.build-report.json`));

  // ---- build_hospital.py: a valid run inside the declared area
  const built = build('--out', join(SRC, `${TEST}.blend`));
  record('build writes the .blend and the sibling report inside the source area', built.status === 0 && existsSync(join(SRC, `${TEST}.blend`)) && existsSync(join(SRC, `${TEST}.build-report.json`)), `exit ${built.status} ${built.text.slice(-300)}`);
  const rebuilt = build('--out', join(SRC, `${TEST}.blend`), '--allow-overwrite');
  record('build with --allow-overwrite succeeds and leaves no .blend1 backup', rebuilt.status === 0 && !existsSync(join(SRC, `${TEST}.blend1`)), `exit ${rebuilt.status} blend1 ${existsSync(join(SRC, `${TEST}.blend1`))}`);
  rejects('build refuses the same outputs again without --allow-overwrite', build('--out', join(SRC, `${TEST}.blend`)));

  // ---- export_hospital.py: rejected before any write (opened .blend = the committed one unless stated)
  const goodGlb = join(RUN, `${TEST}.glb`);
  rejects('export rejects --out outside the checkout', exportGlb(COMMITTED.blend, '--out', join(outside, 'hospital-a-escape.glb')), [join(outside, 'hospital-a-escape.glb')]);
  rejects('export rejects --out reaching outside by ..', exportGlb(COMMITTED.blend, '--out', join(RUN, '..', '..', '..', '..', 'hospital-a-escape.glb')), [join(RUN, '..', '..', '..', '..', 'hospital-a-escape.glb')]);
  rejects('export rejects --out in the wrong checkout directory (world/public/models/)', exportGlb(COMMITTED.blend, '--out', join(ROOT, 'world/public/models/hospital-a-escape.glb')), [join(ROOT, 'world/public/models/hospital-a-escape.glb')]);
  rejects('export rejects --out with another suffix (.gltf)', exportGlb(COMMITTED.blend, '--out', join(RUN, 'hospital-a-escape.gltf')), [join(RUN, 'hospital-a-escape.gltf')]);
  rejects('export rejects --out with another name', exportGlb(COMMITTED.blend, '--out', join(RUN, 'other.glb')), [join(RUN, 'other.glb')]);
  rejects('export refuses the committed .glb without --allow-overwrite', exportGlb(COMMITTED.blend, '--out', COMMITTED.glb));
  copyFileSync(COMMITTED.blend, join(outside, 'hospital-a-copy.blend'));
  rejects('export rejects an opened .blend outside the checkout', exportGlb(join(outside, 'hospital-a-copy.blend'), '--out', goodGlb), [goodGlb]);
  copyFileSync(COMMITTED.blend, join(ROOT, 'tools/qa-a-assets/hospital-a-copy.blend'));
  rejects('export rejects an opened .blend inside the checkout but outside the source area', exportGlb(join(ROOT, 'tools/qa-a-assets/hospital-a-copy.blend'), '--out', goodGlb), [goodGlb]);
  rejects('export rejects an empty scene (no .blend opened)', blender({ script: EXPORT, args: ['--out', goodGlb] }), [goodGlb]);

  // ---- export_hospital.py: a valid run, then the output validated by the independent validator
  const exported = exportGlb(join(SRC, `${TEST}.blend`), '--out', goodGlb);
  record('export writes the .glb inside the runtime area', exported.status === 0 && existsSync(goodGlb), `exit ${exported.status} ${exported.text.slice(-300)}`);
  const goodSha = existsSync(goodGlb) ? sha(goodGlb) : null;
  rejects('export refuses the same .glb again without --allow-overwrite', exportGlb(join(SRC, `${TEST}.blend`), '--out', goodGlb));
  record('the refused export left the previous .glb unchanged', existsSync(goodGlb) && sha(goodGlb) === goodSha);
  const v = validator(goodGlb, 'unused', '--no-write');
  record('the validator passes every check on the freshly exported .glb', v.status === 0 && !/^FAIL/m.test(v.text) && (v.text.match(/^PASS/gm) ?? []).length === 13, v.text.split('\n').filter((l) => /^FAIL/.test(l)).join(' | '));
  results.push({ name: 'info: fresh export is byte-identical to the committed model', ok: true, info: goodSha === protectedBefore.glb });

  // ---- validate-glb.mjs: manifest path guard and labelling
  const m = join(SRC, `${TEST}.manifest.json`);
  const vOut = validator(goodGlb, join(outside, 'hospital-a-escape.manifest.json'));
  record('validator rejects a manifest outside the checkout', vOut.status !== 0 && /path guard/.test(vOut.text) && !existsSync(join(outside, 'hospital-a-escape.manifest.json')), vOut.text);
  const vName = validator(goodGlb, join(SRC, 'other.json'));
  record('validator rejects a manifest with another name in the source area', vName.status !== 0 && /path guard/.test(vName.text) && !existsSync(join(SRC, 'other.json')), vName.text);
  const vOk = validator(goodGlb, m);
  const man = existsSync(m) ? JSON.parse(readFileSync(m, 'utf8')) : null;
  record('validator writes a manifest in the source area with measured, declared and compared parts kept apart', vOk.status === 0 && man && man.measuredFromGlb && man.declaredContract && man.comparisons && man.allChecksPass === true && man.measuredFromGlb.textures === 0 && man.comparisons.footprintMatchesDeclaredCollisionBox === true && !('footprint' in man) && !('doorAnchor' in man) && !('worldPlacement' in man), vOk.text.slice(0, 200));
  record('measured part reports the real texture, image and sampler counts and no declared values', man && man.measuredFromGlb.textures === 0 && man.measuredFromGlb.images === 0 && man.measuredFromGlb.samplers === 0 && !('doorAnchor' in man.measuredFromGlb) && !('collisionBox' in man.measuredFromGlb));
  record('declared door anchor is marked as not stored in the GLB, and the comparison is computed from the declared numbers', man && man.declaredContract.doorAnchor.storedInGlb === false && man.comparisons.metresFromFootprintEdgeToDeclaredDoorAnchor === 1.8);
  // a GLB that fails the footprint check must produce false, not a hard-coded true
  const kit = join(ROOT, 'world/public/assets/models/kit-pack.glb');
  const mk = join(SRC, `${TEST}.manifest.json`);
  const vKit = validator(kit, mk);
  const manKit = existsSync(mk) ? JSON.parse(readFileSync(mk, 'utf8')) : null;
  record('a GLB that fails the footprint check yields footprintMatchesDeclaredCollisionBox false and allChecksPass false', existsSync(kit) && vKit.status !== 0 && manKit && manKit.comparisons.footprintMatchesDeclaredCollisionBox === false && manKit.allChecksPass === false && manKit.checks.some((c) => !c.ok && /footprint/.test(c.name)), existsSync(kit) ? vKit.text.slice(0, 200) : 'kit-pack.glb missing');
} finally {
  clean();
  try { rmdirSync(join(SRC, 'hospital-a-sub')); } catch { /* gone */ }
  rmSync(outside, { recursive: true, force: true });
}

const after = snapshot();
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]);
record('after cleanup every watched directory is exactly as before (no stray .blend1, .blend@, __pycache__, report, manifest or glb)', changed.length === 0, changed.join(', '));
record('committed model, source and build report are byte-identical', Object.entries(COMMITTED).every(([k, v]) => sha(v) === protectedBefore[k]), JSON.stringify(protectedBefore));

const info = results.find((r) => r.info !== undefined);
const summary = { when: new Date().toISOString(), blender: BLENDER, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, committedModelSha256: protectedBefore.glb, freshExportIdenticalToCommitted: info?.info ?? null, results: results.filter((r) => r.info === undefined) };
writeFileSync(join(ROOT, 'docs/qa-captures/a-hospital/script-guard-test.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`${summary.passed} passed, ${summary.failed} failed; committed GLB sha256 ${protectedBefore.glb.slice(0, 16)}...`);
process.exit(summary.failed ? 1 : 0);
