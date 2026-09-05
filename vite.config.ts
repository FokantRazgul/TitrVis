import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Vite build configuration. GLSL sources are imported as raw strings (`?raw`). */
export default defineConfig({
  // BASE_PATH is set by the GitHub Pages workflow (e.g. "/TitrVis/"); locally the app is served at "/".
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          plotly: ['plotly.js-basic-dist-min', 'react-plotly.js'],
        },
      },
    },
  },
});
