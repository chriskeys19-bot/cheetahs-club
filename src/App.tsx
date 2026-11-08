import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { useAuth } from './auth/useAuth.ts'
import { QuoteLoginListener } from './components/QuoteLoginListener.tsx'
import { RequireAuth } from './components/RequireAuth.tsx'
import { Shell } from './components/Shell.tsx'
import { supabase } from './lib/supabase.ts'
import { ActivitiesPage } from './pages/ActivitiesPage.tsx'
import { AdminPage } from './pages/AdminPage.tsx'
import { AnnouncementsPage } from './pages/AnnouncementsPage.tsx'
import { FeedbackPage } from './pages/FeedbackPage.tsx'
import { DuesPage } from './pages/DuesPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { MembersPage } from './pages/MembersPage.tsx'
import { InvitesPage } from './pages/InvitesPage.tsx'
import { AuthCallbackPage } from './pages/AuthCallbackPage.tsx'
import { JoinPage } from './pages/JoinPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx'
import { PollsPage } from './pages/PollsPage.tsx'
import { SchedulesPage } from './pages/SchedulesPage.tsx'
import { GameCardPreviewPage } from './pages/GameCardPreviewPage.tsx'
import { StreamPreviewPage } from './pages/StreamPreviewPage.tsx'
import { StreamsPage } from './pages/StreamsPage.tsx'
import { SetupNotice } from './pages/SetupNotice.tsx'

function SendRecoveryToReset() {
  const { authReady, passwordRecovery } = useAuth()
  const location = useLocation()
  if (!authReady || !passwordRecovery) return null
  if (
    location.pathname === '/reset-password' ||
    location.pathname === '/login' ||
    location.pathname === '/auth/callback'
  ) {
    return null
  }
  return <Navigate to="/reset-password" replace />
}

export default function App() {
  if (
    import.meta.env.DEV &&
    (window.location.pathname.startsWith('/dev/stream-states') ||
      window.location.pathname.startsWith('/dev/game-cards'))
  ) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/dev/stream-states" element={<StreamPreviewPage />} />
          <Route path="/dev/game-cards" element={<GameCardPreviewPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (!supabase) return <SetupNotice />

  return (
    <AuthProvider>
      <QuoteLoginListener />
      <BrowserRouter>
        <SendRecoveryToReset />
        <Routes>
          {import.meta.env.DEV ? <Route path="/dev/stream-states" element={<StreamPreviewPage />} /> : null}
          {import.meta.env.DEV ? <Route path="/dev/game-cards" element={<GameCardPreviewPage />} /> : null}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/join/:token" element={<JoinPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Shell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/invites" element={<InvitesPage />} />
              <Route path="/announcements" element={<AnnouncementsPage />} />
              <Route path="/activities" element={<ActivitiesPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/streams" element={<StreamsPage />} />
              <Route path="/polls" element={<PollsPage />} />
              <Route path="/dues" element={<DuesPage />} />
              <Route path="/feedback" element={<FeedbackPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/members" element={<MembersPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
