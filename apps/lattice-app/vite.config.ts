import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  base: isGitHubPages ? '/WoodwardFormanLatticeGen/' : '/',
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: resolve(__dirname, './src/lib'),
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['lattice-wasm'],
  },
  worker: {
    format: 'es',
  },
});
