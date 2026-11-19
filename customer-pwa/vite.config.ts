import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png'],
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
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        globIgnores: ['**/node_modules/**/*', 'sw.js', 'workbox-*.js', '**/icon.png'],
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
