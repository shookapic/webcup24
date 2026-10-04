// Rebuilds the colony GLBs from the Blender scripts and packs them into the one file the world loads.
// node tools/assets/build.mjs            (BLENDER=<path to blender.exe> to override the default install location)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url))); // always the project root, whatever the caller's cwd
const blender = process.env.BLENDER || (process.platform === 'win32' ? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' : 'blender');
if (!existsSync(blender) && process.platform === 'win32') { console.error(`Blender not found at ${blender}; set BLENDER`); process.exit(1); }
const assets = [['bench', 'bench'], ['lamp', 'streetLamp'], ['tree', 'colonyTree'], ['townhall', 'townHall']];
mkdirSync('world/assets-src/colony', { recursive: true });
mkdirSync('world/public/models', { recursive: true });
for (const [script, name] of assets) {
  const run = spawnSync(blender, ['-b', '--factory-startup', '--python', `tools/assets/${script}.py`, '--', `world/assets-src/colony/${name}.glb`], { encoding: 'utf8' });
  const line = run.stdout.split('\n').find((l) => l.startsWith('TRIANGLES'));
  if (run.status !== 0 || !line) { console.error(run.stdout.slice(-800), run.stderr.slice(-800)); process.exit(1); }
  console.log(`${name}: ${line}`);
}
const pack = spawnSync(process.execPath, ['tools/pack-models.mjs', 'world/public/models/colony-pack.glb', ...assets.map(([, name]) => `world/assets-src/colony/${name}.glb`)], { stdio: 'inherit' });
process.exit(pack.status ?? 1);
