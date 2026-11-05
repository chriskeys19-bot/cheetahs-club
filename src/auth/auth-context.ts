import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from '../lib/types.ts'

export type AuthValue = {
  session: Session | null
  profile: Profile | null
  authReady: boolean
  profileReady: boolean
  profileError: string | null
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)
