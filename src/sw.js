// Service worker personalizat — precache-ul generat automat de Workbox
// (fișierele aplicației) rămâne neschimbat; adăugăm doar partea de
// notificări push, care are nevoie de cod propriu (Workbox singur nu
// gestionează push-uri).

import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

precacheAndRoute(self.__WB_MANIFEST)

// Păstrat identic cu configurația anterioară (generateSW) — fonturile
// Google rămân în cache, nu se pierde acest comportament la trecerea
// la strategia injectManifest.
registerRoute(
  ({ url }) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url.href),
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  })
)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// O comandă nouă a apărut, sau una a fost anulată/redeschisă — afișează
// notificarea chiar cu telefonul blocat sau aplicația complet închisă.
self.addEventListener('push', (event) => {
  let data = { title: 'Zimand Driver', body: 'Neue Benachrichtigung', url: '/' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {}

  // Gruparea în bara de notificări.
  //
  // Toate notificările purtau aceeaşi etichetă, 'zimand-order-update'. Două
  // cu aceeaşi etichetă se înlocuiesc una pe alta: o anulare ştergea din
  // bară atribuirea de dinainte, şi două curse pierdute deodată se vedeau
  // ca una singură. Telefonul suna oricum (`renotify`), dar în bară rămânea
  // doar ultima.
  //
  // Acum fiecare veste îşi ţine locul: eticheta trimisă de server, dacă
  // vine una, altfel una scoasă din titlu — care diferă de la o veste la
  // alta. Aceeaşi notificare trimisă de două ori se uneşte în continuare.
  const eticheta = data.tag
    || ('zimand-' + String(data.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60))

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: data.url },
      tag: eticheta,
      renotify: true,
    })
  )
})

// La apăsarea notificării — deschide aplicația (sau aduce în prim-plan
// tab-ul deja deschis, dacă există unul).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin))
      if (existing) return existing.focus()
      return self.clients.openWindow(targetUrl)
    })
  )
})
