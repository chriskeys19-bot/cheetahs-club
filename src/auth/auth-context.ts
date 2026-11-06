import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { ClubRole, Profile } from '../lib/types.ts'

export type AuthValue = {
  session: Session | null
  /** Role the rest of the UI should follow. May differ from the database while previewing. */
  profile: Profile | null
  /** Profile as stored. Writes that record a role use this, not the preview. */
  accountProfile: Profile | null
  authReady: boolean
  profileReady: boolean
  profileError: string | null
  canSwitchRole: boolean
  /** Set only while the allowlisted owner is previewing a different role. */
  viewRole: ClubRole | null
  setViewRole: (role: ClubRole | null) => void
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  /** False while a Google-only session is still being checked against an invite. */
  googleGateReady: boolean
}

export const AuthContext = createContext<AuthValue | null>(null)
