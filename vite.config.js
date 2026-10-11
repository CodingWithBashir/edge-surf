import { defineConfig } from 'vite';

// Surf Rush - build configuration.
// `base: './'` keeps the production build portable: the `dist/` folder can be
// served from any sub-path (GitHub Pages project sites, a static host subfolder,
// or even opened through a local static server) without rewriting asset URLs.
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow the game to be embedded / proxied by preview & tunnel hosts.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
