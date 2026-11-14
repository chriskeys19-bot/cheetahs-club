import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { AccessHoldPage } from '../pages/AccessHoldPage.tsx'
import { Splash } from './Splash.tsx'

export function RequireAuth() {
  const { session, authReady, googleGateReady, accountProfile, profileReady } = useAuth()
  const location = useLocation()

  if (!authReady || (session && !googleGateReady) || (session && !profileReady)) {
    return <Splash label="Opening the clubhouse…" />
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (accountProfile?.access_status === 'pending') return <AccessHoldPage />
  return <Outlet />
}
