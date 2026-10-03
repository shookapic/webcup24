import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'world',
  base: '/monde/',
  plugins: [react()],
  build: { outDir: '../dist/monde', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
