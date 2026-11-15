import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: true },
  build: {
    cssMinify: true,
    chunkSizeWarningLimit: 700,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples/jsm')) return 'three-extras';
          if (id.includes('node_modules/three')) return 'three-core';
          if (id.includes('node_modules/lenis')) return 'lenis';
        },
      },
    },
  },
});
