import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'icon.png'],
      manifest: {
        name: 'Riders Delivery',
        short_name: 'Riders',
        description: 'Book motorcycle deliveries with Riders.',
        theme_color: '#169B62',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          {
            src: 'icon.png',
            sizes: '1024x1024',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/auth\//, /^\/admin\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: {
      '/auth': 'http://127.0.0.1:3000',
      '/customers': 'http://127.0.0.1:3000',
    },
  },
});
