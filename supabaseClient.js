import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Lipsesc variabilele VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — verifică .env.local sau setările din Vercel.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
