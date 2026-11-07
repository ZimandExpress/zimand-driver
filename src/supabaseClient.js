import { createClient } from '@supabase/supabase-js'

// ── Zimand Driver: o singură aplicație pentru Zimand Express ȘI platforma Zimand Software ──────────
// Implicit (fără cod de firmă) aplicația lucrează EXACT ca până acum, pe baza Zimand Express.
// Dacă șoferul introduce la login un cod de firmă (sau deschide un link cu ?firmencode=COD), aplicația
// lucrează pe baza Zimand Software, pe firma acelui cod. Alegerea se ține pe telefon ('zd-backend').
// Fiecare bază are sesiunea ei (chei separate în localStorage) și coada ei de dovezi offline (IndexedDB separat).

const ZE = {
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY,
}
const ZS = {
  url: import.meta.env.VITE_ZS_SUPABASE_URL || 'https://khkpvlxsaiylruwfcfke.supabase.co',
  key: import.meta.env.VITE_ZS_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtoa3B2bHhzYWl5bHJ1d2ZjZmtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NDkwMDEsImV4cCI6MjEwODUyNTAwMX0.Qeb57FUsE3q20uLsGQmXpZOVIHFZyItfryqZkQ9vPdY',
}

const CHEIE_BACKEND = 'zd-backend'
const CHEIE_COD_FIRMA = 'zs_company_code'
const CODE_RE = /^[A-Z0-9]{3,12}$/

function citeste(k) { try { return localStorage.getItem(k) || '' } catch { return '' } }
function scrie(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* fără stocare */ } }

// Link de la firmă (invitație șofer / resetare parolă): ?firmencode=COD → platforma Zimand Software
;(() => {
  try {
    const q = new URLSearchParams(window.location.search)
    const c = String(q.get('firmencode') || '').trim().toUpperCase()
    if (CODE_RE.test(c)) { scrie(CHEIE_BACKEND, 'zs'); scrie(CHEIE_COD_FIRMA, c) }
    // Resetare parolă cerută fără cod de firmă (07.11.2026): linkul trimis de
    // platformă are ?platforma=1 → se deschide baza Zimand Software.
    else if (q.get('platforma') === '1') scrie(CHEIE_BACKEND, 'zs')
  } catch { /* */ }
})()

export const BACKEND = citeste(CHEIE_BACKEND) === 'zs' ? 'zs' : 'ze'
export const MULTI_TENANT = BACKEND === 'zs'
const cfg = MULTI_TENANT ? ZS : ZE
export const SUPABASE_URL = cfg.url
export const SUPABASE_ANON_KEY = cfg.key

if (!ZE.url || !ZE.key) {
  console.warn(
    'Lipsesc variabilele VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — verifică .env.local sau setările din Vercel.'
  )
}

export const supabase = createClient(cfg.url, cfg.key)

// Clientul pentru o anumită bază (la login, înainte să comutăm aplicația pe ea).
let celalalt = null
export function clientPentru(backend) {
  if (backend === BACKEND) return supabase
  if (!celalalt) {
    const c = backend === 'zs' ? ZS : ZE
    celalalt = createClient(c.url, c.key)
  }
  return celalalt
}

// Comută aplicația pe altă bază — trebuie urmat de reîncărcarea paginii.
export function seteazaBackend(backend) { scrie(CHEIE_BACKEND, backend === 'zs' ? 'zs' : '') }

export function codFirmaSalvat() { return citeste(CHEIE_COD_FIRMA) }
export function salveazaCodFirma(c) { scrie(CHEIE_COD_FIRMA, c) }
export function codFirmaValid(c) { return CODE_RE.test(String(c || '').trim().toUpperCase()) }

// Alege firma după cod (platforma Zimand Software). Întoarce null dacă a mers, altfel 'invalid' sau 'not_member'.
export async function alegeFirma(cod, client = supabase) {
  const c = String(cod || '').trim().toUpperCase()
  if (!c) return 'invalid'
  const { error } = await client.rpc('select_tenant_by_code', { p_code: c })
  if (error) return /not_member|not a member/i.test(error.message) ? 'not_member' : 'invalid'
  salveazaCodFirma(c)
  return null
}

// Cheia publică pentru notificări push — fiecare bază are perechea ei de chei.
export const VAPID_PUBLIC_KEY_PLATFORMA = import.meta.env.VITE_ZS_VAPID_PUBLIC_KEY || 'BBR905Tmony7cgnzrREyLjbMt4sIFDcUnlFBdgmURV5JBrVlY_skDu2eu88-RagRDNA2pfLfpf1Kkvg1OrpXSGA'

// Brandingul firmei (nume, logo, culoare principală) pentru ecranul de intrare și antet — platforma
// Zimand Software, prin RPC-ul public driver_branding_by_code. Ținut pe telefon ('zs_brand_<COD>'),
// ca ecranul să apară imediat, chiar fără rețea. Fără cod de firmă: nimic (aspectul Zimand Express).
const PREFIX_BRAND = 'zs_brand_'
const CULOARE_RE = /^#[0-9A-Fa-f]{6}$/

export function brandFirmaSalvat(cod) {
  const c = String(cod || '').trim().toUpperCase()
  if (!CODE_RE.test(c)) return null
  try {
    const v = JSON.parse(citeste(PREFIX_BRAND + c) || 'null')
    return v && v.name ? v : null
  } catch { return null }
}

export async function incarcaBrandFirma(cod) {
  const c = String(cod || '').trim().toUpperCase()
  if (!CODE_RE.test(c)) return null
  try {
    const { data, error } = await clientPentru('zs').rpc('driver_branding_by_code', { p_code: c })
    if (error) return brandFirmaSalvat(c) // fără rețea / eroare: rămâne ce știm
    if (!data || !data.name) { scrie(PREFIX_BRAND + c, ''); return null } // cod necunoscut
    const b = {
      name: String(data.name).slice(0, 80),
      logo_url: typeof data.logo_url === 'string' && /^https:\/\//i.test(data.logo_url) ? data.logo_url : null,
      primary_color: CULOARE_RE.test(data.primary_color || '') ? data.primary_color : null,
    }
    scrie(PREFIX_BRAND + c, JSON.stringify(b))
    return b
  } catch { return brandFirmaSalvat(c) }
}
