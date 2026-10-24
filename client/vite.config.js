import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the API runs on :5000; the proxy avoids CORS and keeps URLs as /api/...
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:5000',
    },
  },
});
