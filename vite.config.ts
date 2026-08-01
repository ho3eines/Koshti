import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: true, port: 5173 },
  // `public/` is this project's *distribution* folder (built by
  // scripts/make-public.mjs), not Vite's static-assets dir. Leaving the
  // default on would copy public/ into dist/ and nest it on every rebuild.
  publicDir: false,
  build: {
    target: 'es2020',
    outDir: 'dist',
    // Always start from a clean dist so stale chunks (or a previously copied
    // public/ tree) can never leak into the next build.
    emptyOutDir: true,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The production-bundle smoke test links ES modules with node:vm; the
    // npm `test` script sets NODE_OPTIONS=--experimental-vm-modules for it.
  },
} as never);
