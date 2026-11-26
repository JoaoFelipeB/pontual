import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the same build works on a website and inside the Android app (Capacitor).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 }
});
