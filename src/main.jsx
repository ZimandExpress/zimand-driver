import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { PlasaEroare, momentSigurPentruVersiuneNoua } from './App.jsx'

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
// reîncărcăm o singură dată — dar nu oricând, ci la primul moment sigur,
// ca să nu întrerupem un şofer în mijlocul unei semnături sau al unei poze.
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

    // Reîncărcăm doar într-un moment sigur: fără comandă deschisă şi cu
    // aplicaţia pe ecran (vezi `momentSigurPentruVersiuneNoua`). Dacă acum
    // nu e sigur, aşteptăm — nu renunţăm. Verificăm la revenirea în aplicaţie
    // şi, pentru cazul în care şoferul iese dintr-o comandă fără să plece din
    // aplicaţie, şi din două în două secunde.
    //
    // Schimbarea poate doar să AMÂNE o reîncărcare, niciodată să provoace una
    // în plus: în cel mai rău caz şoferul vede versiunea veche ceva mai mult,
    // până se întoarce în lista de curse.
    if (momentSigurPentruVersiuneNoua()) { reincarca(); return }

    let ceas = null
    const incearca = () => {
      if (!momentSigurPentruVersiuneNoua()) return
      if (ceas) clearInterval(ceas)
      document.removeEventListener('visibilitychange', incearca)
      reincarca()
    }
    ceas = setInterval(incearca, 2000)
    document.addEventListener('visibilitychange', incearca)
  })
}

// Plasa de aici e ultima: ecranele îşi au propria plasă, aşa că aici ajunge
// doar ce cade în afara lor. Şi ea uită comanda deschisă, ca reîncărcarea să
// nu redeschidă comanda care a căzut.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PlasaEroare ecran="aplicatie" lang={localStorage.getItem('zimand-driver-lang') === 'en' ? 'en' : 'de'}>
      <App />
    </PlasaEroare>
  </React.StrictMode>
)
