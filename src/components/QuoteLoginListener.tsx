import { useEffect } from 'react'
import { noteSignIn } from '../lib/dailyQuote.ts'
import { supabase } from '../lib/supabase.ts'

/** Marks a real sign-in so the home welcome can show again the same day. */
export function QuoteLoginListener() {
  useEffect(() => {
    const client = supabase
    if (!client) return
    const { data } = client.auth.onAuthStateChange((event, session) => {
      noteSignIn(sessionStorage, {
        event,
        accessToken: session?.access_token ?? null,
        lastSignInAt: session?.user.last_sign_in_at ?? null,
      })
    })
    return () => {
      data.subscription.unsubscribe()
    }
  }, [])
  return null
}
