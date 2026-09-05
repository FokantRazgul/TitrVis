import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Vite build configuration. GLSL sources are imported as raw strings (`?raw`). */
export default defineConfig({
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
