import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function readEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  const value = import.meta.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

const url = readEnv('VITE_SUPABASE_URL')
const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null
