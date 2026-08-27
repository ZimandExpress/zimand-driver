import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Trecut la 'injectManifest' — necesar ca să putem adăuga cod propriu
      // pentru notificări push (Workbox singur nu gestionează push-uri).
      // 'src/sw.js' conține precache-ul automat (neschimbat) PLUS partea nouă.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Zimand Driver',
        short_name: 'Zimand Driver',
        description: 'Aplicația de curse și livrări Zimand Express',
        start_url: '/',
        display: 'standalone',
        background_color: '#F6F4F0',
        theme_color: '#0F2240',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // opencv.js (~9 MB) depășește limita implicită de 2 MB — o ridicăm,
        // exact cum indică mesajul de eroare al build-ului.
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
      },
    }),
  ],
})
