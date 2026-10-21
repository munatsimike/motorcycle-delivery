import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://127.0.0.1:3000',
      '/admin': 'http://127.0.0.1:3000',
    },
  },
  test: {
    environment: 'jsdom',
  },
});
