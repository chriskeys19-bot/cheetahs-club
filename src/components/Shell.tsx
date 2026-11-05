import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { displayName } from '../lib/types.ts'
import { RoleBadge } from './RoleBadge.tsx'

export function Shell() {
  const { session, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const email = session?.user.email ?? null
  const name = displayName(profile, email)

  async function onSignOut() {
    setBusy(true)
    setError(null)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not sign out.'
      setError(message)
      setBusy(false)
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand" end>
          <img src="/crest.jpg" alt="" width={56} height={56} />
          <span className="brand-text">
            <span className="brand-kicker">Cheetahs</span>
            <span className="brand-name">Cricket Club</span>
          </span>
        </NavLink>
        <div className="topbar-user">
          <div className="identity">
            <span className="identity-name">{name}</span>
            <span className="identity-email">{email}</span>
          </div>
          <RoleBadge role={profile?.role ?? null} />
          <button type="button" className="sign-out" onClick={onSignOut} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>
      <nav className="shell-nav" aria-label="Clubhouse">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/announcements">Announcements</NavLink>
        <NavLink to="/activities">Activities</NavLink>
        <NavLink to="/schedules">Schedules</NavLink>
        <NavLink to="/polls">Polls</NavLink>
        <NavLink to="/feedback">Feedback</NavLink>
        <NavLink to="/admin">Admin</NavLink>
      </nav>
      {error ? (
        <p className="shell-error" role="alert">
          {error}
        </p>
      ) : null}
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  )
}
