import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'https://motorcycle-delivery-production.up.railway.app',
      '/admin': 'https://motorcycle-delivery-production.up.railway.app',
    },
  },
  test: {
    environment: 'jsdom',
  },
});
