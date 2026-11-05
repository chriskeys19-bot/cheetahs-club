import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { RequireAuth } from './components/RequireAuth.tsx'
import { Shell } from './components/Shell.tsx'
import { supabase } from './lib/supabase.ts'
import { ActivitiesPage } from './pages/ActivitiesPage.tsx'
import { AdminPage } from './pages/AdminPage.tsx'
import { AnnouncementsPage } from './pages/AnnouncementsPage.tsx'
import { FeedbackPage } from './pages/FeedbackPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { MembersPage } from './pages/MembersPage.tsx'
import { InvitesPage } from './pages/InvitesPage.tsx'
import { JoinPage } from './pages/JoinPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { PollsPage } from './pages/PollsPage.tsx'
import { SchedulesPage } from './pages/SchedulesPage.tsx'
import { SetupNotice } from './pages/SetupNotice.tsx'

export default function App() {
  if (!supabase) return <SetupNotice />

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/join/:token" element={<JoinPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Shell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/invites" element={<InvitesPage />} />
              <Route path="/announcements" element={<AnnouncementsPage />} />
              <Route path="/activities" element={<ActivitiesPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/polls" element={<PollsPage />} />
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
