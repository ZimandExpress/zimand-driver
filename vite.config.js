import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Semnul build-ului: data şi ora la care s-a construit pachetul, scrise
// discret în meniu. Fără el, când ceva „nu apare", nu se poate şti dacă
// telefonul rulează versiunea nouă sau una veche din precache — am pierdut
// deja o rundă întreagă căutând în server o problemă care era în bundle.
const SEMN_BUILD = new Date().toLocaleString('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(SEMN_BUILD),
  },
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
        // opencv.js și jscanify se încarcă leneș, doar când șoferul scanează
        // efectiv un document. Nu au ce căuta în precache: altfel service
        // worker-ul descarcă ~9 MB la prima instalare ȘI la fiecare
        // actualizare, pe datele mobile ale șoferului.
        globIgnores: ['**/vendor/opencv.js', '**/vendor/jscanify.js'],
      },
    }),
  ],
})
