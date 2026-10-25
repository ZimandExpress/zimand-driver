import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Lipsesc variabilele VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — verifică .env.local sau setările din Vercel.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ── Zimand Software (platforma multi-firmă) ──────────────────────────────
// Aceeași aplicație servește și platforma Zimand Software, unde un cont poate lucra pentru mai multe firme.
// Acolo (VITE_MULTI_TENANT=true) șoferul introduce la login codul firmei; după autentificare, aplicația
// îi spune bazei pe ce firmă lucrează (select_tenant_by_code). Restul aplicației rămâne neschimbat:
// baza și funcțiile de server folosesc firma aleasă.
// Pe Zimand Express (variabila lipsă) nimic din toate astea nu se activează.
export const MULTI_TENANT = import.meta.env.VITE_MULTI_TENANT === 'true'
const CHEIE_COD_FIRMA = 'zs_company_code'

export function codFirmaSalvat() {
  try { return localStorage.getItem(CHEIE_COD_FIRMA) || '' } catch { return '' }
}

// Alege firma după cod. Întoarce null dacă a mers, altfel 'invalid' (cod necunoscut) sau 'not_member'.
export async function alegeFirma(cod) {
  const c = String(cod || '').trim().toUpperCase()
  if (!c) return 'invalid'
  const { error } = await supabase.rpc('select_tenant_by_code', { p_code: c })
  if (error) return /not_member/i.test(error.message) ? 'not_member' : 'invalid'
  try { localStorage.setItem(CHEIE_COD_FIRMA, c) } catch { /* fără stocare */ }
  return null
}
