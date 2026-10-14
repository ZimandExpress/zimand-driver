// startCache.js — ce a văzut şoferul ultima dată, ţinut pe telefon.
//
// La deschidere aplicaţia întreba serverul pe rând: sesiunea, profilul,
// şoferii firmei, apoi comenzile. Fiecare pas aştepta după cel dinainte,
// iar pe date mobile asta însemna 2–3 secunde de ecran gol.
//
// Acum arătăm imediat ultima stare cunoscută şi o înlocuim cu cea de pe
// server de îndată ce soseşte. Serverul are mereu ultimul cuvânt: nimic de
// aici nu se scrie înapoi şi nu decide nimic, doar umple ecranul cât timp
// sosesc datele adevărate.
//
// Totul e legat de contul conectat şi se şterge la deconectare.

const PREFIX = 'zd-cache:'

export function citesteCache(cheie) {
  try {
    const v = localStorage.getItem(PREFIX + cheie)
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}

export function scrieCache(cheie, valoare) {
  try {
    if (valoare == null) localStorage.removeItem(PREFIX + cheie)
    else localStorage.setItem(PREFIX + cheie, JSON.stringify(valoare))
  } catch {
    // Spaţiu plin sau stocare blocată: aplicaţia merge şi fără, doar mai încet.
  }
}

export function golesteCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k))
  } catch { /* nimic de făcut */ }
}

// Sesiunea salvată de Supabase, citită direct, fără să aşteptăm clientul.
//
// supabase.auth.getSession() aşteaptă iniţializarea, iar dacă tokenul a
// expirat (după o oră) îl reînnoieşte întâi pe server. Pentru primul ecran
// ne ajunge să ştim CINE e conectat; interogările oricum aşteaptă singure
// tokenul reînnoit înainte să plece. Dacă reînnoirea eşuează, getSession
// întoarce null şi aplicaţia trece la login, exact ca înainte.
export function sesiuneSalvata() {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL
    if (!url) return null
    const ref = new URL(url).hostname.split('.')[0]
    const raw = localStorage.getItem(`sb-${ref}-auth-token`)
    if (!raw) return null
    const s = JSON.parse(raw)
    return s?.user?.id && s?.refresh_token ? s : null
  } catch {
    return null
  }
}
