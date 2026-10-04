// Isolated preview server for the hospital asset. Own config: nothing in the root package.json or the game's vite config is touched.
// Serves world/public (so /models/buildings/*.glb and B's /assets/models/kit-pack.glb resolve) on the A test port range 3200-3209.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('../../../world/public', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 3206, strictPort: true },
  cacheDir: fileURLToPath(new URL('../../../node_modules/.vite-a-assets', import.meta.url)),
});
