import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ecctrl asks for @dimforge/rapier3d-compat ^0.19.2 but npm hoists 0.12.0 (from @types/three) to the top level, so the bundle
// carried TWO Rapier WebAssembly blobs (~2.9 MB of wasm) and ecctrl ran another Rapier than @react-three/rapier. Resolve every
// import to the copy @react-three/rapier itself uses (nested under it when versions differ, hoisted otherwise).
const require = createRequire(import.meta.url);
const entry = require.resolve('@react-three/rapier').replaceAll('\\', '/');
const root = entry.slice(0, entry.indexOf('/@react-three/rapier/') + '/@react-three/rapier'.length);
const nested = join(root, 'node_modules', '@dimforge', 'rapier3d-compat');
const alias = existsSync(nested) ? { '@dimforge/rapier3d-compat': nested } : {};

export default defineConfig({
  root: 'world',
  base: '/monde/',
  plugins: [react()],
  resolve: { alias },
  build: { outDir: '../dist/monde', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
