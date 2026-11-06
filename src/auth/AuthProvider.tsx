import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, type AuthValue } from './auth-context.ts'
import {
  clearInviteToken,
  finishGoogleSignIn,
  isGoogleOnlyUser,
  readInviteToken,
  writeOauthNotice,
} from '../lib/googleAuth.ts'
import { canSwitchRole, readStoredViewRole, writeStoredViewRole } from '../lib/roleView.ts'
import { ensureSplitwiseMembership, resetSplitwiseEnsureOnSignOut } from '../lib/splitwiseMembership.ts'
import { supabase } from '../lib/supabase.ts'
import { isClubRole, type ClubRole, type Profile } from '../lib/types.ts'
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
  const [viewChoice, setViewChoice] = useState<ClubRole | null>(() => readStoredViewRole())
  const [gate, setGate] = useState<{ userId: string; ready: boolean } | null>(null)

  useEffect(() => {
    if (!client) return

    let cancelled = false

    const { data: subscription } = client.auth.onAuthStateChange((event, next) => {
      if (cancelled) return
      setSession(next)
      setAuthReady(true)
      if (event === 'SIGNED_OUT') {
        resetSplitwiseEnsureOnSignOut()
        return
      }
      if (!next) return
      // Password, invite sign-in, and Google OAuth all land here. Defer the
      // call so it does not run inside the auth callback, and never block login.
      if (event === 'SIGNED_IN') ensureSplitwiseMembership(true)
      else if (event === 'INITIAL_SESSION') ensureSplitwiseMembership(false)
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

  const userId = session?.user.id ?? null
  const onCallback = window.location.pathname === '/auth/callback'
  const needsGoogleGate = !!session && !onCallback && isGoogleOnlyUser(session.user)
  const googleGateReady = !needsGoogleGate || (gate?.userId === userId && gate.ready)

  useEffect(() => {
    if (!client || !userId) return
    const supabaseClient = client
    let cancelled = false

    async function checkGoogleMembership() {
      if (window.location.pathname === '/auth/callback') return
      const { data } = await supabaseClient.auth.getSession()
      const user = data.session?.user
      if (!user || user.id !== userId || !isGoogleOnlyUser(user)) return
      const result = await finishGoogleSignIn(readInviteToken())
      if (cancelled) return
      if (result.status === 'member' || result.status === 'joined') {
        clearInviteToken()
        setGate({ userId, ready: true })
        return
      }
      writeOauthNotice(result)
      clearInviteToken()
      await supabaseClient.auth.signOut()
    }

    void checkGoogleMembership()
    return () => {
      cancelled = true
    }
  }, [client, userId])

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

  const accountProfile = session && profileState?.userId === session.user.id ? profileState.profile : null
  const profileError = session && profileState?.userId === session.user.id ? profileState.error : null
  const profileReady = !session ? authReady : profileState?.userId === session.user.id
  const allowed = canSwitchRole(session?.user.email)
  const viewRole =
    allowed && accountProfile && viewChoice && viewChoice !== accountProfile.role ? viewChoice : null
  const profile = useMemo(() => {
    if (!accountProfile) return null
    if (!viewRole) return accountProfile
    return { ...accountProfile, role: viewRole }
  }, [accountProfile, viewRole])

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

  const setViewRole = useCallback(
    (next: ClubRole | null) => {
      if (!allowed || !accountProfile) return
      const stored = next && next !== accountProfile.role ? next : null
      setViewChoice(stored)
      writeStoredViewRole(stored)
    },
    [allowed, accountProfile],
  )

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      accountProfile,
      authReady,
      profileReady,
      profileError,
      canSwitchRole: allowed && accountProfile !== null,
      viewRole,
      setViewRole,
      signIn,
      signOut,
      googleGateReady,
    }),
    [
      session,
      profile,
      accountProfile,
      authReady,
      profileReady,
      profileError,
      allowed,
      viewRole,
      setViewRole,
      signIn,
      signOut,
      googleGateReady,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
