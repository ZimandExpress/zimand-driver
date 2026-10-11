import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// O versiune nouă se vede de la PRIMA deschidere.
//
// Plugin-ul PWA scrie un registerSW.js care doar înregistrează worker-ul:
//   navigator.serviceWorker.register('/sw.js')
// Worker-ul nou se instalează, face skipWaiting() + clients.claim() — dar
// pagina care rulează deja a pornit din precache-ul VECHI şi rămâne pe el
// până e închisă. Aşa că fiecare publicare avea nevoie de două deschideri:
// prima arăta tot aplicaţia veche. Exact de-aia nu apărea CMR / semnătura pe
// comenzile deja deschise.
//
// `controllerchange` se aude când worker-ul nou a preluat pagina. Atunci
// reîncărcăm o singură dată, iar şoferul vede build-ul nou pe loc.
if ('serviceWorker' in navigator) {
  // La prima instalare nu era nimic vechi de înlocuit — nu reîncărcăm degeaba.
  const aveaWorker = !!navigator.serviceWorker.controller
  let reincarcat = false
  const reincarca = () => {
    if (reincarcat) return
    reincarcat = true
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!aveaWorker) return
    // Worker-ul se verifică la încărcarea paginii, deci de obicei suntem la
    // câteva secunde de la deschidere: nu are ce pierde şoferul.
    if (performance.now() < 60000) { reincarca(); return }
    // Dacă totuşi a trecut ceva timp, poate completa o livrare chiar acum —
    // o semnătură, nişte poze. Aşteptăm să iasă din aplicaţie şi reîncărcăm
    // când se întoarce.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reincarca()
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
