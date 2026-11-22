import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { onAccessChanged, pendingAccessCount } from '../lib/access.ts'
import { canManageClub, displayName, roleLabel } from '../lib/types.ts'
import { CopySignupLink } from './CopySignupLink.tsx'
import { Crest } from './Crest.tsx'
import { InstagramLink } from './InstagramLink.tsx'
import { RoleBadge } from './RoleBadge.tsx'
import { RoleSwitcher } from './RoleSwitcher.tsx'
import { StreamsProvider } from './StreamsProvider.tsx'

export function Shell() {
  const { session, profile, accountProfile, viewRole, setViewRole, canSwitchRole, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const staff = canManageClub(profile?.role)
  const [accessCount, setAccessCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!staff) return
    let cancelled = false
    const load = () => {
      void pendingAccessCount().then((count) => {
        if (!cancelled) setAccessCount(count)
      })
    }
    load()
    const unsubscribe = onAccessChanged(() => {
      if (!cancelled) load()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [staff, location.pathname])

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
    <div className={canSwitchRole ? 'shell shell-preview' : 'shell'}>
      <header className="topbar">
        <div className="topbar-brand">
          <NavLink to="/" className="brand" end>
            <Crest width={56} alt="" />
            <span className="brand-text">
              <span className="brand-kicker">Cheetahs</span>
              <span className="brand-name">Cricket Club</span>
            </span>
          </NavLink>
          <InstagramLink />
        </div>
        <div className="topbar-user">
          <RoleSwitcher placement="header" />
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
        <RoleSwitcher placement="menu" />
        <div className="shell-nav-links">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/announcements">Announcements</NavLink>
          <NavLink to="/activities">Activities</NavLink>
          <NavLink to="/schedules">Schedules</NavLink>
          <NavLink to="/streams">Streams</NavLink>
          {staff ? <NavLink to="/broadcasts">Broadcasts</NavLink> : null}
          <NavLink to="/polls">Polls</NavLink>
          <NavLink to="/dues">Dues</NavLink>
          <NavLink to="/feedback">Feedback</NavLink>
          {staff ? <NavLink to="/invites">Invites</NavLink> : null}
          {staff ? (
            <NavLink to="/access" aria-label={accessCount > 0 ? `Access requests, ${accessCount} waiting` : 'Access requests'}>
              Access
              {accessCount > 0 ? <span className="nav-count">{accessCount > 99 ? '99+' : accessCount}</span> : null}
            </NavLink>
          ) : null}
          {staff ? <CopySignupLink /> : null}
          <NavLink to="/admin">Admin</NavLink>
        </div>
      </nav>
      {viewRole && accountProfile ? (
        <div className="view-banner" role="status">
          <p>
            <span className="view-banner-chip">Viewing as {roleLabel(viewRole)}</span>
            <span className="view-banner-note">UI only. Your saved role is unchanged.</span>
          </p>
          <button type="button" className="view-banner-reset" onClick={() => setViewRole(null)}>
            Reset
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="shell-error" role="alert">
          {error}
        </p>
      ) : null}
      <StreamsProvider>
        <main className="shell-main">
          <Outlet />
        </main>
      </StreamsProvider>
    </div>
  )
}
