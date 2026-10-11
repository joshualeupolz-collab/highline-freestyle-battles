import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Installable app with an offline app shell. Video storage offline follows in step 8.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Highline Freestyle Battles',
        short_name: 'HL Battles',
        description: 'Highline freestyle battles with ratings per format',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // API calls always go to the network; only the app itself is cached.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    // `pnpm --filter @hfb/api dev` runs the API on 8787; the dev server forwards /api to it.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
