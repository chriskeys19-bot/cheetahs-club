import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, type AuthValue } from './auth-context.ts'
import { supabase } from '../lib/supabase.ts'
import { isClubRole, type Profile } from '../lib/types.ts'
import type { Session } from '@supabase/supabase-js'

function parseProfile(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !isClubRole(row.role)) return null
  if (row.full_name !== null && typeof row.full_name !== 'string') return null
  return { id: row.id, full_name: row.full_name, role: row.role }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = supabase
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!client)
  const [profileState, setProfileState] = useState<{
    userId: string
    profile: Profile | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (!client) return

    let cancelled = false

    const { data: subscription } = client.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return
      setSession(next)
      setAuthReady(true)
    })

    client.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setAuthReady(true)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [client])

  useEffect(() => {
    if (!authReady || !client || !session) return

    const userId = session.user.id
    let cancelled = false

    client
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setProfileState({ userId, profile: null, error: error.message })
        } else {
          setProfileState({ userId, profile: parseProfile(data), error: null })
        }
      })

    return () => {
      cancelled = true
    }
  }, [authReady, client, session])

  const profile = session && profileState?.userId === session.user.id ? profileState.profile : null
  const profileError = session && profileState?.userId === session.user.id ? profileState.error : null
  const profileReady = !session ? authReady : profileState?.userId === session.user.id

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!client) return 'Supabase is not configured.'
      const { error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      return error ? error.message : null
    },
    [client],
  )

  const signOut = useCallback(async () => {
    if (!client) return
    const { error } = await client.auth.signOut()
    if (error) throw new Error(error.message)
  }, [client])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      authReady,
      profileReady,
      profileError,
      signIn,
      signOut,
    }),
    [session, profile, authReady, profileReady, profileError, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
