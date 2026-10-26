/// <reference types="vitest" />
import { defineConfig } from 'vite';

// No proxy and no key: a public world is read keyless from www.onlyworlds.com, and a world
// file is read in the browser and sends nothing.
export default defineConfig({
  base: '/',
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
