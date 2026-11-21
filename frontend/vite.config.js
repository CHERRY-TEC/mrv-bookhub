import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Explicit empty PostCSS config: prevents Vite from walking up and
  // loading an unrelated postcss.config.js from a parent directory.
  css: { postcss: { plugins: [] } },
  server: {
    port: 5173,
    proxy: {
      // Same-origin fallback if VITE_API_BASE_URL is set to "/api"
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
});
