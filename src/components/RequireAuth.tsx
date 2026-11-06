import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { Splash } from './Splash.tsx'

export function RequireAuth() {
  const { session, authReady, googleGateReady } = useAuth()
  const location = useLocation()

  if (!authReady || (session && !googleGateReady)) return <Splash label="Opening the clubhouse…" />
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
